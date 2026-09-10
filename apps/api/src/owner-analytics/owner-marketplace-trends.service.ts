import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import {
  OWNER_ANALYTICS_TIMEZONE,
  resolveOwnerAnalyticsPeriod,
  type OwnerAnalyticsPeriod,
} from './owner-analytics.period';
import { OwnerMarketplaceReportsService } from './owner-marketplace-reports.service';
import {
  buildTrendBuckets,
  selectTrendGranularity,
  type OwnerRevenueTrendGranularity,
} from './owner-revenue-trends.service';

export const OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION = 'owner-marketplace-trends-v1';

export type OwnerMarketplaceTrendMetric =
  | 'bookingsCreated'
  | 'confirmedBookings'
  | 'rentalsStarted'
  | 'completedRentals'
  | 'cancellations'
  | 'newRenters'
  | 'newVehicleOwners'
  | 'newVehicles';

type TrendRow = {
  bucketIndex: number;
  count: bigint;
  metric: OwnerMarketplaceTrendMetric;
};

const METRICS: readonly OwnerMarketplaceTrendMetric[] = [
  'bookingsCreated',
  'confirmedBookings',
  'rentalsStarted',
  'completedRentals',
  'cancellations',
  'newRenters',
  'newVehicleOwners',
  'newVehicles',
];

type TrendBucket = ReturnType<typeof buildTrendBuckets>[number];

@Injectable()
export class OwnerMarketplaceTrendsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly reports: OwnerMarketplaceReportsService,
  ) {}

  async trends(input: {
    period: OwnerAnalyticsPeriod;
    startDate?: string;
    endDate?: string;
    now?: Date;
  }) {
    const range = resolveOwnerAnalyticsPeriod(input);
    const generatedAt = input.now ?? new Date();
    const granularity = selectTrendGranularity(
      range.period,
      range.startInclusive,
      range.endExclusive,
    );
    const buckets = buildTrendBuckets(range.startInclusive, range.endExclusive, granularity);
    const [summary, rows] = await Promise.all([
      this.reports.marketplace(input),
      this.database.client.$queryRaw<TrendRow[]>(buildOwnerMarketplaceTrendQuery(buckets)),
    ]);
    const grouped = new Map(rows.map((row) => [`${row.metric}:${row.bucketIndex}`, row.count]));
    const series = Object.fromEntries(
      METRICS.map((metric) => [
        metric,
        buckets.map((bucket, bucketIndex) => ({
          startInclusive: bucket.startInclusive.toISOString(),
          endExclusive: bucket.endExclusive.toISOString(),
          count: (grouped.get(`${metric}:${bucketIndex}`) ?? 0n).toString(),
        })),
      ]),
    ) as Record<
      OwnerMarketplaceTrendMetric,
      Array<{ startInclusive: string; endExclusive: string; count: string }>
    >;

    assertMarketplaceTrendsReconciled(series, summary.periodActivity);
    const environment = this.configuration.getOrThrow('APP_ENV', { infer: true });
    return {
      definitionVersion: OWNER_MARKETPLACE_TRENDS_DEFINITION_VERSION,
      environment,
      syntheticData: environment !== 'production',
      timezone: OWNER_ANALYTICS_TIMEZONE,
      generatedAt: generatedAt.toISOString(),
      period: {
        kind: range.period,
        startInclusive: range.startInclusive.toISOString(),
        endExclusive: range.endExclusive.toISOString(),
      },
      granularity,
      series,
      integrity: summary.integrity,
    };
  }
}

export function buildOwnerMarketplaceTrendQuery(buckets: TrendBucket[]) {
  const values = Prisma.join(
    buckets.map(
      (bucket, index) =>
        Prisma.sql`(${index}::integer, ${bucket.startInclusive}::timestamptz, ${bucket.endExclusive}::timestamptz)`,
    ),
  );
  return Prisma.sql`
    WITH buckets("bucketIndex", "startInclusive", "endExclusive") AS (VALUES ${values}),
    first_transitions AS (
      SELECT "booking_id", "to_status", MIN("occurred_at") AS "occurred_at"
      FROM "booking_status_history"
      WHERE "to_status" IN ('CONFIRMED', 'ACTIVE', 'COMPLETED')
      GROUP BY "booking_id", "to_status"
    ),
    first_renter_roles AS (
      SELECT ur."user_id", MIN(ur."assigned_at") AS "assigned_at"
      FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE r."code" = 'RENTER'
      GROUP BY ur."user_id"
    ),
    events AS (
      SELECT 'bookingsCreated'::text AS metric, b."created_at" AS occurred_at FROM "bookings" b
      UNION ALL
      SELECT CASE ft."to_status"
        WHEN 'CONFIRMED' THEN 'confirmedBookings'
        WHEN 'ACTIVE' THEN 'rentalsStarted'
        WHEN 'COMPLETED' THEN 'completedRentals'
      END, ft."occurred_at" FROM first_transitions ft
      UNION ALL
      SELECT 'cancellations', bc."created_at" FROM "booking_cancellations" bc
      UNION ALL
      SELECT 'newRenters', fr."assigned_at" FROM first_renter_roles fr
      UNION ALL
      SELECT 'newVehicleOwners', op."created_at" FROM "owner_profiles" op
      UNION ALL
      SELECT 'newVehicles', v."created_at" FROM "vehicles" v
    )
    SELECT b."bucketIndex", e.metric, COUNT(*)::bigint AS count
    FROM buckets b
    JOIN events e ON e.occurred_at >= b."startInclusive" AND e.occurred_at < b."endExclusive"
    GROUP BY b."bucketIndex", e.metric
    ORDER BY e.metric, b."bucketIndex"
  `;
}

function assertMarketplaceTrendsReconciled(
  series: Record<OwnerMarketplaceTrendMetric, Array<{ count: string }>>,
  summary: Record<OwnerMarketplaceTrendMetric, number>,
) {
  for (const metric of METRICS) {
    const actual = series[metric].reduce((total, point) => total + BigInt(point.count), 0n);
    const authoritative = BigInt(summary[metric] ?? 0);
    if (actual !== authoritative) {
      throw new Error('OWNER_MARKETPLACE_TRENDS_RECONCILIATION_FAILED');
    }
  }
}

export type OwnerMarketplaceTrendGranularity = OwnerRevenueTrendGranularity;
