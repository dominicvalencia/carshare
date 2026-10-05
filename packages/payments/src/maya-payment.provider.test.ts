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
  it('declares evidence capabilities conservatively', () => {
    const evidence = new MayaPaymentProvider(options).capabilities.evidence;
    expect(evidence).toMatchObject({
      supportsIdempotentReplayAfterTimeout: 'UNPROVEN',
      supportsMultipleCaptures: 'UNSUPPORTED',
      supportsOperationSpecificRetrieval: 'UNPROVEN',
      supportsPartialCapture: 'UNSUPPORTED',
      supportsSecurityDepositUtilization: 'UNSUPPORTED',
      supportsWebhookOperationAmount: 'UNPROVEN',
      supportsWebhookOperationIdentity: 'UNPROVEN',
    });
  });
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

  it('uses PREAUTHORIZATION only for explicitly enabled security deposit holds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ checkoutId: 'deposit-1', redirectUrl: 'https://sandbox.test/3ds' }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider({
      ...options,
      securityDepositPreauthorizationEnabled: true,
    });
    await provider.authorize({
      amountMinor: 500_000n,
      authorizationType: 'PREAUTHORIZATION',
      currency: 'PHP',
      description: 'Security deposit',
      idempotencyKey: 'deposit-authorize-1',
      requestReference: 'booking-deposit-1',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      authorizationType: 'PREAUTHORIZATION',
    });
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
      { status: 'SUCCESS', paymentId: 'pay-1', id: 'void-1' },
      { status: 'PAYMENT_SUCCESS', paymentId: 'pay-1', id: 'refund-1' },
      {
        status: 'FOR_AUTHENTICATION',
        paymentId: 'pay-1',
        refundedAmount: { currency: 'PHP', value: 123.45 },
      },
      { status: 'PAYMENT_FAILED', paymentId: 'pay-1' },
      { status: 'VENDOR_NEW_STATE', paymentId: 'pay-1' },
    ];
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 })),
      );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider(options);
    await expect(provider.capture(referenced)).resolves.toMatchObject({ kind: 'SUCCEEDED' });
    await expect(provider.voidAuthorization(referenced)).resolves.toMatchObject({
      kind: 'SUCCEEDED',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      reason: 'CarShare authorization release.',
    });
    await expect(
      provider.refund({ ...referenced, reason: 'approved refund' }),
    ).resolves.toMatchObject({ kind: 'SUCCEEDED' });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({
      refundedAmountMinor: 12_345n,
      state: 'PENDING',
    });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({ state: 'FAILED' });
    await expect(provider.retrievePayment('pay-1')).resolves.toMatchObject({ state: 'UNKNOWN' });
  });

  it('retrieves an authorization by its durable request reference after a lost create response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            amount: { currency: 'PHP', value: 5000 },
            id: 'deposit-payment-1',
            status: 'AUTHORIZED',
          },
        ]),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new MayaPaymentProvider(options);

    await expect(
      provider.retrievePaymentByRequestReference('deposit-request-1'),
    ).resolves.toMatchObject({
      externalPaymentId: 'deposit-payment-1',
      authorizedAmountMinor: 500_000n,
      currency: 'PHP',
      providerState: 'AUTHORIZED',
      state: 'AUTHORIZED',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pg-sandbox.paymaya.com/payments/v1/payment-rrns/deposit-request-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fails closed when a request-reference lookup is ambiguous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 'deposit-payment-1', status: 'AUTHORIZED' },
            { id: 'deposit-payment-2', status: 'PENDING_TOKEN' },
          ]),
          { status: 200 },
        ),
      ),
    );

    await expect(
      new MayaPaymentProvider(options).retrievePaymentByRequestReference('duplicate-reference'),
    ).rejects.toMatchObject({
      category: 'PROVIDER_UNAVAILABLE',
      diagnostics: {
        reason: 'Expected one payment for the request reference but received 2.',
      },
    });
  });

  it('normalizes the top-level amount and currency returned by Maya Checkout retrieval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            amount: '3000',
            currency: 'PHP',
            id: 'deposit-payment-1',
            status: 'AUTHORIZED',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      new MayaPaymentProvider(options).retrievePayment('deposit-payment-1'),
    ).resolves.toMatchObject({
      authorizedAmountMinor: 300_000n,
      currency: 'PHP',
      state: 'AUTHORIZED',
    });
  });

  it.each([
    'PENDING_TOKEN',
    'PENDING_PAYMENT',
    'FOR_AUTHENTICATION',
    'AUTHENTICATING',
    'AUTH_SUCCESS',
    'PAYMENT_PROCESSING',
  ])('maps documented in-progress authorization state %s to pending', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'payment-1', status }), { status: 200 }),
        ),
    );

    await expect(
      new MayaPaymentProvider(options).retrievePayment('payment-1'),
    ).resolves.toMatchObject({
      providerState: status,
      state: 'PENDING',
    });
  });

  it('maps a documented authentication failure to a definitive failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'payment-1', status: 'AUTH_FAILED' }), { status: 200 }),
        ),
    );

    await expect(
      new MayaPaymentProvider(options).retrievePayment('payment-1'),
    ).resolves.toMatchObject({
      providerState: 'AUTH_FAILED',
      state: 'FAILED',
    });
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
