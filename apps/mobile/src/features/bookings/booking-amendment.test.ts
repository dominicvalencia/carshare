import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../auth/api-client';
import {
  amendmentErrorMessage,
  amendmentStatusCopy,
  type AmendmentDetail,
} from './booking-amendment';

const renter = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/BookingAmendmentSheet.tsx'),
  'utf8',
);
const bookings = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/MyBookingsScreen.tsx'),
  'utf8',
);
const owner = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);
const navigation = readFileSync(resolve(process.cwd(), 'src/navigation/AppNavigation.tsx'), 'utf8');

function detail(overrides: Partial<AmendmentDetail> = {}): AmendmentDetail {
  return {
    amendmentId: 'amendment-id',
    appliedAt: null,
    bookingReference: 'CR-TEST',
    current: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-02T00:00:00.000Z',
      rentalStart: '2026-10-01T00:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
      totalMinor: '10000',
    },
    expiresAt: '2026-10-01T00:00:00.000Z',
    financial: { additionalPaymentMinor: '0', currency: 'PHP', expectedRefundMinor: '0' },
    history: [],
    paymentDeadlineAt: null,
    paymentState: null,
    proposed: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-03T00:00:00.000Z',
      rentalStart: '2026-10-01T00:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
      totalMinor: '12000',
    },
    refundState: null,
    status: 'PENDING_OWNER',
    ...overrides,
  };
}

describe('booking amendment state presentation', () => {
  it.each([
    ['PENDING_OWNER', 'Waiting for Owner approval'],
    ['OWNER_ACCEPTED_PAYMENT_PENDING', 'Payment required'],
    ['OWNER_ACCEPTED_PROCESSING', 'Applying booking change'],
    ['APPLIED', 'Booking updated successfully'],
    ['DECLINED', 'Owner declined the change'],
    ['WITHDRAWN', 'Change request withdrawn'],
    ['EXPIRED', 'Change request expired'],
    ['FAILED', 'Change could not be completed'],
    ['FINANCIAL_RECOVERY_PENDING', 'Booking change could not be applied'],
  ] as const)('maps %s without exposing internal enum copy', (status, expected) => {
    expect(amendmentStatusCopy(detail({ status }))[0]).toBe(expected);
  });

  it('distinguishes payment and refund reconciliation states', () => {
    expect(amendmentStatusCopy(detail({ paymentState: 'PAYMENT_VERIFYING' }))[0]).toBe(
      'Payment being verified',
    );
    expect(
      amendmentStatusCopy(detail({ paymentState: 'PAYMENT_RECEIVED_AWAITING_APPLICATION' }))[0],
    ).toBe('Payment received — applying booking change');
    expect(amendmentStatusCopy(detail({ refundState: 'REFUND_VERIFYING' }))[0]).toBe(
      'Refund being verified',
    );
    expect(
      amendmentStatusCopy(detail({ refundState: 'REFUND_COMPLETED_AWAITING_APPLICATION' }))[0],
    ).toBe('Refund completed — applying booking change');
    expect(
      amendmentStatusCopy(
        detail({ refundState: 'FINANCIAL_RECOVERY_SETTLED', status: 'FINANCIAL_RECOVERY_PENDING' }),
      )[0],
    ).toBe('Refund settled');
  });

  it('maps actionable server errors to recoverable customer copy', () => {
    expect(amendmentErrorMessage(new ApiError('raw', 'QUOTE_EXPIRED', 409))).toContain(
      'preview expired',
    );
    expect(
      amendmentErrorMessage(new ApiError('raw', 'BOOKING_AVAILABILITY_CONFLICT', 409)),
    ).toContain('no longer available');
    expect(amendmentErrorMessage(new ApiError('raw', 'RETURN_WORKFLOW_STARTED', 409))).toContain(
      'return process',
    );
  });
});

describe('renter change-booking UX integration', () => {
  it('offers pre-trip Change Booking and ACTIVE Extend Trip without ACTIVE shortening', () => {
    expect(bookings).toContain("booking.status === 'ACTIVE'");
    expect(bookings).toContain("? 'Extend Trip'");
    expect(bookings).toContain(": 'Change Booking'");
    expect(renter).toContain('...(active ? {} : { proposedPickupAt:');
    expect(renter).toContain('proposedReturnAt: returnAt.toISOString()');
    expect(renter).toContain('active ? new Date(booking.rentalEnd) : pickup');
  });

  it('supports dates, fulfillment destinations, server preview, review, and explicit submit', () => {
    expect(renter).toContain('proposedStartMethod');
    expect(renter).toContain('proposedEndMethod');
    expect(renter).toContain('proposedDeliveryDestination');
    expect(renter).toContain('proposedCollectionDestination');
    expect(renter).toContain('/amendment-preview');
    expect(renter).toContain('Confirm your request');
    expect(renter).toContain('Request Owner approval');
    expect(renter).toContain("'Idempotency-Key': submitKey.current");
  });

  it('renders zero, payment, refund, full-price, availability, and preview-expiry UX', () => {
    expect(renter).toContain('No additional charge / no refund');
    expect(renter).toContain('Additional payment required');
    expect(renter).toContain('Refund due');
    expect(renter).toContain('New total booking price');
    expect(renter).toContain('availability and price');
    expect(renter).toContain('Review the latest change');
  });

  it('restores, polls, refreshes, withdraws, and pays through accepted endpoints', () => {
    expect(bookings).toContain('booking.latestAmendment');
    expect(renter).toContain("queryKey: ['booking-amendment'");
    expect(renter).toContain('transientAmendmentStatuses.has');
    expect(renter).toContain('useRefreshOnFocusAndForeground');
    expect(renter).toContain('/withdraw');
    expect(renter).toContain('/payment');
    expect(renter).toContain('disabled={paying}');
    expect(renter).toContain('disabled={withdrawing}');
  });
});

describe('Owner booking-change UX integration', () => {
  it('surfaces actionable requests with current/proposed comparison and earnings', () => {
    expect(owner).toContain("'/owner/bookings/amendments/actionable'");
    expect(owner).toContain('Change requested');
    expect(owner).toContain('Review requested change');
    expect(owner).toContain('Current');
    expect(owner).toContain('Proposed');
    expect(owner).toContain('Owner earnings');
    expect(owner).toContain('Renter additional payment');
  });

  it('uses actionable authority, confirmation, idempotency and duplicate-tap guards', () => {
    expect(owner).toContain('amendment.actionable');
    expect(owner).toContain('Accept this change?');
    expect(owner).toContain('Decline this change?');
    expect(owner).toContain("'Idempotency-Key': idempotencyKey");
    expect(owner).toContain('disabled={decide.isPending}');
  });

  it('routes existing booking notification links to the actionable Owner amendment', () => {
    expect(navigation).toContain("booking.data.latestAmendment?.status === 'PENDING_OWNER'");
    expect(navigation).toContain('initialAmendmentReference');
  });
});
