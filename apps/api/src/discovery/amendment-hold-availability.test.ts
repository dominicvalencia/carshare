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
    expect(() => service.assertQuotable(result)).toThrow(
      'The vehicle is not available for the requested rental period.',
    );
  });
});
