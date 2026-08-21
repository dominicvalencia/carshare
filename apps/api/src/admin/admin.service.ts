import { HttpStatus, Injectable } from '@nestjs/common';
import { OwnerProfileStatus, UserStatus, VerificationStatus } from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { SecurityEventService } from '../security/security-event.service';
import type { RequestMetadata } from '../security/security-context';

@Injectable()
export class AdminService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly events: SecurityEventService,
  ) {}

  listUsers(query?: string) {
    const value = query?.trim().toLowerCase();
    return this.database.client.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        email: true,
        id: true,
        mobileNumber: true,
        ownerProfile: { select: { status: true } },
        profile: true,
        roles: { select: { role: { select: { code: true } } } },
        status: true,
      },
      take: 100,
      ...(value
        ? {
            where: {
              OR: [
                { normalizedEmail: { contains: value } },
                { normalizedMobileNumber: { contains: value } },
              ],
            },
          }
        : {}),
    });
  }

  user(id: string) {
    return this.database.client.user.findUniqueOrThrow({
      where: { id },
      include: {
        ownerProfile: true,
        profile: true,
        roles: { include: { role: true } },
        sessions: true,
      },
      omit: { passwordHash: true },
    });
  }

  async changeUserStatus(
    id: string,
    status: UserStatus,
    reason: string,
    actorUserId: string,
    request: RequestMetadata,
  ) {
    if (id === actorUserId && status !== UserStatus.ACTIVE) {
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'Administrators cannot suspend their own account.',
        HttpStatus.CONFLICT,
      );
    }
    const user = await this.database.client.user.update({ data: { status }, where: { id } });
    if (status !== UserStatus.ACTIVE) {
      await this.database.client.session.updateMany({
        data: { revocationReason: `ACCOUNT_${status}`, revokedAt: new Date() },
        where: { revokedAt: null, userId: id },
      });
    }
    await this.audit.record({
      action: 'USER_STATUS_CHANGED',
      actorUserId,
      reason,
      request,
      targetId: id,
      targetType: 'USER',
      metadata: { status },
    });
    return { id: user.id, status: user.status };
  }

  listOwners(status?: OwnerProfileStatus) {
    return this.database.client.ownerProfile.findMany({
      include: { user: { include: { profile: true } }, verifications: true },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      ...(status ? { where: { status } } : {}),
    });
  }

  owner(id: string) {
    return this.database.client.ownerProfile.findUniqueOrThrow({
      where: { id },
      include: {
        user: { include: { profile: true } },
        verifications: { include: { documents: { include: { fileAsset: true } } } },
      },
    });
  }

  async approveOwner(id: string, actorUserId: string, request: RequestMetadata) {
    const owner = await this.database.client.ownerProfile.findUniqueOrThrow({ where: { id } });
    if (owner.status !== OwnerProfileStatus.PENDING_VERIFICATION) {
      throw new ApplicationException(
        IdentityErrorCode.OWNER_ALREADY_VERIFIED,
        'Only pending owner profiles can be approved.',
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date();
    const updated = await this.database.client.$transaction(async (transaction) => {
      await transaction.verification.updateMany({
        data: {
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          status: VerificationStatus.VERIFIED,
        },
        where: { ownerProfileId: id, status: VerificationStatus.PENDING },
      });
      return transaction.ownerProfile.update({
        data: { rejectionReason: null, status: OwnerProfileStatus.VERIFIED, verifiedAt: now },
        where: { id },
      });
    });
    await this.audit.record({
      action: 'OWNER_VERIFIED',
      actorUserId,
      request,
      targetId: id,
      targetType: 'OWNER_PROFILE',
    });
    await this.events.record('OWNER_VERIFIED', { ...request, userId: owner.userId });
    return updated;
  }

  async rejectOwner(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    const owner = await this.database.client.ownerProfile.findUniqueOrThrow({ where: { id } });
    if (owner.status !== OwnerProfileStatus.PENDING_VERIFICATION) {
      throw new ApplicationException(
        'OWNER_NOT_PENDING',
        'Only pending owner profiles can be rejected.',
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date();
    const updated = await this.database.client.$transaction(async (transaction) => {
      await transaction.verification.updateMany({
        data: {
          rejectionReason: reason,
          reviewedAt: now,
          reviewedByUserId: actorUserId,
          status: VerificationStatus.REJECTED,
        },
        where: { ownerProfileId: id, status: VerificationStatus.PENDING },
      });
      return transaction.ownerProfile.update({
        data: { rejectedAt: now, rejectionReason: reason, status: OwnerProfileStatus.REJECTED },
        where: { id },
      });
    });
    await this.audit.record({
      action: 'OWNER_REJECTED',
      actorUserId,
      reason,
      request,
      targetId: id,
      targetType: 'OWNER_PROFILE',
    });
    await this.events.record('OWNER_REJECTED', { ...request, userId: owner.userId });
    return updated;
  }

  async suspendOwner(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    const owner = await this.database.client.ownerProfile.update({
      data: {
        status: OwnerProfileStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspensionReason: reason,
      },
      where: { id },
    });
    await this.audit.record({
      action: 'OWNER_SUSPENDED',
      actorUserId,
      reason,
      request,
      targetId: id,
      targetType: 'OWNER_PROFILE',
    });
    await this.events.record('OWNER_SUSPENDED', { ...request, userId: owner.userId });
    return owner;
  }

  auditLogs() {
    return this.database.client.auditLog.findMany({ orderBy: { occurredAt: 'desc' }, take: 200 });
  }
}
