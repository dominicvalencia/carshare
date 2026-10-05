import { describe, expect, it, vi } from 'vitest';
import {
  BookingStatus,
  PaymentStatus,
  SecurityDepositStatus,
  type PrismaClient,
} from '@carrental/database';
import {
  processSecurityDepositReminders,
  SECURITY_DEPOSIT_REMINDER_EVENTS,
  securityDepositIsSatisfied,
  securityDepositReminderEventsDue,
} from './security-deposit-reminders';

const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const renterUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerUserId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const now = new Date('2026-10-05T00:00:00.000Z');

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: bookingId,
    renterUserId,
    rentalStart: new Date('2026-10-07T00:00:00.000Z'),
    status: BookingStatus.CONFIRMED,
    policySnapshot: { securityDepositRequired: true },
    payments: [{ status: PaymentStatus.CAPTURED }],
    securityDeposit: {
      status: SecurityDepositStatus.PENDING,
      requiredAmountMinor: 300_000n,
      authorizedAmountMinor: 0n,
    },
    ...overrides,
  };
}

function fakeDatabase(current: ReturnType<typeof booking>) {
  const notifications = new Map<string, Record<string, unknown>>();
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: bookingId }]),
    booking: {
      findUnique: vi.fn(async ({ select }: { select?: Record<string, unknown> }) =>
        select?.publicReference
          ? { publicReference: 'CR-2026-DEPOSIT' }
          : select?.renterUserId
            ? { ownerUserId, renterUserId }
            : current,
      ),
    },
    devicePushToken: { findMany: vi.fn(async () => []) },
    notificationPreference: { findUnique: vi.fn(async () => null) },
    notification: {
      findUnique: vi.fn(async ({ where }: { where: { stableKey: string } }) =>
        notifications.has(where.stableKey) ? { id: bookingId } : null,
      ),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        const key = String(create.stableKey);
        if (!notifications.has(key)) notifications.set(key, create);
        return { id: bookingId };
      }),
    },
  };
  const database = {
    booking: { findMany: vi.fn(async () => [{ id: bookingId }]) },
    $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<number>) =>
      callback(transaction),
    ),
  } as unknown as PrismaClient;
  return { database, notifications, transaction };
}

