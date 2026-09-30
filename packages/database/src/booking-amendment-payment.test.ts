import { describe, expect, it } from 'vitest';
import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentStatus,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentPurpose,
  PaymentStatus,
} from './generated/prisma/enums';
import { hasBookingAmendmentPaidApplicationAuthority } from './booking-amendment-payment';

const valid = {
  amendmentBookingId: 'booking-1',
  amendmentStatus: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
  direction: BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT,
  payment: {
    amountMinor: 500n,
    bookingId: 'booking-1',
    currency: 'PHP',
    operations: [
      {
        amountMinor: 500n,
        currency: 'PHP',
        status: PaymentOperationStatus.SUCCEEDED,
        type: PaymentOperationType.CAPTURE,
      },
    ],
    purpose: PaymentPurpose.ADDITIONAL_CHARGE,
    status: PaymentStatus.CAPTURED,
  },
  pricingCurrency: 'PHP',
  pricingDeltaMinor: 500n,
  settlementCurrency: 'PHP',
  settlementDeltaMinor: 500n,
};

describe('booking amendment paid-application authority', () => {
  it('accepts only the complete captured authority', () => {
    expect(hasBookingAmendmentPaidApplicationAuthority(valid)).toBe(true);
  });

  it.each([
    ['no payment', { payment: null }],
    ['wrong lifecycle', { amendmentStatus: BookingAmendmentStatus.PENDING_OWNER }],
    ['zero delta', { settlementDeltaMinor: 0n }],
    ['refund', { direction: BookingAmendmentFinancialDirection.REFUND }],
    [
      'authorization pending',
      { payment: { ...valid.payment!, status: PaymentStatus.AUTHORIZING } },
    ],
    ['authorization only', { payment: { ...valid.payment!, status: PaymentStatus.AUTHORIZED } }],
    ['capture pending', { payment: { ...valid.payment!, status: PaymentStatus.CAPTURING } }],
    ['explicit failure', { payment: { ...valid.payment!, status: PaymentStatus.FAILED } }],
    ['wrong amount', { payment: { ...valid.payment!, amountMinor: 501n } }],
    ['wrong currency', { payment: { ...valid.payment!, currency: 'USD' } }],
    ['wrong booking', { payment: { ...valid.payment!, bookingId: 'booking-2' } }],
    [
      'capture unknown',
      {
        payment: {
          ...valid.payment!,
          operations: [
            {
              ...valid.payment!.operations[0]!,
              status: PaymentOperationStatus.UNKNOWN,
            },
          ],
        },
      },
    ],
  ])('rejects %s', (_label, override) => {
    expect(hasBookingAmendmentPaidApplicationAuthority({ ...valid, ...override })).toBe(false);
  });
});
