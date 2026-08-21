export type PayoutProviderCode = 'XENDIT' | 'FAKE';
export type PayoutDestinationType = 'BANK_ACCOUNT' | 'E_WALLET';
export type PayoutFailureCategory =
  | 'RETRYABLE'
  | 'INVALID_DESTINATION'
  | 'ACCOUNT_CLOSED'
  | 'PROVIDER_TEMPORARY'
  | 'COMPLIANCE_REJECTED'
  | 'LIMIT_EXCEEDED'
  | 'UNKNOWN';
export type PayoutProviderState =
  'ACCEPTED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'REVERSED' | 'UNKNOWN';

export interface PayoutProviderCapabilities {
  readonly country: 'PH';
  readonly currency: 'PHP';
  readonly destinationTypes: readonly PayoutDestinationType[];
  readonly maximumAmountMinor: bigint | null;
  readonly minimumAmountMinor: bigint | null;
  readonly supportsDestinationValidation: boolean;
  readonly supportsIdempotency: boolean;
  readonly supportsRetrieval: boolean;
  readonly supportsWebhooks: boolean;
}

export interface ValidatePayoutDestinationInput {
  readonly accountHolderName: string;
  readonly accountIdentifier: string;
  readonly country: 'PH';
  readonly currency: 'PHP';
  readonly destinationChannel: string;
  readonly type: PayoutDestinationType;
}

export interface PayoutDestinationValidationResult {
  readonly kind: 'VALID' | 'INVALID' | 'REQUIRES_ACTION';
  readonly safeReason?: string;
  readonly safeValidationReference?: string;
  readonly validationLevel: 'FORMAT_AND_CHANNEL' | 'PROVIDER';
}

export interface CreatePayoutInput extends ValidatePayoutDestinationInput {
  readonly amountMinor: bigint;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly referenceId: string;
}

export interface PayoutProviderStatus {
  readonly amountMinor: bigint;
  readonly authoritativeAt?: Date;
  readonly externalPayoutId: string;
  readonly failureCategory?: PayoutFailureCategory;
  readonly feeAmountMinor?: bigint;
  readonly providerState: string;
  readonly safeFailureCode?: string;
  readonly safeFailureMessage?: string;
  readonly state: PayoutProviderState;
}

export interface CreatePayoutResult extends PayoutProviderStatus {
  readonly kind: 'ACCEPTED' | 'FAILED' | 'UNKNOWN';
}

export interface ProviderWebhookInput {
  readonly callbackToken?: string;
  readonly payload: unknown;
  readonly rawBody: Buffer;
}

export interface NormalizedPayoutWebhook {
  readonly eventType: string;
  readonly externalEventId: string;
  readonly providerPayoutId: string;
  readonly providerState: string;
  readonly redactedPayload: Readonly<Record<string, unknown>>;
  readonly state: PayoutProviderState;
}

export interface PayoutProvider {
  readonly code: PayoutProviderCode;
  getCapabilities(): PayoutProviderCapabilities;
  validateDestination(
    input: ValidatePayoutDestinationInput,
  ): Promise<PayoutDestinationValidationResult>;
  createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult>;
  retrievePayout(providerPayoutId: string): Promise<PayoutProviderStatus>;
  normalizeWebhook(input: ProviderWebhookInput): Promise<NormalizedPayoutWebhook>;
}

export class PayoutProviderError extends Error {
  constructor(
    message: string,
    readonly category: 'CONFIGURATION' | 'PROVIDER_UNAVAILABLE' | 'INVALID_WEBHOOK',
  ) {
    super(message);
    this.name = 'PayoutProviderError';
  }
}
