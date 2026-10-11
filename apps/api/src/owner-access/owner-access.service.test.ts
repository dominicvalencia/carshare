import { describe, expect, it, vi } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus, OwnerStaffVehicleScopeMode } from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { OwnerAccessService } from './owner-access.service';

function serviceWithClient(client: Record<string, unknown>) {
  return new OwnerAccessService(
    { client } as never,
    {
      secureEqual: vi.fn(() => true),
    } as never,
    {
      hashOpaque: vi.fn(() => 'hash'),
      opaqueToken: vi.fn(() => ({ hash: 'hash', raw: 'raw-token' })),
      parseOpaqueId: vi.fn(() => 'invitation-id'),
    } as never,
  );
}

const ownerContext: OwnerAccessContext = {
  capacity: 'OWNER',
  membershipStatus: 'OWNER',
  ownerProfileId: 'owner-a',
  permissions: [],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

const staffContext: OwnerAccessContext = {
  capacity: 'STAFF',
  membershipId: 'membership-a',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-a',
  permissions: ['vehicles.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
};

describe('OwnerAccessService', () => {
  it('resolves the actual Owner without requiring a delegated membership', async () => {
    const service = serviceWithClient({
      ownerProfile: { findUnique: vi.fn().mockResolvedValue({ userId: 'owner-user' }) },
    });
    await expect(service.resolve('owner-user', 'owner-a')).resolves.toMatchObject({
      capacity: 'OWNER',
      ownerProfileId: 'owner-a',
      vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
    });
  });

  it.each([OwnerStaffStatus.INVITED, OwnerStaffStatus.SUSPENDED, OwnerStaffStatus.DISABLED])(
    'denies a %s membership operational authority',
    async (status) => {
      const service = serviceWithClient({
        ownerProfile: { findUnique: vi.fn().mockResolvedValue({ userId: 'different-user' }) },
        ownerStaffMembership: {
          findFirst: vi.fn().mockResolvedValue({ permissions: [], status }),
        },
      });
      await expect(service.resolve('staff-user', 'owner-a')).rejects.toMatchObject({
        code: 'OWNER_ACCESS_DENIED',
      });
    },
  );

  it('reloads explicit permissions and rejects a removed permission immediately', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'membership-a',
        permissions: [{ permission: { code: 'vehicles.view' } }],
        role: OwnerStaffRole.STAFF,
        status: OwnerStaffStatus.ACTIVE,
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      })
      .mockResolvedValueOnce({
        id: 'membership-a',
        permissions: [],
        role: OwnerStaffRole.STAFF,
        status: OwnerStaffStatus.ACTIVE,
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      });
    const service = serviceWithClient({
      ownerProfile: { findUnique: vi.fn().mockResolvedValue({ userId: 'different-user' }) },
      ownerStaffMembership: { findFirst },
    });
    const allowed = await service.resolve('staff-user', 'owner-a');
    expect(() => service.requirePermission(allowed, 'vehicles.view')).not.toThrow();
    const reduced = await service.resolve('staff-user', 'owner-a');
    expect(() => service.requirePermission(reduced, 'vehicles.view')).toThrow(
      'required Owner permission',
    );
  });

  it('filters selected vehicle scope and keeps all-vehicle scope within one Owner', () => {
    const service = serviceWithClient({});
    expect(service.vehicleReadWhere(staffContext)).toEqual({
      ownerProfileId: 'owner-a',
      staffAssignments: { some: { membershipId: 'membership-a' } },
    });
    expect(
      service.vehicleReadWhere({
        ...staffContext,
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      }),
    ).toEqual({ ownerProfileId: 'owner-a' });
  });

  it('denies direct read of an unassigned or cross-owner vehicle', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = serviceWithClient({ vehicle: { findFirst } });
    await expect(
      service.assertVehicleAccess(staffContext, 'vehicle-b', 'vehicles.view'),
    ).rejects.toMatchObject({ code: 'OWNER_ACCESS_DENIED' });
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        id: 'vehicle-b',
        ownerProfileId: 'owner-a',
        staffAssignments: { some: { membershipId: 'membership-a' } },
      },
    });
  });

  it('scope-checks direct rental references through the assigned vehicle relation', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'booking-a',
      ownerUserId: 'owner-user',
      publicReference: 'CR-A',
      vehicleId: 'vehicle-a',
    });
    const service = serviceWithClient({ booking: { findFirst } });
    const context = { ...staffContext, permissions: ['rentals.view'] };
    await expect(
      service.assertBookingAccess(context, 'CR-A', 'rentals.view'),
    ).resolves.toMatchObject({ vehicleId: 'vehicle-a' });
    expect(findFirst).toHaveBeenCalledWith({
      select: { id: true, ownerUserId: true, publicReference: true, vehicleId: true },
      where: {
        publicReference: 'CR-A',
        vehicle: {
          ownerProfileId: 'owner-a',
          staffAssignments: { some: { membershipId: 'membership-a' } },
        },
      },
    });
  });

  it('denies an unassigned or cross-owner direct rental reference', async () => {
    const service = serviceWithClient({ booking: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.assertBookingAccess(
        { ...staffContext, permissions: ['rentals.view'] },
        'CR-OTHER',
        'rentals.view',
      ),
    ).rejects.toMatchObject({ code: 'OWNER_ACCESS_DENIED' });
  });

  it('allows Owner to create Manager and Staff, while Manager may create Staff only', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'membership' });
    const service = serviceWithClient({
      ownerStaffMembership: { create },
      permission: { findMany: vi.fn().mockResolvedValue([{ id: 'permission' }]) },
    });
    for (const role of [OwnerStaffRole.MANAGER, OwnerStaffRole.STAFF]) {
      await expect(
        service.createMembership({
          actor: ownerContext,
          actorUserId: 'owner-user',
          displayName: 'Staff Person',
          normalizedEmail: 'staff@example.com',
          permissions: ['vehicles.view'],
          role,
          vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
        }),
      ).resolves.toEqual({ id: 'membership' });
    }
    const manager = {
      ...staffContext,
      capacity: 'MANAGER' as const,
      permissions: ['staff.invite'],
    };
    await expect(
      service.createMembership({
        actor: manager,
        actorUserId: 'manager-user',
        displayName: 'Manager Two',
        normalizedEmail: 'manager@example.com',
        permissions: ['vehicles.view'],
        role: OwnerStaffRole.MANAGER,
        vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
      }),
    ).rejects.toThrow('ordinary Staff only');
  });

  it('attributes delegated audit records to the real actor and membership', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit' });
    const service = serviceWithClient({ auditLog: { create } });
    await service.auditDelegatedAction({
      action: 'OWNER_WORKSPACE_VEHICLE_VIEWED',
      actorUserId: 'staff-user',
      context: staffContext,
      permission: 'vehicles.view',
      targetId: 'vehicle-a',
      targetType: 'VEHICLE',
      vehicleId: 'vehicle-a',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: 'staff-user',
        metadata: expect.objectContaining({
          capacity: 'STAFF',
          membershipId: 'membership-a',
          ownerProfileId: 'owner-a',
          permission: 'vehicles.view',
          vehicleId: 'vehicle-a',
        }),
      }),
    });
  });

  it('prevents an existing account with a different email from accepting an invitation', async () => {
    const transaction = vi.fn();
    const service = serviceWithClient({
      $transaction: transaction,
      ownerStaffInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          id: 'invitation-id',
          membership: {
            id: 'membership-a',
            normalizedEmail: 'invited@example.com',
            status: OwnerStaffStatus.INVITED,
          },
          membershipId: 'membership-a',
          revokedAt: null,
          tokenHash: 'hash',
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          emailVerifiedAt: new Date(),
          normalizedEmail: 'attacker@example.com',
        }),
      },
    });
    await expect(service.acceptInvitation('raw-token', 'attacker-user')).rejects.toMatchObject({
      code: 'OWNER_STAFF_INVITATION_INVALID',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('allows exactly one winner when an invitation is consumed concurrently', async () => {
    const consume = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
    const transactionClient = {
      ownerStaffInvitation: {
        updateMany: consume,
      },
      ownerStaffMembership: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = serviceWithClient({
      $transaction: vi.fn(async (callback) => callback(transactionClient)),
      ownerStaffInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          consumedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          id: 'invitation-id',
          membership: {
            id: 'membership-a',
            normalizedEmail: 'invited@example.com',
            status: OwnerStaffStatus.INVITED,
          },
          membershipId: 'membership-a',
          revokedAt: null,
          tokenHash: 'hash',
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          emailVerifiedAt: new Date(),
          normalizedEmail: 'invited@example.com',
        }),
      },
    });
    const results = await Promise.allSettled([
      service.acceptInvitation('raw-token', 'invited-user'),
      service.acceptInvitation('raw-token', 'invited-user'),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  });
});
