import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingStatus,
  ConversationParticipantContext,
  ConversationStatus,
  MessageModerationStatus,
  ModerationTargetType,
  Prisma,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { ApplicationException } from '../common/errors/application.exception';
import type { RequestMetadata } from '../security/security-context';
import { AuditService } from '../audit/audit.service';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { OwnerPermissionCode } from '../owner-access/owner-permissions';
import type { OwnerAccessContext } from '../security/security-context';

const WRITABLE = new Set<BookingStatus>([
  BookingStatus.AWAITING_OWNER,
  BookingStatus.CAPTURE_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.READY_FOR_PICKUP,
  BookingStatus.ACTIVE,
  BookingStatus.RETURN_PENDING,
  BookingStatus.RETURNED,
  BookingStatus.COMPLETED,
]);

@Injectable()
export class CommunicationsService {
  private readonly completedWindowDays: number;
  private readonly maxLength: number;
  private readonly ratePerMinute: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ownerAccess: OwnerAccessService,
    @Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>,
  ) {
    this.completedWindowDays = configuration.getOrThrow('POST_RENTAL_MESSAGING_DAYS', {
      infer: true,
    });
    this.maxLength = configuration.getOrThrow('MESSAGE_MAX_LENGTH', { infer: true });
    this.ratePerMinute = configuration.getOrThrow('MESSAGE_RATE_LIMIT_PER_MINUTE', { infer: true });
  }

  async list(
    userId: string,
    query: { cursor?: string; limit: number; audience?: 'RENTER' | 'OWNER' },
  ) {
    return this.listForParticipant(userId, query);
  }

  async listForOwnerAccess(
    context: OwnerAccessContext,
    query: { cursor?: string; limit: number; audience?: 'RENTER' | 'OWNER' },
  ) {
    const vehicle = this.ownerAccess.vehicleWhere(context, 'messages.view');
    const owner = await this.database.client.ownerProfile.findUniqueOrThrow({
      select: { userId: true },
      where: { id: context.ownerProfileId },
    });
    return this.listForParticipant(owner.userId, { ...query, audience: 'OWNER' }, { vehicle });
  }

  private async listForParticipant(
    userId: string,
    query: { cursor?: string; limit: number; audience?: 'RENTER' | 'OWNER' },
    booking?: Prisma.BookingWhereInput,
  ) {
    const contexts = query.audience
      ? [ConversationParticipantContext[query.audience], ConversationParticipantContext.SUPPORT]
      : undefined;
    const rows = await this.database.client.conversation.findMany({
      where: {
        ...(booking ? { booking } : {}),
        participants: {
          some: { userId, leftAt: null, ...(contexts ? { context: { in: contexts } } : {}) },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        booking: {
          select: {
            publicReference: true,
            status: true,
            vehicle: { select: { make: true, model: true } },
          },
        },
        participants: {
          select: {
            userId: true,
            context: true,
            lastReadAt: true,
            user: { select: { profile: { select: { firstName: true, lastName: true } } } },
          },
        },
        messages: { orderBy: [{ createdAt: 'desc' }], take: 1 },
      },
    });
    const page = rows.slice(0, query.limit);
    const unread = await Promise.all(
      page.map((conversation) => {
        const participant = conversation.participants.find((item) => item.userId === userId);
        return this.database.client.message.count({
          where: {
            conversationId: conversation.id,
            senderUserId: { not: userId },
            ...(participant?.lastReadAt ? { createdAt: { gt: participant.lastReadAt } } : {}),
          },
        });
      }),
    );
    return {
      items: page.map((row, index) => ({
        ...row,
        messages: row.messages.map(this.publicMessage),
        unreadCount: unread[index],
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async context(userId: string, conversationId: string) {
    const participant = await this.database.client.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { context: true, leftAt: true },
    });
    if (!participant || participant.leftAt)
      throw new ApplicationException(
        'CONVERSATION_NOT_FOUND',
        'Conversation not found.',
        HttpStatus.NOT_FOUND,
      );
    return { context: participant.context };
  }

  async contextForOwnerAccess(context: OwnerAccessContext, conversationId: string) {
    const authority = await this.workspaceConversation(context, conversationId, 'messages.view');
    return { context: ConversationParticipantContext.OWNER, ownerUserId: authority.ownerUserId };
  }

  async detail(userId: string, conversationId: string, audience?: 'RENTER' | 'OWNER') {
    const conversation = await this.requireParticipant(userId, conversationId, audience);
    return {
      ...conversation,
      canSend: await this.canWrite(conversation.bookingId, conversation.status),
    };
  }

  async detailForOwnerAccess(context: OwnerAccessContext, conversationId: string) {
    const authority = await this.workspaceConversation(context, conversationId, 'messages.view');
    return this.detail(authority.ownerUserId, conversationId, 'OWNER');
  }

  async messages(
    userId: string,
    conversationId: string,
    query: { cursor?: string; limit: number },
    audience?: 'RENTER' | 'OWNER',
  ) {
    await this.requireParticipant(userId, conversationId, audience);
    const rows = await this.database.client.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { sender: { select: { profile: { select: { firstName: true, lastName: true } } } } },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(this.publicMessage).reverse(),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async messagesForOwnerAccess(
    context: OwnerAccessContext,
    conversationId: string,
    query: { cursor?: string; limit: number },
  ) {
    const authority = await this.workspaceConversation(context, conversationId, 'messages.view');
    return this.messages(authority.ownerUserId, conversationId, query, 'OWNER');
  }

  async send(
    userId: string,
    conversationId: string,
    body: string,
    replyToMessageId: string | undefined,
    idempotencyKey: string,
    request: RequestMetadata,
    audience?: 'RENTER' | 'OWNER',
  ) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    const trimmed = body.trim();
    if (!trimmed || trimmed.length > this.maxLength)
      throw new ApplicationException(
        'MESSAGE_INVALID',
        `Message must contain 1 to ${this.maxLength} characters.`,
        HttpStatus.BAD_REQUEST,
      );
    const conversation = await this.requireParticipant(userId, conversationId, audience);
    if (!(await this.canWrite(conversation.bookingId, conversation.status)))
      throw new ApplicationException(
        'CONVERSATION_READ_ONLY',
        'This conversation is read-only.',
        HttpStatus.CONFLICT,
      );
    const recent = await this.database.client.message.count({
      where: { senderUserId: userId, createdAt: { gte: new Date(Date.now() - 60_000) } },
    });
    if (recent >= this.ratePerMinute)
      throw new ApplicationException(
        'MESSAGE_RATE_LIMITED',
        'Message rate limit exceeded. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (replyToMessageId) {
      const reply = await this.database.client.message.findUnique({
        where: { id: replyToMessageId },
        select: { conversationId: true },
      });
      if (!reply || reply.conversationId !== conversationId)
        throw new ApplicationException(
          'MESSAGE_REPLY_INVALID',
          'Reply target does not belong to this conversation.',
          HttpStatus.BAD_REQUEST,
        );
    }
    const recipient = conversation.participants.find(
      (participant) => participant.userId !== userId,
    )?.userId;
    try {
      const message = await this.database.client.$transaction(async (transaction) => {
        const created = await transaction.message.create({
          data: {
            body: trimmed,
            conversationId,
            idempotencyKey,
            senderUserId: userId,
            ...(replyToMessageId ? { replyToMessageId } : {}),
          },
        });
        if (recipient)
          await transaction.outboxEvent.create({
            data: {
              aggregateId: conversation.bookingId,
              aggregateType: 'BOOKING',
              eventType: 'NEW_MESSAGE',
              payload: {
                bookingId: conversation.bookingId,
                conversationId,
                messageId: created.id,
                recipientUserId: recipient,
              },
            },
          });
        await transaction.analyticsEvent.create({
          data: {
            eventType: 'MESSAGE_SENT',
            userId,
            bookingId: conversation.bookingId,
            metadata: {
              conversationId,
              ...(request.correlationId ? { correlationId: request.correlationId } : {}),
            },
          },
        });
        return created;
      });
      return this.publicMessage(message);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.database.client.message.findUnique({
          where: {
            conversationId_senderUserId_idempotencyKey: {
              conversationId,
              senderUserId: userId,
              idempotencyKey,
            },
          },
        });
        if (existing) return this.publicMessage(existing);
      }
      throw error;
    }
  }

  async sendForOwnerAccess(input: {
    readonly actorUserId: string;
    readonly body: string;
    readonly context: OwnerAccessContext;
    readonly conversationId: string;
    readonly idempotencyKey: string;
    readonly replyToMessageId?: string;
    readonly request: RequestMetadata;
  }) {
    const authority = await this.workspaceConversation(
      input.context,
      input.conversationId,
      'messages.reply',
    );
    const message = await this.send(
      authority.ownerUserId,
      input.conversationId,
      input.body,
      input.replyToMessageId,
      input.idempotencyKey,
      input.request,
      'OWNER',
    );
    await this.ownerAccess.auditDelegatedAction({
      action: 'BOOKING_MESSAGE_SENT',
      actorUserId: input.actorUserId,
      context: input.context,
      permission: 'messages.reply',
      request: input.request,
      targetId: message.id,
      targetType: 'MESSAGE',
      vehicleId: authority.vehicleId,
    });
    return message;
  }

  async markRead(
    userId: string,
    conversationId: string,
    messageId: string,
    audience?: 'RENTER' | 'OWNER',
  ) {
    await this.requireParticipant(userId, conversationId, audience);
    const message = await this.database.client.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, createdAt: true },
    });
    if (!message || message.conversationId !== conversationId)
      throw new ApplicationException(
        'MESSAGE_NOT_FOUND',
        'Message not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.database.client.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: message.createdAt, lastReadMessageId: messageId },
    });
    return { conversationId, messageId, readAt: message.createdAt };
  }

  async markReadForOwnerAccess(
    context: OwnerAccessContext,
    conversationId: string,
    messageId: string,
  ) {
    const authority = await this.workspaceConversation(context, conversationId, 'messages.view');
    return this.markRead(authority.ownerUserId, conversationId, messageId, 'OWNER');
  }

  async report(
    userId: string,
    input: {
      targetType: 'MESSAGE' | 'REVIEW' | 'USER';
      targetId: string;
      reason: string;
      details?: string;
    },
  ) {
    if (input.targetType === 'MESSAGE') {
      const message = await this.database.client.message.findUnique({
        where: { id: input.targetId },
        select: { conversationId: true },
      });
      if (!message)
        throw new ApplicationException(
          'REPORT_TARGET_NOT_FOUND',
          'Report target not found.',
          HttpStatus.NOT_FOUND,
        );
      await this.requireParticipant(userId, message.conversationId);
    } else if (input.targetType === 'REVIEW') {
      const exists = await this.database.client.review.count({ where: { id: input.targetId } });
      if (!exists)
        throw new ApplicationException(
          'REPORT_TARGET_NOT_FOUND',
          'Report target not found.',
          HttpStatus.NOT_FOUND,
        );
    } else {
      if (input.targetId === userId)
        throw new ApplicationException(
          'REPORT_TARGET_INVALID',
          'You cannot report your own account.',
          HttpStatus.BAD_REQUEST,
        );
      const exists = await this.database.client.user.count({ where: { id: input.targetId } });
      if (!exists)
        throw new ApplicationException(
          'REPORT_TARGET_NOT_FOUND',
          'Report target not found.',
          HttpStatus.NOT_FOUND,
        );
    }
    return this.database.client.moderationReport.create({
      data: {
        reporterUserId: userId,
        targetType: input.targetType as ModerationTargetType,
        reason: input.reason.trim(),
        ...(input.details ? { details: input.details.trim() } : {}),
        ...(input.targetType === 'MESSAGE'
          ? { messageId: input.targetId }
          : input.targetType === 'REVIEW'
            ? { reviewId: input.targetId }
            : { reportedUserId: input.targetId }),
      },
    });
  }

  async moderateMessage(
    adminUserId: string,
    messageId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    const report = await this.database.client.moderationReport.findFirst({ where: { messageId } });
    if (!report)
      throw new ApplicationException(
        'MODERATION_REPORT_REQUIRED',
        'Only reported messages can be moderated.',
        HttpStatus.CONFLICT,
      );
    const message = await this.database.client.message.update({
      where: { id: messageId },
      data: {
        moderationStatus: MessageModerationStatus.TOMBSTONED,
        tombstonedAt: new Date(),
        tombstoneReason: reason.trim(),
        moderatedByUserId: adminUserId,
      },
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'MESSAGE_TOMBSTONED',
      targetType: 'MESSAGE',
      targetId: messageId,
      reason,
      metadata: { moderationReportId: report.id },
      request,
    });
    return message;
  }

  private async requireParticipant(
    userId: string,
    conversationId: string,
    audience?: 'RENTER' | 'OWNER',
  ) {
    const contexts = audience
      ? [ConversationParticipantContext[audience], ConversationParticipantContext.SUPPORT]
      : undefined;
    const conversation = await this.database.client.conversation.findFirst({
      where: {
        id: conversationId,
        participants: {
          some: { userId, leftAt: null, ...(contexts ? { context: { in: contexts } } : {}) },
        },
      },
      include: {
        booking: {
          select: {
            publicReference: true,
            status: true,
            vehicle: { select: { make: true, model: true } },
          },
        },
        participants: { select: { userId: true, context: true } },
      },
    });
    if (!conversation)
      throw new ApplicationException(
        'CONVERSATION_NOT_FOUND',
        'Conversation not found.',
        HttpStatus.NOT_FOUND,
      );
    return conversation;
  }

  private async workspaceConversation(
    context: OwnerAccessContext,
    conversationId: string,
    permission: OwnerPermissionCode,
  ) {
    const vehicle = this.ownerAccess.vehicleWhere(context, permission);
    const conversation = await this.database.client.conversation.findFirst({
      select: {
        booking: { select: { ownerUserId: true, publicReference: true, vehicleId: true } },
        id: true,
      },
      where: { booking: { vehicle }, id: conversationId },
    });
    if (!conversation)
      throw new ApplicationException(
        'CONVERSATION_NOT_FOUND',
        'Conversation not found.',
        HttpStatus.NOT_FOUND,
      );
    return {
      bookingReference: conversation.booking.publicReference,
      ownerUserId: conversation.booking.ownerUserId,
      vehicleId: conversation.booking.vehicleId,
    };
  }

  private async canWrite(
    bookingId: string,
    conversationStatus: ConversationStatus,
  ): Promise<boolean> {
    if (conversationStatus !== ConversationStatus.ACTIVE) return false;
    const booking = await this.database.client.booking.findUnique({
      where: { id: bookingId },
      select: { status: true },
    });
    if (!booking || !WRITABLE.has(booking.status)) return false;
    if (booking.status !== BookingStatus.COMPLETED) return true;
    const completed = await this.database.client.bookingStatusHistory.findFirst({
      where: { bookingId, toStatus: BookingStatus.COMPLETED },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    return Boolean(
      completed &&
      completed.occurredAt.getTime() + this.completedWindowDays * 86_400_000 >= Date.now(),
    );
  }

  private readonly publicMessage = <
    T extends {
      body: string;
      moderationStatus: MessageModerationStatus;
      tombstonedAt: Date | null;
    },
  >(
    message: T,
  ) => ({
    ...message,
    body:
      message.moderationStatus === MessageModerationStatus.VISIBLE && !message.tombstonedAt
        ? message.body
        : '[Message removed by moderation]',
  });
}
