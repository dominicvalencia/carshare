import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ModerationReportStatus,
  Prisma,
  RoleCode,
  SupportMessageVisibility,
  SupportTicketStatus,
  UserStatus,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { ApplicationException } from '../common/errors/application.exception';
import { AuditService } from '../audit/audit.service';
import type { RequestMetadata } from '../security/security-context';

@Injectable()
export class SupportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  listUser(userId: string) {
    return this.database.client.supportTicket.findMany({
      where: { createdByUserId: userId },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        publicReference: true,
        category: true,
        priority: true,
        status: true,
        subject: true,
        lastActivityAt: true,
        createdAt: true,
      },
    });
  }

  async detailUser(userId: string, reference: string) {
    const ticket = await this.database.client.supportTicket.findFirst({
      where: { publicReference: reference, createdByUserId: userId },
      include: {
        messages: {
          where: { visibility: SupportMessageVisibility.USER_VISIBLE },
          orderBy: { createdAt: 'asc' },
          select: { id: true, body: true, createdAt: true, authorUserId: true },
        },
      },
    });
    if (!ticket)
      throw new ApplicationException(
        'SUPPORT_TICKET_NOT_FOUND',
        'Support ticket not found.',
        HttpStatus.NOT_FOUND,
      );
    return ticket;
  }

  async create(
    userId: string,
    input: {
      category: never;
      subject: string;
      message: string;
      bookingId?: string;
      paymentId?: string;
      claimId?: string;
      payoutId?: string;
      vehicleId?: string;
    },
    idempotencyKey: string,
  ) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    await this.validateContext(userId, input);
    return this.database.client.$transaction(async (transaction) => {
      const ticket = await transaction.supportTicket.create({
        data: {
          publicReference: `SUP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`,
          createdByUserId: userId,
          category: input.category,
          subject: input.subject.trim(),
          ...(input.bookingId ? { bookingId: input.bookingId } : {}),
          ...(input.paymentId ? { paymentId: input.paymentId } : {}),
          ...(input.claimId ? { claimId: input.claimId } : {}),
          ...(input.payoutId ? { payoutId: input.payoutId } : {}),
          ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
        },
      });
      await transaction.supportTicketMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: userId,
          idempotencyKey,
          body: input.message.trim(),
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: ticket.id,
          aggregateType: 'SUPPORT_TICKET',
          eventType: 'SUPPORT_TICKET_CREATED',
          payload: { ticketId: ticket.id, userId },
        },
      });
      return ticket;
    });
  }

  async addUserMessage(userId: string, reference: string, body: string, idempotencyKey: string) {
    const ticket = await this.database.client.supportTicket.findFirst({
      where: { publicReference: reference, createdByUserId: userId },
    });
    if (!ticket)
      throw new ApplicationException(
        'SUPPORT_TICKET_NOT_FOUND',
        'Support ticket not found.',
        HttpStatus.NOT_FOUND,
      );
    if (ticket.status === SupportTicketStatus.CLOSED)
      throw new ApplicationException(
        'SUPPORT_TICKET_CLOSED',
        'Closed tickets are read-only.',
        HttpStatus.CONFLICT,
      );
    return this.addMessage(
      ticket.id,
      userId,
      body,
      SupportMessageVisibility.USER_VISIBLE,
      idempotencyKey,
      userId,
    );
  }

  adminQueue(status?: SupportTicketStatus) {
    return this.database.client.supportTicket.findMany({
      where: status ? { status } : {},
      orderBy: [{ priority: 'desc' }, { lastActivityAt: 'asc' }],
      take: 200,
      include: {
        createdBy: { select: { email: true, profile: true } },
        assignedTo: { select: { email: true } },
      },
    });
  }
  async adminDetail(reference: string) {
    const ticket = await this.database.client.supportTicket.findUnique({
      where: { publicReference: reference },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { email: true } } },
        },
        createdBy: { select: { email: true, profile: true } },
        assignedTo: { select: { email: true } },
      },
    });
    if (!ticket)
      throw new ApplicationException(
        'SUPPORT_TICKET_NOT_FOUND',
        'Support ticket not found.',
        HttpStatus.NOT_FOUND,
      );
    return ticket;
  }

  async adminMessage(
    adminUserId: string,
    reference: string,
    body: string,
    visibility: SupportMessageVisibility,
    idempotencyKey: string,
    request: RequestMetadata,
  ) {
    const ticket = await this.database.client.supportTicket.findUnique({
      where: { publicReference: reference },
    });
    if (!ticket)
      throw new ApplicationException(
        'SUPPORT_TICKET_NOT_FOUND',
        'Support ticket not found.',
        HttpStatus.NOT_FOUND,
      );
    const message = await this.addMessage(
      ticket.id,
      adminUserId,
      body,
      visibility,
      idempotencyKey,
      ticket.createdByUserId,
    );
    await this.audit.record({
      actorUserId: adminUserId,
      action:
        visibility === SupportMessageVisibility.INTERNAL
          ? 'SUPPORT_INTERNAL_NOTE_ADDED'
          : 'SUPPORT_REPLY_SENT',
      targetType: 'SUPPORT_TICKET',
      targetId: ticket.id,
      request,
    });
    return message;
  }

  async update(
    adminUserId: string,
    reference: string,
    input: {
      status?: SupportTicketStatus;
      priority?: never;
      assignedToUserId?: string;
      reason: string;
    },
    request: RequestMetadata,
  ) {
    const ticket = await this.database.client.supportTicket.findUnique({
      where: { publicReference: reference },
    });
    if (!ticket)
      throw new ApplicationException(
        'SUPPORT_TICKET_NOT_FOUND',
        'Support ticket not found.',
        HttpStatus.NOT_FOUND,
      );
    if (input.assignedToUserId) {
      const staff = await this.database.client.user.findFirst({
        where: {
          id: input.assignedToUserId,
          status: UserStatus.ACTIVE,
          roles: {
            some: {
              role: { code: { in: [RoleCode.SUPPORT, RoleCode.ADMIN, RoleCode.SUPER_ADMIN] } },
            },
          },
        },
      });
      if (!staff)
        throw new ApplicationException(
          'SUPPORT_ASSIGNEE_INVALID',
          'Assignee must be active support staff.',
          HttpStatus.BAD_REQUEST,
        );
    }
    const now = new Date();
    const updated = await this.database.client.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(input.status
          ? {
              status: input.status,
              resolvedAt: input.status === SupportTicketStatus.RESOLVED ? now : ticket.resolvedAt,
              closedAt: input.status === SupportTicketStatus.CLOSED ? now : ticket.closedAt,
            }
          : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.assignedToUserId ? { assignedToUserId: input.assignedToUserId } : {}),
      },
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'SUPPORT_TICKET_UPDATED',
      targetType: 'SUPPORT_TICKET',
      targetId: ticket.id,
      reason: input.reason,
      metadata: {
        previousStatus: ticket.status,
        status: updated.status,
        priority: updated.priority,
        assignedToUserId: updated.assignedToUserId,
      },
      request,
    });
    return updated;
  }

  moderationQueue(status?: ModerationReportStatus) {
    return this.database.client.moderationReport.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: {
        reporter: { select: { email: true } },
        message: true,
        review: true,
        reportedUser: { select: { email: true, status: true } },
      },
    });
  }
  async moderationDetail(id: string) {
    const report = await this.database.client.moderationReport.findUnique({
      where: { id },
      include: {
        reporter: { select: { email: true } },
        message: true,
        review: true,
        reportedUser: { select: { email: true, status: true } },
      },
    });
    if (!report)
      throw new ApplicationException(
        'MODERATION_REPORT_NOT_FOUND',
        'Moderation report not found.',
        HttpStatus.NOT_FOUND,
      );
    return report;
  }
  async resolveReport(
    adminUserId: string,
    id: string,
    reason: string,
    outcome: 'RESOLVED' | 'DISMISSED',
    request: RequestMetadata,
  ) {
    const report = await this.moderationDetail(id);
    const updated = await this.database.client.moderationReport.update({
      where: { id },
      data: {
        status:
          outcome === 'DISMISSED'
            ? ModerationReportStatus.DISMISSED
            : ModerationReportStatus.ACTIONED,
        resolutionReason: reason.trim(),
        resolvedByUserId: adminUserId,
        resolvedAt: new Date(),
      },
    });
    await this.audit.record({
      actorUserId: adminUserId,
      action: 'MODERATION_REPORT_RESOLVED',
      targetType: 'MODERATION_REPORT',
      targetId: id,
      reason,
      metadata: { targetType: report.targetType, outcome },
      request,
    });
    return updated;
  }

  private async addMessage(
    ticketId: string,
    authorUserId: string,
    body: string,
    visibility: SupportMessageVisibility,
    idempotencyKey: string,
    recipientUserId: string,
  ) {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const message = await transaction.supportTicketMessage.create({
          data: { ticketId, authorUserId, body: body.trim(), visibility, idempotencyKey },
        });
        await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { lastActivityAt: new Date() },
        });
        if (
          visibility === SupportMessageVisibility.USER_VISIBLE &&
          recipientUserId !== authorUserId
        )
          await transaction.outboxEvent.create({
            data: {
              aggregateId: ticketId,
              aggregateType: 'SUPPORT_TICKET',
              eventType: 'SUPPORT_REPLY_ADDED',
              payload: { ticketId, messageId: message.id, recipientUserId },
            },
          });
        return message;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.database.client.supportTicketMessage.findUnique({
          where: {
            ticketId_authorUserId_idempotencyKey: { ticketId, authorUserId, idempotencyKey },
          },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async validateContext(
    userId: string,
    input: {
      bookingId?: string;
      paymentId?: string;
      claimId?: string;
      payoutId?: string;
      vehicleId?: string;
    },
  ) {
    const checks: Promise<number>[] = [];
    if (input.bookingId)
      checks.push(
        this.database.client.booking.count({
          where: { id: input.bookingId, OR: [{ renterUserId: userId }, { ownerUserId: userId }] },
        }),
      );
    if (input.paymentId)
      checks.push(
        this.database.client.payment.count({
          where: {
            id: input.paymentId,
            booking: { OR: [{ renterUserId: userId }, { ownerUserId: userId }] },
          },
        }),
      );
    if (input.claimId)
      checks.push(
        this.database.client.postReturnClaim.count({
          where: {
            id: input.claimId,
            booking: { OR: [{ renterUserId: userId }, { ownerUserId: userId }] },
          },
        }),
      );
    if (input.payoutId)
      checks.push(
        this.database.client.payout.count({
          where: { id: input.payoutId, ownerProfile: { userId } },
        }),
      );
    if (input.vehicleId)
      checks.push(
        this.database.client.vehicle.count({ where: { id: input.vehicleId, ownerUserId: userId } }),
      );
    const results = await Promise.all(checks);
    if (results.some((count) => count === 0))
      throw new ApplicationException(
        'SUPPORT_CONTEXT_FORBIDDEN',
        'One or more linked records are not available to this account.',
        HttpStatus.FORBIDDEN,
      );
  }
}
