import { describe, expect, it, vi } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import {
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
} from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './vehicles.dto';

const managerContext: OwnerAccessContext = {
  capacity: 'MANAGER',
  membershipId: 'membership-manager',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-profile',
  permissions: ['vehicles.create', 'vehicles.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
};

function vehicleRecord(overrides: Record<string, unknown> = {}) {
  return {
    approvedAt: null,
    archivedAt: null,
    archivedByUserId: null,
    blockedPeriods: [],
    bookings: [],
    category: null,
    categoryId: null,
    color: null,
    createdAt: new Date('2026-10-12T00:00:00Z'),
    createdByMembershipId: 'membership-manager',
    createdByUserId: 'manager-user',
    description: null,
    documents: [],
    doorCount: null,
    features: [],
    fuelType: null,
    id: 'vehicle-new',
    knownIssues: [],
    lastCompletedSection: null,
    location: null,
    make: null,
    model: null,
    modelYear: null,
    operationalStatus: VehicleOperationalStatus.AVAILABLE,
    ownerProfileId: 'owner-profile',
    ownerUserId: 'owner-user',
    photos: [],
    plateHash: null,
    plateNumber: null,
    policyVersions: [],
    powertrain: null,
    rentalRequirements: null,
    removalOtherReason: null,
    removalReason: null,
    reviewReason: null,
    revision: 0,
    seatCount: null,
    status: VehicleLifecycleStatus.DRAFT,
    statusHistory: [],
    submittedAt: null,
    transmission: null,
    updatedAt: new Date('2026-10-12T00:00:00Z'),
    variant: null,
    vin: null,
    vinHash: null,
    ...overrides,
  };
}

function setup(options: {
  readonly assignmentRejects?: boolean;
  readonly context?: OwnerAccessContext;
}) {
  const context = options.context ?? managerContext;
  const created = vehicleRecord({
    createdByMembershipId: context.membershipId,
    ownerProfileId: context.ownerProfileId,
  });
  const transaction = {
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    ownerStaffVehicleAssignment: {
      create: options.assignmentRejects
        ? vi.fn().mockRejectedValue(new Error('assignment failed'))
        : vi.fn().mockResolvedValue({ membershipId: context.membershipId }),
    },
    vehicle: { create: vi.fn().mockResolvedValue(created) },
    vehicleStatusHistory: { create: vi.fn().mockResolvedValue({ id: 'history-a' }) },
  };
  const client = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
      callback(transaction),
    ),
    ownerProfile: {
      findUnique: vi.fn().mockResolvedValue({ userId: 'owner-user' }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'owner-profile' }),
    },
  };
  const requirePermission = vi.fn((candidate: OwnerAccessContext, permission: string) => {
    if (candidate.capacity !== 'OWNER' && !candidate.permissions.includes(permission))
      throw new Error('permission denied');
  });
  const service = new VehiclesService(
    { client } as never,
    { assertDraftCapable: vi.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { requirePermission } as never,
  );
  const { createdByMembershipId, createdByUserId, ...safeCreated } = created;
  void createdByMembershipId;
  void createdByUserId;
  vi.spyOn(service as never, 'getAccessible' as never).mockResolvedValue(safeCreated as never);
  return { client, context, requirePermission, service, transaction };
}

