import { describe, expect, it } from 'vitest';
import { priceCompleteTripRental } from '../discovery/complete-trip-pricing';
import { evaluateConfirmedCancellationTiming } from './cancellation-policy';
import { reconcileAmendmentPreviewFinancials } from './amendment-preview.service';

const commission = {
  fixedAmountMinor: 0n,
  maximumAmountMinor: null,
  minimumAmountMinor: null,
  rateBasisPoints: 1_000,
};

const tiers = {
  dailyRateMinor: 100_000,
  extendedTripDiscountBps: 1_500,
  monthlyDiscountBps: 2_000,
  shortDurationDiscountBps: 500,
  weeklyDiscountBps: 1_000,
};

describe('amendment preview financial conservation', () => {
  it.each([
    [2, 3, 200_000n, 285_000n, 85_000n],
    [6, 7, 570_000n, 630_000n, 60_000n],
    [13, 14, 1_170_000n, 1_190_000n, 20_000n],
    [29, 30, 2_465_000n, 2_400_000n, -65_000n],
  ])(
    'reconciles complete-trip threshold %i→%i instead of multiplying added days',
    (currentDays, proposedDays, currentMinor, proposedMinor, expectedDelta) => {
      expect(
        BigInt(priceCompleteTripRental(currentDays, tiers).discount.discountedSubtotalMinor),
      ).toBe(currentMinor);
      const proposed = BigInt(
        priceCompleteTripRental(proposedDays, tiers).discount.discountedSubtotalMinor,
      );
      expect(proposed).toBe(proposedMinor);
      const result = reconcileAmendmentPreviewFinancials({
        commission,
        currentTotal: currentMinor,
        proposedFulfillment: 0n,
        proposedRental: proposed,
        retainedRental: 0n,
      });
      expect(result.policyAdjustedTotal - currentMinor).toBe(expectedDelta);
      expect(result.additionalPaymentMinor > 0n && result.refundMinor > 0n).toBe(false);
    },
  );

  it('removes the 7-day tier for 7→6 and applies the refundable economic reduction', () => {
    const current = BigInt(priceCompleteTripRental(7, tiers).discount.discountedSubtotalMinor);
    const proposed = priceCompleteTripRental(6, tiers);
    expect(proposed.discount.tier).toBe('SHORT_3_DAY');
    const result = reconcileAmendmentPreviewFinancials({
      commission,
      currentTotal: current,
      proposedFulfillment: 0n,
      proposedRental: BigInt(proposed.discount.discountedSubtotalMinor),
      retainedRental: 0n,
    });
    expect(result.refundMinor).toBe(60_000n);
    expect(result.proposedOwnerEarnings).toBe(513_000n);
  });

  it('keeps retained rental and Owner earnings intact for a non-refundable shortening', () => {
    const result = reconcileAmendmentPreviewFinancials({
      commission,
      currentTotal: 630_000n,
      proposedFulfillment: 0n,
      proposedRental: 570_000n,
      retainedRental: 60_000n,
    });
    expect(result).toMatchObject({
      additionalPaymentMinor: 0n,
      policyAdjustedRental: 630_000n,
      policyAdjustedTotal: 630_000n,
      proposedCommission: 63_000n,
      proposedOwnerEarnings: 567_000n,
      refundMinor: 0n,
    });
  });

  it('supports zero-delta fulfillment-neutral operation without unexplained cents', () => {
    const result = reconcileAmendmentPreviewFinancials({
      commission,
      currentTotal: 205_001n,
      proposedFulfillment: 5_001n,
      proposedRental: 200_000n,
      retainedRental: 0n,
    });
    expect(result.additionalPaymentMinor).toBe(0n);
    expect(result.refundMinor).toBe(0n);
    expect(result.proposedOwnerEarnings + result.proposedCommission).toBe(
      result.policyAdjustedTotal,
    );
  });

  it('uses integer commission rounding without cumulative sequential drift', () => {
    const oddCommission = { ...commission, rateBasisPoints: 333 };
    const three = reconcileAmendmentPreviewFinancials({
      commission: oddCommission,
      currentTotal: 200_001n,
      proposedFulfillment: 0n,
      proposedRental: 285_001n,
      retainedRental: 0n,
    });
    const seven = reconcileAmendmentPreviewFinancials({
      commission: oddCommission,
      currentTotal: three.policyAdjustedTotal,
      proposedFulfillment: 0n,
      proposedRental: 630_001n,
      retainedRental: 0n,
    });
    expect(three.proposedOwnerEarnings + three.proposedCommission).toBe(285_001n);
    expect(seven.proposedOwnerEarnings + seven.proposedCommission).toBe(630_001n);
    expect(seven.additionalPaymentMinor).toBe(345_000n);
  });

  it('binds proposed commission to the immutable original commission authority', () => {
    const original = reconcileAmendmentPreviewFinancials({
      commission,
      currentTotal: 200_000n,
      proposedFulfillment: 0n,
      proposedRental: 285_000n,
      retainedRental: 0n,
    });
    const hypotheticalCurrentRule = reconcileAmendmentPreviewFinancials({
      commission: { ...commission, rateBasisPoints: 2_500 },
      currentTotal: 200_000n,
      proposedFulfillment: 0n,
      proposedRental: 285_000n,
      retainedRental: 0n,
    });
    expect(original.proposedCommission).toBe(28_500n);
    expect(hypotheticalCurrentRule.proposedCommission).toBe(71_250n);
    expect(original.proposedOwnerEarnings).toBe(256_500n);
  });
});

describe('amendment shortening uses cancellation timing authority', () => {
  const pickup = new Date('2026-10-10T12:00:00.000Z');
  const hour = 60 * 60_000;

  it.each([
    [96, 73, true],
    [96, 72, false],
    [96, 71, false],
    [48, 43, true],
    [48, 42, true],
    [48, 41, false],
  ])(
    'preserves cancellation boundaries %ih confirmed/%ih before',
    (confirmed, before, refundable) => {
      expect(
        evaluateConfirmedCancellationTiming({
          confirmedAt: new Date(pickup.getTime() - confirmed * hour),
          evaluatedAt: new Date(pickup.getTime() - before * hour),
          scheduledPickupAt: pickup,
        }).refundable,
      ).toBe(refundable);
    },
  );
});
