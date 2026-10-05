export type PaymentProviderCode = 'MAYA' | 'XENDIT' | 'FAKE';

export type ProviderCapabilitySupport = 'SUPPORTED' | 'UNSUPPORTED' | 'UNPROVEN';

export interface PaymentProviderEvidenceCapabilities {
  readonly supportsAuthorizationExpiryLookup: ProviderCapabilitySupport;
  readonly supportsAuthorizationRetrieval: ProviderCapabilitySupport;
  readonly supportsFullCapture: ProviderCapabilitySupport;
  readonly supportsFullVoid: ProviderCapabilitySupport;
  readonly supportsIdempotentReplayAfterTimeout: ProviderCapabilitySupport;
  readonly supportsMultipleCaptures: ProviderCapabilitySupport;
  readonly supportsOperationSpecificRetrieval: ProviderCapabilitySupport;
  readonly supportsPartialCapture: ProviderCapabilitySupport;
  readonly supportsPartialRefund: ProviderCapabilitySupport;
  readonly supportsPartialVoid: ProviderCapabilitySupport;
  readonly supportsRefund: ProviderCapabilitySupport;
  readonly supportsRequestReferenceRetrieval: ProviderCapabilitySupport;
  readonly supportsSecurityDepositUtilization: ProviderCapabilitySupport;
  readonly supportsWebhookOperationAmount: ProviderCapabilitySupport;
  readonly supportsWebhookOperationIdentity: ProviderCapabilitySupport;
}

export interface PaymentProviderCapabilities {
  readonly evidence: PaymentProviderEvidenceCapabilities;
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
  readonly authorizationType?: 'NORMAL' | 'PREAUTHORIZATION';
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
  readonly currency?: string;
  readonly externalPaymentId: string;
  readonly providerState: string;
  readonly refundedAmountMinor?: bigint;
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
  retrievePaymentByRequestReference(requestReference: string): Promise<ProviderPaymentStatus>;
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
