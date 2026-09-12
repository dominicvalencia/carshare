import { describe, expect, it } from 'vitest';
import {
  VehicleBlockReason,
  VehicleLifecycleStatus,
  VehicleOccupancyType,
  VehicleOperationalStatus,
} from '@carrental/database';
import { manilaTodayWindow, ownerAvailabilityToday } from './owner-availability';

describe('owner vehicle current availability', () => {
  it('uses authoritative Asia/Manila calendar-day boundaries', () => {
    expect(manilaTodayWindow(new Date('2026-09-12T15:59:59.999Z'))).toEqual({
      endExclusive: new Date('2026-09-12T16:00:00.000Z'),
      startInclusive: new Date('2026-09-11T16:00:00.000Z'),
    });
    expect(manilaTodayWindow(new Date('2026-09-12T16:00:00.000Z'))).toEqual({
      endExclusive: new Date('2026-09-13T16:00:00.000Z'),
      startInclusive: new Date('2026-09-12T16:00:00.000Z'),
    });
  });

  it('keeps marketplace, booking, owner-block, and available states distinct', () => {
    const base = {
      blocks: [],
      lifecycleStatus: VehicleLifecycleStatus.APPROVED,
      occupancies: [],
      operationalStatus: VehicleOperationalStatus.AVAILABLE,
    };
    expect(ownerAvailabilityToday(base).state).toBe('AVAILABLE');
    expect(
      ownerAvailabilityToday({
        ...base,
        blocks: [
          { endsAt: new Date('2026-09-13T00:00:00Z'), reason: VehicleBlockReason.MAINTENANCE },
        ],
        occupancies: [{ type: VehicleOccupancyType.OWNER_BLOCK }],
      }),
    ).toEqual({
      blockedUntil: '2026-09-13T00:00:00.000Z',
      blockReason: VehicleBlockReason.MAINTENANCE,
      state: 'OWNER_BLOCKED',
    });
    expect(
      ownerAvailabilityToday({
        ...base,
        blocks: [{ endsAt: new Date(), reason: VehicleBlockReason.PERSONAL_USE }],
        occupancies: [
          { type: VehicleOccupancyType.OWNER_BLOCK },
          { type: VehicleOccupancyType.BOOKING_RESERVATION },
        ],
      }).state,
    ).toBe('BOOKED');
    expect(
      ownerAvailabilityToday({
        ...base,
        operationalStatus: VehicleOperationalStatus.MAINTENANCE,
      }).state,
    ).toBe('MARKETPLACE_UNAVAILABLE');
  });

  it('does not invent a reason or end time for overlapping owner blocks', () => {
    expect(
      ownerAvailabilityToday({
        blocks: [
          { endsAt: new Date('2026-09-13T00:00:00Z'), reason: VehicleBlockReason.MAINTENANCE },
          { endsAt: new Date('2026-09-14T00:00:00Z'), reason: VehicleBlockReason.PERSONAL_USE },
        ],
        lifecycleStatus: VehicleLifecycleStatus.APPROVED,
        occupancies: [{ type: VehicleOccupancyType.OWNER_BLOCK }],
        operationalStatus: VehicleOperationalStatus.AVAILABLE,
      }),
    ).toEqual({ blockReason: null, blockedUntil: null, state: 'OWNER_BLOCKED' });
  });
});
