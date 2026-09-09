import { Injectable } from '@nestjs/common';
import type { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly reason?: string;
    readonly metadata?: Prisma.InputJsonValue;
    readonly request: RequestMetadata;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        targetId: input.targetId,
        targetType: input.targetType,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.request.correlationId ? { correlationId: input.request.correlationId } : {}),
        ...(input.request.ipAddress ? { ipAddress: input.request.ipAddress } : {}),
      },
    });
  }

  async recordAdmin(input: {
    readonly action: string;
    readonly actorUserId: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly reason?: string;
    readonly previousState?: Prisma.InputJsonValue;
    readonly newState?: Prisma.InputJsonValue;
    readonly request: RequestMetadata;
  }): Promise<void> {
    const actor = await this.database.client.adminUser.findUniqueOrThrow({
      where: { credentialUserId: input.actorUserId },
      select: { id: true, role: true },
    });
    await this.database.client.adminAuditLog.create({
      data: {
        action: input.action,
        actorAdminId: actor.id,
        actorRole: actor.role,
        entityId: input.entityId,
        entityType: input.entityType,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.previousState ? { previousState: input.previousState } : {}),
        ...(input.newState ? { newState: input.newState } : {}),
        ...(input.request.correlationId
          ? { requestCorrelationId: input.request.correlationId }
          : {}),
        ...(input.request.ipAddress ? { ipAddress: input.request.ipAddress } : {}),
        ...(input.request.userAgent ? { userAgent: input.request.userAgent.slice(0, 500) } : {}),
      },
    });
  }
}
