import { createHash } from 'node:crypto';
import type {
  AuthorizePaymentInput,
  PaymentProvider,
  ProviderOperationResult,
  ProviderPaymentStatus,
  ReferencedPaymentInput,
  RefundPaymentInput,
  VerifiedWebhookEvent,
  WebhookVerificationInput,
} from './payment-provider';

export type FakePaymentOutcome = 'succeed' | 'decline' | 'unknown';

export class FakePaymentProvider implements PaymentProvider {
  readonly code = 'FAKE' as const;
  readonly capabilities = Object.freeze({
    authorizationHoldDurationSeconds: 6 * 24 * 60 * 60,
    supportsAuthorization: true,
    supportsAuthorizationVoid: true,
    supportsAdditionalPaymentAuthorization: true,
    supportsOffSessionAdditionalCharge: false,
    supportsPartialCapture: false,
    supportsPartialRefund: true,
    supportsRefund: true,
    supportsSecurityDeposit: false,
    supportsSecurityDepositUtilization: false,
    supportsWebhooks: true,
  });
  private readonly states = new Map<string, ProviderPaymentStatus>();
  private readonly refundResults = new Map<string, ProviderOperationResult>();

  constructor(private outcome: FakePaymentOutcome = 'succeed') {}

  async authorize(input: AuthorizePaymentInput): Promise<ProviderOperationResult> {
    const externalPaymentId = `fake_${digest(input.requestReference).slice(0, 24)}`;
    if (this.outcome === 'unknown')
      return { externalPaymentId, kind: 'UNKNOWN', providerState: 'UNKNOWN' };
    if (this.outcome === 'decline')
      return { kind: 'DECLINED', providerState: 'DECLINED', failureCode: 'FAKE_DECLINE' };
    this.states.set(externalPaymentId, {
      authorizedAmountMinor: input.amountMinor,
      externalPaymentId,
      providerState: 'AUTHORIZED',
      state: 'AUTHORIZED',
    });
    return { externalPaymentId, kind: 'SUCCEEDED', providerState: 'AUTHORIZED' };
  }

  async capture(input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    if (this.outcome !== 'succeed') return this.nonSuccess();
    this.states.set(input.externalPaymentId, {
      authorizedAmountMinor: input.amountMinor,
      capturedAmountMinor: input.amountMinor,
      externalPaymentId: input.externalPaymentId,
      providerState: 'CAPTURED',
      state: 'CAPTURED',
    });
    return {
      externalOperationId: `capture_${digest(input.idempotencyKey).slice(0, 20)}`,
      kind: 'SUCCEEDED',
      providerState: 'CAPTURED',
    };
  }

  async voidAuthorization(input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    if (this.outcome !== 'succeed') return this.nonSuccess();
    this.states.set(input.externalPaymentId, {
      externalPaymentId: input.externalPaymentId,
      providerState: 'VOIDED',
      state: 'VOIDED',
    });
    return {
      externalOperationId: `void_${digest(input.idempotencyKey).slice(0, 20)}`,
      kind: 'SUCCEEDED',
      providerState: 'VOIDED',
    };
  }

  async refund(input: RefundPaymentInput): Promise<ProviderOperationResult> {
    const replay = this.refundResults.get(input.idempotencyKey);
    if (replay) return replay;
    if (this.outcome !== 'succeed') return this.nonSuccess();
    const prior = this.states.get(input.externalPaymentId);
    this.states.set(input.externalPaymentId, {
      ...prior,
      externalPaymentId: input.externalPaymentId,
      providerState: 'CAPTURED',
      refundedAmountMinor: (prior?.refundedAmountMinor ?? 0n) + input.amountMinor,
      state: 'CAPTURED',
    });
    const result = {
      externalOperationId: `refund_${digest(input.idempotencyKey).slice(0, 20)}`,
      kind: 'SUCCEEDED' as const,
      providerState: 'REFUNDED',
    };
    this.refundResults.set(input.idempotencyKey, result);
    return result;
  }

  async retrievePayment(externalPaymentId: string): Promise<ProviderPaymentStatus> {
    return (
      this.states.get(externalPaymentId) ?? {
        externalPaymentId,
        providerState: 'UNKNOWN',
        state: 'UNKNOWN',
      }
    );
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhookEvent> {
    const payload = input.payload as Record<string, unknown>;
    const providerPaymentId = String(payload.paymentId ?? '');
    const eventType = String(payload.status ?? '');
    if (!providerPaymentId || !eventType) throw new Error('Invalid fake webhook.');
    return {
      eventType,
      externalEventId: digest(
        `${providerPaymentId}|${eventType}|${String(payload.updatedAt ?? '')}`,
      ),
      providerPaymentId,
      redactedPayload: { paymentId: providerPaymentId, status: eventType },
    };
  }

  setState(status: ProviderPaymentStatus): void {
    this.states.set(status.externalPaymentId, status);
  }

  setOutcome(outcome: FakePaymentOutcome): void {
    this.outcome = outcome;
  }

  private nonSuccess(): ProviderOperationResult {
    return this.outcome === 'decline'
      ? { failureCode: 'FAKE_DECLINE', kind: 'DECLINED', providerState: 'DECLINED' }
      : { kind: 'UNKNOWN', providerState: 'UNKNOWN' };
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