describe('security deposit reminder scheduling', () => {
  it('sends the initial required notification at the configured eligibility boundary', () => {
    expect(securityDepositReminderEventsDue(booking(), now, 48)).toEqual([
      SECURITY_DEPOSIT_REMINDER_EVENTS.REQUIRED,
    ]);
  });

  it('sends the 24-hour reminder when the deposit remains unsatisfied', () => {
    const pickup = new Date(now.getTime() + 24 * 3_600_000);
    expect(securityDepositReminderEventsDue(booking({ rentalStart: pickup }), now, 48)).toContain(
      SECURITY_DEPOSIT_REMINDER_EVENTS.TWENTY_FOUR_HOUR,
    );
  });

  it('sends the final reminder three hours before pickup', () => {
    const pickup = new Date(now.getTime() + 3 * 3_600_000);
    expect(securityDepositReminderEventsDue(booking({ rentalStart: pickup }), now, 48)).toContain(
      SECURITY_DEPOSIT_REMINDER_EVENTS.FINAL,
    );
  });

  it.each([SecurityDepositStatus.PENDING, SecurityDepositStatus.AUTHORIZING])(
    'does not treat %s, including reconciliation-pending/unknown, as satisfied',
    (status) => {
      const current = booking({
        securityDeposit: {
          status,
          requiredAmountMinor: 300_000n,
          authorizedAmountMinor: 0n,
        },
      });
      expect(securityDepositIsSatisfied(current.securityDeposit)).toBe(false);
      expect(securityDepositReminderEventsDue(current, now, 48)).not.toHaveLength(0);
    },
  );

  it('skips all reminders after the authoritative required amount is authorized', () => {
    const current = booking({
      securityDeposit: {
        status: SecurityDepositStatus.AUTHORIZED,
        requiredAmountMinor: 300_000n,
        authorizedAmountMinor: 300_000n,
      },
    });
    expect(securityDepositIsSatisfied(current.securityDeposit)).toBe(true);
    expect(securityDepositReminderEventsDue(current, now, 48)).toEqual([]);
  });

  it('does not accept a partial or mismatched authorization as satisfied', () => {
    const current = booking({
      securityDeposit: {
        status: SecurityDepositStatus.AUTHORIZED,
        requiredAmountMinor: 300_000n,
        authorizedAmountMinor: 299_999n,
      },
    });
    expect(securityDepositReminderEventsDue(current, now, 48)).not.toHaveLength(0);
  });

  it.each([BookingStatus.CANCELLED, BookingStatus.EXPIRED, BookingStatus.ACTIVE])(
    'skips invalid booking status %s',
    (status) => {
      expect(securityDepositReminderEventsDue(booking({ status }), now, 48)).toEqual([]);
    },
  );

  it('skips a late job after the effective pickup time has passed', () => {
    expect(
      securityDepositReminderEventsDue(
        booking({ rentalStart: new Date(now.getTime() - 1) }),
        now,
        48,
      ),
    ).toEqual([]);
  });

  it('requires captured rental payment and an enabled required policy', () => {
    expect(
      securityDepositReminderEventsDue(
        booking({ payments: [{ status: PaymentStatus.AUTHORIZED }] }),
        now,
        48,
      ),
    ).toEqual([]);
    expect(
      securityDepositReminderEventsDue(
        booking({ policySnapshot: { securityDepositRequired: false } }),
        now,
        48,
      ),
    ).toEqual([]);
  });

  it('does not schedule reminders while deposit execution is disabled', async () => {
    const { database } = fakeDatabase(booking());
    expect(
      await processSecurityDepositReminders(database, {
        applicationEnvironment: 'test',
        executionEnabled: false,
        leadHours: 48,
        now,
      }),
    ).toBe(0);
    expect(database.booking.findMany).not.toHaveBeenCalled();
  });

  it('rechecks current persisted state under a booking lock before notifying', async () => {
    const current = booking({ status: BookingStatus.CANCELLED });
    const { database, notifications, transaction } = fakeDatabase(current);
    await processSecurityDepositReminders(database, {
      applicationEnvironment: 'test',
      executionEnabled: true,
      leadHours: 48,
      now,
    });
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(notifications).toHaveLength(0);
  });

  it('uses effective start in the durable identity so stale amended schedules are harmless', async () => {
    const first = fakeDatabase(booking());
    await processSecurityDepositReminders(first.database, {
      applicationEnvironment: 'test',
      executionEnabled: true,
      leadHours: 48,
      now,
    });
    const oldKeys = [...first.notifications.keys()];

    const amended = fakeDatabase(booking({ rentalStart: new Date('2026-10-06T00:00:00.000Z') }));
    await processSecurityDepositReminders(amended.database, {
      applicationEnvironment: 'test',
      executionEnabled: true,
      leadHours: 48,
      now,
    });
    expect([...amended.notifications.keys()]).not.toEqual(oldKeys);
  });

  it('deduplicates duplicate sweeps and worker retries while preserving the booking deep link', async () => {
    const fixture = fakeDatabase(booking());
    const options = {
      applicationEnvironment: 'test',
      executionEnabled: true,
      leadHours: 48,
      now,
    } as const;
    await processSecurityDepositReminders(fixture.database, options);
    await processSecurityDepositReminders(fixture.database, options);
    expect(fixture.notifications).toHaveLength(1);
    expect([...fixture.notifications.values()][0]).toMatchObject({
      deepLink: 'carshare-test://bookings/CR-2026-DEPOSIT',
      sourceEventType: SECURITY_DEPOSIT_REMINDER_EVENTS.REQUIRED,
      templateKey: 'security-deposit.required',
      userId: renterUserId,
    });
  });
});
