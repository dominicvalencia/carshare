import { createHash } from 'node:crypto';
import type { WorkerEnvironment } from '@carrental/config';
import {
  NotificationCategory,
  NotificationAudience,
  NotificationChannel,
  NotificationDeliveryStatus,
  PushTokenStatus,
  type Prisma,
  type PrismaClient,
} from '@carrental/database';
import {
  ExpoPushProvider,
  FakePushProvider,
  renderNotification,
  type PushProvider,
  type PushResult,
} from '@carrental/notifications';

type Payload = Readonly<Record<string, unknown>>;
interface EventPolicy {
  readonly category: NotificationCategory;
  readonly templateKey: string;
  readonly recipients: 'DIRECT' | 'OWNER' | 'RENTER' | 'BOTH';
}
interface NotificationRecipient {
  readonly userId: string;
  readonly audience: NotificationAudience;
}

export function workerPushProvider(environment: WorkerEnvironment): PushProvider | null {
  if (!environment.PUSH_ENABLED || environment.PUSH_PROVIDER === 'in_app') return null;
  return environment.PUSH_PROVIDER === 'expo'
    ? new ExpoPushProvider(environment.EXPO_PUSH_ACCESS_TOKEN)
    : new FakePushProvider();
}

export async function consumeDomainEvent(
  database: PrismaClient,
  eventType: string,
  rawPayload: unknown,
  outboxId: string,
  applicationEnvironment = 'local',
): Promise<number> {
  const payload = isRecord(rawPayload) ? rawPayload : {};
  const policy = policyFor(eventType);
  if (!policy) return 0;
  const recipients = await resolveRecipients(database, policy.recipients, payload);
  const sourceId =
    uuid(payload.messageId) ??
    uuid(payload.claimId) ??
    uuid(payload.reviewId) ??
    uuid(payload.ticketId) ??
    uuid(payload.payoutId) ??
    uuid(payload.aggregateId) ??
    uuid(payload.bookingId) ??
    uuid(outboxId);
  if (!sourceId) return 0;
  let created = 0;
  for (const recipient of recipients) {
    const { audience, userId } = recipient;
    const stableKey = createHash('sha256')
      .update(`${eventType}:${userId}:${audience}:${sourceId}`)
      .digest('hex');
    const reference = await bookingReference(database, uuid(payload.bookingId));
    const notification = await database.notification.upsert({
      where: { stableKey },
      create: {
        userId,
        audience,
        category: policy.category,
        templateKey: policy.templateKey,
        sourceEventType: eventType,
        sourceType: sourceType(eventType),
        sourceId,
        stableKey,
        variables: (reference ? { reference } : {}) as Prisma.InputJsonValue,
        deepLink: deepLink(policy, eventType, payload, reference, applicationEnvironment),
      },
      update: {},
    });
    const pushEnabled = await channelEnabled(
      database,
      userId,
      policy.category,
      NotificationChannel.PUSH,
    );
    if (pushEnabled) {
      const tokens = await database.devicePushToken.findMany({
        where: {
          userId,
          environment: applicationEnvironment,
          status: PushTokenStatus.ACTIVE,
          OR: [{ sessionId: null }, { session: { revokedAt: null } }],
        },
        select: { id: true },
      });
      for (const token of tokens) {
        await database.notificationDelivery.upsert({
          where: {
            notificationId_channel_devicePushTokenId_attemptNumber: {
              notificationId: notification.id,
              channel: NotificationChannel.PUSH,
              devicePushTokenId: token.id,
              attemptNumber: 1,
            },
          },
          create: {
            notificationId: notification.id,
            channel: NotificationChannel.PUSH,
            devicePushTokenId: token.id,
            provider: 'pending',
          },
          update: {},
        });
      }
    }
    created += 1;
  }
  return created;
}

