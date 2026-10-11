import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  type Prisma,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { OwnerAccessContext, RequestMetadata } from '../security/security-context';
import { CryptoService } from '../security/crypto.service';
import { TokenService } from '../auth/token.service';
import {
  OWNER_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  type OwnerPermissionCode,
  assertAssignableOwnerPermissions,
  assertManagerTargetRole,
  assertOwnerPermissionCodes,
  withDefaultOwnerStaffPermissions,
} from './owner-permissions';

const OWNER_STAFF_INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OwnerAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
  ) {}

  async resolve(userId: string, ownerProfileId: string): Promise<OwnerAccessContext> {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: { userId: true },
      where: { id: ownerProfileId },
    });
    if (!owner) throw this.denied();
    if (owner.userId === userId)
      return {
        capacity: 'OWNER',
        membershipStatus: 'OWNER',
        ownerProfileId,
        permissions: Object.keys(OWNER_PERMISSIONS),
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      };

    const membership = await this.database.client.ownerStaffMembership.findFirst({
      include: { permissions: { include: { permission: true } } },
      where: { ownerProfileId, userId },
    });
    if (!membership || membership.status !== OwnerStaffStatus.ACTIVE) throw this.denied();
    return {
      capacity: membership.role,
      membershipId: membership.id,
      membershipStatus: membership.status,
      ownerProfileId,
      permissions: withDefaultOwnerStaffPermissions(
        membership.permissions.map(({ permission }) => permission.code),
      ),
      vehicleScopeMode: membership.vehicleScopeMode,
    };
  }

  requirePermission(context: OwnerAccessContext, permission: OwnerPermissionCode): void {
    assertOwnerPermissionCodes([permission]);
    if (context.capacity === 'OWNER' || context.permissions.includes(permission)) return;
    throw this.denied('The required Owner permission is not assigned.');
  }

  async assertVehicleAccess(
    context: OwnerAccessContext,
    vehicleId: string,
    permission: OwnerPermissionCode,
  ): Promise<void> {
    this.requirePermission(context, permission);
    const membershipId = this.scopedMembershipId(context);
    const vehicle = await this.database.client.vehicle.findFirst({
      select: { id: true },
      where: {
        id: vehicleId,
        ownerProfileId: context.ownerProfileId,
        ...(context.capacity !== 'OWNER' &&
        context.vehicleScopeMode === OwnerStaffVehicleScopeMode.SELECTED_VEHICLES
          ? { staffAssignments: { some: { membershipId } } }
          : {}),
      },
    });
    if (!vehicle) throw this.denied('The vehicle is outside this Owner workspace or assignment.');
  }

  async assertBookingAccess(
    context: OwnerAccessContext,
    reference: string,
    permission: OwnerPermissionCode,
  ) {
    const vehicle = this.vehicleWhere(context, permission);
    const booking = await this.database.client.booking.findFirst({
      select: { id: true, ownerUserId: true, publicReference: true, vehicleId: true },
      where: { publicReference: reference, vehicle },
    });
    if (!booking) throw this.denied('The rental is outside this Owner workspace or assignment.');
    return booking;
  }

  async assertClaimAccess(
    context: OwnerAccessContext,
    claimId: string,
    permission: OwnerPermissionCode,
  ) {
    const vehicle = this.vehicleWhere(context, permission);
    const claim = await this.database.client.postReturnClaim.findFirst({
      select: {
        booking: { select: { ownerUserId: true, publicReference: true, vehicleId: true } },
        id: true,
      },
      where: { booking: { vehicle }, id: claimId },
    });
    if (!claim) throw this.denied('The claim is outside this Owner workspace or assignment.');
    return { claimId: claim.id, ...claim.booking };
  }

  vehicleReadWhere(context: OwnerAccessContext): Prisma.VehicleWhereInput {
    return this.vehicleWhere(context, 'vehicles.view');
  }

  vehicleWhere(
    context: OwnerAccessContext,
    permission: OwnerPermissionCode,
  ): Prisma.VehicleWhereInput {
    this.requirePermission(context, permission);
    const membershipId = this.scopedMembershipId(context);
    return {
      ownerProfileId: context.ownerProfileId,
      ...(context.capacity !== 'OWNER' &&
      context.vehicleScopeMode === OwnerStaffVehicleScopeMode.SELECTED_VEHICLES
        ? { staffAssignments: { some: { membershipId } } }
        : {}),
    };
  }

  async createMembership(input: {
    readonly actor: OwnerAccessContext;
    readonly actorUserId: string;
    readonly displayName: string;
    readonly normalizedEmail: string;
    readonly permissions: readonly string[];
    readonly role: OwnerStaffRole;
    readonly vehicleScopeMode: OwnerStaffVehicleScopeMode;
  }) {
    this.assertCanCreateMembership(input.actor, input.role);
    const permissions = withDefaultOwnerStaffPermissions(input.permissions);
    assertAssignableOwnerPermissions(input.role, permissions);
    const permissionRows = await this.permissionRows(permissions);
    return this.database.client.ownerStaffMembership.create({
      data: {
        createdByUserId: input.actorUserId,
        displayName: input.displayName.trim(),
        normalizedEmail: input.normalizedEmail.trim().toLowerCase(),
        ownerProfileId: input.actor.ownerProfileId,
        permissions: {
          create: permissionRows.map(({ id: permissionId }) => ({
            assignedByUserId: input.actorUserId,
            permissionId,
          })),
        },
        role: input.role,
        vehicleScopeMode: input.vehicleScopeMode,
      },
      include: { permissions: { include: { permission: true } } },
    });
  }

  assertCanManageTarget(actor: OwnerAccessContext, target: { role: OwnerStaffRole }): void {
    if (actor.capacity === 'OWNER') return;
    if (actor.capacity !== 'MANAGER') throw this.denied('Staff management is not permitted.');
    assertManagerTargetRole(target.role);
  }

  async assignVehicle(
    actor: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    vehicleId: string,
  ) {
    this.requirePermission(actor, 'staff.assign_vehicles');
    const [membership, vehicle] = await Promise.all([
      this.database.client.ownerStaffMembership.findUnique({ where: { id: membershipId } }),
      this.database.client.vehicle.findUnique({
        select: { ownerProfileId: true },
        where: { id: vehicleId },
      }),
    ]);
    if (!membership || !vehicle || membership.ownerProfileId !== actor.ownerProfileId)
      throw this.denied();
    this.assertCanManageTarget(actor, membership);
    if (vehicle.ownerProfileId !== membership.ownerProfileId)
      throw this.denied('Cross-owner vehicle assignment is not permitted.');
    return this.database.client.ownerStaffVehicleAssignment.upsert({
      create: { assignedByUserId: actorUserId, membershipId, vehicleId },
      update: { assignedByUserId: actorUserId, assignedAt: new Date() },
      where: { membershipId_vehicleId: { membershipId, vehicleId } },
    });
  }

  async issueInvitation(
    actor: OwnerAccessContext,
    membershipId: string,
    actorUserId: string,
    permission: 'staff.invite' | 'staff.reissue_invite' = 'staff.reissue_invite',
  ) {
    this.requirePermission(actor, permission);
    const membership = await this.database.client.ownerStaffMembership.findUnique({
      select: { id: true, ownerProfileId: true, role: true, status: true },
      where: { id: membershipId },
    });
    if (
      !membership ||
      membership.ownerProfileId !== actor.ownerProfileId ||
      membership.status !== OwnerStaffStatus.INVITED
    )
      throw this.invalidInvitation();
    this.assertCanManageTarget(actor, membership);
    const id = randomUUID();
    const token = this.tokens.opaqueToken(id);
    const now = new Date();
    await this.database.client.$transaction([
      this.database.client.ownerStaffInvitation.updateMany({
        data: { revokedAt: now },
        where: { consumedAt: null, membershipId, revokedAt: null },
      }),
      this.database.client.ownerStaffInvitation.create({
        data: {
          createdByUserId: actorUserId,
          expiresAt: new Date(now.getTime() + OWNER_STAFF_INVITATION_TTL_MS),
          id,
          membershipId,
          tokenHash: token.hash,
        },
      }),
    ]);
    return token.raw;
  }

  async revokeInvitation(actor: OwnerAccessContext, membershipId: string): Promise<void> {
    this.requirePermission(actor, 'staff.reissue_invite');
    const membership = await this.database.client.ownerStaffMembership.findUnique({
      select: { ownerProfileId: true, role: true },
      where: { id: membershipId },
    });
    if (!membership || membership.ownerProfileId !== actor.ownerProfileId) throw this.denied();
    this.assertCanManageTarget(actor, membership);
    await this.database.client.ownerStaffInvitation.updateMany({
      data: { revokedAt: new Date() },
      where: { consumedAt: null, membershipId, revokedAt: null },
    });
  }

  async acceptInvitation(rawToken: string, acceptingUserId: string) {
    const invitationId = this.tokens.parseOpaqueId(rawToken);
    if (!invitationId) throw this.invalidInvitation();
    const invitation = await this.database.client.ownerStaffInvitation.findUnique({
      include: { membership: true },
      where: { id: invitationId },
    });
    const acceptingUser = await this.database.client.user.findUnique({
      select: { emailVerifiedAt: true, normalizedEmail: true },
      where: { id: acceptingUserId },
    });
    if (
      !invitation ||
      !acceptingUser?.normalizedEmail ||
      !acceptingUser.emailVerifiedAt ||
      acceptingUser.normalizedEmail !== invitation.membership.normalizedEmail ||
      !this.crypto.secureEqual(invitation.tokenHash, this.tokens.hashOpaque(rawToken))
    )
      throw this.invalidInvitation();
    if (invitation.consumedAt)
      throw this.invitationStateError('CONSUMED', 'This Staff invitation was already accepted.');
    if (invitation.revokedAt)
      throw this.invitationStateError('REVOKED', 'This Staff invitation was revoked.');
    if (invitation.expiresAt <= new Date())
      throw this.invitationStateError('EXPIRED', 'This Staff invitation has expired.');
    if (invitation.membership.status !== OwnerStaffStatus.INVITED) throw this.invalidInvitation();

    await this.database.client.$transaction(async (transaction) => {
      const consumed = await transaction.ownerStaffInvitation.updateMany({
        data: { consumedAt: new Date() },
        where: { consumedAt: null, id: invitation.id, revokedAt: null },
      });
      if (consumed.count !== 1) throw this.invalidInvitation();
      const activated = await transaction.ownerStaffMembership.updateMany({
        data: { activatedAt: new Date(), status: OwnerStaffStatus.ACTIVE, userId: acceptingUserId },
        where: {
          id: invitation.membershipId,
          status: OwnerStaffStatus.INVITED,
          OR: [{ userId: null }, { userId: acceptingUserId }],
        },
      });
      if (activated.count !== 1) throw this.invalidInvitation();
      await transaction.ownerStaffInvitation.updateMany({
        data: { revokedAt: new Date() },
        where: {
          consumedAt: null,
          membershipId: invitation.membershipId,
          revokedAt: null,
        },
      });
    });
    return {
      membershipId: invitation.membershipId,
      ownerProfileId: invitation.membership.ownerProfileId,
      role: invitation.membership.role,
    };
  }

  async auditDelegatedAction(input: {
    readonly actorUserId: string;
    readonly context: OwnerAccessContext;
    readonly action: string;
    readonly permission: OwnerPermissionCode;
    readonly targetId: string;
    readonly targetType: string;
    readonly vehicleId?: string;
    readonly request?: RequestMetadata;
  }): Promise<void> {
    if (input.context.capacity === 'OWNER') return;
    await this.database.client.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        ...(input.request?.correlationId ? { correlationId: input.request.correlationId } : {}),
        ...(input.request?.ipAddress ? { ipAddress: input.request.ipAddress } : {}),
        metadata: {
          capacity: input.context.capacity,
          membershipId: input.context.membershipId,
          ownerProfileId: input.context.ownerProfileId,
          permission: input.permission,
          ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
        },
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
  }

  private assertCanCreateMembership(actor: OwnerAccessContext, role: OwnerStaffRole): void {
    if (actor.capacity === 'OWNER') return;
    this.requirePermission(actor, 'staff.invite');
    if (actor.capacity !== 'MANAGER') throw this.denied('Staff management is not permitted.');
    assertManagerTargetRole(role);
  }

  private permissionRows(codes: readonly string[]) {
    return this.database.client.permission
      .findMany({ select: { id: true }, where: { code: { in: [...codes] } } })
      .then((rows) => {
        if (rows.length !== codes.length)
          throw this.denied('One or more Owner permissions are not assignable.');
        return rows;
      });
  }

  private denied(message = 'Owner workspace access is unavailable.') {
    return new ApplicationException('OWNER_ACCESS_DENIED', message, HttpStatus.FORBIDDEN);
  }

  private scopedMembershipId(context: OwnerAccessContext): string {
    if (context.capacity === 'OWNER') return '';
    if (!context.membershipId) throw this.denied();
    return context.membershipId;
  }

  private invalidInvitation() {
    return new ApplicationException(
      'OWNER_STAFF_INVITATION_INVALID',
      'This Staff invitation is invalid or expired.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private invitationStateError(state: 'CONSUMED' | 'EXPIRED' | 'REVOKED', message: string) {
    return new ApplicationException(
      `OWNER_STAFF_INVITATION_${state}`,
      message,
      state === 'CONSUMED' ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export function isUsableOwnerStaffInvitation(
  invitation: {
    readonly consumedAt: Date | null;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
    readonly membership: { readonly status: OwnerStaffStatus };
  },
  tokenMatches: boolean,
  now: Date,
): boolean {
  return (
    tokenMatches &&
    !invitation.consumedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt > now &&
    invitation.membership.status === OwnerStaffStatus.INVITED
  );
}

export function mayAssignOwnerPermission(
  capacity: OwnerAccessContext['capacity'],
  permission: OwnerPermissionCode,
): boolean {
  return capacity === 'OWNER' || !OWNER_ONLY_PERMISSIONS.has(permission);
}
