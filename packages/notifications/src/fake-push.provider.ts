import { createHash } from 'node:crypto';
import type { PushMessage, PushProvider, PushResult } from './push-provider';

export class FakePushProvider implements PushProvider {
  readonly code = 'fake';
  private readonly results = new Map<string, PushResult>();

  async send(message: PushMessage): Promise<PushResult> {
    const existing = this.results.get(message.idempotencyKey);
    if (existing) return existing;
    const reference = `fake_${createHash('sha256').update(message.idempotencyKey).digest('hex').slice(0, 24)}`;
    const result: PushResult = message.token.includes('invalid')
      ? {
          status: 'PERMANENT_FAILURE',
          failureCategory: 'DEVICE_NOT_REGISTERED',
          safeFailureMessage: 'Push token is no longer registered.',
        }
      : message.token.includes('temporary')
        ? {
            status: 'RETRYABLE_FAILURE',
            failureCategory: 'PROVIDER_UNAVAILABLE',
            safeFailureMessage: 'Push provider is temporarily unavailable.',
          }
        : { status: 'ACCEPTED', providerReference: reference };
    this.results.set(message.idempotencyKey, result);
    return result;
  }

  async receipts(
    providerReferences: readonly string[],
  ): Promise<Readonly<Record<string, PushResult>>> {
    return Object.fromEntries(
      providerReferences.map((reference) => [
        reference,
        { status: 'DELIVERED' } satisfies PushResult,
      ]),
    );
  }
}
