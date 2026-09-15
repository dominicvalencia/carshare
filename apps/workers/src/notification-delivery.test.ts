import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@carrental/database';
import { consumeDomainEvent, workerPushProvider } from './notification-delivery';
import type { WorkerEnvironment } from '@carrental/config';

describe('booking request notification delivery', () => {
  it('fails closed when external push delivery is disabled', () => {
    expect(
      workerPushProvider({ PUSH_ENABLED: false, PUSH_PROVIDER: 'expo' } as WorkerEnvironment),
    ).toBeNull();
    expect(
      workerPushProvider({ PUSH_ENABLED: true, PUSH_PROVIDER: 'expo' } as WorkerEnvironment)?.code,
    ).toBe('expo');
  });
  it('creates one idempotent owner notification with the public booking reference', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates: Record<string, unknown>[] = [];
    const stableKeys = new Set<string>();
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-TRACE' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          if (!stableKeys.has(String(create.stableKey))) creates.push(create);
          stableKeys.add(String(create.stableKey));
          return { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
        }),
      },
      notificationPreference: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;

    const payload = { bookingId, ownerUserId };
    await consumeDomainEvent(database, 'BOOKING_OWNER_REQUESTED', payload, 'outbox-1');
    await consumeDomainEvent(database, 'BOOKING_OWNER_REQUESTED', payload, 'outbox-1');

    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      deepLink: 'carrental://bookings/CR-2026-TRACE',
      sourceEventType: 'BOOKING_OWNER_REQUESTED',
      templateKey: 'booking.requested',
      userId: ownerUserId,
      variables: { reference: 'CR-2026-TRACE' },
    });
  });

  it('routes actionable pickup and discrepancy events to the correct role', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates: Record<string, unknown>[] = [];
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-B4' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          creates.push(create);
          return { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
        }),
      },
      notificationPreference: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    await consumeDomainEvent(
      database,
      'PICKUP_INSPECTION_SUBMITTED',
      { bookingId },
      '11111111-1111-4111-8111-111111111111',
    );
    await consumeDomainEvent(
      database,
      'PICKUP_INSPECTION_DISAGREED',
      { bookingId },
      '22222222-2222-4222-8222-222222222222',
    );
    await consumeDomainEvent(
      database,
      'PICKUP_DISCREPANCY_OWNER_RESPONDED',
      { bookingId },
      '33333333-3333-4333-8333-333333333333',
    );
    await consumeDomainEvent(
      database,
      'PICKUP_DISCREPANCY_RESOLUTION_ACCEPTED',
      { bookingId },
      '44444444-4444-4444-8444-444444444444',
    );
    await consumeDomainEvent(
      database,
      'PICKUP_HANDOVER_OPERATIONS_RESOLVED',
      { bookingId },
      '55555555-5555-4555-8555-555555555555',
    );
    await consumeDomainEvent(
      database,
      'PICKUP_DISCREPANCY_SUPPORT_REQUESTED',
      { bookingId },
      '66666666-6666-4666-8666-666666666666',
    );
    await consumeDomainEvent(
      database,
      'RENTER_PRE_CUSTODY_HANDOVER_CANCELLED',
      { bookingId },
      '77777777-7777-4777-8777-777777777777',
    );
    expect(creates.map(({ userId }) => userId)).toEqual([
      renterUserId,
      ownerUserId,
      renterUserId,
      ownerUserId,
      renterUserId,
      ownerUserId,
      renterUserId,
      ownerUserId,
      ownerUserId,
    ]);
    expect(creates.map(({ templateKey }) => templateKey)).toEqual([
      'rental.inspection-ready',
      'rental.discrepancy-reported',
      'rental.discrepancy-response',
      'rental.discrepancy-resolution',
      'rental.operations-resolution',
      'rental.operations-resolution',
      'rental.discrepancy-support',
      'rental.discrepancy-support',
      'booking.pre-custody-cancelled',
    ]);
  });
});
