import { HttpStatus, Injectable } from '@nestjs/common';
import { NotificationCategory, NotificationChannel, PushTokenStatus } from '@carrental/database';
import { renderNotification } from '@carrental/notifications';
import { DatabaseService } from '../infrastructure/database/database.service';
import { ApplicationException } from '../common/errors/application.exception';

@Injectable()
export class NotificationsService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string, query: { cursor?: string; limit: number }) {
    const rows = await this.database.client.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(this.present),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async summary(userId: string) {
    return {
      unreadCount: await this.database.client.notification.count({
        where: { userId, readAt: null },
      }),
    };
  }

  async read(userId: string, notificationId: string) {
    const result = await this.database.client.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    if (!result.count)
      throw new ApplicationException(
        'NOTIFICATION_NOT_FOUND',
        'Notification not found.',
        HttpStatus.NOT_FOUND,
      );
    return { id: notificationId, read: true };
  }

  async readAll(userId: string) {
    const result = await this.database.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async opened(userId: string, notificationId: string) {
    const notification = await this.database.client.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification)
      throw new ApplicationException(
        'NOTIFICATION_NOT_FOUND',
        'Notification not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.database.client.notification.update({
      where: { id: notificationId },
      data: { openedAt: new Date(), readAt: notification.readAt ?? new Date() },
    });
    return { deepLink: notification.deepLink };
  }

  async preferences(userId: string) {
    const stored = await this.database.client.notificationPreference.findMany({
      where: { userId },
    });
    const index = new Map(stored.map((item) => [`${item.category}:${item.channel}`, item.enabled]));
    return Object.values(NotificationCategory).flatMap((category) =>
      Object.values(NotificationChannel).map((channel) => ({
        category,
        channel,
        enabled: index.get(`${category}:${channel}`) ?? true,
      })),
    );
  }

  async updatePreferences(
    userId: string,
    preferences: readonly {
      category: NotificationCategory;
      channel: NotificationChannel;
      enabled: boolean;
    }[],
  ) {
    await this.database.client.$transaction(
      preferences.map((item) =>
        this.database.client.notificationPreference.upsert({
          where: {
            userId_category_channel: { userId, category: item.category, channel: item.channel },
          },
          create: { userId, ...item },
          update: { enabled: item.enabled },
        }),
      ),
    );
    return this.preferences(userId);
  }

  async registerToken(
    userId: string,
    sessionId: string,
    input: {
      provider: 'EXPO' | 'FAKE';
      platform: 'IOS' | 'ANDROID' | 'WEB' | 'UNKNOWN';
      token: string;
    },
  ) {
    const token = input.token.trim();
    if (!token || token.length > 512)
      throw new ApplicationException(
        'PUSH_TOKEN_INVALID',
        'Push token is invalid.',
        HttpStatus.BAD_REQUEST,
      );
    return this.database.client.$transaction(async (transaction) => {
      const existing = await transaction.devicePushToken.findUnique({ where: { token } });
      if (existing && existing.userId !== userId)
        throw new ApplicationException(
          'PUSH_TOKEN_CONFLICT',
          'Push token is already registered.',
          HttpStatus.CONFLICT,
        );
      await transaction.devicePushToken.updateMany({
        where: { sessionId, status: PushTokenStatus.ACTIVE, token: { not: token } },
        data: { status: PushTokenStatus.DISABLED, disabledAt: new Date() },
      });
      const saved = await transaction.devicePushToken.upsert({
        where: { token },
        create: { userId, sessionId, provider: input.provider, platform: input.platform, token },
        update: {
          userId,
          sessionId,
          provider: input.provider,
          platform: input.platform,
          status: PushTokenStatus.ACTIVE,
          disabledAt: null,
          lastSeenAt: new Date(),
        },
        select: { id: true, provider: true, platform: true, status: true, lastSeenAt: true },
      });
      return saved;
    });
  }

  async deleteToken(userId: string, tokenId: string) {
    const result = await this.database.client.devicePushToken.updateMany({
      where: { id: tokenId, userId },
      data: { status: PushTokenStatus.DISABLED, disabledAt: new Date() },
    });
    if (!result.count)
      throw new ApplicationException(
        'PUSH_TOKEN_NOT_FOUND',
        'Push token not found.',
        HttpStatus.NOT_FOUND,
      );
    return { id: tokenId, disabled: true };
  }

  private readonly present = (notification: {
    id: string;
    category: NotificationCategory;
    templateKey: string;
    variables: unknown;
    deepLink: string | null;
    readAt: Date | null;
    openedAt: Date | null;
    createdAt: Date;
  }) => ({
    id: notification.id,
    category: notification.category,
    ...renderNotification(
      notification.templateKey,
      (notification.variables ?? {}) as Record<string, unknown>,
    ),
    deepLink: notification.deepLink,
    readAt: notification.readAt,
    openedAt: notification.openedAt,
    createdAt: notification.createdAt,
  });
}
