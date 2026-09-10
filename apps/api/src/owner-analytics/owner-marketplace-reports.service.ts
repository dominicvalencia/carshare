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

export const OWNER_MARKETPLACE_REPORTS_DEFINITION_VERSION = 'owner-marketplace-reports-v1';

type MarketplaceReportRow = {
  activeRentalsNow: bigint;
  activeRentersDuringPeriod: bigint;
  approvedListingsNow: bigint;
  bookingsCreated: bigint;
  cancelledCohort: bigint;
  cancellations: bigint;
  cancellationRecordsWithoutTransition: bigint;
  cancellationTransitionsWithoutRecord: bigint;
  completedRentals: bigint;
  confirmedBookings: bigint;
  confirmedCohort: bigint;
  newRenters: bigint;
  newVehicleOwners: bigint;
  newVehicles: bigint;
  rentalsStarted: bigint;
  rentalsStartedMissingActualPickup: bigint;
  rentalsStartedPickupTimestampMismatch: bigint;
  actualPickupsWithoutActiveTransition: bigint;
};

type CancellationBreakdownRow = {
  actorType: string;
  count: bigint;
  reasonCode: string;
};

@Injectable()
export class OwnerMarketplaceReportsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async marketplace(input: {
    period: OwnerAnalyticsPeriod;
    startDate?: string;
    endDate?: string;
    now?: Date;
  }) {
    const range = resolveOwnerAnalyticsPeriod(input);
    const generatedAt = input.now ?? new Date();
    const [rows, cancellationBreakdown] = await Promise.all([
      this.database.client.$queryRaw<MarketplaceReportRow[]>(
        marketplaceReportQuery(range.startInclusive, range.endExclusive, generatedAt),
      ),
      this.database.client.$queryRaw<CancellationBreakdownRow[]>(
        cancellationBreakdownQuery(range.startInclusive, range.endExclusive),
      ),
    ]);
    const row = rows[0];
    if (!row) throw new Error('OWNER_MARKETPLACE_REPORT_QUERY_EMPTY');
    const cohortSize = Number(row.bookingsCreated);
    const environment = this.configuration.getOrThrow('APP_ENV', { infer: true });
    const integrityCounts = {
      actualPickupsWithoutActiveTransition: Number(row.actualPickupsWithoutActiveTransition),
      cancellationRecordsWithoutTransition: Number(row.cancellationRecordsWithoutTransition),
      cancellationTransitionsWithoutRecord: Number(row.cancellationTransitionsWithoutRecord),
      rentalsStartedMissingActualPickup: Number(row.rentalsStartedMissingActualPickup),
      rentalsStartedPickupTimestampMismatch: Number(row.rentalsStartedPickupTimestampMismatch),
    };
    return {
      definitionVersion: OWNER_MARKETPLACE_REPORTS_DEFINITION_VERSION,
      environment,
      syntheticData: environment !== 'production',
      timezone: OWNER_ANALYTICS_TIMEZONE,
      generatedAt: generatedAt.toISOString(),
      period: {
        kind: range.period,
        startInclusive: range.startInclusive.toISOString(),
        endExclusive: range.endExclusive.toISOString(),
      },
      periodActivity: {
        bookingsCreated: Number(row.bookingsCreated),
        confirmedBookings: Number(row.confirmedBookings),
        rentalsStarted: Number(row.rentalsStarted),
        completedRentals: Number(row.completedRentals),
        cancellations: Number(row.cancellations),
        newRenters: Number(row.newRenters),
        newVehicleOwners: Number(row.newVehicleOwners),
        newVehicles: Number(row.newVehicles),
        activeRentersDuringPeriod: Number(row.activeRentersDuringPeriod),
      },
      cohortMetrics: {
        bookingConfirmationConversion: cohortMetric(
          cohortSize,
          Number(row.confirmedCohort),
          'Bookings created in the selected period that reached their first CONFIRMED transition by generatedAt.',
        ),
        bookingCohortCancellationRate: cohortMetric(
          cohortSize,
          Number(row.cancelledCohort),
          'Bookings created in the selected period that received a cancellation record by generatedAt.',
        ),
      },
      pointInTime: {
        activeRentalsNow: {
          asOf: generatedAt.toISOString(),
          definition: 'Current bookings in ACTIVE or RETURN_PENDING.',
          value: Number(row.activeRentalsNow),
        },
        approvedListingsNow: {
          asOf: generatedAt.toISOString(),
          definition: 'Current vehicles with lifecycle status APPROVED.',
          value: Number(row.approvedListingsNow),
        },
      },
      cancellationBreakdown: {
        actorAndReasonCode: cancellationBreakdown.map((item) => ({
          actorType: item.actorType,
          count: Number(item.count),
          reasonCode: item.reasonCode,
        })),
      },
      integrity: {
        ...integrityCounts,
        rentalsStartedChecked: Number(row.rentalsStarted),
        status: Object.values(integrityCounts).every((value) => value === 0)
          ? 'PASS'
          : 'REVIEW_REQUIRED',
      },
      unavailable: [
        'activeVehicleOwnersDuringPeriod',
        'fleetUtilization',
        'geographicPerformance',
        'historicalApprovedListings',
        'rankings',
        'riskAndQuality',
      ],
    };
  }
}

