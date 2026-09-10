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
import { OwnerRevenueService } from './owner-revenue.service';

export const OWNER_REVENUE_TRENDS_DEFINITION_VERSION = 'owner-revenue-trends-v1';
export type OwnerRevenueTrendGranularity = 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type OwnerRevenueTrendMetric =
  | 'rentalCollections'
  | 'grossBookingValue'
  | 'recognizedCommission'
  | 'ownerEarnings'
  | 'completedRefunds'
  | 'paidPayouts';

type Bucket = { startInclusive: Date; endExclusive: Date };
type TrendRow = {
  bucketIndex: number;
  currency: string;
  metric: OwnerRevenueTrendMetric;
  valueMinor: bigint;
};
type MoneyValue = { currency: string; amountMinor: string };

const METRICS: readonly OwnerRevenueTrendMetric[] = [
  'rentalCollections',
  'grossBookingValue',
  'recognizedCommission',
  'ownerEarnings',
  'completedRefunds',
  'paidPayouts',
];

@Injectable()
export class OwnerRevenueTrendsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly revenue: OwnerRevenueService,
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
      this.revenue.summary(input),
      this.database.client.$queryRaw<TrendRow[]>(buildOwnerRevenueTrendQuery(buckets)),
    ]);
    const currencies = [...new Set(rows.map((row) => row.currency))].sort();
    const grouped = new Map(
      rows.map((row) => [`${row.metric}:${row.currency}:${row.bucketIndex}`, row.valueMinor]),
    );

    const result = currencies.map((currency) => ({
      currency,
      series: Object.fromEntries(
        METRICS.map((metric) => [
          metric,
          buckets.map((bucket, bucketIndex) => ({
            endExclusive: bucket.endExclusive.toISOString(),
            startInclusive: bucket.startInclusive.toISOString(),
            valueMinor: (grouped.get(`${metric}:${currency}:${bucketIndex}`) ?? 0n).toString(),
          })),
        ]),
      ) as Record<
        OwnerRevenueTrendMetric,
        Array<{
          startInclusive: string;
          endExclusive: string;
          valueMinor: string;
        }>
      >,
    }));

    assertReconciled(result, summary);
    const environment = this.configuration.getOrThrow('APP_ENV', { infer: true });
    return {
      definitionVersion: OWNER_REVENUE_TRENDS_DEFINITION_VERSION,
      environment,
      syntheticData: environment !== 'production',
      timezone: OWNER_ANALYTICS_TIMEZONE,
      period: range.period,
      startInclusive: range.startInclusive.toISOString(),
      endExclusive: range.endExclusive.toISOString(),
      granularity,
      generatedAt: generatedAt.toISOString(),
      currencies: result,
    };
  }
}

export function selectTrendGranularity(
  period: OwnerAnalyticsPeriod,
  startInclusive: Date,
  endExclusive: Date,
): OwnerRevenueTrendGranularity {
  if (period === 'TODAY') return 'HOURLY';
  if (period !== 'CUSTOM' || calendarDays(startInclusive, endExclusive) <= 31) return 'DAILY';
  return calendarDays(startInclusive, endExclusive) <= 180 ? 'WEEKLY' : 'MONTHLY';
}

export function buildTrendBuckets(
  startInclusive: Date,
  endExclusive: Date,
  granularity: OwnerRevenueTrendGranularity,
): Bucket[] {
  const buckets: Bucket[] = [];
  let cursor = startInclusive;
  while (cursor < endExclusive) {
    const next =
      granularity === 'HOURLY'
        ? new Date(cursor.getTime() + 3_600_000)
        : addManilaCalendar(
            cursor,
            granularity === 'DAILY'
              ? { days: 1 }
              : granularity === 'WEEKLY'
                ? { days: 7 }
                : { months: 1 },
          );
    buckets.push({
      startInclusive: cursor,
      endExclusive: next < endExclusive ? next : endExclusive,
    });
    cursor = next;
  }
  return buckets;
}

function addManilaCalendar(value: Date, delta: { days?: number; months?: number }): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: OWNER_ANALYTICS_TIMEZONE,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const calendar = new Date(
    Date.UTC(
      number('year'),
      number('month') - 1 + (delta.months ?? 0),
      number('day') + (delta.days ?? 0),
    ),
  );
  // The shared resolver is the single IANA-timezone authority for calendar midnights.
  return resolveOwnerAnalyticsPeriod({
    endDate: calendar.toISOString().slice(0, 10),
    period: 'CUSTOM',
    startDate: calendar.toISOString().slice(0, 10),
  }).startInclusive;
}

