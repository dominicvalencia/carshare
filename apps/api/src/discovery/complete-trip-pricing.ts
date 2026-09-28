import { durationDiscount, type DurationDiscountPolicy } from './duration-discounts';

export interface CompleteTripPricingPolicy extends DurationDiscountPolicy {
  readonly dailyRateMinor: number;
}

/** Pure complete-trip rental pricing used by public quotes and amendment previews. */
export function priceCompleteTripRental(chargeableDays: number, policy: CompleteTripPricingPolicy) {
  if (!Number.isInteger(chargeableDays) || chargeableDays < 1)
    throw new RangeError('Chargeable days must be a positive integer.');
  const baseRentalAmountMinor = policy.dailyRateMinor * chargeableDays;
  if (!Number.isSafeInteger(baseRentalAmountMinor) || baseRentalAmountMinor > 2_147_483_647)
    throw new RangeError('The calculated rental amount exceeds the supported range.');
  return {
    baseRentalAmountMinor,
    discount: durationDiscount(baseRentalAmountMinor, chargeableDays, policy),
  };
}
