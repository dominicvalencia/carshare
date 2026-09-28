import { BookingAmendmentStatus } from '@carrental/database';
import { describe, expect, it } from 'vitest';
import {
  amendmentPaymentDeadline,
  canTransitionBookingAmendment,
  isUnresolvedBookingAmendment,
} from './booking-amendment-foundation';

describe('booking amendment foundation', () => {
  it('keeps owner response and payment-pending amendments unresolved', () => {
    expect(isUnresolvedBookingAmendment(BookingAmendmentStatus.PENDING_OWNER)).toBe(true);
    expect(
      isUnresolvedBookingAmendment(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING),
    ).toBe(true);
    expect(isUnresolvedBookingAmendment(BookingAmendmentStatus.APPLIED)).toBe(false);
  });

  it('prevents terminal amendment states from transitioning again', () => {
    expect(
      canTransitionBookingAmendment(
        BookingAmendmentStatus.PENDING_OWNER,
        BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      ),
    ).toBe(true);
    expect(
      canTransitionBookingAmendment(
        BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
        BookingAmendmentStatus.FAILED,
      ),
    ).toBe(true);
    expect(
      canTransitionBookingAmendment(
        BookingAmendmentStatus.FAILED,
        BookingAmendmentStatus.PENDING_OWNER,
      ),
    ).toBe(false);
  });

  it('calculates the dedicated renter payment deadline independently', () => {
    const acceptedAt = new Date('2026-09-28T00:00:00.000Z');
    expect(amendmentPaymentDeadline(acceptedAt, 10).toISOString()).toBe('2026-09-28T00:10:00.000Z');
    expect(() => amendmentPaymentDeadline(acceptedAt, 0)).toThrow(RangeError);
  });
});
