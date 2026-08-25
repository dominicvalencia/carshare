import { describe, expect, it } from 'vitest';
import { FakePushProvider } from './fake-push.provider';

describe('FakePushProvider', () => {
  it('is idempotent and returns delivery receipts', async () => {
    const provider = new FakePushProvider();
    const input = {
      token: 'ExponentPushToken[ok]',
      title: 'Title',
      body: 'Body',
      data: {},
      idempotencyKey: 'stable-key',
    };
    const first = await provider.send(input);
    expect(await provider.send(input)).toEqual(first);
    expect(
      (await provider.receipts([first.providerReference!]))[first.providerReference!]?.status,
    ).toBe('DELIVERED');
  });

  it('classifies invalid and temporary tokens safely', async () => {
    const provider = new FakePushProvider();
    expect(
      (
        await provider.send({
          token: 'invalid',
          title: '',
          body: '',
          data: {},
          idempotencyKey: 'one',
        })
      ).status,
    ).toBe('PERMANENT_FAILURE');
    expect(
      (
        await provider.send({
          token: 'temporary',
          title: '',
          body: '',
          data: {},
          idempotencyKey: 'two',
        })
      ).status,
    ).toBe('RETRYABLE_FAILURE');
  });
});
