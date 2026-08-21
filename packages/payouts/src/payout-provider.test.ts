import { describe, expect, it } from 'vitest';
import { FakePayoutProvider } from './fake-payout.provider';

const destination = {
  accountHolderName: 'Maria Santos',
  accountIdentifier: '09171234567',
  country: 'PH' as const,
  currency: 'PHP' as const,
  destinationChannel: 'PH_GCASH',
  type: 'E_WALLET' as const,
};

describe('PayoutProvider contract — FakePayoutProvider', () => {
  it('validates normalized destinations without exposing provider types', async () => {
    const provider = new FakePayoutProvider();
    await expect(provider.validateDestination(destination)).resolves.toMatchObject({
      kind: 'VALID',
      validationLevel: 'PROVIDER',
    });
  });

  it('uses one stable provider payout for idempotent create retries', async () => {
    const provider = new FakePayoutProvider();
    const input = {
      ...destination,
      amountMinor: 25_000n,
      description: 'Owner payout',
      idempotencyKey: 'payout:test:submit:v1',
      referenceId: 'PO-TEST',
    };
    const first = await provider.createPayout(input);
    const second = await provider.createPayout(input);
    expect(second.externalPayoutId).toBe(first.externalPayoutId);
    expect(provider.createCallCount).toBe(1);
    await expect(provider.retrievePayout(first.externalPayoutId)).resolves.toMatchObject({
      state: 'ACCEPTED',
    });
    provider.settle(first.externalPayoutId);
    await expect(provider.retrievePayout(first.externalPayoutId)).resolves.toMatchObject({
      state: 'SUCCEEDED',
    });
  });

  it('recovers an accepted payout whose first HTTP response was lost', async () => {
    const provider = new FakePayoutProvider();
    const input = {
      ...destination,
      accountIdentifier: 'lost-response-09171234567',
      amountMinor: 25_000n,
      description: 'Owner payout',
      idempotencyKey: 'payout:lost:submit:v1',
      referenceId: 'PO-LOST',
    };
    await expect(provider.createPayout(input)).rejects.toThrow('response loss');
    const recovered = await provider.createPayout(input);
    expect(provider.createCallCount).toBe(1);
    expect(recovered.state).toBe('ACCEPTED');
  });

  it('normalizes definitive invalid-destination failure and duplicate webhooks', async () => {
    const provider = new FakePayoutProvider();
    const result = await provider.createPayout({
      ...destination,
      accountIdentifier: 'invalid-123456',
      amountMinor: 25_000n,
      description: 'Owner payout',
      idempotencyKey: 'payout:failed:submit:v1',
      referenceId: 'PO-FAILED',
    });
    expect(result).toMatchObject({
      failureCategory: 'INVALID_DESTINATION',
      kind: 'FAILED',
      state: 'FAILED',
    });
    const body = Buffer.from(
      JSON.stringify({ payout_id: result.externalPayoutId, status: 'FAILED' }),
    );
    const one = await provider.normalizeWebhook({
      payload: JSON.parse(body.toString()),
      rawBody: body,
    });
    const two = await provider.normalizeWebhook({
      payload: JSON.parse(body.toString()),
      rawBody: body,
    });
    expect(two.externalEventId).toBe(one.externalEventId);
  });
});
