import { describe, expect, it, vi } from 'vitest';
import {
  PostmarkEmailProvider,
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

  it('maps Semaphore acceptance and callbacks', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify([{ message_id: 42 }]), { status: 200 }));
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
    ).resolves.toEqual({ provider: 'semaphore', providerMessageId: '42', status: 'ACCEPTED' });
    expect(normalizeSemaphoreStatus('delivered')).toBe('DELIVERED');
    expect(normalizeSemaphoreStatus('queued')).toBe('DELAYED');
    expect(normalizeSemaphoreStatus('undelivered')).toBe('FAILED');
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
