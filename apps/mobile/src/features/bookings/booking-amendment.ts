import { ApiError } from '../../auth/api-client';

export type AmendmentStatus =
  | 'PENDING_OWNER'
  | 'OWNER_ACCEPTED_PAYMENT_PENDING'
  | 'OWNER_ACCEPTED_PROCESSING'
  | 'APPLIED'
  | 'DECLINED'
  | 'WITHDRAWN'
  | 'EXPIRED'
  | 'FAILED'
  | 'FINANCIAL_RECOVERY_PENDING';

export interface AmendmentValues {
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly startMethod: 'RENTER_PICKUP' | 'OWNER_DELIVERY';
  readonly endMethod: 'RENTER_RETURN' | 'OWNER_COLLECTION';
  readonly totalMinor: string;
  readonly chargeableDays?: number;
  readonly fulfillmentTotalMinor?: string;
}

export type AmendmentPreviewValues = Omit<AmendmentValues, 'totalMinor'>;

export interface AmendmentFinancial {
  readonly additionalPaymentMinor: string;
  readonly currency: string;
  readonly expectedRefundMinor: string;
  readonly retainedNonRefundableRentalMinor?: string;
  readonly proposedEconomicTotalMinor?: string;
  readonly currentOwnerEarningsMinor?: string;
  readonly proposedOwnerEarningsMinor?: string;
  readonly ownerEarningsDeltaMinor?: string;
}

export interface AmendmentPreview {
  readonly availability: { readonly available: true };
  readonly bookingReference: string;
  readonly bookingStatus?: string;
  readonly closedAt?: string | null;
  readonly current: AmendmentValues;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly financial: AmendmentFinancial;
  readonly previewToken: string;
  readonly proposed: AmendmentPreviewValues;
  readonly warnings: readonly string[];
}

export type AmendmentPreviewFinancialSummary =
  | {
      readonly valid: true;
      readonly additionalPaymentMinor: number;
      readonly currency: string;
      readonly currentTotalMinor: number;
      readonly differenceMinor: number;
      readonly expectedRefundMinor: number;
      readonly proposedTotalMinor: number;
      readonly direction: 'ADDITIONAL_PAYMENT' | 'REFUND' | 'ZERO_DELTA';
    }
  | { readonly valid: false; readonly message: string };

export function amendmentPreviewFinancialSummary(
  preview: AmendmentPreview,
): AmendmentPreviewFinancialSummary {
  const currentTotalMinor = safeMinor(preview.current.totalMinor);
  const proposedTotalMinor = safeMinor(preview.financial.proposedEconomicTotalMinor);
  const additionalPaymentMinor = safeMinor(preview.financial.additionalPaymentMinor);
  const expectedRefundMinor = safeMinor(preview.financial.expectedRefundMinor);
  const currency = preview.financial.currency?.trim();
  if (
    currentTotalMinor === null ||
    proposedTotalMinor === null ||
    additionalPaymentMinor === null ||
    expectedRefundMinor === null ||
    !currency ||
    (additionalPaymentMinor > 0 && expectedRefundMinor > 0)
  )
    return {
      valid: false,
      message: 'The latest price could not be verified. Edit the change or retry the preview.',
    };
  const signedDifference = proposedTotalMinor - currentTotalMinor;
  const direction =
    additionalPaymentMinor > 0
      ? 'ADDITIONAL_PAYMENT'
      : expectedRefundMinor > 0
        ? 'REFUND'
        : 'ZERO_DELTA';
  if (
    (direction === 'ADDITIONAL_PAYMENT' && signedDifference !== additionalPaymentMinor) ||
    (direction === 'REFUND' && signedDifference !== -expectedRefundMinor) ||
    (direction === 'ZERO_DELTA' && signedDifference !== 0)
  )
    return {
      valid: false,
      message: 'The latest price could not be verified. Edit the change or retry the preview.',
    };
  return {
    additionalPaymentMinor,
    currency,
    currentTotalMinor,
    differenceMinor: Math.abs(signedDifference),
    direction,
    expectedRefundMinor,
    proposedTotalMinor,
    valid: true,
  };
}

