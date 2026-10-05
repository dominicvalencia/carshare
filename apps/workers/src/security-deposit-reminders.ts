import {
  BookingStatus,
  NotificationAudience,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  type PrismaClient,
  SecurityDepositStatus,
} from '@carrental/database';
import { consumeDomainEvent, notificationStableKey } from './notification-delivery';

export const SECURITY_DEPOSIT_REMINDER_EVENTS = {
  REQUIRED: 'SECURITY_DEPOSIT_REQUIRED',
  TWENTY_FOUR_HOUR: 'SECURITY_DEPOSIT_24H_REMINDER',
  FINAL: 'SECURITY_DEPOSIT_FINAL_REMINDER',
} as const;

type ReminderEvent =
  (typeof SECURITY_DEPOSIT_REMINDER_EVENTS)[keyof typeof SECURITY_DEPOSIT_REMINDER_EVENTS];

interface ReminderBookingState {
  readonly id: string;
  readonly renterUserId: string;
  readonly rentalStart: Date;
  readonly status: BookingStatus;
  readonly policySnapshot: { readonly securityDepositRequired: boolean } | null;
  readonly securityDeposit: {
    readonly status: SecurityDepositStatus;
    readonly requiredAmountMinor: bigint;
    readonly authorizedAmountMinor: bigint;
  } | null;
  readonly payments: ReadonlyArray<{ readonly status: PaymentStatus }>;
}

export interface SecurityDepositReminderSweepOptions {
  readonly applicationEnvironment: string;
  readonly executionEnabled: boolean;
  readonly leadHours: number;
  readonly now?: Date;
}

const HOUR_MS = 3_600_000;
const ACTIVE_PRE_PICKUP_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.READY_FOR_PICKUP,
];

export function securityDepositReminderEventsDue(
  booking: ReminderBookingState,
  now: Date,
  leadHours: number,
): ReminderEvent[] {
  if (
    !ACTIVE_PRE_PICKUP_STATUSES.includes(booking.status) ||
    !booking.policySnapshot?.securityDepositRequired ||
    booking.rentalStart <= now ||
    !booking.payments.some((payment) => payment.status === PaymentStatus.CAPTURED) ||
    securityDepositIsSatisfied(booking.securityDeposit)
  )
    return [];

  const millisecondsUntilPickup = booking.rentalStart.getTime() - now.getTime();
  const events: ReminderEvent[] = [];
  if (millisecondsUntilPickup <= leadHours * HOUR_MS)
    events.push(SECURITY_DEPOSIT_REMINDER_EVENTS.REQUIRED);
  if (millisecondsUntilPickup <= 24 * HOUR_MS)
    events.push(SECURITY_DEPOSIT_REMINDER_EVENTS.TWENTY_FOUR_HOUR);
  if (millisecondsUntilPickup <= 3 * HOUR_MS) events.push(SECURITY_DEPOSIT_REMINDER_EVENTS.FINAL);
  return events;
}

export function securityDepositIsSatisfied(
  deposit: ReminderBookingState['securityDeposit'],
): boolean {
  return Boolean(
    deposit &&
    deposit.status === SecurityDepositStatus.AUTHORIZED &&
    deposit.requiredAmountMinor > 0n &&
    deposit.authorizedAmountMinor >= deposit.requiredAmountMinor,
  );
}

export async function processSecurityDepositReminders(
  database: PrismaClient,
  options: SecurityDepositReminderSweepOptions,
): Promise<number> {
  if (!options.executionEnabled) return 0;
  const now = options.now ?? new Date();
  const latestEligiblePickup = new Date(now.getTime() + options.leadHours * HOUR_MS);
  const candidates = await database.booking.findMany({
    where: {
      status: { in: ACTIVE_PRE_PICKUP_STATUSES },
      rentalStart: { gt: now, lte: latestEligiblePickup },
      policySnapshot: { securityDepositRequired: true },
      payments: {
        some: { purpose: PaymentPurpose.RENTAL, status: PaymentStatus.CAPTURED },
      },
    },
    select: { id: true },
    orderBy: { rentalStart: 'asc' },
    take: 500,
  });

  let handled = 0;
  for (const candidate of candidates) {
    handled += await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "bookings"
        WHERE "id" = ${candidate.id}::uuid
        FOR UPDATE
      `);
      const current = await transaction.booking.findUnique({
        where: { id: candidate.id },
        include: {
          policySnapshot: { select: { securityDepositRequired: true } },
          securityDeposit: {
            select: {
              authorizedAmountMinor: true,
              requiredAmountMinor: true,
              status: true,
            },
          },
          payments: {
            where: { purpose: PaymentPurpose.RENTAL },
            select: { status: true },
          },
        },
      });
      if (!current) return 0;

      const events = securityDepositReminderEventsDue(current, now, options.leadHours);
      let created = 0;
      for (const eventType of events) {
        const notificationIdentity = `${current.id}:${eventType}:${current.rentalStart.toISOString()}`;
        const stableKey = notificationStableKey(
          eventType,
          current.renterUserId,
          NotificationAudience.RENTER,
          notificationIdentity,
        );
        const existing = await transaction.notification.findUnique({
          where: { stableKey },
          select: { id: true },
        });
        if (existing) continue;
        await consumeDomainEvent(
          transaction as unknown as PrismaClient,
          eventType,
          {
            bookingId: current.id,
            effectiveRentalStart: current.rentalStart.toISOString(),
            notificationIdentity,
          },
          current.id,
          options.applicationEnvironment,
        );
        created += 1;
      }
      return created;
    });
  }
  return handled;
}
