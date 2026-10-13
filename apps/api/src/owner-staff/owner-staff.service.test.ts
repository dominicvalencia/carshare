import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStaffInvitationChannel,
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
} from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { OPERATIONS_STAFF_PERMISSIONS } from '../owner-access/owner-permissions';
import { OwnerStaffPreset } from './owner-staff.dto';
import { OwnerStaffService } from './owner-staff.service';

const owner: OwnerAccessContext = {
  capacity: 'OWNER',
  membershipStatus: 'OWNER',
  ownerProfileId: 'owner-a',
  permissions: [],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

const manager: OwnerAccessContext = {
  capacity: 'MANAGER',
  membershipId: 'manager-a',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-a',
  permissions: [
    'staff.invite',
    'staff.assign_permissions',
    'staff.assign_vehicles',
    'staff.suspend',
    'staff.disable',
    'staff.update',
    'staff.reissue_invite',
    'staff.view',
    'vehicles.view',
  ],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

function createService(
  client: Record<string, unknown>,
  accessOverrides = {},
  deliveryOverrides: { email?: ReturnType<typeof vi.fn>; sms?: ReturnType<typeof vi.fn> } = {},
) {
  return new OwnerStaffService(
    { client } as never,
    {
      assertCanManageTarget: vi.fn(),
      createInvitedMembership: vi.fn(),
      createMembership: vi.fn(),
      issueInvitation: vi.fn(),
      requirePermission: vi.fn(),
      revokeInvitation: vi.fn(),
      ...accessOverrides,
    } as never,
    { send: deliveryOverrides.email ?? vi.fn() } as never,
    { send: deliveryOverrides.sms ?? vi.fn() } as never,
    { assertAllowed: vi.fn() } as never,
    { hashIdentifier: vi.fn(), randomSecret: vi.fn() } as never,
    {
      getOrThrow: vi.fn((key: string) => (key === 'APP_ENV' ? 'local' : 'http://localhost:3000')),
    } as never,
    { requestMobileVerification: vi.fn() } as never,
  );
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    activatedAt: new Date(),
    createdAt: new Date(),
    createdBy: { id: 'owner-user', profile: { displayName: 'Owner' } },
    disabledAt: null,
    displayName: 'Staff Person',
    id: 'staff-a',
    invitations: [],
    invitedAt: new Date(),
    normalizedEmail: 'staff@example.com',
    ownerApprovalBypassChangedAt: null,
    ownerApprovalBypassChangedByUserId: null,
    ownerApprovalBypassEnabled: false,
    ownerProfileId: 'owner-a',
    permissions: [{ permission: { code: 'vehicles.view' } }],
    role: OwnerStaffRole.STAFF,
    status: OwnerStaffStatus.ACTIVE,
    suspendedAt: null,
    suspensionReason: null,
    updatedAt: new Date(),
    userId: 'staff-user',
    vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
    vehicles: [],
    ...overrides,
  };
}

describe('OwnerStaffService management boundaries', () => {
  it.each([true, false])(
    'allows the actual Owner to set Manager trusted authority to %s without changing permissions',
    async (enabled) => {
      const target = member({
        ownerApprovalBypassEnabled: !enabled,
        role: OwnerStaffRole.MANAGER,
      });
      const updated = member({
        ownerApprovalBypassChangedAt: new Date(),
        ownerApprovalBypassChangedByUserId: 'owner-user',
        ownerApprovalBypassEnabled: enabled,
        role: OwnerStaffRole.MANAGER,
      });
      const updateMany = vi.fn().mockResolvedValue({ count: 1 });
      const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-a' });
      const transaction = {
        auditLog: { create: auditCreate },
        ownerStaffMembership: {
          findFirst: vi.fn().mockResolvedValue(target),
          findUniqueOrThrow: vi.fn().mockResolvedValue(updated),
          updateMany,
        },
      };
      const service = createService({
        $transaction: vi.fn((operation) => operation(transaction)),
      });

      await expect(
        service.updateManagerAuthority(owner, 'owner-user', 'staff-a', enabled, {
          correlationId: 'correlation-a',
        }),
      ).resolves.toMatchObject({ ownerApprovalBypassEnabled: enabled });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerApprovalBypassChangedByUserId: 'owner-user',
            ownerApprovalBypassEnabled: enabled,
          }),
        }),
      );
      expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('permissions');
      expect(auditCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'OWNER_STAFF_MANAGER_AUTHORITY_CHANGED',
          actorUserId: 'owner-user',
          correlationId: 'correlation-a',
          metadata: expect.objectContaining({
            newOwnerApprovalBypassEnabled: enabled,
            ownerProfileId: 'owner-a',
            previousOwnerApprovalBypassEnabled: !enabled,
          }),
          targetId: 'staff-a',
        }),
      });
    },
  );

  it.each([
    ['Manager', manager],
    [
      'Staff',
      {
        ...manager,
        capacity: 'STAFF' as const,
        membershipId: 'staff-actor',
      },
    ],
  ])('denies a delegated %s from changing trusted authority', async (_label, actor) => {
    const transaction = vi.fn();
    const service = createService({ $transaction: transaction });

    await expect(
      service.updateManagerAuthority(actor, 'delegated-user', 'manager-target', true, {}),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_FORBIDDEN' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects ordinary Staff and inactive or cross-workspace targets', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(member())
      .mockResolvedValueOnce(
        member({ role: OwnerStaffRole.MANAGER, status: OwnerStaffStatus.DISABLED }),
      )
      .mockResolvedValueOnce(null);
    const transaction = {
      auditLog: { create: vi.fn() },
      ownerStaffMembership: { findFirst, updateMany: vi.fn() },
    };
    const service = createService({
      $transaction: vi.fn((operation) => operation(transaction)),
    });

    await expect(
      service.updateManagerAuthority(owner, 'owner-user', 'staff-a', true, {}),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_FORBIDDEN' });
    await expect(
      service.updateManagerAuthority(owner, 'owner-user', 'manager-disabled', true, {}),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_CONFLICT' });
    await expect(
      service.updateManagerAuthority(owner, 'owner-user', 'other-workspace-manager', true, {}),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_NOT_FOUND' });
    expect(transaction.ownerStaffMembership.updateMany).not.toHaveBeenCalled();
  });

  it('projects only safe invitation context for the public preview', async () => {
    const service = createService(
      {},
      {
        previewInvitation: vi.fn().mockResolvedValue({
          channel: OwnerStaffInvitationChannel.SMS,
          expiresAt: new Date('2026-10-13T00:00:00.000Z'),
          permissions: OPERATIONS_STAFF_PERMISSIONS,
          role: OwnerStaffRole.STAFF,
          state: 'PENDING',
          workspaceLabel: 'Dominic Rentals',
        }),
      },
    );

    await expect(service.previewInvitation('opaque-token')).resolves.toEqual({
      channel: OwnerStaffInvitationChannel.SMS,
      expiresAt: new Date('2026-10-13T00:00:00.000Z'),
      role: OwnerStaffRole.STAFF,
      roleLabel: 'Operations Staff',
      state: 'PENDING',
      workspaceLabel: 'Dominic Rentals',
    });
  });

  it.each(['09171234567', '+639171234567'])(
    'normalizes %s into an SMS invite without sending email',
    async (mobileNumber) => {
      const createInvitedMembership = vi.fn().mockResolvedValue({
        membership: { id: 'staff-a' },
        token: 'raw-token',
      });
      const emailSend = vi.fn();
      const smsSend = vi.fn();
      const invited = member({
        invitations: [
          {
            channel: OwnerStaffInvitationChannel.SMS,
            consumedAt: null,
            createdAt: new Date(),
            destinationNormalized: '+639171234567',
            expiresAt: new Date(Date.now() + 86_400_000),
            revokedAt: null,
          },
        ],
        normalizedEmail: null,
        status: OwnerStaffStatus.INVITED,
        userId: null,
      });
      const service = new OwnerStaffService(
        {
          client: {
            auditLog: { create: vi.fn() },
            ownerProfile: {
              findUnique: vi.fn().mockResolvedValue({
                legalName: 'Dominic Rentals',
                user: { profile: { displayName: 'Dominic' } },
              }),
            },
            ownerStaffMembership: { findFirst: vi.fn().mockResolvedValue(invited) },
            ownerStaffVehicleAssignment: { createMany: vi.fn() },
            vehicle: { findMany: vi.fn() },
          },
        } as never,
        {
          assertCanManageTarget: vi.fn(),
          createInvitedMembership,
          requirePermission: vi.fn(),
        } as never,
        { send: emailSend } as never,
        { send: smsSend } as never,
        { assertAllowed: vi.fn() } as never,
        { hashIdentifier: vi.fn(), randomSecret: vi.fn() } as never,
        {
          getOrThrow: vi.fn((key: string) =>
            key === 'APP_ENV' ? 'local' : 'http://localhost:3000',
          ),
        } as never,
        { requestMobileVerification: vi.fn() } as never,
      );

      await service.invite(
        owner,
        'owner-user',
        {
          displayName: 'SMS Staff',
          mobileNumber,
          preset: OwnerStaffPreset.OPERATIONS_STAFF,
          role: OwnerStaffRole.STAFF,
          vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
        },
        {},
      );

      expect(createInvitedMembership).toHaveBeenCalledWith(
        expect.objectContaining({ destinationNormalized: '+639171234567' }),
      );
      expect(emailSend).not.toHaveBeenCalled();
      expect(smsSend).toHaveBeenCalledWith({
        invitationUrl: 'carrental://owner/staff-invitation?token=raw-token',
        roleLabel: 'Staff',
        template: 'STAFF_INVITATION',
        to: '+639171234567',
        workspaceLabel: 'Dominic Rentals',
      });
    },
  );

  it('rejects an invalid Philippine mobile before creating an invitation', async () => {
    const createInvitedMembership = vi.fn();
    const service = createService({}, { createInvitedMembership });

    await expect(
      service.invite(
        owner,
        'owner-user',
        {
          displayName: 'Invalid Mobile',
          mobileNumber: '12345',
          preset: OwnerStaffPreset.OPERATIONS_STAFF,
          role: OwnerStaffRole.STAFF,
          vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_MOBILE_INVALID' });
    expect(createInvitedMembership).not.toHaveBeenCalled();
  });

  it('keeps the created invitation live and returns a safe error when SMS delivery fails', async () => {
    const createInvitedMembership = vi.fn().mockResolvedValue({
      membership: { id: 'staff-a' },
      token: 'raw-token',
    });
    const invited = member({
      invitations: [
        {
          channel: OwnerStaffInvitationChannel.SMS,
          consumedAt: null,
          createdAt: new Date(),
          destinationNormalized: '+639171234567',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
      ],
      normalizedEmail: null,
      status: OwnerStaffStatus.INVITED,
      userId: null,
    });
    const smsSend = vi.fn().mockRejectedValue(new Error('secret provider response'));
    const auditCreate = vi.fn();
    const rateLimit = vi.fn();
    const service = new OwnerStaffService(
      {
        client: {
          auditLog: { create: auditCreate },
          ownerProfile: {
            findUnique: vi.fn().mockResolvedValue({ legalName: 'Owner', user: { profile: null } }),
          },
          ownerStaffMembership: { findFirst: vi.fn().mockResolvedValue(invited) },
          vehicle: { findMany: vi.fn() },
        },
      } as never,
      {
        assertCanManageTarget: vi.fn(),
        createInvitedMembership,
        requirePermission: vi.fn(),
      } as never,
      { send: vi.fn() } as never,
      { send: smsSend } as never,
      { assertAllowed: rateLimit } as never,
      { hashIdentifier: vi.fn(), randomSecret: vi.fn() } as never,
      {
        getOrThrow: vi.fn((key: string) => (key === 'APP_ENV' ? 'local' : 'http://localhost:3000')),
      } as never,
      { requestMobileVerification: vi.fn() } as never,
    );

    await expect(
      service.invite(
        owner,
        'owner-user',
        {
          displayName: 'SMS Staff',
          mobileNumber: '09171234567',
          preset: OwnerStaffPreset.OPERATIONS_STAFF,
          role: OwnerStaffRole.STAFF,
          vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
        },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toMatchObject({
      code: 'OWNER_STAFF_INVITATION_DELIVERY_FAILED',
      message: expect.not.stringContaining('secret provider response'),
    });
    expect(createInvitedMembership).toHaveBeenCalledTimes(1);
    expect(rateLimit).toHaveBeenCalledWith(
      'owner-staff-invite-sms',
      expect.arrayContaining([
        'actor:owner-user',
        'workspace:owner-a',
        'destination:+639171234567',
      ]),
      5,
      3600,
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'OWNER_STAFF_INVITATION_DELIVERY_FAILED' }),
      }),
    );
  });

  it('rate-limits and delivers an SMS reissue with the fresh token', async () => {
    const target = member({
      id: 'staff-a',
      invitations: [
        {
          channel: OwnerStaffInvitationChannel.SMS,
          consumedAt: null,
          createdAt: new Date(),
          destinationNormalized: '+639171234567',
          expiresAt: new Date(Date.now() + 86_400_000),
          revokedAt: null,
        },
      ],
      status: OwnerStaffStatus.INVITED,
      userId: null,
    });
    const smsSend = vi.fn();
    const emailSend = vi.fn();
    const rateLimit = vi.fn();
    const service = new OwnerStaffService(
      {
        client: {
          auditLog: { create: vi.fn() },
          ownerProfile: {
            findUnique: vi.fn().mockResolvedValue({ legalName: 'Owner', user: { profile: null } }),
          },
          ownerStaffMembership: { findFirst: vi.fn().mockResolvedValue(target) },
        },
      } as never,
      {
        assertCanManageTarget: vi.fn(),
        issueInvitation: vi.fn().mockResolvedValue({
          channel: OwnerStaffInvitationChannel.SMS,
          destinationNormalized: '+639171234567',
          token: 'fresh-token',
        }),
        requirePermission: vi.fn(),
      } as never,
      { send: emailSend } as never,
      { send: smsSend } as never,
      { assertAllowed: rateLimit } as never,
      { hashIdentifier: vi.fn(), randomSecret: vi.fn() } as never,
      {
        getOrThrow: vi.fn((key: string) => (key === 'APP_ENV' ? 'local' : 'http://localhost:3000')),
      } as never,
      { requestMobileVerification: vi.fn() } as never,
    );

    await service.reissueInvitation(owner, 'owner-user', 'staff-a', {
      ipAddress: '127.0.0.1',
    });

    expect(rateLimit).toHaveBeenCalledWith(
      'owner-staff-reissue-sms',
      expect.arrayContaining(['destination:+639171234567']),
      3,
      3600,
    );
    expect(smsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationUrl: expect.stringContaining('fresh-token'),
        template: 'STAFF_INVITATION',
      }),
    );
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('adds own-activity access to a Custom Staff invite with no configurable permissions', () => {
    const service = createService({});
    const resolver = service as unknown as {
      permissionsForInvite(input: {
        preset: OwnerStaffPreset;
        role: OwnerStaffRole;
        permissions: readonly string[];
      }): readonly string[];
    };
    expect(
      resolver.permissionsForInvite({
        permissions: [],
        preset: OwnerStaffPreset.CUSTOM,
        role: OwnerStaffRole.STAFF,
      }),
    ).toEqual(['audit.view_own_actions']);
  });

  it('allows Owner Manager/Staff invites but prevents Manager from inviting Manager', async () => {
    const service = createService(
      { ownerStaffMembership: { findUnique: vi.fn().mockResolvedValue(null) } },
      {
        assertCanManageTarget: vi.fn((_actor, target) => {
          if (_actor.capacity === 'MANAGER' && target.role === OwnerStaffRole.MANAGER)
            throw new Error('Manager may manage ordinary Staff only.');
        }),
      },
    );
    const input = {
      displayName: 'Manager',
      mobileNumber: '09171234567',
      preset: OwnerStaffPreset.MANAGER,
      role: OwnerStaffRole.MANAGER,
      vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
    };
    await expect(service.invite(manager, 'manager-user', input, {})).rejects.toMatchObject({
      code: 'OWNER_STAFF_FORBIDDEN',
    });
    // The Owner gets past the role boundary; this mock then reaches membership creation.
    await expect(service.invite(owner, 'owner-user', input, {})).rejects.not.toMatchObject({
      code: 'OWNER_STAFF_FORBIDDEN',
    });
  });

  it('rejects cross-owner or invalid selected vehicle IDs', async () => {
    const service = createService({
      ownerStaffMembership: { findFirst: vi.fn().mockResolvedValue(member()) },
      vehicle: { findMany: vi.fn().mockResolvedValue([{ id: 'vehicle-a' }]) },
    });
    await expect(
      service.updateScope(
        owner,
        'owner-user',
        'staff-a',
        {
          vehicleIds: ['vehicle-a', 'vehicle-other-owner'],
          vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_FORBIDDEN' });
  });

  it('blocks Manager self-management before changing permissions or scope', async () => {
    const findFirst = vi.fn().mockResolvedValue(
      member({
        id: 'manager-a',
        role: OwnerStaffRole.MANAGER,
        userId: 'manager-user',
      }),
    );
    const service = createService({ ownerStaffMembership: { findFirst } });
    await expect(
      service.updatePermissions(manager, 'manager-user', 'manager-a', ['vehicles.view'], {}),
    ).rejects.toMatchObject({ code: 'OWNER_STAFF_FORBIDDEN' });
  });

  it('preserves the default own-activity permission when configurable permissions are cleared', async () => {
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const findFirst = vi.fn().mockResolvedValue(member({ permissions: [] }));
    const findMany = vi.fn().mockResolvedValue([{ id: 'audit-permission' }]);
    const service = createService({
      $transaction: vi.fn(async (work) =>
        work({ ownerStaffPermission: { createMany, deleteMany } }),
      ),
      auditLog: { create: vi.fn() },
      ownerStaffMembership: { findFirst },
      permission: { findMany },
    });

    await service.updatePermissions(owner, 'owner-user', 'staff-a', [], {});

    expect(findMany).toHaveBeenCalledWith({
      select: { id: true },
      where: { code: { in: ['audit.view_own_actions'] } },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          assignedByUserId: 'owner-user',
          membershipId: 'staff-a',
          permissionId: 'audit-permission',
        },
      ],
    });
  });

  it('keeps DISABLED terminal and allows only SUSPENDED to reactivate', async () => {
    const findFirst = vi.fn().mockResolvedValue(member({ status: OwnerStaffStatus.DISABLED }));
    const service = createService({ ownerStaffMembership: { findFirst } });
    await expect(service.reactivate(owner, 'owner-user', 'staff-a', {})).rejects.toMatchObject({
      code: 'OWNER_STAFF_CONFLICT',
    });
  });
});
