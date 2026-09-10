import { describe, expect, it, vi } from 'vitest';
import {
  cancellationBreakdownQuery,
  marketplaceReportQuery,
  OwnerMarketplaceReportsService,
} from './owner-marketplace-reports.service';

const row = (overrides: Record<string, bigint> = {}) => ({
  activeRentalsNow: 3n,
  activeRentersDuringPeriod: 4n,
  actualPickupsWithoutActiveTransition: 0n,
  approvedListingsNow: 10n,
  bookingsCreated: 7n,
  cancelledCohort: 2n,
  cancellations: 1n,
  cancellationRecordsWithoutTransition: 0n,
  cancellationTransitionsWithoutRecord: 0n,
  completedRentals: 2n,
  confirmedBookings: 5n,
  confirmedCohort: 6n,
  newRenters: 3n,
  newVehicleOwners: 2n,
  newVehicles: 4n,
  rentalsStarted: 4n,
  rentalsStartedMissingActualPickup: 0n,
  rentalsStartedPickupTimestampMismatch: 0n,
  ...overrides,
});

function service(report = row(), breakdown: unknown[] = []) {
  const queryRaw = vi.fn().mockResolvedValueOnce([report]).mockResolvedValueOnce(breakdown);
  return {
    instance: new OwnerMarketplaceReportsService(
      { client: { $queryRaw: queryRaw } } as never,
      { getOrThrow: vi.fn().mockReturnValue('local') } as never,
    ),
    queryRaw,
  };
}

describe('OwnerMarketplaceReportsService', () => {
  it('returns the versioned aggregate contract with period, cohort, and current state separated', async () => {
    const { instance } = service(row(), [
      { actorType: 'USER', count: 1n, reasonCode: 'RENTER_CANCELLED' },
    ]);
    const result = await instance.marketplace({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'THIS_MONTH',
    });

    expect(result).toMatchObject({
      definitionVersion: 'owner-marketplace-reports-v1',
      environment: 'local',
      syntheticData: true,
      timezone: 'Asia/Manila',
      period: { kind: 'THIS_MONTH' },
      periodActivity: {
        activeRentersDuringPeriod: 4,
        bookingsCreated: 7,
        cancellations: 1,
        completedRentals: 2,
        confirmedBookings: 5,
        newRenters: 3,
        newVehicleOwners: 2,
        newVehicles: 4,
        rentalsStarted: 4,
      },
      pointInTime: {
        activeRentalsNow: { value: 3 },
        approvedListingsNow: { value: 10 },
      },
      integrity: { rentalsStartedChecked: 4, status: 'PASS' },
    });
    expect(result.cohortMetrics.bookingConfirmationConversion).toMatchObject({
      classification: 'cohortToDate',
      cohortSize: 7,
      count: 6,
      maturityCutoffApplied: false,
      rate: '85.71',
      rateUnit: 'PERCENT',
    });
    expect(result.cohortMetrics.bookingCohortCancellationRate.rate).toBe('28.57');
    expect(result.cancellationBreakdown.actorAndReasonCode).toEqual([
      { actorType: 'USER', count: 1, reasonCode: 'RENTER_CANCELLED' },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/bookingId|reasonText|userId|vehicleId/u);
  });

  it('returns a null cohort rate for a zero denominator without floating point', async () => {
    const { instance } = service(row({ bookingsCreated: 0n, confirmedCohort: 0n }));
    const result = await instance.marketplace({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });
    expect(result.cohortMetrics.bookingConfirmationConversion).toMatchObject({
      cohortSize: 0,
      count: 0,
      rate: null,
    });
  });

  it('exposes safe integrity counts instead of substituting current mutable state', async () => {
    const { instance } = service(
      row({
        cancellationRecordsWithoutTransition: 1n,
        rentalsStartedMissingActualPickup: 2n,
      }),
    );
    const result = await instance.marketplace({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });
    expect(result.integrity).toMatchObject({
      cancellationRecordsWithoutTransition: 1,
      rentalsStartedMissingActualPickup: 2,
      status: 'REVIEW_REQUIRED',
    });
    expect(result.periodActivity.rentalsStarted).toBe(4);
  });

  it('uses first lifecycle transitions, first renter-role assignment, cohort membership, and generatedAt', () => {
    const query = marketplaceReportQuery(
      new Date('2026-09-01T16:00:00.000Z'),
      new Date('2026-09-02T16:00:00.000Z'),
      new Date('2026-09-03T00:00:00.000Z'),
    ).strings.join(' ');
    expect(query).toContain('MIN("occurred_at")');
    expect(query).toContain('MIN(ur."assigned_at")');
    expect(query).toContain('b."created_at"');
    expect(query).toContain('ft."occurred_at" <=');
    expect(query).toContain('bc."created_at" <=');
    expect(query).toContain('b."actual_pickup_at"');
    expect(query).toContain('ABS(EXTRACT(EPOCH');
    expect(query).toContain('> 1');
    expect(query).not.toContain('reason_text');
  });

  it('keeps cancellation breakdown aggregate-only', () => {
    const query = cancellationBreakdownQuery(new Date(0), new Date(1)).strings.join(' ');
    expect(query).toContain('GROUP BY "actor_type", "reason_code"');
    expect(query).not.toContain('reason_text');
    expect(query).not.toContain('actor_user_id');
  });
});
