export interface PushMessage {
  readonly token: string;
  readonly title: string;
  readonly body: string;
  readonly data: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

export type PushResultStatus = 'ACCEPTED' | 'DELIVERED' | 'PERMANENT_FAILURE' | 'RETRYABLE_FAILURE';

export interface PushResult {
  readonly status: PushResultStatus;
  readonly providerReference?: string;
  readonly failureCategory?: string;
  readonly safeFailureMessage?: string;
}

export interface PushProvider {
  readonly code: string;
  send(message: PushMessage): Promise<PushResult>;
  receipts(providerReferences: readonly string[]): Promise<Readonly<Record<string, PushResult>>>;
}
