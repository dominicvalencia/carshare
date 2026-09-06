export type ProviderFailureKind = 'RETRYABLE' | 'NON_RETRYABLE' | 'RECONCILE';

export interface ProviderFailure {
  readonly code: string;
  readonly kind: ProviderFailureKind;
  readonly safeMessage: string;
}

export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maxAttempts: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_PROVIDER_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 1_000,
  maxAttempts: 4,
  maxDelayMs: 30_000,
};

export function retryDelayMs(attempt: number, policy = DEFAULT_PROVIDER_RETRY_POLICY): number {
  return Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);
}

export function classifyHttpFailure(
  status: number | undefined,
  ambiguous = false,
): ProviderFailure {
  if (ambiguous)
    return {
      code: 'PROVIDER_STATUS_UNKNOWN',
      kind: 'RECONCILE',
      safeMessage: 'The provider result is being confirmed.',
    };
  if (status === 408 || status === 429 || (status !== undefined && status >= 500))
    return {
      code: status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
      kind: 'RETRYABLE',
      safeMessage: 'The provider is temporarily unavailable.',
    };
  return {
    code: status === 401 || status === 403 ? 'PROVIDER_CONFIGURATION_INVALID' : 'PROVIDER_REJECTED',
    kind: 'NON_RETRYABLE',
    safeMessage: 'The provider could not accept the request.',
  };
}
