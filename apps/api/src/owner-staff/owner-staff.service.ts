import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OwnerStaffInvitationChannel,
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  type Prisma,
} from '@carrental/database';
import type { ApiEnvironment } from '@carrental/config';
import { passwordResetAppScheme } from '../auth/password-reset-link';
import { ApplicationException } from '../common/errors/application.exception';
import { normalizePhilippineMobile } from '../common/phone/philippine-mobile';
import { DatabaseService } from '../infrastructure/database/database.service';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import {
  MANAGER_PERMISSIONS,
  OPERATIONS_STAFF_PERMISSIONS,
  OWNER_PERMISSION_PRESETS,
  SUPPORT_STAFF_PERMISSIONS,
  assertActorCanGrantOwnerPermissions,
  type OwnerPermissionCode,
  withDefaultOwnerStaffPermissions,
} from '../owner-access/owner-permissions';
import { EmailProvider, SmsProvider } from '../providers/delivery.provider';
import { RateLimitService } from '../security/rate-limit.service';
import type { OwnerAccessContext, RequestMetadata } from '../security/security-context';
import {
  OwnerStaffPreset,
  type InviteOwnerStaffDto,
  type OwnerStaffQueryDto,
  type UpdateOwnerStaffScopeDto,
} from './owner-staff.dto';

const safeMemberSelect = {
  activatedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
  disabledAt: true,
  displayName: true,
  id: true,
  invitations: {
    orderBy: { createdAt: 'desc' as const },
    select: {
      channel: true,
      consumedAt: true,
      createdAt: true,
      destinationNormalized: true,
      expiresAt: true,
      revokedAt: true,
    },
    take: 1,
  },
  invitedAt: true,
  normalizedEmail: true,
  ownerProfileId: true,
  permissions: {
    orderBy: { permission: { code: 'asc' as const } },
    select: { permission: { select: { code: true } } },
  },
  role: true,
  status: true,
  suspendedAt: true,
  suspensionReason: true,
  updatedAt: true,
  userId: true,
  vehicleScopeMode: true,
  vehicles: {
    orderBy: { assignedAt: 'asc' as const },
    select: {
      vehicle: { select: { id: true, make: true, model: true, modelYear: true } },
    },
  },
} satisfies Prisma.OwnerStaffMembershipSelect;

type SafeMember = Prisma.OwnerStaffMembershipGetPayload<{ select: typeof safeMemberSelect }>;

@Injectable()
export class OwnerStaffService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: OwnerAccessService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly rateLimits: RateLimitService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async list(context: OwnerAccessContext, query: OwnerStaffQueryDto) {
    this.access.requirePermission(context, 'staff.view');
    const rows = await this.database.client.ownerStaffMembership.findMany({
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      select: safeMemberSelect,
      where: {
        ownerProfileId: context.ownerProfileId,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
    });
    return rows.map((member) => this.publicMember(member, false));
  }

  async detail(context: OwnerAccessContext, membershipId: string) {
    this.access.requirePermission(context, 'staff.view');
    const member = await this.requireTarget(context, membershipId, true);
    return this.publicMember(member, true);
  }