export async function deliverPendingNotifications(
  database: PrismaClient,
  provider: PushProvider | null,
): Promise<number> {
  if (!provider) return 0;
  const deliveries = await database.notificationDelivery.findMany({
    where: {
      status: {
        in: [NotificationDeliveryStatus.PENDING, NotificationDeliveryStatus.RETRYABLE_FAILURE],
      },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    include: { notification: true, devicePushToken: true },
  });
  let handled = 0;
  for (const delivery of deliveries) {
    if (!delivery.devicePushToken || delivery.devicePushToken.status !== PushTokenStatus.ACTIVE) {
      await database.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationDeliveryStatus.SKIPPED,
          failureCategory: 'TOKEN_DISABLED',
          safeFailureMessage: 'Push token is disabled.',
        },
      });
      continue;
    }
    const claimed = await database.notificationDelivery.updateMany({
      where: { id: delivery.id, status: delivery.status },
      data: { status: NotificationDeliveryStatus.PROCESSING, provider: provider.code },
    });
    if (!claimed.count) continue;
    const variables = isRecord(delivery.notification.variables)
      ? delivery.notification.variables
      : {};
    const content = renderNotification(delivery.notification.templateKey, variables);
    const result = await provider.send({
      token: delivery.devicePushToken.token,
      title: content.title,
      body: content.body,
      data: {
        notificationId: delivery.notification.id,
        deepLink: delivery.notification.deepLink ?? '',
      },
      idempotencyKey: delivery.id,
    });
    await applyResult(
      database,
      delivery.id,
      delivery.devicePushToken.id,
      delivery.attemptNumber,
      result,
    );
    handled += 1;
  }
  return handled;
}

export async function reconcilePushReceipts(
  database: PrismaClient,
  provider: PushProvider | null,
  receiptDelaySeconds: number,
): Promise<number> {
  if (!provider) return 0;
  const sent = await database.notificationDelivery.findMany({
    where: {
      provider: provider.code,
      status: NotificationDeliveryStatus.SENT,
      providerReference: { not: null },
      sentAt: { lte: new Date(Date.now() - receiptDelaySeconds * 1000) },
    },
    take: 100,
    select: { id: true, providerReference: true, devicePushTokenId: true, attemptNumber: true },
  });
  const references = sent.flatMap((item) =>
    item.providerReference ? [item.providerReference] : [],
  );
  const receipts = await provider.receipts(references);
  for (const delivery of sent) {
    const result = delivery.providerReference ? receipts[delivery.providerReference] : undefined;
    if (result)
      await applyResult(
        database,
        delivery.id,
        delivery.devicePushTokenId,
        delivery.attemptNumber,
        result,
      );
  }
  return sent.length;
}

