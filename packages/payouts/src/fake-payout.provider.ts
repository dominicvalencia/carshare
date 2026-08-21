import { createHash } from 'node:crypto';
import {
  type CreatePayoutInput,
  type CreatePayoutResult,
  type NormalizedPayoutWebhook,
  type PayoutDestinationValidationResult,
  type PayoutProvider,
  type PayoutProviderCapabilities,
  PayoutProviderError,
  type PayoutProviderStatus,
  type ProviderWebhookInput,
  type ValidatePayoutDestinationInput,
} from './payout-provider';

export class FakePayoutProvider implements PayoutProvider {
  readonly code = 'FAKE' as const;
  private readonly byIdempotency = new Map<string, PayoutProviderStatus>();
  private readonly statuses = new Map<string, PayoutProviderStatus>();
  private createCalls = 0;

  get createCallCount(): number {
    return this.createCalls;
  }

  getCapabilities(): PayoutProviderCapabilities {
    return {
      country: 'PH',
      currency: 'PHP',
      destinationTypes: ['BANK_ACCOUNT', 'E_WALLET'],
      maximumAmountMinor: null,
      minimumAmountMinor: 100n,
      supportsDestinationValidation: true,
      supportsIdempotency: true,
      supportsRetrieval: true,
      supportsWebhooks: true,
    };
  }

  async validateDestination(
    input: ValidatePayoutDestinationInput,
  ): Promise<PayoutDestinationValidationResult> {
    if (input.accountIdentifier.includes('invalid')) {
      return {
        kind: 'INVALID',
        safeReason: 'Destination is invalid.',
        validationLevel: 'PROVIDER',
      };
    }
    return {
      kind: 'VALID',
      safeValidationReference: `fake-validation-${this.digest(input.accountIdentifier).slice(0, 12)}`,
      validationLevel: 'PROVIDER',
    };
  }

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    const existing = this.byIdempotency.get(input.idempotencyKey);
    if (existing) return { ...existing, kind: existing.state === 'FAILED' ? 'FAILED' : 'ACCEPTED' };
    this.createCalls += 1;
    const id = `fake-po-${this.digest(input.idempotencyKey).slice(0, 24)}`;
    const failed =
      input.accountIdentifier.includes('invalid') ||
      input.accountIdentifier.includes('fail-on-create');
    const status: PayoutProviderStatus = failed
      ? {
          amountMinor: input.amountMinor,
          externalPayoutId: id,
          failureCategory: 'INVALID_DESTINATION',
          providerState: 'FAILED',
          safeFailureCode: 'INVALID_DESTINATION',
          safeFailureMessage: 'Destination rejected by provider.',
          state: 'FAILED',
        }
      : {
          amountMinor: input.amountMinor,
          externalPayoutId: id,
          providerState: 'ACCEPTED',
          state: 'ACCEPTED',
        };
    this.byIdempotency.set(input.idempotencyKey, status);
    this.statuses.set(id, status);
    if (input.accountIdentifier.includes('lost-response')) {
      throw new PayoutProviderError(
        'Simulated accepted payout response loss.',
        'PROVIDER_UNAVAILABLE',
      );
    }
    return { ...status, kind: failed ? 'FAILED' : 'ACCEPTED' };
  }

  async retrievePayout(providerPayoutId: string): Promise<PayoutProviderStatus> {
    const status = this.statuses.get(providerPayoutId);
    if (!status) throw new PayoutProviderError('Unknown fake payout.', 'PROVIDER_UNAVAILABLE');
    return status;
  }

  settle(providerPayoutId: string): void {
    const current = this.statuses.get(providerPayoutId);
    if (!current) throw new Error('Unknown fake payout.');
    this.statuses.set(providerPayoutId, {
      ...current,
      authoritativeAt: new Date(),
      providerState: 'SUCCEEDED',
      state: 'SUCCEEDED',
    });
  }

  async normalizeWebhook(input: ProviderWebhookInput): Promise<NormalizedPayoutWebhook> {
    const payload = input.payload as Record<string, unknown>;
    const providerPayoutId = String(payload.payout_id ?? '');
    const providerState = String(payload.status ?? 'UNKNOWN');
    if (!providerPayoutId)
      throw new PayoutProviderError('Invalid fake webhook.', 'INVALID_WEBHOOK');
    return {
      eventType: String(payload.event ?? `fake_payout.${providerState.toLowerCase()}`),
      externalEventId: this.digest(input.rawBody.toString('utf8')),
      providerPayoutId,
      providerState,
      redactedPayload: { event: payload.event, payout_id: providerPayoutId, status: providerState },
      state: this.state(providerState),
    };
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private state(value: string): PayoutProviderStatus['state'] {
    if (value === 'SUCCEEDED') return 'SUCCEEDED';
    if (value === 'FAILED') return 'FAILED';
    if (value === 'REVERSED') return 'REVERSED';
    if (value === 'ACCEPTED') return 'ACCEPTED';
    return 'PROCESSING';
  }
}
