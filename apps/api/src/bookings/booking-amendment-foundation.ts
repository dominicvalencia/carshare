import { BookingAmendmentStatus } from '@carrental/database';

export const BOOKING_AMENDMENT_POLICY_VERSION = 'CARSHARE_BOOKING_AMENDMENT_V1';

export const unresolvedBookingAmendmentStatuses = [
  BookingAmendmentStatus.PENDING_OWNER,
  BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
  BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
] as const;

const allowedTransitions: Readonly<
  Record<BookingAmendmentStatus, readonly BookingAmendmentStatus[]>
> = {
  APPLIED: [],
  DECLINED: [],
  EXPIRED: [],
  FAILED: [],
  OWNER_ACCEPTED_PROCESSING: [BookingAmendmentStatus.APPLIED, BookingAmendmentStatus.FAILED],
  OWNER_ACCEPTED_PAYMENT_PENDING: [BookingAmendmentStatus.APPLIED, BookingAmendmentStatus.FAILED],
  PENDING_OWNER: [
    BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
    BookingAmendmentStatus.APPLIED,
    BookingAmendmentStatus.DECLINED,
    BookingAmendmentStatus.WITHDRAWN,
    BookingAmendmentStatus.EXPIRED,
    BookingAmendmentStatus.FAILED,
  ],
  WITHDRAWN: [],
};

export function isUnresolvedBookingAmendment(status: BookingAmendmentStatus): boolean {
  return unresolvedBookingAmendmentStatuses.includes(
    status as (typeof unresolvedBookingAmendmentStatuses)[number],
  );
}

export function canTransitionBookingAmendment(
  from: BookingAmendmentStatus,
  to: BookingAmendmentStatus,
): boolean {
  return allowedTransitions[from].includes(to);
}

export function amendmentPaymentDeadline(acceptedAt: Date, deadlineMinutes: number): Date {
  if (!Number.isInteger(deadlineMinutes) || deadlineMinutes <= 0) {
    throw new RangeError('Amendment payment deadline must be a positive whole number of minutes.');
  }
  return new Date(acceptedAt.getTime() + deadlineMinutes * 60_000);
}
