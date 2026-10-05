import { describe, expect, it } from 'vitest';
import { FakePaymentProvider } from './fake-payment.provider';

describe('payment provider contract', () => {
  it('uses a stable provider payment reference and supports idempotent state retrieval', async () => {
    const provider = new FakePaymentProvider();
    const authorization = await provider.authorize({
      amountMinor: 500_000n,
      currency: 'PHP',
      description: 'Rental',
      idempotencyKey: 'booking:one:authorize:v1',
      requestReference: 'fb1bc085-6f68-4a03-8005-e810a0031233',
    });
    expect(authorization.kind).toBe('SUCCEEDED');
    expect((await provider.retrievePayment(authorization.externalPaymentId!)).state).toBe(
      'AUTHORIZED',
    );
  });

  it('classifies an uncertain provider response as unknown', async () => {
    const provider = new FakePaymentProvider('unknown');
    const result = await provider.authorize({
      amountMinor: 100n,
      currency: 'PHP',
      description: 'Rental',
      idempotencyKey: 'booking:two:authorize:v1',
      requestReference: 'fb1bc085-6f68-4a03-8005-e810a0031234',
    });
    expect(result.kind).toBe('UNKNOWN');
  });

  it('recovers an authorization by its durable request reference', async () => {
    const provider = new FakePaymentProvider();
    const requestReference = 'fb1bc085-6f68-4a03-8005-e810a0031235';
    await provider.authorize({
      amountMinor: 500_000n,
      authorizationType: 'PREAUTHORIZATION',
      currency: 'PHP',
      description: 'Security deposit',
      idempotencyKey: 'booking:three:security-deposit:authorize:v1',
      requestReference,
    });

    expect(await provider.retrievePaymentByRequestReference(requestReference)).toMatchObject({
      authorizedAmountMinor: 500_000n,
      currency: 'PHP',
      state: 'AUTHORIZED',
    });
  });

  it('replays one logical refund without increasing provider movement twice', async () => {
    const provider = new FakePaymentProvider();
    const input = {
      amountMinor: 10_000n,
      currency: 'PHP',
      externalPaymentId: 'fake-payment-refund',
      idempotencyKey: 'amendment:refund:v1',
      reason: 'Accepted amendment',
      requestReference: 'refund-request-one',
    };
    const first = await provider.refund(input);
    const replay = await provider.refund(input);
    expect(replay).toEqual(first);
    expect((await provider.retrievePayment(input.externalPaymentId)).refundedAmountMinor).toBe(
      input.amountMinor,
    );
  });
});
