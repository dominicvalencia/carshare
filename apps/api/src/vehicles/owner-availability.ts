import {
  VehicleLifecycleStatus,
  VehicleOccupancyType,
  VehicleOperationalStatus,
  type VehicleBlockReason,
} from '@carrental/database';

export const OWNER_AVAILABILITY_TIMEZONE = 'Asia/Manila';

export type OwnerAvailabilityTodayState =
  'AVAILABLE' | 'BOOKED' | 'OWNER_BLOCKED' | 'MARKETPLACE_UNAVAILABLE';

export interface OwnerAvailabilityToday {
  readonly state: OwnerAvailabilityTodayState;
  readonly blockReason: VehicleBlockReason | null;
  readonly blockedUntil: string | null;
}

export function manilaTodayWindow(now = new Date()): {
  startInclusive: Date;
  endExclusive: Date;
} {
  const calendar = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: OWNER_AVAILABILITY_TIMEZONE,
    year: 'numeric',
  });
  const parts = calendar.formatToParts(now);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const startInclusive = new Date(
    Date.UTC(number('year'), number('month') - 1, number('day')) - 8 * 60 * 60 * 1_000,
  );
  return {
    startInclusive,
    endExclusive: new Date(startInclusive.getTime() + 24 * 60 * 60 * 1_000),
  };
}

export function ownerAvailabilityToday(input: {
  lifecycleStatus: VehicleLifecycleStatus;
  operationalStatus: VehicleOperationalStatus;
  occupancies: readonly { type: VehicleOccupancyType }[];
  blocks: readonly { reason: VehicleBlockReason; endsAt: Date }[];
}): OwnerAvailabilityToday {
  if (
    input.lifecycleStatus !== VehicleLifecycleStatus.APPROVED ||
    input.operationalStatus !== VehicleOperationalStatus.AVAILABLE ||
    input.occupancies.some(({ type }) => type === VehicleOccupancyType.MAINTENANCE)
  ) {
    return { blockReason: null, blockedUntil: null, state: 'MARKETPLACE_UNAVAILABLE' };
  }
  if (input.occupancies.some(({ type }) => type === VehicleOccupancyType.BOOKING_RESERVATION)) {
    return { blockReason: null, blockedUntil: null, state: 'BOOKED' };
  }
  if (input.blocks.length === 1) {
    return {
      blockReason: input.blocks[0]!.reason,
      blockedUntil: input.blocks[0]!.endsAt.toISOString(),
      state: 'OWNER_BLOCKED',
    };
  }
  if (input.blocks.length > 1) {
    return { blockReason: null, blockedUntil: null, state: 'OWNER_BLOCKED' };
  }
  return { blockReason: null, blockedUntil: null, state: 'AVAILABLE' };
}