describe('delegated Manager vehicle creation', () => {
  it('preserves the existing Owner creation path and Owner creator attribution', async () => {
    const { service, transaction } = setup({});
    await service.create('owner-user', {}, {});
    expect(transaction.vehicle.create).toHaveBeenCalledWith({
      data: {
        createdByUserId: 'owner-user',
        ownerProfileId: 'owner-profile',
        ownerUserId: 'owner-user',
      },
    });
    expect(transaction.ownerStaffVehicleAssignment.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('creates an Owner-owned DRAFT with Manager provenance, assignment, history, and audit', async () => {
    const { context, requirePermission, service, transaction } = setup({});
    const result = await service.createForOwnerAccess(
      context,
      'manager-user',
      {},
      { correlationId: 'request-a' },
    );
    expect(result).toMatchObject({ id: 'vehicle-new', revision: 0, status: 'DRAFT' });
    expect(result).not.toHaveProperty('createdByMembershipId');
    expect(result).not.toHaveProperty('createdByUserId');

    expect(requirePermission).toHaveBeenCalledWith(context, 'vehicles.create');
    expect(transaction.vehicle.create).toHaveBeenCalledWith({
      data: {
        createdByMembershipId: 'membership-manager',
        createdByUserId: 'manager-user',
        ownerProfileId: 'owner-profile',
        ownerUserId: 'owner-user',
      },
    });
    expect(transaction.ownerStaffVehicleAssignment.create).toHaveBeenCalledWith({
      data: {
        assignedByUserId: 'manager-user',
        membershipId: 'membership-manager',
        vehicleId: 'vehicle-new',
      },
    });
    expect(transaction.vehicleStatusHistory.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'manager-user',
        correlationId: 'request-a',
        newStatus: VehicleLifecycleStatus.DRAFT,
        vehicleId: 'vehicle-new',
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'OWNER_WORKSPACE_VEHICLE_CREATED',
        actorUserId: 'manager-user',
        metadata: expect.objectContaining({
          membershipId: 'membership-manager',
          ownerProfileId: 'owner-profile',
          permission: 'vehicles.create',
          vehicleId: 'vehicle-new',
        }),
        targetId: 'vehicle-new',
      }),
    });
    expect(transaction).not.toHaveProperty('vehicleOwnerApprovalRequest');
  });

  it('does not create an assignment for an all-vehicles Manager', async () => {
    const context = {
      ...managerContext,
      vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
    };
    const { service, transaction } = setup({ context });
    await service.createForOwnerAccess(context, 'manager-user', {}, {});
    expect(transaction.ownerStaffVehicleAssignment.create).not.toHaveBeenCalled();
  });

  it.each([
    ['ordinary Staff', { ...managerContext, capacity: 'STAFF' as const }],
    ['Operations Staff', { ...managerContext, capacity: 'STAFF' as const }],
    ['Support Staff', { ...managerContext, capacity: 'STAFF' as const }],
    ['Custom Staff', { ...managerContext, capacity: 'STAFF' as const }],
    ['suspended Manager', { ...managerContext, membershipStatus: OwnerStaffStatus.SUSPENDED }],
    ['disabled Manager', { ...managerContext, membershipStatus: OwnerStaffStatus.DISABLED }],
  ])('denies %s creation even if the context contains the permission', async (_label, context) => {
    const { service, transaction } = setup({ context });
    await expect(service.createForOwnerAccess(context, 'actor-user', {}, {})).rejects.toMatchObject(
      {
        code: 'OWNER_ACCESS_DENIED',
      },
    );
    expect(transaction.vehicle.create).not.toHaveBeenCalled();
  });

  it('denies a Manager without the exact create permission', async () => {
    const context = { ...managerContext, permissions: ['vehicles.view'] };
    const { service, transaction } = setup({ context });
    await expect(service.createForOwnerAccess(context, 'manager-user', {}, {})).rejects.toThrow(
      'permission denied',
    );
    expect(transaction.vehicle.create).not.toHaveBeenCalled();
  });

  it('does not allow the workspace route to substitute actual Owner-role authority', async () => {
    const context: OwnerAccessContext = {
      capacity: 'OWNER',
      membershipStatus: 'OWNER',
      ownerProfileId: 'owner-profile',
      permissions: [],
      vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
    };
    const { service, transaction } = setup({ context });
    await expect(service.createForOwnerAccess(context, 'owner-user', {}, {})).rejects.toMatchObject(
      {
        code: 'OWNER_ACCESS_DENIED',
      },
    );
    expect(transaction.vehicle.create).not.toHaveBeenCalled();
  });

  it('fails closed when the route workspace is unavailable', async () => {
    const { client, context, service, transaction } = setup({});
    client.ownerProfile.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.createForOwnerAccess(context, 'manager-user', {}, {}),
    ).rejects.toMatchObject({ code: 'OWNER_ACCESS_DENIED' });
    expect(transaction.vehicle.create).not.toHaveBeenCalled();
  });

  it('rolls back creation when selected-scope assignment fails', async () => {
    const { client, context, service, transaction } = setup({ assignmentRejects: true });
    await expect(service.createForOwnerAccess(context, 'manager-user', {}, {})).rejects.toThrow(
      'assignment failed',
    );
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.vehicleStatusHistory.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    'ownerProfileId',
    'ownerUserId',
    'createdByUserId',
    'createdByMembershipId',
    'status',
    'revision',
    'archivedAt',
  ])('rejects the forbidden request field %s', async (field) => {
    const pipe = new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    });
    await expect(
      pipe.transform(
        { [field]: 'forbidden', make: 'Toyota' },
        { metatype: CreateVehicleDto, type: 'body' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
