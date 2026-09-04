export interface PublicDurationDiscount {
  readonly minimumDays: number;
  readonly discountBps: number;
}

export function chargeableDays(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

export function positiveDurationDiscounts(
  tiers: readonly PublicDurationDiscount[] | undefined,
): readonly PublicDurationDiscount[] {
  return (tiers ?? [])
    .filter(
      (tier) =>
        Number.isInteger(tier.minimumDays) &&
        tier.minimumDays > 0 &&
        Number.isInteger(tier.discountBps) &&
        tier.discountBps > 0,
    )
    .sort((left, right) => left.minimumDays - right.minimumDays);
}

export function percentageLabel(discountBps: number): string {
  const percentage = discountBps / 100;
  return `${Number.isInteger(percentage) ? percentage : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function durationDiscountMessage(
  days: number,
  tiers: readonly PublicDurationDiscount[],
): string | null {
  const applicable = [...tiers].reverse().find((tier) => days >= tier.minimumDays);
  if (applicable) {
    return `Your ${days}-day trip qualifies for ${percentageLabel(applicable.discountBps)} off the rental subtotal.`;
  }
  const next = tiers.find((tier) => tier.minimumDays > days);
  if (!next) return null;
  const remaining = next.minimumDays - days;
  return `Book ${remaining} more ${remaining === 1 ? 'day' : 'days'} to unlock ${percentageLabel(next.discountBps)} off.`;
}
