import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingErrorCode, VehicleErrorCode } from '@carrental/api-contracts';
import { Prisma, VehicleOccupancyType } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';

@Injectable()
export class OccupancyService {
  constructor(private readonly database: DatabaseService) {}

  async expireStale(transaction?: Prisma.TransactionClient): Promise<number> {
    const client = transaction ?? this.database.client;
    const result = await client.$queryRaw<Array<{ expired: number }>>(
      Prisma.sql`SELECT "expire_stale_bookings"() AS "expired"`,
    );
    return result[0]?.expired ?? 0;
  }

  createBooking(
    transaction: Prisma.TransactionClient,
    input: {
      bookingId: string;
      vehicleId: string;
      rentalStart: Date;
      rentalEnd: Date;
      turnaroundMinutes: number;
      expiresAt: Date;
    },
  ) {
    return transaction.vehicleOccupancy.create({
      data: {
        active: true,
        bookingId: input.bookingId,
        expiresAt: input.expiresAt,
        occupiedEnd: new Date(input.rentalEnd.getTime() + input.turnaroundMinutes * 60_000),
        occupiedStart: input.rentalStart,
        type: VehicleOccupancyType.BOOKING_RESERVATION,
        vehicleId: input.vehicleId,
      },
    });
  }

  async createOwnerBlock(
    transaction: Prisma.TransactionClient,
    input: { vehicleId: string; startsAt: Date; endsAt: Date },
  ) {
    await this.expireStale(transaction);
    return transaction.vehicleOccupancy.create({
      data: {
        active: true,
        occupiedEnd: input.endsAt,
        occupiedStart: input.startsAt,
        type: VehicleOccupancyType.OWNER_BLOCK,
        vehicleId: input.vehicleId,
      },
    });
  }

  release(transaction: Prisma.TransactionClient, occupancyId: string, reason: string) {
    return transaction.vehicleOccupancy.updateMany({
      data: { active: false, releaseReason: reason, releasedAt: new Date() },
      where: { active: true, id: occupancyId },
    });
  }

  async assertNoFutureBooking(vehicleId: string): Promise<void> {
    await this.expireStale();
    const occupancy = await this.database.client.vehicleOccupancy.findFirst({
      select: { id: true },
      where: {
        active: true,
        occupiedEnd: { gt: new Date() },
        type: VehicleOccupancyType.BOOKING_RESERVATION,
        vehicleId,
      },
    });
    if (occupancy) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_VEHICLE_STATE,
        'Resolve active booking reservations before changing vehicle availability.',
        HttpStatus.CONFLICT,
      );
    }
  }

  bookingConflict(): ApplicationException {
    return new ApplicationException(
      BookingErrorCode.BOOKING_CONFLICT,
      'The vehicle is no longer available for this occupied period.',
      HttpStatus.CONFLICT,
    );
  }

  isExclusionConflict(error: unknown): boolean {
    const value = String(
      error instanceof Error ? `${error.name} ${error.message} ${JSON.stringify(error)}` : error,
    );
    return (
      value.includes('vehicle_occupancies_no_overlap') ||
      value.includes('23P01') ||
      value.includes('exclusion constraint')
    );
  }
}
