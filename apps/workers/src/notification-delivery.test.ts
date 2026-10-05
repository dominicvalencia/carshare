import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@carrental/database';
import { consumeDomainEvent, workerPushProvider } from './notification-delivery';
import type { WorkerEnvironment } from '@carrental/config';

describe('booking request notification delivery', () => {
  it('creates the authoritative deposit-completed notification exactly once for the renter', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates = new Map<string, Record<string, unknown>>();
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-DEPOSIT' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notificationPreference: { findUnique: vi.fn(async () => null) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          creates.set(String(create.stableKey), create);
          return { id: bookingId };
        }),
      },
    } as unknown as PrismaClient;
    const payload = { bookingId, amountMinor: '300000', currency: 'PHP' };
    await consumeDomainEvent(database, 'SECURITY_DEPOSIT_HELD', payload, 'outbox-1');
    await consumeDomainEvent(database, 'SECURITY_DEPOSIT_HELD', payload, 'outbox-2');
    expect(creates).toHaveLength(1);
    expect([...creates.values()][0]).toMatchObject({
      deepLink: 'carrental://bookings/CR-2026-DEPOSIT',
      templateKey: 'security-deposit.completed',
      userId: renterUserId,
      variables: { reference: 'CR-2026-DEPOSIT' },
    });
  });
  it('creates one renter recovery notification with a safe focused deep link', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates: Record<string, unknown>[] = [];
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'DEMO-OVERDUE-RETURN' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notificationPreference: { findUnique: vi.fn(async () => null) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          creates.push(create);
          return { id: bookingId };
        }),
      },
    } as unknown as PrismaClient;
    await consumeDomainEvent(
      database,
      'OVERDUE_HANDOVER_RECOVERY_REPORTED',
      {
        bookingId,
        scope: 'RETURN',
        responseDeadlineAt: '2026-09-21T12:00:00.000Z',
        reportedReturnAt: 'private',
      },
      'outbox-1',
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      deepLink: 'carrental://bookings/DEMO-OVERDUE-RETURN/handover-recovery',
      userId: renterUserId,
      variables: {
        reference: 'DEMO-OVERDUE-RETURN',
        responseDeadlineAt: '2026-09-21T12:00:00.000Z',
        scope: 'RETURN',
      },
    });
    expect(JSON.stringify(creates[0])).not.toContain('reportedReturnAt');
  });

  it('notifies only the waiver counterpart once per phase with safe reference routing', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates = new Map<string, Record<string, unknown>>();
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-WAIVER' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notificationPreference: { findUnique: vi.fn(async () => null) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          creates.set(String(create.stableKey), create);
          return { id: bookingId };
        }),
      },
    } as unknown as PrismaClient;
    for (const event of [
      'START_INSPECTION_EVIDENCE_WAIVED',
      'RETURN_INSPECTION_EVIDENCE_WAIVED',
      'OWNER_RETURN_INSPECTION_EVIDENCE_WAIVED',
    ]) {
      await consumeDomainEvent(
        database,
        event,
        { bookingId, code: '123456', address: 'private', mediaUrl: 'private' },
        bookingId,
      );
      await consumeDomainEvent(database, event, { bookingId }, bookingId);
    }
    expect(creates.size).toBe(3);
    expect([...creates.values()].map((n) => n.userId)).toEqual([
      renterUserId,
      ownerUserId,
      renterUserId,
    ]);
    for (const n of creates.values()) {
      expect(n.variables).toEqual({ reference: 'CR-2026-WAIVER' });
      expect(n.deepLink).toBe('carrental://bookings/CR-2026-WAIVER');
    }
  });
  it('delivers role-specific overdue reminders idempotently without private evidence', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates = new Map<string, Record<string, unknown>>();
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-OVERDUE' }
            : { ownerUserId, renterUserId },
        ),
      },
      devicePushToken: { findMany: vi.fn(async () => []) },
      notification: {
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
          creates.set(String(create.stableKey), create);
          return { id: bookingId };
        }),
      },
      notificationPreference: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    for (const event of ['PICKUP_HANDOVER_OVERDUE', 'RETURN_CONFIRMATION_OVERDUE']) {
      await consumeDomainEvent(
        database,
        event,
        { bookingId, code: '123456', privateAddress: 'private' },
        bookingId,
      );
      await consumeDomainEvent(database, event, { bookingId }, bookingId);
    }
    expect(creates.size).toBe(4);
    expect([...creates.values()].map((item) => item.templateKey)).toEqual([
      'rental.handover-overdue.renter',
      'rental.handover-overdue.owner',
      'rental.return-overdue.renter',
      'rental.return-overdue.owner',
    ]);
    for (const notification of creates.values()) {
      expect(notification.deepLink).toBe('carrental://bookings/CR-2026-OVERDUE');
      expect(notification.variables).toEqual({ reference: 'CR-2026-OVERDUE' });
    }
  });
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

  it('routes amendment lifecycle events idempotently without trusting private payload fields', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const ownerUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const renterUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const creates: Record<string, unknown>[] = [];
    const stableKeys = new Set<string>();
    const database = {
      booking: {
        findUnique: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
          'publicReference' in select
            ? { publicReference: 'CR-2026-AMEND' }
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
    const events = [
      [
        'BOOKING_AMENDMENT_REQUESTED',
        { amendmentId: '10000000-0000-4000-8000-000000000001', bookingId },
      ],
      [
        'BOOKING_AMENDMENT_WITHDRAWN',
        { amendmentId: '10000000-0000-4000-8000-000000000002', bookingId },
      ],
      [
        'BOOKING_AMENDMENT_ACCEPTED',
        {
          bookingId,
          amendmentId: '10000000-0000-4000-8000-000000000003',
          financialOutcome: 'ADDITIONAL_PAYMENT',
          paymentDeadlineAt: '2026-09-28T12:10:00.000Z',
        },
      ],
      [
        'BOOKING_AMENDMENT_ACCEPTED',
        {
          amendmentId: '10000000-0000-4000-8000-000000000004',
          bookingId,
          financialOutcome: 'REFUND',
        },
      ],
      [
        'BOOKING_AMENDMENT_DECLINED',
        { amendmentId: '10000000-0000-4000-8000-000000000005', bookingId },
      ],
      [
        'BOOKING_AMENDMENT_APPLIED',
        { amendmentId: '10000000-0000-4000-8000-000000000007', bookingId },
      ],
      [
        'BOOKING_AMENDMENT_TERMINATED',
        {
          amendmentId: '10000000-0000-4000-8000-000000000006',
          bookingId,
          status: 'EXPIRED',
        },
      ],
      [
        'BOOKING_AMENDMENT_TERMINATED',
        {
          amendmentId: '10000000-0000-4000-8000-000000000008',
          bookingId,
          reasonCode: 'RENTER_PAYMENT_DEADLINE_EXPIRED',
          status: 'FAILED',
        },
      ],
    ] as const;
    for (const [index, [eventType, payload]] of events.entries()) {
      const outboxId = `${index + 1}1111111-1111-4111-8111-111111111111`.slice(0, 36);
      await consumeDomainEvent(database, eventType, payload, outboxId);
      await consumeDomainEvent(database, eventType, payload, outboxId);
    }
    expect(creates.map(({ templateKey, userId }) => ({ templateKey, userId }))).toEqual([
      { templateKey: 'booking-amendment.requested', userId: ownerUserId },
      { templateKey: 'booking-amendment.withdrawn', userId: ownerUserId },
      { templateKey: 'booking-amendment.accepted-payment-required', userId: renterUserId },
      { templateKey: 'booking-amendment.accepted-processing', userId: renterUserId },
      { templateKey: 'booking-amendment.declined', userId: renterUserId },
      { templateKey: 'booking-amendment.applied', userId: renterUserId },
      { templateKey: 'booking-amendment.expired', userId: renterUserId },
      { templateKey: 'booking-amendment.expired', userId: ownerUserId },
      { templateKey: 'booking-amendment.payment-window-expired', userId: renterUserId },
    ]);
    for (const [index, notification] of creates.entries()) {
      expect(notification.deepLink).toBe('carrental://bookings/CR-2026-AMEND');
      expect(notification.variables).toEqual(
        index === 2
          ? {
              reference: 'CR-2026-AMEND',
              financialOutcome: 'ADDITIONAL_PAYMENT',
              paymentDeadlineAt: '2026-09-28T12:10:00.000Z',
            }
          : index === 3
            ? { reference: 'CR-2026-AMEND', financialOutcome: 'REFUND' }
            : { reference: 'CR-2026-AMEND' },
      );
    }
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
