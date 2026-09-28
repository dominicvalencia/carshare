import { describe, expect, it } from 'vitest';
import { priceCompleteTripRental } from './complete-trip-pricing';

const policy = {
  dailyRateMinor: 100_000,
  extendedTripDiscountBps: 1_500,
  monthlyDiscountBps: 2_000,
  shortDurationDiscountBps: 500,
  weeklyDiscountBps: 1_000,
};

describe('complete-trip rental pricing', () => {
  it.each([
    [2, null, 200_000],
    [3, 'SHORT_3_DAY', 285_000],
    [6, 'SHORT_3_DAY', 570_000],
    [7, 'WEEKLY_7_DAY', 630_000],
    [13, 'WEEKLY_7_DAY', 1_170_000],
    [14, 'EXTENDED_14_DAY', 1_190_000],
    [29, 'EXTENDED_14_DAY', 2_465_000],
    [30, 'MONTHLY_30_DAY', 2_400_000],
  ])('reprices all %i days and its duration threshold', (days, tier, expected) => {
    const result = priceCompleteTripRental(days, policy);
    expect(result.discount.tier).toBe(tier);
    expect(result.discount.discountedSubtotalMinor).toBe(expected);
  });

  it('prices the complete proposed trip rather than a day-count delta', () => {
    const twoDays = priceCompleteTripRental(2, policy);
    const threeDays = priceCompleteTripRental(3, policy);
    expect(
      threeDays.discount.discountedSubtotalMinor - twoDays.discount.discountedSubtotalMinor,
    ).toBe(85_000);
  });

  it('does not invent an unconfigured tier', () => {
    const result = priceCompleteTripRental(7, {
      ...policy,
      shortDurationDiscountBps: null,
      weeklyDiscountBps: null,
    });
    expect(result.discount).toMatchObject({
      amountMinor: 0,
      discountedSubtotalMinor: 700_000,
      tier: null,
    });
  });

  it('selects only the highest qualifying tier instead of stacking discounts', () => {
    const result = priceCompleteTripRental(14, policy);
    expect(result.discount).toMatchObject({
      amountMinor: 210_000,
      basisPoints: 1_500,
      discountedSubtotalMinor: 1_190_000,
      tier: 'EXTENDED_14_DAY',
    });
  });

  it('preserves representative public quote component economics', () => {
    const rental = priceCompleteTripRental(7, policy);
    const fulfillmentFeeMinor = 75_000;
    expect({
      baseRentalAmountMinor: rental.baseRentalAmountMinor,
      chargeableDays: 7,
      currency: 'PHP',
      durationDiscountAmountMinor: rental.discount.amountMinor,
      fulfillmentFeeMinor,
      totalMinor: rental.discount.discountedSubtotalMinor + fulfillmentFeeMinor,
    }).toEqual({
      baseRentalAmountMinor: 700_000,
      chargeableDays: 7,
      currency: 'PHP',
      durationDiscountAmountMinor: 70_000,
      fulfillmentFeeMinor: 75_000,
      totalMinor: 705_000,
    });
  });
});
