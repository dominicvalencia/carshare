import { describe, expect, it } from 'vitest';
import {
  chargeableDays,
  durationDiscountMessage,
  percentageLabel,
  positiveDurationDiscounts,
} from './duration-discount-presentation';

describe('duration discount presentation', () => {
  it('hides absent, disabled, zero, and invalid tiers', () => {
    expect(positiveDurationDiscounts(undefined)).toEqual([]);
    expect(
      positiveDurationDiscounts([
        { discountBps: 0, minimumDays: 3 },
        { discountBps: -1, minimumDays: 7 },
      ]),
    ).toEqual([]);
  });

  it('shows only enabled positive tiers in duration order', () => {
    expect(
      positiveDurationDiscounts([
        { discountBps: 2_000, minimumDays: 30 },
        { discountBps: 1_000, minimumDays: 7 },
      ]),
    ).toEqual([
      { discountBps: 1_000, minimumDays: 7 },
      { discountBps: 2_000, minimumDays: 30 },
    ]);
  });

  it('formats integer and fractional basis-point percentages for renters', () => {
    expect(percentageLabel(500)).toBe('5%');
    expect(percentageLabel(1_025)).toBe('10.25%');
  });

  it('uses the longest qualifying tier without claiming peso savings', () => {
    const tiers = [
      { discountBps: 500, minimumDays: 3 },
      { discountBps: 1_000, minimumDays: 7 },
      { discountBps: 1_500, minimumDays: 14 },
    ];
    expect(durationDiscountMessage(8, tiers)).toBe(
      'Your 8-day trip qualifies for 10% off the rental subtotal.',
    );
    expect(durationDiscountMessage(2, tiers)).toBe('Book 1 more day to unlock 5% off.');
  });

  it('matches the quote duration ceiling without calculating money', () => {
    const start = new Date('2026-09-10T08:00:00.000Z');
    expect(chargeableDays(start, new Date('2026-09-11T07:00:00.000Z'))).toBe(1);
    expect(chargeableDays(start, new Date('2026-09-11T09:00:00.000Z'))).toBe(2);
  });
});
