import { BookingAmendmentFinancialDirection, BookingAmendmentStatus } from '@carrental/database';
import { describe, expect, it } from 'vitest';
import { blocksIncompatibleBookingLifecycle } from './booking-amendment-lifecycle-guard';

describe('booking amendment lifecycle guard', () => {
  it('blocks payment-pending and accepted refund-due amendments', () => {
    expect(
      blocksIncompatibleBookingLifecycle({
        settlement: null,
        status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      }),
    ).toBe(true);
    expect(
      blocksIncompatibleBookingLifecycle({
        settlement: {
          direction: BookingAmendmentFinancialDirection.REFUND,
          financialDeltaMinor: -1n,
        },
        status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      }),
    ).toBe(true);
  });

  it('does not block zero-delta processing or terminal amendments', () => {
    expect(
      blocksIncompatibleBookingLifecycle({
        settlement: {
          direction: BookingAmendmentFinancialDirection.NONE,
          financialDeltaMinor: 0n,
        },
        status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      }),
    ).toBe(false);

    for (const status of [
      BookingAmendmentStatus.APPLIED,
      BookingAmendmentStatus.DECLINED,
      BookingAmendmentStatus.EXPIRED,
      BookingAmendmentStatus.FAILED,
      BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      BookingAmendmentStatus.WITHDRAWN,
    ]) {
      expect(
        blocksIncompatibleBookingLifecycle({
          settlement: {
            direction: BookingAmendmentFinancialDirection.REFUND,
            financialDeltaMinor: -1n,
          },
          status,
        }),
      ).toBe(false);
    }
  });
});
