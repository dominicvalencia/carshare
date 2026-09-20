import type { WorkerEnvironment } from '@carrental/config';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
  type PrismaClient,
} from '@carrental/database';
import { consumeDomainEvent } from './notification-delivery';

const REQUEST_TIMEOUT_MS = 10_000;

export interface RecoveryReminderProviders {
  sendEmail(input: {
    body: string;
    idempotencyKey: string;
    subject: string;
    to: string;
  }): Promise<{ provider: string; reference: string; delivered?: boolean }>;
  sendSms(input: {
    body: string;
    idempotencyKey: string;
    to: string;
  }): Promise<{ provider: string; reference: string; delivered?: boolean }>;
}

export function recoveryReminderProviders(
  environment: WorkerEnvironment,
): RecoveryReminderProviders {
  return {
    async sendEmail(input) {
      if (
        !environment.EMAIL_ENABLED ||
        environment.EMAIL_PROVIDER !== 'postmark' ||
        !environment.POSTMARK_SERVER_TOKEN ||
        !environment.POSTMARK_FROM_EMAIL
      )
        throw new PermanentChannelError('EMAIL_NOT_ENABLED', 'Transactional email is not enabled.');
      let response: Response;
      try {
        response = await fetch('https://api.postmarkapp.com/email', {
          method: 'POST',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Postmark-Server-Token': environment.POSTMARK_SERVER_TOKEN,
          },
          body: JSON.stringify({
            From: environment.POSTMARK_FROM_EMAIL,
            To: input.to,
            Subject: input.subject,
            TextBody: input.body,
            MessageStream: environment.POSTMARK_MESSAGE_STREAM,
            Metadata: { idempotencyKey: input.idempotencyKey },
          }),
        });
      } catch {
        throw new UnknownSubmissionError('Postmark submission result is unknown.');
      }
      const body = (await response.json().catch(() => ({}))) as { MessageID?: unknown };
      if (!response.ok || typeof body.MessageID !== 'string')
        throw new RetryableChannelError('EMAIL_PROVIDER_REJECTED', 'Postmark rejected the email.');
      return { provider: 'postmark', reference: body.MessageID };
    },
    async sendSms(input) {
      if (
        !environment.SMS_TRANSACTIONAL_ENABLED ||
        environment.SMS_PROVIDER !== 'semaphore' ||
        !environment.SEMAPHORE_API_KEY
      )
        throw new PermanentChannelError('SMS_NOT_ENABLED', 'Transactional SMS is not enabled.');
      const form = new URLSearchParams({
        apikey: environment.SEMAPHORE_API_KEY,
        number: input.to.replace(/^\+/, ''),
        message: input.body,
      });
      if (environment.SEMAPHORE_SENDER_NAME)
        form.set('sendername', environment.SEMAPHORE_SENDER_NAME);
      let response: Response;
      try {
        response = await fetch(environment.SEMAPHORE_API_URL, {
          method: 'POST',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CarShare-Idempotency-Key': input.idempotencyKey,
          },
          body: form,
        });
      } catch {
        throw new UnknownSubmissionError('Semaphore submission result is unknown.');
      }
      const body = (await response.json().catch(() => undefined)) as
        Array<{ message_id?: string | number; status?: string }> | undefined;
      const item = body?.[0];
      if (!response.ok || item?.message_id === undefined)
        throw new RetryableChannelError('SMS_PROVIDER_REJECTED', 'Semaphore rejected the SMS.');
      return {
        provider: 'semaphore',
        reference: String(item.message_id),
        delivered: item.status?.toLowerCase() === 'delivered',
      };
    },
  };
}

