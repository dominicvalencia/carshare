import { afterEach, describe, expect, it, vi } from 'vitest';
import { MayaPaymentProvider } from './maya-payment.provider';

const options = {
  authCaptureEnabled: true,
  baseUrl: 'https://pg-sandbox.paymaya.com',
  cancelUrl: 'https://local.test/cancel',
  failureUrl: 'https://local.test/failure',
  publicKey: 'sandbox-public',
  secretKey: 'sandbox-secret',
  successUrl: 'https://local.test/success',
  voidRefundEnabled: true,
  webhookAllowedIps: ['203.0.113.10'],
};
const referenced = {
  amountMinor: 10_000n,
  currency: 'PHP',
  externalPaymentId: 'pay-1',
  idempotencyKey: 'operation-1',
  requestReference: 'booking-1',
};

afterEach(() => vi.unstubAllGlobals());

describe('Maya sandbox adapter', () => {
  it('creates an authentication session with idempotency and no secret leakage', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ checkoutId: 'checkout-1', redirectUrl: 'https://sandbox.test/3ds' }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider(options);
    await expect(
      provider.authorize({
        amountMinor: 10_000n,
        currency: 'PHP',
        description: 'Rental',
        idempotencyKey: 'authorize-1',
        requestReference: 'booking-1',
      }),
    ).resolves.toMatchObject({
      customerActionUrl: 'https://sandbox.test/3ds',
      externalPaymentId: 'checkout-1',
      kind: 'ACTION_REQUIRED',
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'Idempotency-Key': 'authorize-1',
    });
    expect(JSON.stringify(fetchMock.mock.calls[0]?.[1]?.body)).not.toContain('sandbox-secret');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      authorizationType: 'NORMAL',
    });
  });

  it('creates an ordinary PHP checkout without requesting auth/capture', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ checkoutId: 'checkout-1', redirectUrl: 'https://sandbox.test/pay' }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider({ ...options, authCaptureEnabled: false });
    await expect(
      provider.createCheckout({
        amountMinor: 10_000n,
        currency: 'PHP',
        description: 'Certification',
        idempotencyKey: 'certify-1',
        requestReference: 'certification-1',
      }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({ totalAmount: { value: 100, currency: 'PHP' } });
    expect(request).not.toHaveProperty('authorizationType');
  });

  it('rejects invalid checkout amounts and currencies before transport', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider(options);
    const input = {
      amountMinor: 10_000n,
      currency: 'PHP',
      description: 'Certification',
      idempotencyKey: 'certify-1',
      requestReference: 'certification-1',
    };
    await expect(provider.createCheckout({ ...input, amountMinor: 0n })).rejects.toMatchObject({
      category: 'CONFIGURATION',
    });
    await expect(provider.createCheckout({ ...input, currency: 'USD' })).rejects.toMatchObject({
      category: 'CONFIGURATION',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'CONFIGURATION'],
    [403, 'CONFIGURATION'],
    [429, 'PROVIDER_UNAVAILABLE'],
    [500, 'PROVIDER_UNAVAILABLE'],
  ])('maps HTTP %i to a safe %s error', async (status, category) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'provider detail', secret: 'do-not-log' }), {
          status,
        }),
      ),
    );
    const provider = new MayaPaymentProvider(options);
    await expect(provider.retrievePayment('pay-1')).rejects.toMatchObject({ category });
  });

  it('exposes only bounded, redacted diagnostics for explicit certification tooling', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errorCode: 'PY0001',
            message: 'Rejected sk-private123 for person@example.com card 4123450131001381',
          }),
          { status: 400 },
        ),
      ),
    );
    const provider = new MayaPaymentProvider(options);
    await expect(provider.retrievePayment('pay-1')).rejects.toMatchObject({
      category: 'CONFIGURATION',
      diagnostics: {
        errorCode: 'PY0001',
        httpStatus: 400,
        reason: 'Rejected [REDACTED] for [REDACTED] card [REDACTED]',
      },
    });
  });

  it('retains safe diagnostics when Maya returns an incomplete HTTP 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errorCode: 'KY0001', message: 'Invalid redirect URL' }), {
          status: 200,
        }),
      ),
    );
    const provider = new MayaPaymentProvider(options);
    await expect(
      provider.createCheckout({
        amountMinor: 10_000n,
        currency: 'PHP',
        description: 'Certification',
        idempotencyKey: 'certify-1',
        requestReference: 'carshare-local-maya-certification',
      }),
    ).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
      diagnostics: {
        errorCode: 'KY0001',
        httpStatus: 200,
        reason: 'Invalid redirect URL',
        requestReference: 'carshare-local-maya-certification',
      },
    });
  });

  it('fails safely for malformed responses and transport timeouts', async () => {
    const provider = new MayaPaymentProvider(options);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })));
    await expect(provider.retrievePayment('pay-1')).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout with secret detail')));
    await expect(provider.retrievePayment('pay-1')).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
      message: 'Maya could not be reached; the result must be reconciled.',
    });
  });

  it('normalizes capture, void, refund, pending, failure, unknown and reconciliation states', async () => {
    const responses = [
      { status: 'CAPTURED', paymentId: 'pay-1', id: 'capture-1' },
      { status: 'VOIDED', paymentId: 'pay-1', id: 'void-1' },
      { status: 'PAYMENT_SUCCESS', paymentId: 'pay-1', id: 'refund-1' },
      { status: 'FOR_AUTHENTICATION', paymentId: 'pay-1' },
      { status: 'PAYMENT_FAILED', paymentId: 'pay-1' },
      { status: 'VENDOR_NEW_STATE', paymentId: 'pay-1' },
    ];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 })),
        ),
    );
    const provider = new MayaPaymentProvider(options);
    await expect(provider.capture(referenced)).resolves.toMatchObject({ kind: 'SUCCEEDED' });
    await expect(provider.voidAuthorization(referenced)).resolves.toMatchObject({
      kind: 'SUCCEEDED',
    });
    await expect(
      provider.refund({ ...referenced, reason: 'approved refund' }),
    ).resolves.toMatchObject({ kind: 'SUCCEEDED' });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({ state: 'PENDING' });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({ state: 'FAILED' });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({ state: 'UNKNOWN' });
  });

  it('requires allowlisted webhooks, produces stable duplicate identities, and reconciles timeouts', async () => {
    const provider = new MayaPaymentProvider(options);
    const payload = { id: 'pay-1', status: 'AUTHORIZED', updatedAt: '2026-09-06T00:00:00Z' };
    await expect(
      provider.verifyWebhook({ payload, rawBody: Buffer.from('{}'), sourceIp: '198.51.100.2' }),
    ).rejects.toMatchObject({ category: 'INVALID_WEBHOOK' });
    const first = await provider.verifyWebhook({
      payload,
      rawBody: Buffer.from('{}'),
      sourceIp: '203.0.113.10',
    });
    const duplicate = await provider.verifyWebhook({
      payload,
      rawBody: Buffer.from('{}'),
      sourceIp: '203.0.113.10',
    });
    expect(duplicate.externalEventId).toBe(first.externalEventId);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    await expect(provider.capture(referenced)).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
    });
  });
});
