import { describe, expect, it } from 'vitest';
import { providerUiState } from './provider-status';

describe('provider UI states', () => {
  it('returns safe actionable copy for known and unknown states', () => {
    expect(providerUiState('PAYMENT_AUTHENTICATION_REQUIRED')).toMatchObject({ canRetry: true });
    expect(providerUiState('PAYMENT_PENDING').message).toContain('Do not submit another');
    expect(providerUiState('KYC_MANUAL_REVIEW').message).toContain('reviewer');
    expect(providerUiState('RAW_VENDOR_FAILURE:secret')).toEqual({
      title: 'Status unavailable',
      message: 'We could not confirm the provider status. Please check again shortly.',
      canRetry: false,
    });
  });
});