async function applyResult(
  database: PrismaClient,
  deliveryId: string,
  tokenId: string | null,
  attempt: number,
  result: PushResult,
) {
  const status =
    result.status === 'ACCEPTED'
      ? NotificationDeliveryStatus.SENT
      : result.status === 'DELIVERED'
        ? NotificationDeliveryStatus.DELIVERED
        : result.status === 'PERMANENT_FAILURE'
          ? NotificationDeliveryStatus.PERMANENT_FAILURE
          : NotificationDeliveryStatus.RETRYABLE_FAILURE;
  await database.notificationDelivery.update({
    where: { id: deliveryId },
    data: {
      status,
      ...(result.providerReference ? { providerReference: result.providerReference } : {}),
      ...(result.failureCategory ? { failureCategory: result.failureCategory } : {}),
      ...(result.safeFailureMessage ? { safeFailureMessage: result.safeFailureMessage } : {}),
      ...(result.status === 'ACCEPTED' ? { sentAt: new Date() } : {}),
      ...(result.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      nextAttemptAt:
        result.status === 'RETRYABLE_FAILURE'
          ? new Date(Date.now() + Math.min(3600, 2 ** attempt * 30) * 1000)
          : null,
    },
  });
  if (
    result.status === 'PERMANENT_FAILURE' &&
    (result.failureCategory === 'DeviceNotRegistered' ||
      result.failureCategory === 'DEVICE_NOT_REGISTERED')
  ) {
    if (tokenId)
      await database.devicePushToken.update({
        where: { id: tokenId },
        data: { status: PushTokenStatus.DISABLED, disabledAt: new Date() },
      });
  }
}

function policyFor(eventType: string): EventPolicy | null {
  if (eventType === 'NEW_MESSAGE')
    return {
      category: NotificationCategory.MESSAGES,
      templateKey: 'message.new',
      recipients: 'DIRECT',
    };
  if (eventType.startsWith('SUPPORT_'))
    return {
      category: NotificationCategory.SUPPORT,
      templateKey: 'support.updated',
      recipients: 'DIRECT',
    };
  if (eventType === 'BOOKING_OWNER_REQUESTED' || eventType === 'BOOKING_AWAITING_OWNER')
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'booking.requested',
      recipients: 'OWNER',
    };
  if (eventType.includes('OWNER_ACCEPTED') || eventType === 'BOOKING_CONFIRMED')
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'booking.accepted',
      recipients: 'RENTER',
    };
  if (eventType.includes('OWNER_REJECTED'))
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'booking.rejected',
      recipients: 'RENTER',
    };
  if (eventType.includes('CANCEL'))
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'booking.cancelled',
      recipients: 'BOTH',
    };
  if (eventType.includes('EXPIRED'))
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'booking.expired',
      recipients: 'BOTH',
    };
  if (eventType.startsWith('PAYMENT_') || eventType.startsWith('REFUND_'))
    return {
      category: NotificationCategory.BOOKING_UPDATES,
      templateKey: 'payment.updated',
      recipients: 'RENTER',
    };
  if (eventType === 'INSPECTION_CORRECTION_REQUESTED')
    return {
      category: NotificationCategory.RENTAL_REMINDERS,
      templateKey: 'inspection-correction.requested',
      recipients: 'OWNER',
    };
  if (eventType === 'INSPECTION_CORRECTION_APPROVED')
    return {
      category: NotificationCategory.RENTAL_REMINDERS,
      templateKey: 'inspection-correction.approved',
      recipients: 'BOTH',
    };
  if (eventType === 'INSPECTION_CORRECTION_REJECTED')
    return {
      category: NotificationCategory.RENTAL_REMINDERS,
      templateKey: 'inspection-correction.rejected',
      recipients: 'OWNER',
    };
  if (eventType.startsWith('EARNING_'))
    return {
      category: NotificationCategory.EARNINGS,
      templateKey: 'earning.updated',
      recipients: 'OWNER',
    };
  if (eventType.startsWith('PAYOUT_'))
    return {
      category: NotificationCategory.EARNINGS,
      templateKey: 'payout.updated',
      recipients: 'OWNER',
    };
  if (
    eventType.includes('CLAIM') ||
    eventType.includes('DISPUTE') ||
    eventType.includes('ADDITIONAL_CHARGE')
  )
    return {
      category: NotificationCategory.CLAIMS,
      templateKey: 'claim.updated',
      recipients: 'BOTH',
    };
  if (
    eventType.includes('PICKUP') ||
    eventType.includes('RETURN') ||
    eventType.includes('RENTAL_') ||
    eventType.includes('INSPECTION')
  )
    return {
      category: NotificationCategory.RENTAL_REMINDERS,
      templateKey: 'rental.updated',
      recipients: 'BOTH',
    };
  if (eventType === 'REVIEW_AVAILABLE')
    return {
      category: NotificationCategory.REVIEWS,
      templateKey: 'review.available',
      recipients: 'BOTH',
    };
  if (eventType === 'REVIEW_SUBMITTED')
    return {
      category: NotificationCategory.REVIEWS,
      templateKey: 'review.counterpart-submitted',
      recipients: 'DIRECT',
    };
  if (eventType === 'REVIEWS_PUBLISHED')
    return {
      category: NotificationCategory.REVIEWS,
      templateKey: 'review.published',
      recipients: 'BOTH',
    };
  if (eventType === 'BOOKING_COMPLETED')
    return {
      category: NotificationCategory.REVIEWS,
      templateKey: 'review.available',
      recipients: 'BOTH',
    };
  return null;
}

