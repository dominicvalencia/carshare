import { describe, expect, it } from 'vitest';
import { resolveOwnerAnalyticsPeriod } from './owner-analytics.period';

describe('resolveOwnerAnalyticsPeriod', () => {
  it('uses Manila midnight across the UTC date crossover', () => {
    const range = resolveOwnerAnalyticsPeriod({
      now: new Date('2026-09-08T16:00:00.000Z'),
      period: 'TODAY',
    });
    expect(range.startInclusive.toISOString()).toBe('2026-09-08T16:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-09-09T16:00:00.000Z');
    expect(range.comparisonStartInclusive.toISOString()).toBe('2026-09-07T16:00:00.000Z');
  });

  it('does not switch Manila dates before local midnight', () => {
    const range = resolveOwnerAnalyticsPeriod({
      now: new Date('2026-09-08T15:59:59.999Z'),
      period: 'TODAY',
    });
    expect(range.startInclusive.toISOString()).toBe('2026-09-07T16:00:00.000Z');
  });

  it('starts weeks on Monday and compares the preceding Monday-to-Monday week', () => {
    const range = resolveOwnerAnalyticsPeriod({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'THIS_WEEK',
    });
    expect(range.startInclusive.toISOString()).toBe('2026-09-06T16:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-09-13T16:00:00.000Z');
    expect(range.comparisonStartInclusive.toISOString()).toBe('2026-08-30T16:00:00.000Z');
  });

  it('uses calendar months and the preceding calendar month at year boundaries', () => {
    const range = resolveOwnerAnalyticsPeriod({
      now: new Date('2027-01-15T00:00:00.000Z'),
      period: 'THIS_MONTH',
    });
    expect(range.startInclusive.toISOString()).toBe('2026-12-31T16:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2027-01-31T16:00:00.000Z');
    expect(range.comparisonStartInclusive.toISOString()).toBe('2026-11-30T16:00:00.000Z');
  });

  it('accepts an inclusive leap-day custom range and returns an equivalent prior range', () => {
    const range = resolveOwnerAnalyticsPeriod({
      endDate: '2028-02-29',
      period: 'CUSTOM',
      startDate: '2028-02-28',
    });
    expect(range.startInclusive.toISOString()).toBe('2028-02-27T16:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2028-02-29T16:00:00.000Z');
    expect(range.comparisonStartInclusive.toISOString()).toBe('2028-02-25T16:00:00.000Z');
  });

  it('accepts 366 days and rejects 367 days', () => {
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        endDate: '2028-12-30',
        period: 'CUSTOM',
        startDate: '2028-01-01',
      }),
    ).not.toThrow();
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        endDate: '2029-01-01',
        period: 'CUSTOM',
        startDate: '2028-01-01',
      }),
    ).toThrow('ANALYTICS_DATE_RANGE_EXCEEDS_366_DAYS');
  });

  it('rejects invalid, reversed, or incomplete custom ranges', () => {
    expect(() => resolveOwnerAnalyticsPeriod({ period: 'CUSTOM' })).toThrow(
      'CUSTOM_REQUIRES_START_AND_END_DATES',
    );
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        endDate: '2026-02-30',
        period: 'CUSTOM',
        startDate: '2026-02-01',
      }),
    ).toThrow('INVALID_ANALYTICS_CALENDAR_DATE');
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        endDate: '2026-09-01',
        period: 'CUSTOM',
        startDate: '2026-09-02',
      }),
    ).toThrow('INVALID_ANALYTICS_DATE_RANGE');
  });
});
