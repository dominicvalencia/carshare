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
  readonly current: AmendmentValues;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
  readonly financial: AmendmentFinancial;
  readonly previewToken: string;
  readonly proposed: AmendmentValues;
  readonly warnings: readonly string[];
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
  readonly paymentState:
    'WAITING_FOR_PAYMENT' | 'PAYMENT_VERIFYING' | 'PAYMENT_RECEIVED_AWAITING_APPLICATION' | null;
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