  async invite(
    context: OwnerAccessContext,
    actorUserId: string,
    input: InviteOwnerStaffDto,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.invite');
    this.assertTargetRole(context, input.role);
    const permissions = this.permissionsForInvite(input);
    this.assertGrant(context, input.role, permissions);
    const vehicleIds = await this.validatedVehicles(
      context.ownerProfileId,
      input.vehicleScopeMode,
      input.vehicleIds ?? [],
    );
    let destinationNormalized: string;
    try {
      destinationNormalized = normalizePhilippineMobile(input.mobileNumber);
    } catch {
      throw new ApplicationException(
        'OWNER_STAFF_MOBILE_INVALID',
        'Enter a valid Philippine mobile number.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.rateLimits.assertAllowed(
      'owner-staff-invite-sms',
      [
        `actor:${actorUserId}`,
        `workspace:${context.ownerProfileId}`,
        `destination:${destinationNormalized}`,
        `ip:${request.ipAddress ?? 'unknown'}`,
      ],
      5,
      3600,
    );
    const { membership: member, token } = await this.access.createInvitedMembership({
      actor: context,
      actorUserId,
      destinationNormalized,
      displayName: input.displayName,
      permissions,
      role: input.role,
      vehicleIds,
      vehicleScopeMode: input.vehicleScopeMode,
    });
    const result = await this.requireTarget(context, member.id, false);
    await this.audit('OWNER_STAFF_INVITED', actorUserId, context, result, request, {
      channel: OwnerStaffInvitationChannel.SMS,
      destination: this.maskMobile(destinationNormalized),
      permissions,
      vehicleIds,
    });
    await this.deliverSmsInvitation({
      actorUserId,
      context,
      destination: destinationNormalized,
      request,
      role: result.role,
      target: result,
      token,
    });
    return this.publicMember(result, true);
  }

  async updateDisplayName(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    displayName: string,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.update');
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    const updated = await this.database.client.ownerStaffMembership.update({
      data: { displayName: displayName.trim() },
      select: safeMemberSelect,
      where: { id: target.id },
    });
    await this.audit('OWNER_STAFF_METADATA_UPDATED', actorUserId, context, updated, request);
    return this.publicMember(updated, true);
  }

  async updatePermissions(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    permissions: readonly string[],
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.assign_permissions');
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    const effectivePermissions = withDefaultOwnerStaffPermissions(permissions);
    this.assertGrant(context, target.role, effectivePermissions);
    const rows = await this.permissionRows(effectivePermissions);
    const before = target.permissions.map(({ permission }) => permission.code);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.ownerStaffPermission.deleteMany({ where: { membershipId } });
      if (rows.length)
        await transaction.ownerStaffPermission.createMany({
          data: rows.map(({ id: permissionId }) => ({
            assignedByUserId: actorUserId,
            membershipId,
            permissionId,
          })),
        });
    });
    const updated = await this.requireTarget(context, membershipId, false);
    await this.audit('OWNER_STAFF_PERMISSIONS_CHANGED', actorUserId, context, updated, request, {
      after: effectivePermissions,
      before,
    });
    return this.publicMember(updated, true);
  }

  async updateScope(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    input: UpdateOwnerStaffScopeDto,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.assign_vehicles');
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    const vehicleIds = await this.validatedVehicles(
      context.ownerProfileId,
      input.vehicleScopeMode,
      input.vehicleIds ?? [],
    );
    const beforeIds = target.vehicles.map(({ vehicle }) => vehicle.id);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.ownerStaffVehicleAssignment.deleteMany({ where: { membershipId } });
      if (
        input.vehicleScopeMode === OwnerStaffVehicleScopeMode.SELECTED_VEHICLES &&
        vehicleIds.length
      )
        await transaction.ownerStaffVehicleAssignment.createMany({
          data: vehicleIds.map((vehicleId) => ({
            assignedByUserId: actorUserId,
            membershipId,
            vehicleId,
          })),
        });
      await transaction.ownerStaffMembership.update({
        data: { vehicleScopeMode: input.vehicleScopeMode },
        where: { id: membershipId },
      });
    });
    const updated = await this.requireTarget(context, membershipId, false);
    await this.audit('OWNER_STAFF_SCOPE_CHANGED', actorUserId, context, updated, request, {
      afterScope: input.vehicleScopeMode,
      afterVehicleIds: vehicleIds,
      beforeScope: target.vehicleScopeMode,
      beforeVehicleIds: beforeIds,
    });
    return this.publicMember(updated, true);
  }

  suspend(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    return this.changeStatus(
      context,
      actorUserId,
      membershipId,
      OwnerStaffStatus.SUSPENDED,
      reason,
      request,
    );
  }

  reactivate(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    request: RequestMetadata,
  ) {
    return this.changeStatus(
      context,
      actorUserId,
      membershipId,
      OwnerStaffStatus.ACTIVE,
      undefined,
      request,
    );
  }

  disable(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    reason: string,
    request: RequestMetadata,
  ) {
    return this.changeStatus(
      context,
      actorUserId,
      membershipId,
      OwnerStaffStatus.DISABLED,
      reason,
      request,
    );
  }

  async reissueInvitation(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.reissue_invite');
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    if (target.status !== OwnerStaffStatus.INVITED)
      throw this.conflict('Only pending invitations can be reissued.');
    const previousInvitation = target.invitations[0];
    if (!previousInvitation) throw this.conflict('No invitation is available to reissue.');
    if (previousInvitation.channel === OwnerStaffInvitationChannel.SMS)
      await this.rateLimits.assertAllowed(
        'owner-staff-reissue-sms',
        [
          `actor:${actorUserId}`,
          `workspace:${context.ownerProfileId}`,
          `destination:${previousInvitation.destinationNormalized}`,
          `ip:${request.ipAddress ?? 'unknown'}`,
        ],
        3,
        3600,
      );
    const invitation = await this.access.issueInvitation(context, membershipId, actorUserId);
    if (invitation.channel === OwnerStaffInvitationChannel.EMAIL)
      await this.sendInvitation(
        invitation.destinationNormalized,
        target.displayName,
        invitation.token,
      );
    await this.audit('OWNER_STAFF_INVITATION_REISSUED', actorUserId, context, target, request, {
      channel: invitation.channel,
      destination: this.maskDestination(invitation.channel, invitation.destinationNormalized),
    });
    if (invitation.channel === OwnerStaffInvitationChannel.SMS)
      await this.deliverSmsInvitation({
        actorUserId,
        context,
        destination: invitation.destinationNormalized,
        request,
        role: target.role,
        target,
        token: invitation.token,
      });
    return { id: membershipId, status: target.status };
  }

  async revokeInvitation(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(context, 'staff.reissue_invite');
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    if (target.status !== OwnerStaffStatus.INVITED)
      throw this.conflict('Only pending invitations can be revoked.');
    await this.access.revokeInvitation(context, membershipId);
    const invitation = target.invitations[0];
    await this.audit('OWNER_STAFF_INVITATION_REVOKED', actorUserId, context, target, request, {
      ...(invitation
        ? {
            channel: invitation.channel,
            destination: this.maskDestination(invitation.channel, invitation.destinationNormalized),
          }
        : {}),
    });
    return { id: membershipId, status: target.status };
  }

  async acceptInvitation(token: string, userId: string, request: RequestMetadata) {
    const accepted = await this.access.acceptInvitation(token, userId);
    await this.database.client.auditLog.create({
      data: {
        action: 'OWNER_STAFF_INVITATION_ACCEPTED',
        actorUserId: userId,
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
        metadata: {
          acceptance: `AUTHENTICATED_VERIFIED_${accepted.channel}_MATCH`,
          ownerProfileId: accepted.ownerProfileId,
          targetRole: accepted.role,
        },
        targetId: accepted.membershipId,
        targetType: 'OWNER_STAFF_MEMBERSHIP',
      },
    });
    return {
      accepted: true,
      ownerProfileId: accepted.ownerProfileId,
      role: accepted.role,
    };
  }

  private async changeStatus(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
    status: OwnerStaffStatus,
    reason: string | undefined,
    request: RequestMetadata,
  ) {
    this.access.requirePermission(
      context,
      status === OwnerStaffStatus.DISABLED ? 'staff.disable' : 'staff.suspend',
    );
    const target = await this.requireMutableTarget(context, actorUserId, membershipId);
    const allowed =
      status === OwnerStaffStatus.SUSPENDED
        ? target.status === OwnerStaffStatus.ACTIVE
        : status === OwnerStaffStatus.ACTIVE
          ? target.status === OwnerStaffStatus.SUSPENDED
          : target.status === OwnerStaffStatus.ACTIVE ||
            target.status === OwnerStaffStatus.SUSPENDED;
    if (!allowed) throw this.conflict('This membership status transition is not allowed.');
    const now = new Date();
    const changed = await this.database.client.ownerStaffMembership.updateMany({
      data: {
        status,
        ...(status === OwnerStaffStatus.SUSPENDED
          ? { suspendedAt: now, suspendedByUserId: actorUserId, suspensionReason: reason ?? null }
          : { suspendedAt: null, suspendedByUserId: null, suspensionReason: null }),
        ...(status === OwnerStaffStatus.DISABLED
          ? { disabledAt: now, disabledByUserId: actorUserId }
          : {}),
      },
      where: { id: membershipId, status: target.status },
    });
    if (changed.count !== 1)
      throw this.conflict('The membership changed while this action was being completed.');
    const updated = await this.requireTarget(context, membershipId, false);
    await this.audit(`OWNER_STAFF_${status}`, actorUserId, context, updated, request, {
      previousStatus: target.status,
      ...(reason ? { reason } : {}),
    });
    return this.publicMember(updated, true);
  }

  private async requireTarget(
    context: OwnerAccessContext,
    membershipId: string,
    enforceRoleBoundary: boolean,
  ) {
    const target = await this.database.client.ownerStaffMembership.findFirst({
      select: safeMemberSelect,
      where: { id: membershipId, ownerProfileId: context.ownerProfileId },
    });
    if (!target) throw this.notFound();
    if (enforceRoleBoundary) this.assertTargetRole(context, target.role);
    return target;
  }

  private async requireMutableTarget(
    context: OwnerAccessContext,
    actorUserId: string,
    membershipId: string,
  ) {
    const target = await this.requireTarget(context, membershipId, true);
    if (target.userId === actorUserId || target.id === context.membershipId)
      throw this.denied('Members cannot modify their own delegated access.');
    return target;
  }

  private assertTargetRole(context: OwnerAccessContext, role: OwnerStaffRole) {
    try {
      this.access.assertCanManageTarget(context, { role });
    } catch {
      throw this.denied('This target role cannot be managed by the current actor.');
    }
  }

  private assertGrant(
    context: OwnerAccessContext,
    role: OwnerStaffRole,
    permissions: readonly string[],
  ) {
    try {
      assertActorCanGrantOwnerPermissions(context, role, permissions);
    } catch (error) {
      throw this.denied(error instanceof Error ? error.message : 'Permission grant is forbidden.');
    }
  }

  private permissionsForInvite(input: InviteOwnerStaffDto): readonly OwnerPermissionCode[] {
    if (input.role === OwnerStaffRole.MANAGER) {
      if (input.preset !== OwnerStaffPreset.MANAGER)
        throw this.denied('Manager invitations require the approved Manager permission set.');
      return MANAGER_PERMISSIONS;
    }
    if (input.preset === OwnerStaffPreset.MANAGER)
      throw this.denied('The Manager preset cannot be assigned to ordinary Staff.');
    if (input.preset === OwnerStaffPreset.CUSTOM)
      return withDefaultOwnerStaffPermissions(input.permissions ?? []);
    return OWNER_PERMISSION_PRESETS[input.preset];
  }

  private async validatedVehicles(
    ownerProfileId: string,
    scope: OwnerStaffVehicleScopeMode,
    vehicleIds: readonly string[],
  ) {
    if (scope === OwnerStaffVehicleScopeMode.ALL_VEHICLES) return [];
    const uniqueIds = [...new Set(vehicleIds)];
    const rows = await this.database.client.vehicle.findMany({
      select: { id: true },
      where: { id: { in: uniqueIds }, ownerProfileId },
    });
    if (rows.length !== uniqueIds.length)
      throw this.denied('One or more vehicle assignments are outside this Owner workspace.');
    return uniqueIds;
  }

  private permissionRows(codes: readonly string[]) {
    return this.database.client.permission
      .findMany({ select: { id: true }, where: { code: { in: [...codes] } } })
      .then((rows) => {
        if (rows.length !== codes.length) throw this.denied('Invalid Owner permission.');
        return rows;
      });
  }

  private publicMember(member: SafeMember, includeVehicles: boolean) {
    const permissions = withDefaultOwnerStaffPermissions(
      member.permissions.map(({ permission }) => permission.code),
    );
    const invitation = member.invitations[0];
    return {
      activatedAt: member.activatedAt,
      assignedVehicleCount: member.vehicles.length,
      createdAt: member.createdAt,
      createdBy: {
        displayName: member.createdBy.profile?.displayName ?? null,
        id: member.createdBy.id,
      },
      disabledAt: member.disabledAt,
      displayName: member.displayName,
      email: member.normalizedEmail,
      id: member.id,
      invitation: invitation
        ? {
            consumedAt: invitation.consumedAt,
            channel: invitation.channel,
            destination: this.maskDestination(invitation.channel, invitation.destinationNormalized),
            expiresAt: invitation.expiresAt,
            revokedAt: invitation.revokedAt,
            state: invitation.consumedAt
              ? 'CONSUMED'
              : invitation.revokedAt
                ? 'REVOKED'
                : invitation.expiresAt <= new Date()
                  ? 'EXPIRED'
                  : 'PENDING',
          }
        : null,
      invitedAt: member.invitedAt,
      permissions,
      preset: this.presetMatch(member.role, permissions),
      role: member.role,
      status: member.status,
      suspendedAt: member.suspendedAt,
      suspensionReason: member.suspensionReason,
      updatedAt: member.updatedAt,
      vehicleScopeMode: member.vehicleScopeMode,
      ...(includeVehicles
        ? { assignedVehicles: member.vehicles.map(({ vehicle }) => vehicle) }
        : {}),
    };
  }

  private presetMatch(role: OwnerStaffRole, permissions: readonly string[]) {
    if (role === OwnerStaffRole.MANAGER && this.sameSet(permissions, MANAGER_PERMISSIONS))
      return OwnerStaffPreset.MANAGER;
    if (this.sameSet(permissions, OPERATIONS_STAFF_PERMISSIONS))
      return OwnerStaffPreset.OPERATIONS_STAFF;
    if (this.sameSet(permissions, SUPPORT_STAFF_PERMISSIONS)) return OwnerStaffPreset.SUPPORT_STAFF;
    return OwnerStaffPreset.CUSTOM;
  }

  private sameSet(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((value) => right.includes(value as never));
  }

  private sendInvitation(to: string, displayName: string, token: string) {
    const actionUrl = this.invitationUrl(token);
    return this.email.send({
      actionUrl,
      template: 'STAFF_INVITATION',
      to,
      token,
      variables: { display_name: displayName, expires_hours: 24 },
    });
  }

  private async deliverSmsInvitation(input: {
    readonly actorUserId: string;
    readonly context: OwnerAccessContext;
    readonly destination: string;
    readonly request: RequestMetadata;
    readonly role: OwnerStaffRole;
    readonly target: SafeMember;
    readonly token: string;
  }): Promise<void> {
    const workspaceLabel = await this.workspaceLabel(input.context.ownerProfileId);
    try {
      await this.sms.send({
        invitationUrl: this.invitationUrl(input.token),
        roleLabel: input.role === OwnerStaffRole.MANAGER ? 'Manager' : 'Staff',
        template: 'STAFF_INVITATION',
        to: input.destination,
        workspaceLabel,
      });
    } catch (error) {
      await this.audit(
        'OWNER_STAFF_INVITATION_DELIVERY_FAILED',
        input.actorUserId,
        input.context,
        input.target,
        input.request,
        {
          channel: OwnerStaffInvitationChannel.SMS,
          destination: this.maskMobile(input.destination),
          errorCategory: this.smsErrorCategory(error),
        },
      );
      throw new ApplicationException(
        'OWNER_STAFF_INVITATION_DELIVERY_FAILED',
        'The invitation was created, but the SMS could not be sent. You can reissue it later.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.audit(
      'OWNER_STAFF_INVITATION_DELIVERY_SENT',
      input.actorUserId,
      input.context,
      input.target,
      input.request,
      {
        channel: OwnerStaffInvitationChannel.SMS,
        destination: this.maskMobile(input.destination),
      },
    );
  }

  private invitationUrl(token: string): string {
    const scheme = passwordResetAppScheme(
      this.configuration.getOrThrow('APP_ENV', { infer: true }),
    );
    return `${scheme}://owner/staff-invitation?token=${encodeURIComponent(token)}`;
  }

  private async workspaceLabel(ownerProfileId: string): Promise<string> {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: {
        legalName: true,
        user: { select: { profile: { select: { displayName: true } } } },
      },
      where: { id: ownerProfileId },
    });
    return owner?.legalName?.trim() || owner?.user.profile?.displayName?.trim() || 'CarShare owner';
  }

  private maskMobile(value: string): string {
    return `${value.slice(0, 4)}*****${value.slice(-3)}`;
  }

  private smsErrorCategory(error: unknown): string {
    if (
      error instanceof Error &&
      ['SMS_PROVIDER_REJECTED', 'SMS_PROVIDER_RETRYABLE'].includes(error.message)
    )
      return error.message;
    return 'SMS_DELIVERY_UNAVAILABLE';
  }

  private maskDestination(channel: OwnerStaffInvitationChannel, value: string): string {
    if (channel === OwnerStaffInvitationChannel.SMS) return this.maskMobile(value);
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private audit(
    action: string,
    actorUserId: string,
    context: OwnerAccessContext,
    target: SafeMember,
    request: RequestMetadata,
    changes?: Record<string, unknown>,
  ) {
    return this.database.client.auditLog.create({
      data: {
        action,
        actorUserId,
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
        metadata: {
          actorCapacity: context.capacity,
          actorMembershipId: context.membershipId,
          ownerProfileId: context.ownerProfileId,
          targetRole: target.role,
          ...changes,
        } as Prisma.InputJsonValue,
        targetId: target.id,
        targetType: 'OWNER_STAFF_MEMBERSHIP',
      },
    });
  }

  private denied(message: string) {
    return new ApplicationException('OWNER_STAFF_FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }

  private conflict(message: string) {
    return new ApplicationException('OWNER_STAFF_CONFLICT', message, HttpStatus.CONFLICT);
  }

  private notFound() {
    return new ApplicationException(
      'OWNER_STAFF_NOT_FOUND',
      'Staff membership was not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
