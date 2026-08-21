import { HttpStatus, Injectable } from '@nestjs/common';
import { AvailabilityPolicyType } from '@carrental/database';
import { DiscoveryErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { RentalDurationService } from './duration.service';
import type { PublicVehicleRecord } from './public-eligibility.service';

export type UnavailableReason =
  'OUTSIDE_WEEKLY_AVAILABILITY' | 'OWNER_BLOCKED' | 'MINIMUM_DURATION' | 'MAXIMUM_DURATION';

export interface AdvisoryAvailability {
  readonly advisory: true;
  readonly available: boolean;
  readonly chargeableDays: number;
  readonly reasons: readonly UnavailableReason[];
  readonly warning: string;
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
    const blocks = ids.length
      ? await this.database.client.vehicleBlockedPeriod.findMany({
          select: { endsAt: true, startsAt: true, vehicleId: true },
          where: { removedAt: null, vehicleId: { in: ids } },
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
      const buffer = policy.turnaroundMinutes * 60 * 1000;
      if (
        blocks.some(
          (block) =>
            block.vehicleId === vehicle.id &&
            start.getTime() < block.endsAt.getTime() + buffer &&
            end.getTime() > block.startsAt.getTime() - buffer,
        )
      ) {
        reasons.push('OWNER_BLOCKED');
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

  assertQuotable(result: AdvisoryAvailability): void {
    const reason = result.reasons[0];
    if (!reason) return;
    const mapping = {
      MAXIMUM_DURATION: DiscoveryErrorCode.MAXIMUM_RENTAL_EXCEEDED,
      MINIMUM_DURATION: DiscoveryErrorCode.MINIMUM_RENTAL_NOT_MET,
      OUTSIDE_WEEKLY_AVAILABILITY: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
      OWNER_BLOCKED: DiscoveryErrorCode.VEHICLE_UNAVAILABLE,
    } as const;
    throw new ApplicationException(
      mapping[reason],
      'The vehicle is not available for the requested rental period.',
      HttpStatus.CONFLICT,
    );
  }
}
