export type ProviderSimulationScenario =
  | 'SUCCESS'
  | 'VALIDATION_FAILURE'
  | 'TIMEOUT'
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'DELAYED'
  | 'UNKNOWN';

export class SimulatedProviderError extends Error {
  constructor(
    readonly code: string,
    readonly kind: 'RETRYABLE' | 'NON_RETRYABLE' | 'RECONCILE',
  ) {
    super(code);
  }
}

export async function simulateProvider<T>(
  scenario: ProviderSimulationScenario,
  success: T,
): Promise<T> {
  if (scenario === 'SUCCESS' || scenario === 'DELAYED') return success;
  if (scenario === 'VALIDATION_FAILURE')
    throw new SimulatedProviderError('PROVIDER_VALIDATION_FAILED', 'NON_RETRYABLE');
  if (scenario === 'TIMEOUT' || scenario === 'UNKNOWN')
    throw new SimulatedProviderError('PROVIDER_STATUS_UNKNOWN', 'RECONCILE');
  throw new SimulatedProviderError(
    scenario === 'RATE_LIMITED' ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE',
    'RETRYABLE',
  );
}
