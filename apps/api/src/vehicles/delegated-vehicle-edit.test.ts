import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  VehicleLifecycleStatus,
} from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { VehiclesService } from './vehicles.service';

const context: OwnerAccessContext = {
  capacity: 'MANAGER',
  membershipId: 'membership-manager',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-profile',
  permissions: ['vehicles.create', 'vehicles.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

function setup(
  options: {
    creatorMembershipId?: string;
    pending?: boolean;
    status?: VehicleLifecycleStatus;
  } = {},
) {
  const vehicle = {
    createdByMembershipId: options.creatorMembershipId ?? 'membership-manager',
    fuelType: 'GASOLINE',
    id: 'vehicle-a',
    ownerProfileId: 'owner-profile',
    powertrain: 'ICE',
    status: options.status ?? VehicleLifecycleStatus.DRAFT,
  };
  const client = {
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockResolvedValue({ ...vehicle, revision: 2 }),
    },
    vehicleOwnerApprovalRequest: {
      findFirst: vi.fn().mockResolvedValue(options.pending ? { id: 'approval-a' } : null),
    },
  };
  const ownerAccess = {
    assertVehicleAccess: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn(),
  };
  const service = new VehiclesService(
    { client } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ownerAccess as never,
  );
  vi.spyOn(service, 'getForOwnerAccess').mockResolvedValue({ id: 'vehicle-a' } as never);
  return { client, ownerAccess, service };
}

describe('delegated Manager draft editing', () => {
  it('updates the Manager-created draft through workspace authority and increments revision', async () => {
    const { client, ownerAccess, service } = setup();
    await expect(
      service.update('manager-user', 'vehicle-a', { description: 'Updated' }, context),
    ).resolves.toEqual({ id: 'vehicle-a' });
    expect(ownerAccess.requirePermission).toHaveBeenCalledWith(context, 'vehicles.create');
    expect(ownerAccess.assertVehicleAccess).toHaveBeenCalledWith(
      context,
      'vehicle-a',
      'vehicles.create',
    );
    expect(client.vehicle.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        description: 'Updated',
        revision: { increment: 1 },
      }),
      where: { id: 'vehicle-a' },
    });
  });

  it('blocks edits while Owner approval is pending', async () => {
    const { client, service } = setup({ pending: true });
    await expect(
      service.update('manager-user', 'vehicle-a', { description: 'Blocked' }, context),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_ALREADY_PENDING', status: 409 });
    expect(client.vehicle.update).not.toHaveBeenCalled();
  });

  it('blocks a Manager from editing a draft created by another membership', async () => {
    const { client, service } = setup({ creatorMembershipId: 'membership-other' });
    await expect(
      service.update('manager-user', 'vehicle-a', { description: 'Blocked' }, context),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN' });
    expect(client.vehicle.update).not.toHaveBeenCalled();
  });

  it.each([VehicleLifecycleStatus.APPROVED, VehicleLifecycleStatus.PENDING_APPROVAL])(
    'blocks delegated edits after the draft leaves DRAFT (%s)',
    async (status) => {
      const { client, service } = setup({ status });
      await expect(
        service.update('manager-user', 'vehicle-a', { description: 'Blocked' }, context),
      ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN' });
      expect(client.vehicle.update).not.toHaveBeenCalled();
    },
  );
});