function calendarDays(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

export function buildOwnerRevenueTrendQuery(buckets: Bucket[]) {
  const values = Prisma.join(
    buckets.map(
      (bucket, index) =>
        Prisma.sql`(${index}::integer, ${bucket.startInclusive}::timestamptz, ${bucket.endExclusive}::timestamptz)`,
    ),
  );
  return Prisma.sql`
    WITH buckets("bucketIndex", "startInclusive", "endExclusive") AS (VALUES ${values}),
    first_rental_captures AS (
      SELECT DISTINCT ON (p."booking_id") p."booking_id", p."captured_at", p."currency",
        p."captured_amount_minor", s."total_minor" AS "gbv_minor", s."currency" AS "gbv_currency"
      FROM "payments" p
      JOIN "booking_pricing_snapshots" s ON s."booking_id" = p."booking_id"
      WHERE p."purpose" = 'RENTAL' AND p."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND p."reconciliation_required" = false AND p."captured_at" IS NOT NULL
      ORDER BY p."booking_id", p."captured_at", p."id"
    ),
    events AS (
      SELECT 'rentalCollections'::text AS metric, "currency", "captured_at" AS occurred_at,
        "captured_amount_minor"::bigint AS value_minor FROM first_rental_captures
      UNION ALL
      SELECT 'grossBookingValue', "gbv_currency", "captured_at", "gbv_minor"::bigint FROM first_rental_captures
      UNION ALL
      SELECT 'recognizedCommission', le."currency", lt."posted_at", -le."amount_minor"
      FROM "ledger_entries" le
      JOIN "ledger_transactions" lt ON lt."id" = le."transaction_id"
      JOIN "financial_accounts" fa ON fa."id" = le."account_id"
      LEFT JOIN "payments" source_payment
        ON lt."source_type" = 'PAYMENT' AND source_payment."id" = lt."source_id"
      WHERE fa."type" = 'PLATFORM_COMMISSION_REVENUE'
        AND COALESCE(source_payment."reconciliation_required", false) = false
      UNION ALL
      SELECT 'ownerEarnings', oe."currency", oe."created_at",
        oe."net_earning_amount_minor" + oe."additional_compensation_minor" + oe."adjustment_amount_minor"
      FROM "owner_earnings" oe JOIN "payments" p ON p."id" = oe."payment_id"
      WHERE p."reconciliation_required" = false
      UNION ALL
      SELECT 'completedRefunds', r."currency", r."completed_at", r."amount_minor"
      FROM "refunds" r WHERE r."status" = 'COMPLETED' AND r."completed_at" IS NOT NULL
      UNION ALL
      SELECT 'paidPayouts', po."currency", po."paid_at", po."amount_minor"
      FROM "payouts" po WHERE po."paid_at" IS NOT NULL
    )
    SELECT b."bucketIndex", e.metric, e."currency", SUM(e.value_minor)::bigint AS "valueMinor"
    FROM buckets b JOIN events e
      ON e.occurred_at >= b."startInclusive" AND e.occurred_at < b."endExclusive"
    GROUP BY b."bucketIndex", e.metric, e."currency"
    ORDER BY e."currency", e.metric, b."bucketIndex"
  `;
}

function assertReconciled(
  currencies: Array<{
    currency: string;
    series: Record<OwnerRevenueTrendMetric, Array<{ valueMinor: string }>>;
  }>,
  summary: Awaited<ReturnType<OwnerRevenueService['summary']>>,
) {
  const expected: Record<OwnerRevenueTrendMetric, readonly MoneyValue[]> = {
    rentalCollections: summary.periodActivity.capturedCollections.rental,
    grossBookingValue: summary.periodActivity.rentalGbv.values,
    recognizedCommission: summary.periodActivity.recognizedCarShareCommission.values,
    ownerEarnings: summary.periodActivity.ownerEarnings.total.values,
    completedRefunds: summary.periodActivity.completedRefunds.values,
    paidPayouts: summary.periodActivity.payouts.paid.values,
  };
  const allCurrencies = new Set([
    ...currencies.map(({ currency }) => currency),
    ...Object.values(expected).flatMap((values) => values.map(({ currency }) => currency)),
  ]);
  for (const currency of allCurrencies) {
    const group = currencies.find((item) => item.currency === currency);
    if (!group) throw new Error('OWNER_REVENUE_TRENDS_RECONCILIATION_FAILED');
    for (const metric of METRICS) {
      const actual = group.series[metric].reduce(
        (sum, point) => sum + BigInt(point.valueMinor),
        0n,
      );
      const authoritative = BigInt(
        expected[metric].find((value) => value.currency === currency)?.amountMinor ?? '0',
      );
      if (actual !== authoritative) throw new Error('OWNER_REVENUE_TRENDS_RECONCILIATION_FAILED');
    }
  }
}