function safeMinor(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export interface AmendmentDetail {
  readonly acceptedAt?: string | null;
  readonly actionable?: boolean;
  readonly amendmentId?: string;
  readonly amendmentReference?: string;
  readonly appliedAt: string | null;
  readonly bookingAlreadyApplied?: boolean;
  readonly bookingReference: string;
  readonly createdAt?: string;
  readonly current: AmendmentValues;
  readonly expiresAt: string;
  readonly financial: AmendmentFinancial;
  readonly history: readonly {
    readonly occurredAt: string;
    readonly reasonCode: string | null;
    readonly toStatus: AmendmentStatus;
  }[];
  readonly paymentDeadlineAt: string | null;
  readonly paymentInitiationAllowed: boolean;
  readonly paymentState:
    'PAYMENT_PROCESSING' | 'PAYMENT_VERIFYING' | 'PAYMENT_RECEIVED_AWAITING_APPLICATION' | null;
  readonly proposed: AmendmentValues;
  readonly reasonCode?: string | null;
  readonly refundState:
    | 'REFUND_PROCESSING'
    | 'REFUND_VERIFYING'
    | 'REFUND_COMPLETED_AWAITING_APPLICATION'
    | 'MANUAL_RECONCILIATION_REQUIRED'
    | 'FINANCIAL_RECOVERY_SETTLED'
    | null;
  readonly renterDisplayName?: string;
  readonly scope?: 'PRE_TRIP' | 'ACTIVE_EXTENSION';
  readonly status: AmendmentStatus;
  readonly vehicleName?: string;
}

export const transientAmendmentStatuses = new Set<AmendmentStatus>([
  'PENDING_OWNER',
  'OWNER_ACCEPTED_PAYMENT_PENDING',
  'OWNER_ACCEPTED_PROCESSING',
  'FINANCIAL_RECOVERY_PENDING',
]);

export function amendmentStatusCopy(amendment: AmendmentDetail) {
  if (amendment.paymentState === 'PAYMENT_PROCESSING')
    return ['Payment processing', 'Your payment is being processed. Do not pay again.'];
  if (amendment.paymentState === 'PAYMENT_VERIFYING')
    return ['Payment being verified', 'We are confirming the payment result. Do not pay again.'];
  if (amendment.paymentState === 'PAYMENT_RECEIVED_AWAITING_APPLICATION')
    return [
      'Payment received — applying booking change',
      'Your current booking stays in effect until the change is applied.',
    ];
  if (amendment.refundState === 'REFUND_VERIFYING')
    return ['Refund being verified', 'We are confirming the refund result. No action is needed.'];
  if (amendment.refundState === 'REFUND_COMPLETED_AWAITING_APPLICATION')
    return [
      'Refund completed — applying booking change',
      'Your current booking stays in effect until the change is applied.',
    ];
  if (amendment.status === 'FINANCIAL_RECOVERY_PENDING')
    return amendment.refundState === 'FINANCIAL_RECOVERY_SETTLED'
      ? ['Refund settled', 'The original booking remains unchanged.']
      : [
          'Booking change could not be applied',
          'Refund recovery is in progress. The original booking remains unchanged.',
        ];
  return (
    {
      PENDING_OWNER: [
        'Waiting for Owner approval',
        'You can withdraw this request before the Owner responds.',
      ],
      OWNER_ACCEPTED_PAYMENT_PENDING: [
        'Payment required',
        'The Owner accepted your request. Complete the additional payment before the deadline.',
      ],
      OWNER_ACCEPTED_PROCESSING: [
        'Applying booking change',
        'No action is needed while the updated booking is finalized.',
      ],
      APPLIED: [
        'Booking updated successfully',
        'These are now your authoritative booking details.',
      ],
      DECLINED: ['Owner declined the change', 'Your original booking remains unchanged.'],
      WITHDRAWN: ['Change request withdrawn', 'Your original booking remains unchanged.'],
      EXPIRED: [
        'Change request expired',
        'The request deadline passed. Your original booking remains unchanged.',
      ],
      FAILED: ['Change could not be completed', 'Your original booking remains unchanged.'],
    } as const
  )[amendment.status];
}

export function ownerAmendmentStatusCopy(amendment: AmendmentDetail): readonly [string, string] {
  if (amendment.status === 'PENDING_OWNER')
    return ['Review requested change', 'Review the request before its response deadline.'];
  if (amendment.status === 'OWNER_ACCEPTED_PAYMENT_PENDING')
    return [
      'Waiting for renter payment',
      'The requested details remain pending until payment succeeds.',
    ];
  if (
    amendment.status === 'OWNER_ACCEPTED_PROCESSING' &&
    Number(amendment.financial.expectedRefundMinor) > 0
  )
    return [
      'Refund processing',
      'The requested details remain pending while the refund is processed.',
    ];
  if (
    amendment.status === 'OWNER_ACCEPTED_PROCESSING' &&
    (amendment.paymentState === 'PAYMENT_VERIFYING' ||
      amendment.paymentState === 'PAYMENT_RECEIVED_AWAITING_APPLICATION' ||
      amendment.refundState === 'REFUND_VERIFYING' ||
      amendment.refundState === 'REFUND_COMPLETED_AWAITING_APPLICATION')
  )
    return [
      'Applying booking change',
      'The requested details remain pending while the financial result is confirmed.',
    ];
  return (
    {
      OWNER_ACCEPTED_PROCESSING: [
        'Applying booking change',
        'The requested details remain pending while the booking is updated.',
      ],
      FINANCIAL_RECOVERY_PENDING: [
        'Booking change could not be applied',
        'Financial recovery is in progress. The original booking remains current.',
      ],
      APPLIED: ['Booking updated successfully', 'These are now the booking details.'],
      DECLINED: ['Change request declined', 'The original booking remains current.'],
      WITHDRAWN: ['Change request withdrawn', 'The original booking remains current.'],
      EXPIRED: ['Change request expired', 'The original booking remains current.'],
      FAILED: ['Change could not be completed', 'The original booking remains current.'],
    } as const
  )[amendment.status];
}

export function ownerAmendmentIsProcessing(amendment: AmendmentDetail) {
  if (amendment.status === 'OWNER_ACCEPTED_PROCESSING') return true;
  if (amendment.status !== 'OWNER_ACCEPTED_PAYMENT_PENDING') return false;
  return (
    amendment.paymentState === 'PAYMENT_PROCESSING' ||
    amendment.paymentState === 'PAYMENT_VERIFYING'
  );
}

export function amendmentErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return error instanceof Error ? error.message : 'Something went wrong. Refresh and try again.';
  return (
    (
      {
        AMENDMENT_ALREADY_UNRESOLVED: 'Another booking change is already in progress.',
        AMENDMENT_PREVIEW_INVALID: 'This preview is no longer valid. Review the change again.',
        BOOKING_AVAILABILITY_CONFLICT:
          'Those dates are no longer available. Edit the change and try again.',
        BOOKING_INVALID_STATE:
          'This booking is no longer eligible for that change. Refresh for the latest status.',
        BOOKING_STATE_CHANGED:
          'The booking changed since your preview. Review the latest details and try again.',
        IDEMPOTENCY_KEY_CONFLICT:
          'This action was already attempted with different details. Refresh before retrying.',
        PAYMENT_DEADLINE_EXPIRED:
          'The payment deadline has passed. Your original booking remains unchanged.',
        QUOTE_EXPIRED: 'This preview expired. Review the latest price before submitting.',
        RETURN_WORKFLOW_STARTED:
          'The return process has started, so this trip can no longer be extended.',
      } as Record<string, string>
    )[error.code] ?? error.message
  );
}

export function idempotencyKey(action: string, reference: string) {
  return `${action}-${reference}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
