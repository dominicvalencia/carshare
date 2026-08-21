export type PaymentProviderCode = 'MAYA' | 'FAKE';

export interface PaymentProviderCapabilities {
  readonly authorizationHoldDurationSeconds: number | null;
  readonly supportsAuthorization: boolean;
  readonly supportsAuthorizationVoid: boolean;
  readonly supportsAdditionalPaymentAuthorization: boolean;
  readonly supportsOffSessionAdditionalCharge: boolean;
  readonly supportsPartialCapture: boolean;
  readonly supportsPartialRefund: boolean;
  readonly supportsRefund: boolean;
  readonly supportsSecurityDeposit: boolean;
  readonly supportsSecurityDepositUtilization: boolean;
  readonly supportsWebhooks: boolean;
}

export interface MoneyInput {
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface AuthorizePaymentInput extends MoneyInput {
  readonly customerEmail?: string;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly requestReference: string;
}

export interface ReferencedPaymentInput extends MoneyInput {
  readonly externalPaymentId: string;
  readonly idempotencyKey: string;
  readonly requestReference: string;
}

export interface RefundPaymentInput extends ReferencedPaymentInput {
  readonly reason: string;
}

export type ProviderResultKind = 'ACTION_REQUIRED' | 'SUCCEEDED' | 'DECLINED' | 'UNKNOWN';

export interface ProviderOperationResult {
  readonly customerActionUrl?: string;
  readonly externalOperationId?: string;
  readonly externalPaymentId?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly kind: ProviderResultKind;
  readonly providerState?: string;
  readonly safeMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export type ProviderPaymentState =
  'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'VOIDED' | 'FAILED' | 'UNKNOWN';

export interface ProviderPaymentStatus {
  readonly authorizedAmountMinor?: bigint;
  readonly capturedAmountMinor?: bigint;
  readonly externalPaymentId: string;
  readonly providerState: string;
  readonly state: ProviderPaymentState;
}

export interface VerifiedWebhookEvent {
  readonly eventType: string;
  readonly externalEventId: string;
  readonly providerPaymentId: string;
  readonly redactedPayload: Readonly<Record<string, unknown>>;
}

export interface WebhookVerificationInput {
  readonly payload: unknown;
  readonly rawBody: Buffer;
  readonly sourceIp?: string;
}

export interface PaymentProvider {
  readonly capabilities: PaymentProviderCapabilities;
  readonly code: PaymentProviderCode;
  authorize(input: AuthorizePaymentInput): Promise<ProviderOperationResult>;
  capture(input: ReferencedPaymentInput): Promise<ProviderOperationResult>;
  voidAuthorization(input: ReferencedPaymentInput): Promise<ProviderOperationResult>;
  refund(input: RefundPaymentInput): Promise<ProviderOperationResult>;
  retrievePayment(externalPaymentId: string): Promise<ProviderPaymentStatus>;
  verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhookEvent>;
}

export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly category: 'CONFIGURATION' | 'PROVIDER_UNAVAILABLE' | 'INVALID_WEBHOOK',
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