export async function processDueRecoveryReminders(
  database: PrismaClient,
  providers: RecoveryReminderProviders,
  applicationEnvironment = 'local',
  now = new Date(),
): Promise<number> {
  const reminders = await database.bookingOverdueHandoverRecoveryReminder.findMany({
    where: {
      status: {
        in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRYABLE_FAILURE],
      },
      scheduledAt: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { scheduledAt: 'asc' },
    take: 100,
    include: {
      recipient: true,
      recovery: {
        include: {
          acceptance: true,
          response: true,
          booking: { select: { publicReference: true, status: true } },
        },
      },
    },
  });
  let handled = 0;
  for (const reminder of reminders) {
    const claimed = await database.bookingOverdueHandoverRecoveryReminder.updateMany({
      where: { id: reminder.id, status: reminder.status },
      data: { status: NotificationDeliveryStatus.PROCESSING, attemptCount: { increment: 1 } },
    });
    if (!claimed.count) continue;
    const current = await database.bookingOverdueHandoverRecovery.findUnique({
      where: { id: reminder.recoveryId },
      include: { response: true, acceptance: true },
    });
    if (!current || current.response || current.acceptance || current.responseDeadlineAt <= now) {
      await skip(
        database,
        reminder.id,
        current?.response
          ? 'RENTER_ALREADY_RESPONDED'
          : current?.acceptance
            ? 'RECOVERY_ALREADY_ACCEPTED'
            : 'DEADLINE_PASSED',
      );
      handled += 1;
      continue;
    }
    const preference = await database.notificationPreference.findUnique({
      where: {
        userId_category_channel: {
          userId: reminder.recipientUserId,
          category: NotificationCategory.RENTAL_REMINDERS,
          channel: reminder.channel,
        },
      },
    });
    if (preference?.enabled === false) {
      await skip(database, reminder.id, 'CHANNEL_DISABLED_BY_USER');
      handled += 1;
      continue;
    }
    const reference = reminder.recovery.booking.publicReference;
    const deepLink = `${scheme(applicationEnvironment)}://bookings/${reference}/handover-recovery`;
    const deadline = formatDeadline(reminder.recovery.responseDeadlineAt);
    try {
      if (reminder.channel === NotificationChannel.PUSH) {
        await consumeDomainEvent(
          database,
          reminder.stage === 'FINAL'
            ? 'OVERDUE_HANDOVER_RECOVERY_FINAL_REMINDER'
            : 'OVERDUE_HANDOVER_RECOVERY_MIDPOINT_REMINDER',
          {
            bookingId: reminder.recovery.bookingId,
            recoveryId: reminder.recoveryId,
            scope: reminder.recovery.scope,
            responseDeadlineAt: reminder.recovery.responseDeadlineAt.toISOString(),
          },
          reminder.id,
          applicationEnvironment,
        );
        await submitted(database, reminder.id, 'notification-outbox', reminder.id, false);
      } else if (reminder.channel === NotificationChannel.EMAIL) {
        if (!reminder.recipient.email || !reminder.recipient.emailVerifiedAt) {
          await skip(database, reminder.id, 'NO_ELIGIBLE_EMAIL');
        } else {
          const result = await providers.sendEmail({
            to: reminder.recipient.email,
            idempotencyKey: reminder.stableKey,
            subject:
              reminder.stage === 'FINAL'
                ? 'Final reminder: Confirm your CarShare handover'
                : 'Action required: Confirm your CarShare handover',
            body: emailBody(reminder.recovery.scope, deadline, deepLink, reminder.stage),
          });
          await submitted(
            database,
            reminder.id,
            result.provider,
            result.reference,
            result.delivered,
          );
        }
      } else {
        if (!reminder.recipient.normalizedMobileNumber || !reminder.recipient.mobileVerifiedAt) {
          await skip(database, reminder.id, 'NO_ELIGIBLE_SMS_DESTINATION');
        } else {
          const result = await providers.sendSms({
            to: reminder.recipient.normalizedMobileNumber,
            idempotencyKey: reminder.stableKey,
            body: `CarShare: Action required for booking ${reference}. Confirm or dispute the handover report before ${deadline}. No response may accept it automatically. ${deepLink}`,
          });
          await submitted(
            database,
            reminder.id,
            result.provider,
            result.reference,
            result.delivered,
          );
        }
      }
    } catch (error) {
      if (error instanceof UnknownSubmissionError) {
        await database.bookingOverdueHandoverRecoveryReminder.update({
          where: { id: reminder.id },
          data: {
            status: NotificationDeliveryStatus.UNKNOWN,
            failureCategory: 'UNKNOWN_PROVIDER_RESULT',
            safeFailureMessage: error.message,
            nextAttemptAt: null,
          },
        });
      } else if (error instanceof PermanentChannelError) {
        await skip(database, reminder.id, error.category, error.message);
      } else {
        const attempt = reminder.attemptCount + 1;
        await database.bookingOverdueHandoverRecoveryReminder.update({
          where: { id: reminder.id },
          data: {
            status: NotificationDeliveryStatus.RETRYABLE_FAILURE,
            failureCategory:
              error instanceof RetryableChannelError ? error.category : 'PROVIDER_FAILURE',
            safeFailureMessage:
              error instanceof Error ? error.message.slice(0, 500) : 'Provider delivery failed.',
            nextAttemptAt: new Date(now.getTime() + Math.min(3600, 2 ** attempt * 30) * 1000),
          },
        });
      }
    }
    handled += 1;
  }
  return handled;
}

function emailBody(scope: string, deadline: string, deepLink: string, stage: string) {
  const phase =
    scope === 'START'
      ? 'an overdue Pickup/Delivery handover'
      : scope === 'RETURN'
        ? 'an overdue Return/Collection handover'
        : 'both Pickup and Return handovers';
  return `${stage === 'FINAL' ? 'Final reminder. Your handover confirmation is due in approximately 2 hours.\n\n' : ''}The Owner reported ${phase} without inspection.\n\nPlease review the report and confirm or disagree before:\n${deadline}\n\nIf you do not respond before the deadline, the report may be accepted automatically under CarShare's overdue handover recovery process.\n\nReview handover:\n${deepLink}\n\nFor your privacy, reported handover details are available after you sign in to CarShare.`;
}
function formatDeadline(value: Date) {
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
    timeZoneName: 'short',
  }).format(value);
}
function scheme(environment: string) {
  return environment === 'production'
    ? 'carshare'
    : environment === 'staging'
      ? 'carshare-staging'
      : environment === 'test'
        ? 'carshare-test'
        : 'carrental';
}
async function skip(database: PrismaClient, id: string, category: string, message = category) {
  await database.bookingOverdueHandoverRecoveryReminder.update({
    where: { id },
    data: {
      status: NotificationDeliveryStatus.SKIPPED,
      failureCategory: category,
      safeFailureMessage: message,
      nextAttemptAt: null,
    },
  });
}
async function submitted(
  database: PrismaClient,
  id: string,
  provider: string,
  reference: string,
  delivered = false,
) {
  await database.bookingOverdueHandoverRecoveryReminder.update({
    where: { id },
    data: {
      status: delivered ? NotificationDeliveryStatus.DELIVERED : NotificationDeliveryStatus.SENT,
      provider,
      providerReference: reference,
      submittedAt: new Date(),
      ...(delivered ? { deliveredAt: new Date() } : {}),
      nextAttemptAt: null,
    },
  });
}
class RetryableChannelError extends Error {
  constructor(
    readonly category: string,
    message: string,
  ) {
    super(message);
  }
}
class PermanentChannelError extends Error {
  constructor(
    readonly category: string,
    message: string,
  ) {
    super(message);
  }
}
class UnknownSubmissionError extends Error {}
