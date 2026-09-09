import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminStatus, RoleCode, UserStatus, type Prisma } from '@carrental/database';
import type { ApiEnvironment } from '@carrental/config';
import { ApplicationException } from '../common/errors/application.exception';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { EmailProvider } from '../providers/delivery.provider';
import { DevelopmentDeliveryInbox } from '../providers/development-delivery.provider';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata, RequestPrincipal } from '../security/security-context';
import { TokenService } from '../auth/token.service';
import {
  ADMIN_PERMISSIONS,
  STAFF_PERMISSION_PROFILES,
  SUPER_ADMIN_DEFAULT_PERMISSIONS,
  assertPermissionCodes,
} from './admin-permissions';
import type { AdminStaffQueryDto, CreateAdminStaffDto, UpdateAdminStaffDto } from './admin.dto';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminStaffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly email: EmailProvider,
    private readonly developmentInbox: DevelopmentDeliveryInbox,
    private readonly audit: AuditService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async completeLogin(credentialUserId: string) {
    const admin = await this.database.client.adminUser.findUnique({
      where: { credentialUserId },
      select: this.safeAdminSelect(),
    });
    if (!admin || admin.status !== AdminStatus.ACTIVE)
      throw this.denied('Administrative access is unavailable.');
    await this.database.client.adminUser.update({
      data: { lastLoginAt: new Date() },
      where: { id: admin.id },
    });
    return this.publicIdentity(admin);
  }

  async me(adminUserId: string) {
    const admin = await this.detail(adminUserId);
    return this.publicIdentity(admin);
  }

  list(query: AdminStaffQueryDto) {
    const search = query.query?.trim().toLowerCase();
    return this.database.client.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      where: {
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: [
                { normalizedEmail: { contains: search } },
                { displayName: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: this.safeAdminSelect(),
      take: 100,
    });
  }

  detail(id: string) {
    return this.database.client.adminUser.findUniqueOrThrow({
      where: { id },
      select: this.safeAdminSelect(),
    });
  }

  async create(input: CreateAdminStaffDto, actor: RequestPrincipal, request: RequestMetadata) {
    this.assertCanManageRole(actor, input.role);
    assertPermissionCodes(input.permissions);
    const normalizedEmail = input.email.trim().toLowerCase();
    const duplicate = await this.database.client.user.findUnique({ where: { normalizedEmail } });
    if (duplicate) throw this.conflict('An account already uses this email address.');
    const legacyAdminRole = await this.database.client.role.findUniqueOrThrow({
      where: { code: RoleCode.ADMIN },
    });
    const permissionRows = await this.permissionRows(input.permissions);
    const invitationId = randomUUID();
    const invitationToken = this.tokens.opaqueToken(invitationId);
    const now = new Date();
    const created = await this.database.client.$transaction(async (transaction) => {
      const credential = await transaction.user.create({
        data: {
          email: input.email.trim(),
          emailVerifiedAt: now,
          normalizedEmail,
          roles: { create: { assignedBy: actor.userId, roleId: legacyAdminRole.id } },
          status: UserStatus.ACTIVE,
        },
      });
      return transaction.adminUser.create({
        data: {
          credentialUserId: credential.id,
          createdByAdminId: actor.adminUserId!,
          displayName: input.displayName.trim(),
          email: input.email.trim(),
          invitedAt: now,
          normalizedEmail,
          role: input.role,
          status: AdminStatus.INVITED,
          permissions: {
            create: permissionRows.map(({ id }) => ({
              assignedByAdminId: actor.adminUserId!,
              permissionId: id,
            })),
          },
          invitations: {
            create: {
              createdByAdminId: actor.adminUserId!,
              expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
              id: invitationId,
              tokenHash: invitationToken.hash,
            },
          },
        },
        select: this.safeAdminSelect(),
      });
    });
    await this.sendInvitation(created.email, invitationToken.raw, created.displayName);
    await this.audit.recordAdmin({
      action: 'STAFF_INVITED',
      actorUserId: actor.userId,
      entityId: created.id,
      entityType: 'ADMIN_USER',
      newState: this.auditState(created),
      request,
    });
    return created;
  }

  async update(
    id: string,
    input: UpdateAdminStaffDto,
    actor: RequestPrincipal,
    request: RequestMetadata,
  ) {
    const target = await this.requireMutableTarget(id, actor);
    const nextRole = input.role ?? target.role;
    this.assertCanManageRole(actor, nextRole);
    if (input.permissions) assertPermissionCodes(input.permissions);
    const before = this.auditState(target);
    const permissionRows = input.permissions ? await this.permissionRows(input.permissions) : [];
    const updated = await this.database.client.$transaction(async (transaction) => {
      if (input.permissions) {
        await transaction.adminUserPermission.deleteMany({ where: { adminUserId: id } });
        if (permissionRows.length)
          await transaction.adminUserPermission.createMany({
            data: permissionRows.map(({ id: permissionId }) => ({
              adminUserId: id,
              assignedByAdminId: actor.adminUserId!,
              permissionId,
            })),
          });
      }
      return transaction.adminUser.update({
        data: {
          ...(input.displayName ? { displayName: input.displayName.trim() } : {}),
          ...(input.role ? { role: input.role } : {}),
        },
        where: { id },
        select: this.safeAdminSelect(),
      });
    });
    await this.revokeSessions(updated.credentialUserId, 'ADMIN_ACCESS_CHANGED');
    await this.audit.recordAdmin({
      action:
        input.permissions && input.role
          ? 'STAFF_ROLE_AND_PERMISSIONS_CHANGED'
          : input.permissions
            ? 'STAFF_PERMISSIONS_CHANGED'
            : 'STAFF_ROLE_CHANGED',
      actorUserId: actor.userId,
      entityId: id,
      entityType: 'ADMIN_USER',
      newState: this.auditState(updated),
      previousState: before,
      request,
    });
    return updated;
  }

  suspend(id: string, reason: string, actor: RequestPrincipal, request: RequestMetadata) {
    return this.changeStatus(id, AdminStatus.SUSPENDED, reason, actor, request);
  }

  reactivate(id: string, actor: RequestPrincipal, request: RequestMetadata) {
    return this.changeStatus(id, AdminStatus.ACTIVE, undefined, actor, request);
  }

  disable(id: string, reason: string, actor: RequestPrincipal, request: RequestMetadata) {
    return this.changeStatus(id, AdminStatus.DISABLED, reason, actor, request);
  }

  async resendInvitation(id: string, actor: RequestPrincipal, request: RequestMetadata) {
    const target = await this.requireMutableTarget(id, actor);
    if (target.status !== AdminStatus.INVITED)
      throw this.conflict('Only invited staff can be reissued an invitation.');
    const invitationId = randomUUID();
    const token = this.tokens.opaqueToken(invitationId);
    const now = new Date();
    await this.database.client.$transaction([
      this.database.client.adminInvitation.updateMany({
        data: { revokedAt: now },
        where: { adminUserId: id, consumedAt: null, revokedAt: null },
      }),
      this.database.client.adminInvitation.create({
        data: {
          adminUserId: id,
          createdByAdminId: actor.adminUserId!,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          id: invitationId,
          tokenHash: token.hash,
        },
      }),
    ]);
    await this.sendInvitation(target.email, token.raw, target.displayName);
    await this.audit.recordAdmin({
      action: 'STAFF_INVITATION_REISSUED',
      actorUserId: actor.userId,
      entityId: id,
      entityType: 'ADMIN_USER',
      request,
    });
    return { id, status: target.status };
  }

  async revokeInvitation(id: string, actor: RequestPrincipal, request: RequestMetadata) {
    const target = await this.requireMutableTarget(id, actor);
    if (target.status !== AdminStatus.INVITED)
      throw this.conflict('Only pending invitations can be revoked.');
    await this.database.client.adminInvitation.updateMany({
      data: { revokedAt: new Date() },
      where: { adminUserId: id, consumedAt: null, revokedAt: null },
    });
    await this.audit.recordAdmin({
      action: 'STAFF_INVITATION_REVOKED',
      actorUserId: actor.userId,
      entityId: id,
      entityType: 'ADMIN_USER',
      request,
    });
    return { id, status: target.status };
  }

  async localInvitationLink(id: string, actor: RequestPrincipal) {
    if (
      actor.adminRole !== AdminRole.OWNER ||
      !isLocalInvitationExposureAllowed(
        this.configuration.getOrThrow('APP_ENV', { infer: true }),
        this.configuration.getOrThrow('EMAIL_PROVIDER', { infer: true }),
      )
    )
      throw new ApplicationException(
        'LOCAL_INVITATION_UNAVAILABLE',
        'Local invitation retrieval is unavailable.',
        HttpStatus.NOT_FOUND,
      );
    const target = await this.database.client.adminUser.findUniqueOrThrow({
      where: { id },
      select: { email: true, status: true },
    });
    if (target.status !== AdminStatus.INVITED) throw this.invalidInvitation();
    const delivery = this.developmentInbox.latest(target.email, 'STAFF_INVITATION');
    const invitationId = delivery ? this.tokens.parseOpaqueId(delivery.secret) : undefined;
    if (!delivery || !invitationId) throw this.invalidInvitation();
    const invitation = await this.database.client.adminInvitation.findUnique({
      where: { id: invitationId },
      include: { adminUser: true },
    });
    if (
      !invitation ||
      invitation.adminUserId !== id ||
      !isUsableAdminInvitation(
        invitation,
        this.crypto.secureEqual(invitation.tokenHash, this.tokens.hashOpaque(delivery.secret)),
        new Date(),
      )
    )
      throw this.invalidInvitation();
    return {
      url: `${this.configuration.getOrThrow('ADMIN_PUBLIC_URL', { infer: true })}/staff-invitation?token=${encodeURIComponent(delivery.secret)}`,
    };
  }

  async activate(rawToken: string, password: string, request: RequestMetadata) {
    this.crypto.assertPasswordPolicy(password);
    const invitationId = this.tokens.parseOpaqueId(rawToken);
    if (!invitationId) throw this.invalidInvitation();
    const invitation = await this.database.client.adminInvitation.findUnique({
      where: { id: invitationId },
      include: { adminUser: true },
    });
    if (
      !invitation ||
      !isUsableAdminInvitation(
        invitation,
        this.crypto.secureEqual(invitation.tokenHash, this.tokens.hashOpaque(rawToken)),
        new Date(),
      )
    )
      throw this.invalidInvitation();
    const now = new Date();
    const passwordHash = await this.crypto.hashPassword(password);
    await this.database.client.$transaction(async (transaction) => {
      const consumed = await transaction.adminInvitation.updateMany({
        data: { consumedAt: now },
        where: { consumedAt: null, id: invitation.id, revokedAt: null },
      });
      if (consumed.count !== 1) throw this.invalidInvitation();
      await transaction.adminInvitation.updateMany({
        data: { revokedAt: now },
        where: { adminUserId: invitation.adminUserId, consumedAt: null, revokedAt: null },
      });
      await transaction.user.update({
        data: { passwordHash },
        where: { id: invitation.adminUser.credentialUserId },
      });
      await transaction.adminUser.update({
        data: { activatedAt: now, passwordChangedAt: now, status: AdminStatus.ACTIVE },
        where: { id: invitation.adminUserId },
      });
    });
    await this.audit.recordAdmin({
      action: 'STAFF_ACTIVATED',
      actorUserId: invitation.adminUser.credentialUserId,
      entityId: invitation.adminUserId,
      entityType: 'ADMIN_USER',
      request,
    });
    return { activated: true };
  }

  permissions() {
    return {
      permissions: ADMIN_PERMISSIONS,
      profiles: STAFF_PERMISSION_PROFILES,
      superAdminDefaults: SUPER_ADMIN_DEFAULT_PERMISSIONS,
    };
  }

  auditLogs(filters: { actorAdminId?: string; action?: string; entityType?: string }) {
    return this.database.client.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      where: {
        ...(filters.actorAdminId ? { actorAdminId: filters.actorAdminId } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(filters.entityType ? { entityType: filters.entityType } : {}),
      },
      select: {
        action: true,
        actor: { select: { displayName: true, id: true, role: true } },
        actorRole: true,
        createdAt: true,
        entityId: true,
        entityType: true,
        id: true,
        newState: true,
        previousState: true,
        reason: true,
        requestCorrelationId: true,
      },
    });
  }

  private async changeStatus(
    id: string,
    status: AdminStatus,
    reason: string | undefined,
    actor: RequestPrincipal,
    request: RequestMetadata,
  ) {
    const target = await this.requireMutableTarget(id, actor);
    const before = this.auditState(target);
    const now = new Date();
    await this.database.client.adminUser.update({
      data: {
        status,
        ...(status === AdminStatus.SUSPENDED
          ? {
              suspendedAt: now,
              suspendedByAdminId: actor.adminUserId!,
              ...(reason ? { suspensionReason: reason } : {}),
            }
          : { suspendedAt: null, suspendedByAdminId: null, suspensionReason: null }),
        ...(status === AdminStatus.DISABLED
          ? { disabledAt: now, disabledByAdminId: actor.adminUserId }
          : {}),
      },
      where: { id },
    });
    const updated = await this.detail(id);
    if (status !== AdminStatus.ACTIVE)
      await this.revokeSessions(target.credentialUserId, `ADMIN_${status}`);
    await this.audit.recordAdmin({
      action: `STAFF_${status === AdminStatus.ACTIVE ? 'REACTIVATED' : status}`,
      actorUserId: actor.userId,
      entityId: id,
      entityType: 'ADMIN_USER',
      newState: this.auditState(updated),
      previousState: before,
      ...(reason ? { reason } : {}),
      request,
    });
    return updated;
  }

  private async requireMutableTarget(id: string, actor: RequestPrincipal) {
    const target = await this.database.client.adminUser.findUniqueOrThrow({
      where: { id },
      select: this.safeAdminSelect(),
    });
    if (target.role === AdminRole.OWNER)
      throw this.denied('The OWNER account cannot be modified through staff management.');
    if (actor.adminRole === AdminRole.STAFF || !actor.adminUserId)
      throw this.denied('Staff management is not permitted.');
    if (actor.adminRole === AdminRole.SUPER_ADMIN && target.role !== AdminRole.STAFF)
      throw this.denied('SUPER_ADMIN may manage STAFF accounts only.');
    if (target.id === actor.adminUserId)
      throw this.denied('Administrators cannot modify their own access here.');
    return target;
  }

  private assertCanManageRole(actor: RequestPrincipal, role: AdminRole) {
    if (!actor.adminUserId || actor.adminRole === AdminRole.STAFF)
      throw this.denied('Staff management is not permitted.');
    if (role === AdminRole.OWNER)
      throw this.denied('OWNER accounts cannot be created through staff management.');
    if (actor.adminRole === AdminRole.SUPER_ADMIN && role !== AdminRole.STAFF)
      throw this.denied('SUPER_ADMIN may create or assign STAFF only.');
  }

  private permissionRows(codes: readonly string[]) {
    return this.database.client.adminPermission
      .findMany({ where: { code: { in: [...codes] } }, select: { id: true } })
      .then((rows) => {
        if (rows.length !== codes.length)
          throw this.denied('One or more permissions are not assignable.');
        return rows;
      });
  }

  private sendInvitation(to: string, token: string, displayName: string) {
    const actionUrl = `${this.configuration.getOrThrow('ADMIN_PUBLIC_URL', { infer: true })}/staff-invitation?token=${encodeURIComponent(token)}`;
    return this.email.send({
      actionUrl,
      template: 'STAFF_INVITATION',
      to,
      token,
      variables: { display_name: displayName, expires_hours: 24 },
    });
  }

  private revokeSessions(userId: string, reason: string) {
    return this.database.client.session.updateMany({
      data: { revocationReason: reason, revokedAt: new Date() },
      where: { revokedAt: null, userId },
    });
  }

  private safeAdminSelect() {
    return {
      activatedAt: true,
      createdAt: true,
      createdBy: { select: { displayName: true, id: true } },
      credentialUserId: true,
      disabledAt: true,
      displayName: true,
      email: true,
      id: true,
      invitedAt: true,
      lastLoginAt: true,
      permissions: {
        select: { permission: { select: { code: true } } },
        orderBy: { permission: { code: 'asc' as const } },
      },
      role: true,
      status: true,
      suspendedAt: true,
      suspensionReason: true,
      updatedAt: true,
    } satisfies Prisma.AdminUserSelect;
  }

  private auditState(value: {
    role: AdminRole;
    status: AdminStatus;
    permissions: readonly { permission: { code: string } }[];
  }) {
    return {
      permissions: value.permissions.map(({ permission }) => permission.code),
      role: value.role,
      status: value.status,
    };
  }

  private publicIdentity(value: Awaited<ReturnType<AdminStaffService['detail']>>) {
    return {
      ...value,
      permissions:
        value.role === AdminRole.OWNER
          ? Object.keys(ADMIN_PERMISSIONS)
          : value.permissions.map(({ permission }) => permission.code),
    };
  }

  private denied(message: string) {
    return new ApplicationException('ADMIN_PERMISSION_DENIED', message, HttpStatus.FORBIDDEN);
  }

  private conflict(message: string) {
    return new ApplicationException('ADMIN_STAFF_CONFLICT', message, HttpStatus.CONFLICT);
  }

  private invalidInvitation() {
    return new ApplicationException(
      'ADMIN_INVITATION_INVALID',
      'This invitation is invalid or expired.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export function isUsableAdminInvitation(
  invitation: {
    readonly consumedAt: Date | null;
    readonly revokedAt: Date | null;
    readonly expiresAt: Date;
    readonly adminUser: { readonly status: AdminStatus };
  },
  tokenMatches: boolean,
  now: Date,
): boolean {
  return (
    tokenMatches &&
    !invitation.consumedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > now &&
    invitation.adminUser.status === AdminStatus.INVITED
  );
}

export function isLocalInvitationExposureAllowed(
  environment: string,
  emailProvider: string,
): boolean {
  return ['local', 'test'].includes(environment) && emailProvider === 'development';
}