function cohortMetric(cohortSize: number, outcomeCount: number, definition: string) {
  return {
    classification: 'cohortToDate' as const,
    cohortSize,
    count: outcomeCount,
    definition,
    maturityCutoffApplied: false,
    rate: cohortSize === 0 ? null : percentage(outcomeCount, cohortSize),
    rateUnit: 'PERCENT' as const,
  };
}

function percentage(numerator: number, denominator: number) {
  const hundredths = (BigInt(numerator) * 10_000n) / BigInt(denominator);
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

export function marketplaceReportQuery(start: Date, end: Date, generatedAt: Date) {
  return Prisma.sql`
    WITH first_transitions AS (
      SELECT "booking_id", "to_status", MIN("occurred_at") AS "occurred_at"
      FROM "booking_status_history"
      WHERE "to_status" IN ('CONFIRMED', 'ACTIVE', 'RETURNED', 'COMPLETED', 'CANCELLED')
      GROUP BY "booking_id", "to_status"
    ),
    cohort AS (
      SELECT b."id"
      FROM "bookings" b
      WHERE b."created_at" >= ${start} AND b."created_at" < ${end}
    ),
    first_renter_roles AS (
      SELECT ur."user_id", MIN(ur."assigned_at") AS "assigned_at"
      FROM "user_roles" ur
      JOIN "roles" r ON r."id" = ur."role_id"
      WHERE r."code" = 'RENTER'
      GROUP BY ur."user_id"
    )
    SELECT
      (SELECT COUNT(*) FROM cohort)::bigint AS "bookingsCreated",
      (SELECT COUNT(*) FROM first_transitions WHERE "to_status" = 'CONFIRMED'
        AND "occurred_at" >= ${start} AND "occurred_at" < ${end})::bigint AS "confirmedBookings",
      (SELECT COUNT(*) FROM first_transitions WHERE "to_status" = 'ACTIVE'
        AND "occurred_at" >= ${start} AND "occurred_at" < ${end})::bigint AS "rentalsStarted",
      (SELECT COUNT(*) FROM first_transitions WHERE "to_status" = 'COMPLETED'
        AND "occurred_at" >= ${start} AND "occurred_at" < ${end})::bigint AS "completedRentals",
      (SELECT COUNT(*) FROM "booking_cancellations" WHERE "created_at" >= ${start}
        AND "created_at" < ${end})::bigint AS "cancellations",
      (SELECT COUNT(*) FROM first_renter_roles WHERE "assigned_at" >= ${start}
        AND "assigned_at" < ${end})::bigint AS "newRenters",
      (SELECT COUNT(*) FROM "owner_profiles" WHERE "created_at" >= ${start}
        AND "created_at" < ${end})::bigint AS "newVehicleOwners",
      (SELECT COUNT(*) FROM "vehicles" WHERE "created_at" >= ${start}
        AND "created_at" < ${end})::bigint AS "newVehicles",
      (SELECT COUNT(DISTINCT b."renter_user_id") FROM first_transitions ft
        JOIN "bookings" b ON b."id" = ft."booking_id"
        WHERE ft."to_status" IN ('CONFIRMED', 'ACTIVE', 'RETURNED', 'COMPLETED')
          AND ft."occurred_at" >= ${start} AND ft."occurred_at" < ${end})::bigint
        AS "activeRentersDuringPeriod",
      (SELECT COUNT(*) FROM cohort c WHERE EXISTS (
        SELECT 1 FROM first_transitions ft WHERE ft."booking_id" = c."id"
          AND ft."to_status" = 'CONFIRMED' AND ft."occurred_at" <= ${generatedAt}
      ))::bigint AS "confirmedCohort",
      (SELECT COUNT(*) FROM cohort c WHERE EXISTS (
        SELECT 1 FROM "booking_cancellations" bc WHERE bc."booking_id" = c."id"
          AND bc."created_at" <= ${generatedAt}
      ))::bigint AS "cancelledCohort",
      (SELECT COUNT(*) FROM "bookings" WHERE "status" IN ('ACTIVE', 'RETURN_PENDING'))::bigint
        AS "activeRentalsNow",
      (SELECT COUNT(*) FROM "vehicles" WHERE "status" = 'APPROVED')::bigint
        AS "approvedListingsNow",
      (SELECT COUNT(*) FROM first_transitions ft JOIN "bookings" b ON b."id" = ft."booking_id"
        WHERE ft."to_status" = 'ACTIVE' AND ft."occurred_at" >= ${start} AND ft."occurred_at" < ${end}
          AND b."actual_pickup_at" IS NULL)::bigint AS "rentalsStartedMissingActualPickup",
      (SELECT COUNT(*) FROM first_transitions ft JOIN "bookings" b ON b."id" = ft."booking_id"
        WHERE ft."to_status" = 'ACTIVE' AND ft."occurred_at" >= ${start} AND ft."occurred_at" < ${end}
          AND b."actual_pickup_at" IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM (b."actual_pickup_at" - ft."occurred_at"))) > 1)::bigint
        AS "rentalsStartedPickupTimestampMismatch",
      (SELECT COUNT(*) FROM "bookings" b WHERE b."actual_pickup_at" >= ${start}
        AND b."actual_pickup_at" < ${end} AND NOT EXISTS (
          SELECT 1 FROM first_transitions ft WHERE ft."booking_id" = b."id" AND ft."to_status" = 'ACTIVE'
        ))::bigint AS "actualPickupsWithoutActiveTransition",
      (SELECT COUNT(*) FROM "booking_cancellations" bc WHERE bc."created_at" >= ${start}
        AND bc."created_at" < ${end} AND NOT EXISTS (
          SELECT 1 FROM first_transitions ft WHERE ft."booking_id" = bc."booking_id"
            AND ft."to_status" = 'CANCELLED'
        ))::bigint AS "cancellationRecordsWithoutTransition",
      (SELECT COUNT(*) FROM first_transitions ft WHERE ft."to_status" = 'CANCELLED'
        AND ft."occurred_at" >= ${start} AND ft."occurred_at" < ${end} AND NOT EXISTS (
          SELECT 1 FROM "booking_cancellations" bc WHERE bc."booking_id" = ft."booking_id"
        ))::bigint AS "cancellationTransitionsWithoutRecord"
  `;
}

export function cancellationBreakdownQuery(start: Date, end: Date) {
  return Prisma.sql`
    SELECT "actor_type"::text AS "actorType", "reason_code" AS "reasonCode", COUNT(*)::bigint AS "count"
    FROM "booking_cancellations"
    WHERE "created_at" >= ${start} AND "created_at" < ${end}
    GROUP BY "actor_type", "reason_code"
    ORDER BY "actor_type", "reason_code"
  `;
}
