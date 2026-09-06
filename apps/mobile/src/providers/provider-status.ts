export type ProviderUiState = {
  readonly title: string;
  readonly message: string;
  readonly canRetry: boolean;
};

const states: Readonly<Record<string, ProviderUiState>> = {
  DELIVERY_DELAYED: {
    title: 'Delivery is taking longer',
    message: 'Your message is queued. You can request another after the waiting period.',
    canRetry: true,
  },
  TOO_MANY_ATTEMPTS: {
    title: 'Try again later',
    message: 'The attempt limit was reached. Please wait before trying again.',
    canRetry: false,
  },
  PROVIDER_UNAVAILABLE: {
    title: 'Service temporarily unavailable',
    message: 'Your information is safe. Please try again shortly.',
    canRetry: true,
  },
  PAYMENT_AUTHENTICATION_REQUIRED: {
    title: 'Authentication required',
    message: 'Complete the secure payment authentication to continue.',
    canRetry: true,
  },
  PAYMENT_PENDING: {
    title: 'Checking payment',
    message: 'We are confirming the payment status. Do not submit another payment.',
    canRetry: false,
  },
  PAYOUT_PROCESSING: {
    title: 'Payout processing',
    message: 'The payout is being confirmed. No action is required.',
    canRetry: false,
  },
  PAYOUT_REVIEW: {
    title: 'Payout needs review',
    message: 'CarShare support is reviewing this payout.',
    canRetry: false,
  },
  KYC_MANUAL_REVIEW: {
    title: 'Verification under review',
    message: 'Automated checks may assist, but a CarShare reviewer makes the decision.',
    canRetry: false,
  },
  KYC_MORE_INFORMATION: {
    title: 'More information needed',
    message: 'Please follow the verification request shown in the app.',
    canRetry: true,
  },
};

export function providerUiState(code: string): ProviderUiState {
  return (
    states[code] ?? {
      title: 'Status unavailable',
      message: 'We could not confirm the provider status. Please check again shortly.',
      canRetry: false,
    }
  );
}
