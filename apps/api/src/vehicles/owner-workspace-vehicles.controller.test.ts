import { describe, expect, it, vi } from 'vitest';
import { OwnerStaffStatus, OwnerStaffVehicleScopeMode, UserStatus } from '@carrental/database';
import type { RequestPrincipal } from '../security/security-context';
import { OwnerWorkspaceVehiclesController } from './owner-workspace-vehicles.controller';

const principal: RequestPrincipal = {
  ownerAccess: {
    capacity: 'STAFF',
    membershipId: 'membership-a',
    membershipStatus: OwnerStaffStatus.ACTIVE,
    ownerProfileId: 'owner-a',
    permissions: ['vehicles.view'],
    vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
  },
  roles: [],
  sessionId: 'session-a',
  status: UserStatus.ACTIVE,
  userId: 'staff-user',
};

describe('OwnerWorkspaceVehiclesController proof endpoint', () => {
  it('uses resolved Owner access for list reads and records delegated attribution', async () => {
    const listForOwnerAccess = vi.fn().mockResolvedValue([{ id: 'vehicle-a' }]);
    const auditDelegatedAction = vi.fn().mockResolvedValue(undefined);
    const controller = new OwnerWorkspaceVehiclesController(
      { listForOwnerAccess } as never,
      { auditDelegatedAction } as never,
    );
    await expect(
      controller.list(principal, { headers: {}, ip: '127.0.0.1' } as never),
    ).resolves.toEqual([{ id: 'vehicle-a' }]);
    expect(listForOwnerAccess).toHaveBeenCalledWith(principal.ownerAccess);
    expect(auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'staff-user',
        context: principal.ownerAccess,
        permission: 'vehicles.view',
      }),
    );
  });

  it('uses scoped direct read rather than the legacy owner-user route', async () => {
    const getForOwnerAccess = vi.fn().mockResolvedValue({ id: 'vehicle-a' });
    const controller = new OwnerWorkspaceVehiclesController(
      { getForOwnerAccess } as never,
      { auditDelegatedAction: vi.fn() } as never,
    );
    await controller.get(principal, 'vehicle-a', { headers: {}, ip: '127.0.0.1' } as never);
    expect(getForOwnerAccess).toHaveBeenCalledWith(principal.ownerAccess, 'vehicle-a');
  });
});
