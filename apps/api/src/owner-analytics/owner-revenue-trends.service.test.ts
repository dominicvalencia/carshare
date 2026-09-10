import { describe, expect, it, vi } from 'vitest';
import {
  buildTrendBuckets,
  buildOwnerRevenueTrendQuery,
  OWNER_REVENUE_TRENDS_DEFINITION_VERSION,
  OwnerRevenueTrendsService,
  selectTrendGranularity,
  type OwnerRevenueTrendMetric,
} from './owner-revenue-trends.service';

const metrics: readonly OwnerRevenueTrendMetric[] = [
  'rentalCollections',
  'grossBookingValue',
  'recognizedCommission',
  'ownerEarnings',
  'completedRefunds',
  'paidPayouts',
];

function summary(value = '100') {
  const values = [{ amountMinor: value, currency: 'PHP' }];
  return {
    periodActivity: {
      capturedCollections: { rental: values },
      completedRefunds: { values },
      ownerEarnings: { total: { values } },
      payouts: { paid: { values } },
      recognizedCarShareCommission: { values },
      rentalGbv: { values },
    },
  };
}

function service(
  rows = metrics.map((metric) => ({ bucketIndex: 0, currency: 'PHP', metric, valueMinor: 100n })),
) {
  return new OwnerRevenueTrendsService(
    { client: { $queryRaw: vi.fn().mockResolvedValue(rows) } } as never,
    { getOrThrow: vi.fn().mockReturnValue('local') } as never,
    { summary: vi.fn().mockResolvedValue(summary()) } as never,
  );
}

describe('owner revenue trend buckets', () => {
  it('creates 24 Manila hourly buckets with inclusive starts and exclusive ends', () => {
    const buckets = buildTrendBuckets(
      new Date('2026-09-08T16:00:00.000Z'),
      new Date('2026-09-09T16:00:00.000Z'),
      'HOURLY',
    );
    expect(buckets).toHaveLength(24);
    expect(buckets[0]).toEqual({
      startInclusive: new Date('2026-09-08T16:00:00.000Z'),
      endExclusive: new Date('2026-09-08T17:00:00.000Z'),
    });
    expect(buckets.at(-1)?.endExclusive.toISOString()).toBe('2026-09-09T16:00:00.000Z');
  });

  it('selects approved daily, weekly, and monthly custom granularities', () => {
    const start = new Date('2027-12-31T16:00:00.000Z');
    expect(selectTrendGranularity('CUSTOM', start, new Date('2028-01-31T16:00:00.000Z'))).toBe(
      'DAILY',
    );
    expect(selectTrendGranularity('CUSTOM', start, new Date('2028-02-01T16:00:00.000Z'))).toBe(
      'WEEKLY',
    );
    expect(selectTrendGranularity('CUSTOM', start, new Date('2028-06-28T16:00:00.000Z'))).toBe(
      'WEEKLY',
    );
    expect(selectTrendGranularity('CUSTOM', start, new Date('2028-06-30T16:00:00.000Z'))).toBe(
      'MONTHLY',
    );
    expect(selectTrendGranularity('THIS_WEEK', start, new Date('2028-01-07T16:00:00.000Z'))).toBe(
      'DAILY',
    );
  });

  it('keeps month and leap-year boundaries continuous in Manila', () => {
    const buckets = buildTrendBuckets(
      new Date('2027-12-31T16:00:00.000Z'),
      new Date('2028-03-31T16:00:00.000Z'),
      'MONTHLY',
    );
    expect(buckets.map((bucket) => bucket.startInclusive.toISOString())).toEqual([
      '2027-12-31T16:00:00.000Z',
      '2028-01-31T16:00:00.000Z',
      '2028-02-29T16:00:00.000Z',
    ]);
    expect(buckets.at(-1)?.endExclusive.toISOString()).toBe('2028-03-31T16:00:00.000Z');
  });
});

describe('OwnerRevenueTrendsService', () => {
  it('aggregates only the six accepted event sources with reconciliation safeguards', () => {
    const query = buildOwnerRevenueTrendQuery(
      buildTrendBuckets(
        new Date('2026-09-08T16:00:00.000Z'),
        new Date('2026-09-09T16:00:00.000Z'),
        'DAILY',
      ),
    ).sql;
    expect(query).toContain('DISTINCT ON (p."booking_id")');
    expect(query).toContain('p."purpose" = \'RENTAL\'');
    expect(query).toContain('p."reconciliation_required" = false');
    expect(query).toContain('fa."type" = \'PLATFORM_COMMISSION_REVENUE\'');
    expect(query).toContain('r."status" = \'COMPLETED\'');
    expect(query).toContain('po."paid_at" IS NOT NULL');
    expect(query).not.toContain('OWNER_PAYABLE');
    expect(query).not.toContain('available_at');
  });

  it('returns a versioned, currency-separated series and fills zero buckets', async () => {
    const result = await service().trends({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });
    expect(result).toMatchObject({
      definitionVersion: OWNER_REVENUE_TRENDS_DEFINITION_VERSION,
      environment: 'local',
      granularity: 'HOURLY',
      syntheticData: true,
      timezone: 'Asia/Manila',
    });
    expect(result.currencies[0]?.series.rentalCollections).toHaveLength(24);
    expect(result.currencies[0]?.series.rentalCollections[0]?.valueMinor).toBe('100');
    expect(result.currencies[0]?.series.rentalCollections[1]?.valueMinor).toBe('0');
    expect(JSON.stringify(result)).not.toMatch(/booking|customer|ownerProfile|provider|ledger/u);
  });

  it('fails closed when any trend total disagrees with owner-revenue-v1', async () => {
    const rows = metrics.map((metric) => ({
      bucketIndex: 0,
      currency: 'PHP',
      metric,
      valueMinor: metric === 'grossBookingValue' ? 99n : 100n,
    }));
    await expect(service(rows).trends({ period: 'TODAY' })).rejects.toThrow(
      'OWNER_REVENUE_TRENDS_RECONCILIATION_FAILED',
    );
  });

  it('preserves integer precision for large values', async () => {
    const large = 9_007_199_254_740_993n;
    const rows = metrics.map((metric) => ({
      bucketIndex: 0,
      currency: 'PHP',
      metric,
      valueMinor: large,
    }));
    const instance = new OwnerRevenueTrendsService(
      { client: { $queryRaw: vi.fn().mockResolvedValue(rows) } } as never,
      { getOrThrow: vi.fn().mockReturnValue('local') } as never,
      { summary: vi.fn().mockResolvedValue(summary(large.toString())) } as never,
    );
    const result = await instance.trends({ period: 'TODAY' });
    expect(result.currencies[0]?.series.ownerEarnings[0]?.valueMinor).toBe(large.toString());
  });
});
