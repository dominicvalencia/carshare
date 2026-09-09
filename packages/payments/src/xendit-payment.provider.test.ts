import { afterEach, describe, expect, it, vi } from 'vitest';
import { XenditPaymentProvider } from './xendit-payment.provider';

const input = {
  amountMinor: 10_000n,
  currency: 'PHP',
  description: 'Certification',
  idempotencyKey: 'stable-key',
  requestReference: 'carshare-local-xendit-certification',
};
afterEach(() => vi.unstubAllGlobals());
describe('Xendit Payment Sessions adapter', () => {
  it('creates a hosted PHP session with Basic auth and idempotency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          payment_session_id: 'ps-test',
          payment_link_url: 'https://dev.xen.to/test',
          status: 'ACTIVE',
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new XenditPaymentProvider({ secretKey: 'xnd_development_secret' }).createSession(input),
    ).resolves.toMatchObject({ externalPaymentId: 'ps-test', kind: 'ACTION_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.xendit.co/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
    const options = fetchMock.mock.calls[0]?.[1];
    expect(options.headers).toMatchObject({ 'Idempotency-Key': 'stable-key' });
    expect(JSON.parse(String(options.body))).toMatchObject({
      amount: 100,
      currency: 'PHP',
      country: 'PH',
      mode: 'PAYMENT_LINK',
      capture_method: 'AUTOMATIC',
    });
    expect(String(options.body)).not.toContain('xnd_development_secret');
    expect(JSON.parse(String(options.body))).not.toHaveProperty('success_return_url');
  });
  it('rejects invalid amount and currency before transport', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new XenditPaymentProvider({ secretKey: 'test' });
    await expect(provider.createSession({ ...input, amountMinor: 0n })).rejects.toMatchObject({
      category: 'CONFIGURATION',
    });
    await expect(provider.createSession({ ...input, currency: 'USD' })).rejects.toMatchObject({
      category: 'CONFIGURATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'CONFIGURATION'],
    [429, 'PROVIDER_UNAVAILABLE'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %i safely', async (status, category) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error_code: 'SAFE_CODE',
            message: 'Rejected xnd_development_private for user@example.com card 4111111111111111',
          }),
          { status },
        ),
      ),
    );
    await expect(
      new XenditPaymentProvider({ secretKey: 'private' }).createSession(input),
    ).rejects.toMatchObject({
      category,
      diagnostics: {
        errorCode: 'SAFE_CODE',
        httpStatus: status,
        reason: 'Rejected [REDACTED] for [REDACTED] card [REDACTED]',
      },
    });
  });
  it('fails closed for malformed/incomplete responses and timeout', async () => {
    const provider = new XenditPaymentProvider({ secretKey: 'test' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })));
    await expect(provider.createSession(input)).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout secret')));
    await expect(provider.createSession(input)).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
    });
  });
  it('keeps unsupported lifecycle operations provider-neutral and disabled', async () => {
    const provider = new XenditPaymentProvider({ secretKey: 'test' });
    await expect(provider.authorize(input)).rejects.toMatchObject({ category: 'CONFIGURATION' });
    expect(provider.capabilities.supportsWebhooks).toBe(false);
  });
});
