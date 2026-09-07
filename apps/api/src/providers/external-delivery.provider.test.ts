import { describe, expect, it, vi } from 'vitest';
import {
  PostmarkEmailProvider,
  PostmarkProviderError,
  SemaphoreProviderError,
  SemaphoreSmsProvider,
  generateOtp,
  hashOtp,
  normalizePostmarkEvent,
  normalizeSemaphoreStatus,
  verifyOtp,
} from './external-delivery.provider';

const config = (values: Record<string, unknown>) => ({
  get: (key: string) => values[key],
  getOrThrow: (key: string) => {
    if (values[key] === undefined) throw new Error(`missing ${key}`);
    return values[key];
  },
});

describe('external delivery providers', () => {
  it('maps Postmark acceptance and suppression events without leaking the auth token into headers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-1' }), { status: 200 }),
      );
    const provider = new PostmarkEmailProvider(
      config({
        POSTMARK_SERVER_TOKEN: 'server-token',
        POSTMARK_FROM_EMAIL: 'noreply@carshare.ph',
        POSTMARK_MESSAGE_STREAM: 'outbound',
      }) as never,
    );
    await expect(
      provider.sendTransactional(
        {
          to: 'member@example.com',
          template: 'EMAIL_VERIFICATION',
          token: 'auth-secret',
          actionUrl: 'https://example.test/verify',
        },
        'delivery-1',
      ),
    ).resolves.toEqual({ provider: 'postmark', providerMessageId: 'pm-1', status: 'ACCEPTED' });
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['X-CarShare-Idempotency-Key']).toBe('delivery-1');
    expect(JSON.stringify(headers)).not.toContain('auth-secret');
    expect(normalizePostmarkEvent('Bounce')).toBe('BOUNCED');
    expect(normalizePostmarkEvent('SpamComplaint')).toBe('COMPLAINED');
    expect(normalizePostmarkEvent('SubscriptionChange')).toBe('SUPPRESSED');
    fetchMock.mockRestore();
  });

  it('sends one safe raw certification email through the transactional stream', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ErrorCode: 0, MessageID: 'pm-cert-1' }), { status: 200 }),
      );
    const provider = new PostmarkEmailProvider(
      config({
        POSTMARK_SERVER_TOKEN: 'private-server-token',
        POSTMARK_FROM_EMAIL: 'sender@example.test',
        POSTMARK_MESSAGE_STREAM: 'outbound',
      }) as never,
    );

    await expect(
      provider.sendCertification('controlled@example.test', 'certification-1'),
    ).resolves.toEqual({
      provider: 'postmark',
      providerMessageId: 'pm-cert-1',
      status: 'ACCEPTED',
    });
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.postmarkapp.com/email');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(request?.headers).toMatchObject({
      'X-Postmark-Server-Token': 'private-server-token',
      'X-CarShare-Idempotency-Key': 'certification-1',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      From: 'sender@example.test',
      To: 'controlled@example.test',
      Subject: 'CarShare Postmark local certification',
      TextBody:
        'CarShare transactional email delivery is configured correctly for local provider certification.',
      MessageStream: 'outbound',
    });
    fetchMock.mockRestore();
  });

  it('maps Postmark retryable and rejected responses to safe errors', async () => {
    const provider = new PostmarkEmailProvider(
      config({
        POSTMARK_SERVER_TOKEN: 'private-server-token',
        POSTMARK_FROM_EMAIL: 'sender@example.test',
      }) as never,
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await expect(
      provider.sendCertification('controlled@example.test', 'certification-1'),
    ).rejects.toThrow('EMAIL_PROVIDER_RETRYABLE');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 422 }));
    await expect(
      provider.sendCertification('controlled@example.test', 'certification-2'),
    ).rejects.toThrow('EMAIL_PROVIDER_REJECTED');
    fetchMock.mockRestore();
  });

  it('retains only sanitized Postmark rejection diagnostics', async () => {
    const provider = new PostmarkEmailProvider(
      config({
        POSTMARK_SERVER_TOKEN: 'private-server-token',
        POSTMARK_FROM_EMAIL: 'sender@example.test',
      }) as never,
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ErrorCode: 412,
          Message:
            'While pending approval, recipient@example.test must share sender@example.test domain. private-server-token-private-value',
        }),
        { headers: { 'X-Postmark-Request-Id': 'request-12345678' }, status: 422 },
      ),
    );

    const failure = await provider
      .sendCertification('recipient@example.test', 'certification-1')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PostmarkProviderError);
    expect(failure).toMatchObject({
      message: 'EMAIL_PROVIDER_REJECTED',
      diagnostics: {
        httpStatus: 422,
        errorCode: 412,
        providerRequestId: 'request-12345678',
      },
    });
    expect(failure.diagnostics.reason).toContain('[redacted-email]');
    expect(failure.diagnostics.reason).toContain('[redacted-credential]');
    expect(failure.diagnostics.reason).not.toContain('recipient@example.test');
    expect(failure.diagnostics.reason).not.toContain('private-server-token-private-value');
    fetchMock.mockRestore();
  });

  it('maps Semaphore acceptance and callbacks', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ message_id: 42, status: 'Queued' }]), { status: 200 }),
      );
    const provider = new SemaphoreSmsProvider(
      config({
        SEMAPHORE_API_KEY: 'api-key',
        SEMAPHORE_API_URL: 'https://api.semaphore.co/api/v4/messages',
      }) as never,
    );
    await expect(
      provider.sendOtp(
        { to: '+639171234567', template: 'LOGIN_OTP', code: '123456' },
        'delivery-2',
      ),
    ).resolves.toEqual({ provider: 'semaphore', providerMessageId: '42', status: 'DELAYED' });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(form.get('number')).toBe('639171234567');
    expect(form.get('sendername')).toBeNull();
    expect(form.get('apikey')).toBe('api-key');
    expect(normalizeSemaphoreStatus('delivered')).toBe('DELIVERED');
    expect(normalizeSemaphoreStatus('sent')).toBe('DELIVERED');
    expect(normalizeSemaphoreStatus('queued')).toBe('DELAYED');
    expect(normalizeSemaphoreStatus('refunded')).toBe('FAILED');
    expect(normalizeSemaphoreStatus('undelivered')).toBe('FAILED');
    fetchMock.mockRestore();
  });

  it('sends fixed certification content and includes only an explicitly configured sender', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ message_id: 'sms-1', status: 'Sent' }]), { status: 200 }),
      );
    const provider = new SemaphoreSmsProvider(
      config({
        SEMAPHORE_API_KEY: 'api-key',
        SEMAPHORE_API_URL: 'https://api.semaphore.co/api/v4/messages',
        SEMAPHORE_SENDER_NAME: 'ApprovedName',
      }) as never,
    );

    await expect(provider.sendCertification('+639171234567', 'certification-1')).resolves.toEqual({
      provider: 'semaphore',
      providerMessageId: 'sms-1',
      status: 'DELIVERED',
    });
    const form = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(form.get('number')).toBe('639171234567');
    expect(form.get('message')).toBe(
      'CarShare Semaphore local certification. SMS delivery is configured correctly.',
    );
    expect(form.get('sendername')).toBe('ApprovedName');
    fetchMock.mockRestore();
  });

  it.each([
    [401, 'INVALID_API_KEY', 'Invalid API key abcdefghijklmnopqrstuvwxyz'],
    [402, 'INSUFFICIENT_CREDITS', 'Insufficient credits'],
    [422, 'INVALID_RECIPIENT', 'Invalid recipient +639171234567'],
  ])('maps Semaphore HTTP %s rejection safely', async (status, code, message) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ code, message }), { status }));
    const provider = new SemaphoreSmsProvider(config({ SEMAPHORE_API_KEY: 'api-key' }) as never);
    const failure = await provider
      .sendCertification('+639171234567', 'certification-1')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SemaphoreProviderError);
    expect(failure).toMatchObject({
      message: 'SMS_PROVIDER_REJECTED',
      diagnostics: { httpStatus: status, providerCode: code },
    });
    expect(failure.diagnostics.reason).not.toContain('+639171234567');
    expect(failure.diagnostics.reason).not.toContain('abcdefghijklmnopqrstuvwxyz');
    fetchMock.mockRestore();
  });

  it.each([429, 500])('maps Semaphore HTTP %s to a retryable error', async (status) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Retry later' }), { status }));
    const provider = new SemaphoreSmsProvider(config({ SEMAPHORE_API_KEY: 'api-key' }) as never);
    await expect(
      provider.sendCertification('+639171234567', 'certification-1'),
    ).rejects.toMatchObject({ message: 'SMS_PROVIDER_RETRYABLE' });
    fetchMock.mockRestore();
  });

  it('maps provider timeout without exposing the recipient', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const provider = new SemaphoreSmsProvider(config({ SEMAPHORE_API_KEY: 'api-key' }) as never);
    await expect(
      provider.sendCertification('+639171234567', 'certification-1'),
    ).rejects.toMatchObject({
      message: 'SMS_PROVIDER_RETRYABLE',
      diagnostics: { httpStatus: 0, providerCode: 'TIMEOUT' },
    });
    fetchMock.mockRestore();
  });

  it('rejects a malformed Semaphore success response', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const provider = new SemaphoreSmsProvider(config({ SEMAPHORE_API_KEY: 'api-key' }) as never);
    await expect(
      provider.sendCertification('+639171234567', 'certification-1'),
    ).rejects.toMatchObject({
      message: 'SMS_PROVIDER_REJECTED',
      diagnostics: { providerCode: 'MALFORMED_RESPONSE' },
    });
    fetchMock.mockRestore();
  });

  it('generates and verifies hashed, expirable-service-ready OTP values', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
    const encoded = hashOtp(otp, 'fixed-test-salt');
    expect(encoded).not.toContain(otp);
    expect(verifyOtp(otp, encoded)).toBe(true);
    expect(verifyOtp('000000', encoded)).toBe(false);
  });
});