async function resolveRecipients(
  database: PrismaClient,
  target: EventPolicy['recipients'],
  payload: Payload,
): Promise<NotificationRecipient[]> {
  const bookingId = uuid(payload.bookingId);
  if (bookingId) {
    const booking = await database.booking.findUnique({
      where: { id: bookingId },
      select: { renterUserId: true, ownerUserId: true },
    });
    if (!booking) return [];
    if (target === 'DIRECT') {
      const userId = uuid(payload.recipientUserId);
      if (!userId) return [];
      return [
        {
          userId,
          audience:
            userId === booking.ownerUserId
              ? NotificationAudience.OWNER
              : userId === booking.renterUserId
                ? NotificationAudience.RENTER
                : NotificationAudience.ACCOUNT,
        },
      ];
    }
    return target === 'RENTER'
      ? [{ userId: booking.renterUserId, audience: NotificationAudience.RENTER }]
      : target === 'OWNER'
        ? [{ userId: booking.ownerUserId, audience: NotificationAudience.OWNER }]
        : [
            { userId: booking.renterUserId, audience: NotificationAudience.RENTER },
            { userId: booking.ownerUserId, audience: NotificationAudience.OWNER },
          ];
  }
  if (target === 'DIRECT')
    return uuid(payload.recipientUserId)
      ? [{ userId: String(payload.recipientUserId), audience: NotificationAudience.ACCOUNT }]
      : [];
  const payoutId = uuid(payload.payoutId) ?? uuid(payload.aggregateId);
  if (target === 'OWNER' && payoutId) {
    const payout = await database.payout.findUnique({
      where: { id: payoutId },
      select: { ownerProfile: { select: { userId: true } } },
    });
    return payout
      ? [{ userId: payout.ownerProfile.userId, audience: NotificationAudience.OWNER }]
      : [];
  }
  return [];
}

async function channelEnabled(
  database: PrismaClient,
  userId: string,
  category: NotificationCategory,
  channel: NotificationChannel,
) {
  return (
    (
      await database.notificationPreference.findUnique({
        where: { userId_category_channel: { userId, category, channel } },
        select: { enabled: true },
      })
    )?.enabled ?? true
  );
}
async function bookingReference(database: PrismaClient, bookingId: string | null) {
  return bookingId
    ? ((
        await database.booking.findUnique({
          where: { id: bookingId },
          select: { publicReference: true },
        })
      )?.publicReference ?? null)
    : null;
}
function deepLink(
  policy: EventPolicy,
  eventType: string,
  payload: Payload,
  bookingPublicReference: string | null,
  applicationEnvironment: string,
): string | null {
  const scheme =
    applicationEnvironment === 'staging'
      ? 'carshare-staging'
      : applicationEnvironment === 'test'
        ? 'carshare-test'
        : applicationEnvironment === 'production'
          ? 'carshare'
          : 'carrental';
  const claimId = uuid(payload.claimId);
  if (policy.category === NotificationCategory.CLAIMS && claimId)
    return `${scheme}://claims/${claimId}`;
  const id = uuid(payload.conversationId) ?? uuid(payload.bookingId) ?? uuid(payload.ticketId);
  const payoutId =
    uuid(payload.payoutId) ?? (eventType.startsWith('PAYOUT_') ? uuid(payload.aggregateId) : null);
  if (payoutId) return `${scheme}://payouts/${payoutId}`;
  if (!id) return eventType.startsWith('EARNING_') ? `${scheme}://earnings` : null;
  return policy.category === NotificationCategory.MESSAGES
    ? `${scheme}://messages/${id}`
    : policy.category === NotificationCategory.SUPPORT
      ? `${scheme}://support/${id}`
      : `${scheme}://bookings/${bookingPublicReference ?? id}`;
}
function sourceType(eventType: string) {
  return eventType.startsWith('PAYOUT_')
    ? 'PAYOUT'
    : eventType.startsWith('SUPPORT_')
      ? 'SUPPORT_TICKET'
      : eventType === 'NEW_MESSAGE'
        ? 'MESSAGE'
        : 'BOOKING';
}
function uuid(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
