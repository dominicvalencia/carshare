import { describe, expect, it } from 'vitest';
import { durationDiscount, validateDurationDiscounts } from './duration-discounts';

const configured = {
  extendedTripDiscountBps: 1_500,
  monthlyDiscountBps: 2_000,
  shortDurationDiscountBps: 500,
  weeklyDiscountBps: 1_000,
};

describe('duration discounts', () => {
  it.each([
    [2, null, 0],
    [3, 'SHORT_3_DAY', 500],
    [6, 'SHORT_3_DAY', 500],
    [7, 'WEEKLY_7_DAY', 1_000],
    [13, 'WEEKLY_7_DAY', 1_000],
    [14, 'EXTENDED_14_DAY', 1_500],
    [29, 'EXTENDED_14_DAY', 1_500],
    [30, 'MONTHLY_30_DAY', 2_000],
    [45, 'MONTHLY_30_DAY', 2_000],
  ])('selects the correct tier for %i days', (days, tier, bps) => {
    expect(durationDiscount(250_000 * days, days, configured)).toMatchObject({
      basisPoints: bps,
      tier,
    });
  });

  it('uses integer PHP minor units and treats zero-percent as enabled', () => {
    expect(durationDiscount(750_001, 3, { shortDurationDiscountBps: 333 })).toMatchObject({
      amountMinor: 24_975,
      discountedSubtotalMinor: 725_026,
    });
    expect(durationDiscount(750_000, 3, { shortDurationDiscountBps: 0 })).toMatchObject({
      amountMinor: 0,
      tier: 'SHORT_3_DAY',
    });
  });

  it('rejects unsafe or decreasing configured tiers', () => {
    expect(validateDurationDiscounts({ weeklyDiscountBps: 4_001 })).toMatch(/between/);
    expect(
      validateDurationDiscounts({ shortDurationDiscountBps: 1_000, weeklyDiscountBps: 500 }),
    ).toMatch(/Longer/);
    expect(validateDurationDiscounts(configured)).toBeNull();
  });
});
