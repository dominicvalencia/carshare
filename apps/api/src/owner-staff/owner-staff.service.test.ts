import { describe, expect, it, vi } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus, OwnerStaffVehicleScopeMode } from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
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

function createService(client: Record<string, unknown>, accessOverrides = {}) {
  return new OwnerStaffService(
    { client } as never,
    {
      assertCanManageTarget: vi.fn(),
      createMembership: vi.fn(),
      issueInvitation: vi.fn(),
      requirePermission: vi.fn(),
      revokeInvitation: vi.fn(),
      ...accessOverrides,
    } as never,
    { send: vi.fn() } as never,
    { getOrThrow: vi.fn(() => 'http://localhost:3000') } as never,
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
      email: 'manager@example.com',
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

  it('keeps DISABLED terminal and allows only SUSPENDED to reactivate', async () => {
    const findFirst = vi.fn().mockResolvedValue(member({ status: OwnerStaffStatus.DISABLED }));
    const service = createService({ ownerStaffMembership: { findFirst } });
    await expect(service.reactivate(owner, 'owner-user', 'staff-a', {})).rejects.toMatchObject({
      code: 'OWNER_STAFF_CONFLICT',
    });
  });
});
