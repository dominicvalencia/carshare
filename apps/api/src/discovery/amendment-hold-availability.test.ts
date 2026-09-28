import { AvailabilityPolicyType, VehicleOccupancyType } from '@carrental/database';
import { describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability.service';
import type { PublicVehicleRecord } from './public-eligibility.service';

const vehicle = {
  id: '11111111-1111-4111-8111-111111111111',
  location: { timezone: 'Asia/Manila' },
  policyVersions: [
    {
      availabilityPolicy: AvailabilityPolicyType.EVERY_DAY,
      maximumRentalDays: 30,
      minimumRentalDays: 1,
      turnaroundMinutes: 60,
    },
  ],
} as unknown as PublicVehicleRecord;

describe('amendment hold availability', () => {
  it('makes an active amendment hold unavailable through shared discovery authority', async () => {
    const database = {
      client: {
        $queryRaw: vi.fn().mockResolvedValue([{ expiredAmendments: 0, expiredBookings: 0 }]),
        vehicleOccupancy: {
          findMany: vi.fn().mockResolvedValue([
            {
              occupiedEnd: new Date('2026-10-02T01:00:00.000Z'),
              occupiedStart: new Date('2026-10-01T00:00:00.000Z'),
              type: VehicleOccupancyType.AMENDMENT_HOLD,
              vehicleId: vehicle.id,
            },
          ]),
        },
      },
    };
    const duration = {
      calculate: vi.fn().mockReturnValue({
        chargeableDays: 1,
        end: new Date('2026-10-01T12:00:00.000Z'),
        start: new Date('2026-10-01T00:00:00.000Z'),
      }),
      touchedWeekdays: vi.fn(),
    };
    const service = new AvailabilityService(database as never, duration as never);

    const result = await service.check(
      vehicle,
      '2026-10-01T00:00:00.000Z',
      '2026-10-01T12:00:00.000Z',
    );

    expect(result).toMatchObject({ available: false, reasons: ['AMENDMENT_HELD'] });
    expect(database.client.vehicleOccupancy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true, vehicleId: { in: [vehicle.id] } } }),
    );
    expect(() => service.assertQuotable(result)).toThrow(
      'The vehicle is not available for the requested rental period.',
    );
  });

  it('excludes only the amended booking while retaining another amendment hold', async () => {
    const bookingId = '22222222-2222-4222-8222-222222222222';
    const database = {
      client: {
        vehicleOccupancy: {
          findMany: vi.fn().mockResolvedValue([
            {
              bookingId,
              occupiedEnd: new Date('2026-10-03T00:00:00.000Z'),
              occupiedStart: new Date('2026-10-01T00:00:00.000Z'),
              type: VehicleOccupancyType.BOOKING_RESERVATION,
            },
            {
              bookingId: null,
              occupiedEnd: new Date('2026-10-04T00:00:00.000Z'),
              occupiedStart: new Date('2026-10-03T00:00:00.000Z'),
              type: VehicleOccupancyType.AMENDMENT_HOLD,
            },
          ]),
        },
      },
    };
    const service = new AvailabilityService(database as never, {} as never);

    await expect(
      service.occupancyConflict({
        end: new Date('2026-10-02T00:00:00.000Z'),
        excludeBookingId: bookingId,
        start: new Date('2026-10-01T00:00:00.000Z'),
        turnaroundMinutes: 0,
        vehicleId: vehicle.id,
      }),
    ).resolves.toBeNull();

    await expect(
      service.occupancyConflict({
        end: new Date('2026-10-03T12:00:00.000Z'),
        excludeBookingId: bookingId,
        start: new Date('2026-10-02T12:00:00.000Z'),
        turnaroundMinutes: 0,
        vehicleId: vehicle.id,
      }),
    ).resolves.toMatchObject({ reason: 'AMENDMENT_HELD', turnaroundOnly: false });
    expect(database.client.vehicleOccupancy.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { active: true, vehicleId: vehicle.id } }),
    );
  });

  it.each([
    [VehicleOccupancyType.OWNER_BLOCK, 'OWNER_BLOCKED'],
    [VehicleOccupancyType.MAINTENANCE, 'MAINTENANCE'],
  ] as const)('classifies %s without exposing occupancy details', async (type, reason) => {
    const database = {
      client: {
        vehicleOccupancy: {
          findMany: vi.fn().mockResolvedValue([
            {
              bookingId: null,
              occupiedEnd: new Date('2026-10-03T00:00:00.000Z'),
              occupiedStart: new Date('2026-10-02T00:00:00.000Z'),
              type,
            },
          ]),
        },
      },
    };
    const service = new AvailabilityService(database as never, {} as never);

    await expect(
      service.occupancyConflict({
        end: new Date('2026-10-02T12:00:00.000Z'),
        excludeBookingId: '22222222-2222-4222-8222-222222222222',
        start: new Date('2026-10-02T01:00:00.000Z'),
        turnaroundMinutes: 0,
        vehicleId: vehicle.id,
      }),
    ).resolves.toEqual({ reason, turnaroundOnly: false });
  });

  it('identifies a preparation-only overlap after the requested return', async () => {
    const database = {
      client: {
        vehicleOccupancy: {
          findMany: vi.fn().mockResolvedValue([
            {
              bookingId: null,
              occupiedEnd: new Date('2026-10-03T00:00:00.000Z'),
              occupiedStart: new Date('2026-10-02T13:00:00.000Z'),
              type: VehicleOccupancyType.BOOKING_RESERVATION,
            },
          ]),
        },
      },
    };
    const service = new AvailabilityService(database as never, {} as never);

    await expect(
      service.occupancyConflict({
        end: new Date('2026-10-02T12:00:00.000Z'),
        excludeBookingId: '22222222-2222-4222-8222-222222222222',
        start: new Date('2026-10-02T00:00:00.000Z'),
        turnaroundMinutes: 120,
        vehicleId: vehicle.id,
      }),
    ).resolves.toEqual({ reason: 'BOOKING_RESERVED', turnaroundOnly: true });
  });
});
