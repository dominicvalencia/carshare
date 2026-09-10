import { describe, expect, it, vi } from 'vitest';
import { resolveOwnerAnalyticsPeriod } from './owner-analytics.period';
import { buildTrendBuckets, selectTrendGranularity } from './owner-revenue-trends.service';
import {
  buildOwnerMarketplaceTrendQuery,
  OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION,
  OwnerMarketplaceTrendsService,
  type OwnerMarketplaceTrendMetric,
} from './owner-marketplace-trends.service';

const metrics: readonly OwnerMarketplaceTrendMetric[] = [
  'bookingsCreated',
  'confirmedBookings',
  'rentalsStarted',
  'completedRentals',
  'cancellations',
  'newRenters',
  'newVehicleOwners',
  'newVehicles',
];

function summary(value = 1) {
  return {
    integrity: {
      actualPickupsWithoutActiveTransition: 0,
      cancellationRecordsWithoutTransition: 0,
      cancellationTransitionsWithoutRecord: 0,
      rentalsStartedChecked: value,
      rentalsStartedMissingActualPickup: 0,
      rentalsStartedPickupTimestampMismatch: 0,
      status: 'PASS',
    },
    periodActivity: {
      activeRentersDuringPeriod: value,
      bookingsCreated: value,
      cancellations: value,
      completedRentals: value,
      confirmedBookings: value,
      newRenters: value,
      newVehicleOwners: value,
      newVehicles: value,
      rentalsStarted: value,
    },
  };
}

function service(
  rows = metrics.map((metric) => ({ bucketIndex: 0, count: 1n, metric })),
  report = summary(),
) {
  return new OwnerMarketplaceTrendsService(
    { client: { $queryRaw: vi.fn().mockResolvedValue(rows) } } as never,
    { getOrThrow: vi.fn().mockReturnValue('local') } as never,
    { marketplace: vi.fn().mockResolvedValue(report) } as never,
  );
}

describe('owner marketplace trend bucket rules', () => {
  it.each([
    ['TODAY', undefined, undefined, 'HOURLY', 24],
    ['THIS_WEEK', undefined, undefined, 'DAILY', 7],
    ['THIS_MONTH', undefined, undefined, 'DAILY', 29],
    ['CUSTOM', '2028-02-01', '2028-02-29', 'DAILY', 29],
    ['CUSTOM', '2028-01-01', '2028-02-01', 'WEEKLY', 5],
    ['CUSTOM', '2027-09-01', '2028-02-29', 'MONTHLY', 6],
  ] as const)(
    'uses server-selected %s buckets with continuous zero-fill coverage',
    (period, startDate, endDate, expectedGranularity, expectedBuckets) => {
      const range = resolveOwnerAnalyticsPeriod({
        period,
        startDate,
        endDate,
        now: new Date('2028-02-29T04:00:00.000Z'),
      });
      const granularity = selectTrendGranularity(
        range.period,
        range.startInclusive,
        range.endExclusive,
      );
      const buckets = buildTrendBuckets(range.startInclusive, range.endExclusive, granularity);
      expect(granularity).toBe(expectedGranularity);
      expect(buckets).toHaveLength(expectedBuckets);
      expect(buckets[0]?.startInclusive).toEqual(range.startInclusive);
      expect(buckets.at(-1)?.endExclusive).toEqual(range.endExclusive);
      for (let index = 1; index < buckets.length; index += 1) {
        expect(buckets[index]?.startInclusive).toEqual(buckets[index - 1]?.endExclusive);
      }
    },
  );

  it('accepts 366 calendar days and rejects a longer custom period', () => {
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        period: 'CUSTOM',
        startDate: '2028-01-01',
        endDate: '2028-12-31',
      }),
    ).not.toThrow();
    expect(() =>
      resolveOwnerAnalyticsPeriod({
        period: 'CUSTOM',
        startDate: '2028-01-01',
        endDate: '2029-01-01',
      }),
    ).toThrow('ANALYTICS_DATE_RANGE_EXCEEDS_366_DAYS');
  });
});

describe('OwnerMarketplaceTrendsService', () => {
  it('uses only the eight accepted immutable event sources with first-event deduplication', () => {
    const query = buildOwnerMarketplaceTrendQuery(
      buildTrendBuckets(
        new Date('2026-08-31T16:00:00.000Z'),
        new Date('2026-09-30T16:00:00.000Z'),
        'DAILY',
      ),
    ).strings.join(' ');
    expect(query).toContain('MIN("occurred_at")');
    expect(query).toContain('MIN(ur."assigned_at")');
    expect(query).toContain('b."created_at"');
    expect(query).toContain('bc."created_at"');
    expect(query).toContain('op."created_at"');
    expect(query).toContain('v."created_at"');
    expect(query).not.toContain('actual_pickup_at');
    expect(query).not.toContain('activeRentersDuringPeriod');
    expect(query).not.toContain('approvedListingsNow');
    expect(query).not.toContain('reason_code');
  });

  it('returns count strings, zero-filled buckets, metadata, and safe integrity aggregates', async () => {
    const result = await service().trends({
      period: 'TODAY',
      now: new Date('2026-09-09T04:00:00.000Z'),
    });
    expect(result).toMatchObject({
      definitionVersion: OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION,
      environment: 'local',
      granularity: 'HOURLY',
      syntheticData: true,
      timezone: 'Asia/Manila',
      integrity: { status: 'PASS' },
    });
    expect(result.series.bookingsCreated).toHaveLength(24);
    expect(result.series.bookingsCreated[0]?.count).toBe('1');
    expect(result.series.bookingsCreated[1]?.count).toBe('0');
    expect(JSON.stringify(result)).not.toMatch(
      /bookingId|userId|vehicleId|reasonText|address|coordinate|providerReference/u,
    );
  });

  it('fails closed when any additive series disagrees with owner-marketplace-reports-v1', async () => {
    const rows = metrics.map((metric) => ({
      bucketIndex: 0,
      count: metric === 'confirmedBookings' ? 2n : 1n,
      metric,
    }));
    await expect(service(rows).trends({ period: 'TODAY' })).rejects.toThrow(
      'OWNER_MARKETPLACE_TRENDS_RECONCILIATION_FAILED',
    );
  });

  it.each(['TODAY', 'THIS_WEEK', 'THIS_MONTH'] as const)(
    'reconciles every additive metric for %s',
    async (period) => {
      await expect(
        service().trends({ period, now: new Date('2026-09-09T04:00:00.000Z') }),
      ).resolves.toMatchObject({ definitionVersion: OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION });
    },
  );

  it.each([
    ['2026-09-01', '2026-09-07'],
    ['2026-01-01', '2026-03-01'],
    ['2025-09-10', '2026-09-10'],
  ] as const)(
    'reconciles every additive metric for CUSTOM %s through %s',
    async (startDate, endDate) => {
      await expect(
        service().trends({ period: 'CUSTOM', startDate, endDate }),
      ).resolves.toMatchObject({ definitionVersion: OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION });
    },
  );
});
