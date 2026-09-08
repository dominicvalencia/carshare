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
});
