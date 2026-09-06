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
