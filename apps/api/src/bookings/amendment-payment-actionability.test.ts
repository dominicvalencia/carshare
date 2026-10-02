import { BookingAmendmentFinancialDirection, BookingAmendmentStatus } from '@carrental/database';
import { describe, expect, it } from 'vitest';
import { canInitiateBookingAmendmentPayment } from './amendment-payment-actionability';

const now = new Date('2026-10-01T03:00:00.000Z');
const valid = {
  additionalPaymentId: null,
  direction: BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT,
  financialDeltaMinor: 3_000n,
  paymentDeadlineAt: new Date('2026-10-01T03:10:00.000Z'),
  pricingCurrency: 'PHP',
  renterFinancialDeltaMinor: 3_000n,
  settlementCurrency: 'PHP',
  status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
} as const;

describe('booking amendment payment initiation actionability', () => {
  it('allows a valid payment-pending amendment with no existing payment', () => {
    expect(canInitiateBookingAmendmentPayment(valid, now)).toBe(true);
  });

  it.each([
    ['existing pending payment', { additionalPaymentId: 'payment-id' }],
    ['provider-uncertain payment', { additionalPaymentId: 'unknown-payment-id' }],
    ['captured payment', { additionalPaymentId: 'captured-payment-id' }],
    ['expired deadline', { paymentDeadlineAt: now }],
    ['applied amendment', { status: BookingAmendmentStatus.APPLIED }],
    ['wrong lifecycle', { status: BookingAmendmentStatus.PENDING_OWNER }],
    ['refund direction', { direction: BookingAmendmentFinancialDirection.REFUND }],
    ['zero delta', { financialDeltaMinor: 0n, renterFinancialDeltaMinor: 0n }],
  ] as const)('rejects %s', (_name, override) => {
    expect(canInitiateBookingAmendmentPayment({ ...valid, ...override }, now)).toBe(false);
  });
});
