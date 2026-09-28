import { HttpStatus, Injectable } from '@nestjs/common';
import { AvailabilityPolicyType, Prisma, VehicleOccupancyType } from '@carrental/database';
import { DiscoveryErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { RentalDurationService } from './duration.service';
import type { PublicVehicleRecord } from './public-eligibility.service';

export type UnavailableReason =
  | 'OUTSIDE_WEEKLY_AVAILABILITY'
  | 'OWNER_BLOCKED'
  | 'BOOKING_RESERVED'
  | 'AMENDMENT_HELD'
  | 'MAINTENANCE'
  | 'MINIMUM_DURATION'
  | 'MAXIMUM_DURATION';

export interface AdvisoryAvailability {
  readonly advisory: true;
  readonly available: boolean;
  readonly chargeableDays: number;
  readonly reasons: readonly UnavailableReason[];
  readonly warning: string;
}

export interface OccupancyConflict {
  readonly reason: Extract<
    UnavailableReason,
    'AMENDMENT_HELD' | 'BOOKING_RESERVED' | 'MAINTENANCE' | 'OWNER_BLOCKED'
  >;
  readonly turnaroundOnly: boolean;
}

const WARNING =
  'Availability is advisory and does not reserve the vehicle. It will be rechecked transactionally during booking.';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly duration: RentalDurationService,
  ) {}

  async check(vehicle: PublicVehicleRecord, startInput: string, endInput: string) {
    const results = await this.checkMany([vehicle], startInput, endInput);
    return results.get(vehicle.id) as AdvisoryAvailability;
  }

  async checkMany(vehicles: readonly PublicVehicleRecord[], startInput: string, endInput: string) {
    const { chargeableDays, end, start } = this.duration.calculate(startInput, endInput);
    const ids = vehicles.map(({ id }) => id);
    if (ids.length) {
      await this.database.client.$queryRaw(Prisma.sql`
        SELECT
          "expire_stale_bookings"() AS "expiredBookings",
          "expire_stale_booking_amendments"() AS "expiredAmendments"
      `);
    }
    const occupancies = ids.length
      ? await this.database.client.vehicleOccupancy.findMany({
          select: { occupiedEnd: true, occupiedStart: true, type: true, vehicleId: true },
          where: { active: true, vehicleId: { in: ids } },
        })
      : [];
    const results = new Map<string, AdvisoryAvailability>();
    for (const vehicle of vehicles) {
      const policy = vehicle.policyVersions[0]!;
      const reasons: UnavailableReason[] = [];
      if (chargeableDays < policy.minimumRentalDays) reasons.push('MINIMUM_DURATION');
      if (chargeableDays > policy.maximumRentalDays) reasons.push('MAXIMUM_DURATION');
      if (policy.availabilityPolicy === AvailabilityPolicyType.WEEKLY) {
        const weekdays = this.duration.touchedWeekdays(start, end, vehicle.location!.timezone);
        const weekly = policy as unknown as Record<string, unknown>;
        if ([...weekdays].some((weekday) => weekly[weekday] !== true)) {
          reasons.push('OUTSIDE_WEEKLY_AVAILABILITY');
        }
      }
      const requestedOccupiedEnd = new Date(end.getTime() + policy.turnaroundMinutes * 60_000);
      for (const occupancy of occupancies) {
        if (
          occupancy.vehicleId !== vehicle.id ||
          start >= occupancy.occupiedEnd ||
          requestedOccupiedEnd <= occupancy.occupiedStart
        ) {
          continue;
        }
        const reason =
          occupancy.type === VehicleOccupancyType.BOOKING_RESERVATION
            ? 'BOOKING_RESERVED'
            : occupancy.type === VehicleOccupancyType.AMENDMENT_HOLD
              ? 'AMENDMENT_HELD'
              : occupancy.type === VehicleOccupancyType.MAINTENANCE
                ? 'MAINTENANCE'
                : 'OWNER_BLOCKED';
        if (!reasons.includes(reason)) reasons.push(reason);
      }
      results.set(vehicle.id, {
        advisory: true,
        available: reasons.length === 0,
        chargeableDays,
        reasons,
        warning: WARNING,
      });
    }
    return results;
  }

  /** Server-only amendment check: excludes one booking, never a vehicle's other occupancy. */
  async occupancyConflict(
    input: {
      end: Date;
      excludeBookingId: string;
      start: Date;
      turnaroundMinutes: number;
      vehicleId: string;
    },
    transaction?: Prisma.TransactionClient,
  ): Promise<OccupancyConflict | null> {
    const client = transaction ?? this.database.client;
    const requestedOccupiedEnd = new Date(input.end.getTime() + input.turnaroundMinutes * 60_000);
    const occupancies = await client.vehicleOccupancy.findMany({
      select: { bookingId: true, occupiedEnd: true, occupiedStart: true, type: true },
      where: { active: true, vehicleId: input.vehicleId },
    });
    for (const occupancy of occupancies) {
      if (occupancy.bookingId === input.excludeBookingId) continue;
      if (input.start >= occupancy.occupiedEnd || requestedOccupiedEnd <= occupancy.occupiedStart)
        continue;
      const reason =
        occupancy.type === VehicleOccupancyType.BOOKING_RESERVATION
          ? 'BOOKING_RESERVED'
          : occupancy.type === VehicleOccupancyType.AMENDMENT_HOLD
            ? 'AMENDMENT_HELD'
            : occupancy.type === VehicleOccupancyType.MAINTENANCE
              ? 'MAINTENANCE'
              : 'OWNER_BLOCKED';
      return {
        reason,
        turnaroundOnly: !(
          input.start < occupancy.occupiedEnd && input.end > occupancy.occupiedStart
        ),
      };
    }
    return null;
  }

  assertQuotable(result: AdvisoryAvailability): void {
    const reason = result.reasons[0];
    if (!reason) return;
    const mapping = {
      MAXIMUM_DURATION: DiscoveryErrorCode.MAXIMUM_RENTAL_EXCEEDED,
      MINIMUM_DURATION: DiscoveryErrorCode.MINIMUM_RENTAL_NOT_MET,
      OUTSIDE_WEEKLY_AVAILABILITY: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
      OWNER_BLOCKED: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
      BOOKING_RESERVED: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
      AMENDMENT_HELD: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
      MAINTENANCE: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
    } as const;
    throw new ApplicationException(
      mapping[reason],
      'The vehicle is not available for the requested rental period.',
      HttpStatus.CONFLICT,
    );
  }
}
