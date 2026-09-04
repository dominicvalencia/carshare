export const MAX_DURATION_DISCOUNT_BPS = 4_000;
export const DURATION_DISCOUNT_RULE_VERSION = 'DURATION_DISCOUNT_BPS_V1';

export interface DurationDiscountPolicy {
  readonly shortDurationDiscountBps?: number | null;
  readonly weeklyDiscountBps?: number | null;
  readonly extendedTripDiscountBps?: number | null;
  readonly monthlyDiscountBps?: number | null;
}

const tiers = [
  { days: 3, field: 'shortDurationDiscountBps', label: '3-day discount', tier: 'SHORT_3_DAY' },
  { days: 7, field: 'weeklyDiscountBps', label: 'Weekly discount', tier: 'WEEKLY_7_DAY' },
  {
    days: 14,
    field: 'extendedTripDiscountBps',
    label: 'Extended-trip discount',
    tier: 'EXTENDED_14_DAY',
  },
  { days: 30, field: 'monthlyDiscountBps', label: 'Monthly discount', tier: 'MONTHLY_30_DAY' },
] as const;

export function validateDurationDiscounts(policy: DurationDiscountPolicy): string | null {
  let previous = 0;
  for (const tier of tiers) {
    const value = policy[tier.field];
    if (value === null || value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value > MAX_DURATION_DISCOUNT_BPS)
      return `${tier.label} must be between 0% and ${MAX_DURATION_DISCOUNT_BPS / 100}%.`;
    if (value < previous)
      return 'Longer enabled duration tiers cannot have a lower discount than shorter tiers.';
    previous = value;
  }
  return null;
}

export function durationDiscount(
  baseRentalAmountMinor: number,
  chargeableDays: number,
  policy: DurationDiscountPolicy,
) {
  const applicable = [...tiers]
    .reverse()
    .find(
      (tier) =>
        chargeableDays >= tier.days &&
        policy[tier.field] !== null &&
        policy[tier.field] !== undefined,
    );
  const basisPoints = applicable ? (policy[applicable.field] ?? 0) : 0;
  const amountMinor = Math.floor((baseRentalAmountMinor * basisPoints) / 10_000);
  return {
    amountMinor,
    basisPoints,
    discountedSubtotalMinor: baseRentalAmountMinor - amountMinor,
    label: applicable?.label ?? null,
    ruleVersion: DURATION_DISCOUNT_RULE_VERSION,
    tier: applicable?.tier ?? null,
  };
}
