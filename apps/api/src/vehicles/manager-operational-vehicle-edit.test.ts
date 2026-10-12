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
  permissions: ['vehicles.view', 'vehicles.update_operational_fields'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

function setup(options: { revision?: number; status?: VehicleLifecycleStatus } = {}) {
  const vehicle = {
    id: 'vehicle-a',
    make: 'Toyota',
    model: 'Vios',
    ownerProfileId: 'owner-profile',
    ownerUserId: 'owner-user',
    powertrain: 'ICE',
    revision: options.revision ?? 4,
    status: options.status ?? VehicleLifecycleStatus.APPROVED,
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-a' }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        profile: { displayName: 'Mika Manager', firstName: null, lastName: null },
      }),
    },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockResolvedValue({ revision: 5 }),
    },
  };
  const client = {
    $transaction: vi.fn((callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const ownerAccess = {
    assertVehicleAccess: vi.fn().mockResolvedValue(undefined),
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
  vi.spyOn(service, 'getForOwnerAccess').mockResolvedValue({
    id: 'vehicle-a',
    revision: 5,
  } as never);
  return { ownerAccess, service, transaction };
}

describe('delegated Manager operational vehicle editing', () => {
  it('updates only safe details immediately with one revision, audit, and Owner outbox event', async () => {
    const { ownerAccess, service, transaction } = setup();
    await expect(
      service.updateManagerOperationalDetails(
        context,
        'manager-user',
        'vehicle-a',
        { description: 'Airport-ready vehicle', expectedRevision: 4 },
        { correlationId: 'request-a' },
      ),
    ).resolves.toEqual({ id: 'vehicle-a', revision: 5 });

    expect(ownerAccess.assertVehicleAccess).toHaveBeenCalledWith(
      context,
      'vehicle-a',
      'vehicles.update_operational_fields',
    );
    expect(transaction.vehicle.update).toHaveBeenCalledWith({
      data: { description: 'Airport-ready vehicle', revision: { increment: 1 } },
      where: { id: 'vehicle-a' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'OWNER_WORKSPACE_VEHICLE_OPERATIONAL_FIELDS_UPDATED',
        actorUserId: 'manager-user',
        metadata: expect.objectContaining({
          changedFields: ['description'],
          membershipId: 'membership-manager',
          ownerProfileId: 'owner-profile',
          permission: 'vehicles.update_operational_fields',
          vehicleId: 'vehicle-a',
        }),
      }),
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'VEHICLE_OPERATIONAL_FIELDS_UPDATED',
        payload: expect.objectContaining({
          managerDisplayName: 'Mika Manager',
          recipientUserId: 'owner-user',
          vehicleDisplayName: 'Toyota Vios',
        }),
      }),
    });
  });

  it('rejects stale edits and creates no audit or notification', async () => {
    const { service, transaction } = setup({ revision: 5 });
    await expect(
      service.updateManagerOperationalDetails(
        context,
        'manager-user',
        'vehicle-a',
        { description: 'Stale', expectedRevision: 4 },
        {},
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    VehicleLifecycleStatus.DRAFT,
    VehicleLifecycleStatus.PENDING_APPROVAL,
    VehicleLifecycleStatus.ARCHIVED,
  ])('rejects operational edits outside APPROVED (%s)', async (status) => {
    const { service, transaction } = setup({ status });
    await expect(
      service.updateManagerOperationalDetails(
        context,
        'manager-user',
        'vehicle-a',
        { description: 'Blocked', expectedRevision: 4 },
        {},
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...context, capacity: 'STAFF' as const },
    { ...context, membershipStatus: OwnerStaffStatus.SUSPENDED },
    { ...context, membershipStatus: OwnerStaffStatus.DISABLED },
  ])('fails closed for an unauthorized delegated identity', async (unauthorized) => {
    const { ownerAccess, service, transaction } = setup();
    await expect(
      service.updateManagerOperationalDetails(
        unauthorized,
        'manager-user',
        'vehicle-a',
        { description: 'Blocked', expectedRevision: 4 },
        {},
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(ownerAccess.assertVehicleAccess).not.toHaveBeenCalled();
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
  });
});
