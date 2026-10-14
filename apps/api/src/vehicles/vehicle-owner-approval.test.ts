import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  Prisma,
  VehicleLifecycleStatus,
  VehicleOwnerApprovalStatus,
  VehiclePowertrain,
} from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { VehiclesService } from './vehicles.service';

const managerContext: OwnerAccessContext = {
  capacity: 'MANAGER',
  membershipId: 'membership-manager',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-profile',
  permissions: ['vehicles.create', 'vehicles.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.ALL_VEHICLES,
};

const completeVehicle = {
  categoryId: 'category',
  color: 'White',
  createdByMembershipId: 'membership-manager',
  documents: [],
  doorCount: 4,
  fuelType: 'GASOLINE',
  id: 'vehicle-a',
  location: { latitude: 14, longitude: 121 },
  make: 'Toyota',
  model: 'Vios',
  modelYear: 2026,
  ownerProfileId: 'owner-profile',
  ownerUserId: 'owner-user',
  photos: ['FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'INTERIOR_DASHBOARD'].map(
    (perspective, index) => ({
      isCover: index === 0,
      perspective,
      removedAt: null,
    }),
  ),
  plateHash: 'plate-hash',
  policyVersions: [{ evReturnPolicy: null, fuelReturnPolicy: 'FULL_TO_FULL' }],
  powertrain: VehiclePowertrain.ICE,
  revision: 7,
  seatCount: 5,
  status: VehicleLifecycleStatus.DRAFT,
  transmission: 'AUTOMATIC',
};

function setup(input?: {
  approval?: Record<string, unknown> | null;
  ownerApprovalBypassEnabled?: boolean;
  vehicle?: Record<string, unknown> | null;
}) {
  const approval =
    input?.approval === undefined
      ? {
          id: 'approval-a',
          ownerProfileId: 'owner-profile',
          status: VehicleOwnerApprovalStatus.PENDING,
          submittedByUserId: 'manager-user',
          submittedRevision: 7,
          vehicleId: 'vehicle-a',
        }
      : input.approval;
  const vehicle = input?.vehicle === undefined ? completeVehicle : input.vehicle;
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    ownerStaffMembership: {
      findFirst: vi.fn().mockResolvedValue({
        displayName: 'Manager Name',
        ownerApprovalBypassEnabled: input?.ownerApprovalBypassEnabled ?? false,
        permissions: [{ permissionId: 'vehicles-create' }],
      }),
    },
    outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-a' }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        profile: { displayName: 'Manager Name', firstName: null, lastName: null },
      }),
    },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockResolvedValue({}),
    },
    vehicleDocumentDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    vehicleOwnerApprovalRequest: {
      create: vi.fn().mockResolvedValue({
        id: 'approval-a',
        status: VehicleOwnerApprovalStatus.PENDING,
        submittedRevision: 7,
      }),
      findFirst: vi.fn().mockResolvedValue(approval),
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve({ ...approval, ...data }),
        ),
    },
    vehicleStatusHistory: { create: vi.fn().mockResolvedValue({ id: 'history-a' }) },
  };
  const client = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
  };
  const ownerAccess = {
    assertVehicleAccess: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn(),
  };
  const service = new VehiclesService(
    { client } as never,
    {
      assertDraftCapable: vi.fn().mockResolvedValue(undefined),
      assertOperational: vi.fn().mockResolvedValue(undefined),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ownerAccess as never,
  );
  vi.spyOn(service, 'getOwned').mockResolvedValue({ id: 'vehicle-a' } as never);
  return { client, ownerAccess, service, transaction };
}

describe('delegated vehicle Owner approval', () => {
  it('submits the current revision without changing the vehicle lifecycle', async () => {
    const { ownerAccess, service, transaction } = setup();
    await expect(
      service.submitForOwnerApproval(managerContext, 'manager-user', 'vehicle-a', {
        correlationId: 'request-a',
      }),
    ).resolves.toMatchObject({ status: VehicleOwnerApprovalStatus.PENDING, submittedRevision: 7 });
    expect(ownerAccess.assertVehicleAccess).toHaveBeenCalledWith(
      managerContext,
      'vehicle-a',
      'vehicles.create',
    );
    expect(transaction.vehicleOwnerApprovalRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submittedByMembershipId: 'membership-manager',
        submittedByUserId: 'manager-user',
        submittedRevision: 7,
      }),
    });
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.vehicleStatusHistory.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: 'approval-a',
        aggregateType: 'VEHICLE_OWNER_APPROVAL',
        eventType: 'VEHICLE_OWNER_APPROVAL_SUBMITTED',
        payload: expect.objectContaining({
          managerDisplayName: 'Manager Name',
          recipientUserId: 'owner-user',
          vehicleDisplayName: 'Toyota Vios',
          vehicleId: 'vehicle-a',
        }),
      }),
    });
  });

  it('sends a trusted Manager-created vehicle directly to CarShare review', async () => {
    const { service, transaction } = setup({ ownerApprovalBypassEnabled: true });

    await expect(
      service.submitForOwnerApproval(managerContext, 'manager-user', 'vehicle-a', {
        correlationId: 'request-a',
      }),
    ).resolves.toMatchObject({
      ownerApprovalBypassed: true,
      status: VehicleLifecycleStatus.PENDING_APPROVAL,
      submittedRevision: 7,
      vehicleId: 'vehicle-a',
    });
    expect(transaction.vehicleOwnerApprovalRequest.create).not.toHaveBeenCalled();
    expect(transaction.vehicle.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: VehicleLifecycleStatus.PENDING_APPROVAL,
        submittedAt: expect.any(Date),
      }),
      where: { id: 'vehicle-a' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'VEHICLE_TRUSTED_MANAGER_SUBMITTED_FOR_REVIEW',
        metadata: expect.objectContaining({
          ownerApprovalBypassEnabled: true,
          ownerApprovalBypassed: true,
          permission: 'vehicles.create',
        }),
      }),
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: 'vehicle-a',
        aggregateType: 'VEHICLE',
        eventType: 'VEHICLE_TRUSTED_MANAGER_SUBMITTED_FOR_REVIEW',
        payload: expect.objectContaining({
          managerDisplayName: 'Manager Name',
          recipientUserId: 'owner-user',
          vehicleDisplayName: 'Toyota Vios',
          vehicleId: 'vehicle-a',
        }),
      }),
    });
  });

  it('revalidates trusted Manager membership and vehicle-create permission transactionally', async () => {
    const { service, transaction } = setup({ ownerApprovalBypassEnabled: true });
    transaction.ownerStaffMembership.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.submitForOwnerApproval(managerContext, 'manager-user', 'vehicle-a', {}),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN' });
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.vehicleOwnerApprovalRequest.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('does not let a trusted Manager submit another Manager’s draft', async () => {
    const { service, transaction } = setup({
      ownerApprovalBypassEnabled: true,
      vehicle: { ...completeVehicle, createdByMembershipId: 'membership-other' },
    });

    await expect(
      service.submitForOwnerApproval(managerContext, 'manager-user', 'vehicle-a', {}),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN' });
    expect(transaction.ownerStaffMembership.findFirst).not.toHaveBeenCalled();
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
  });

  it.each([
    ['ordinary Staff', { ...managerContext, capacity: 'STAFF' as const }],
    ['suspended Manager', { ...managerContext, membershipStatus: OwnerStaffStatus.SUSPENDED }],
    ['disabled Manager', { ...managerContext, membershipStatus: OwnerStaffStatus.DISABLED }],
  ])('denies submit for %s', async (_label, context) => {
    const { service, transaction } = setup();
    await expect(
      service.submitForOwnerApproval(context, 'actor-user', 'vehicle-a', {}),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_FORBIDDEN' });
    expect(transaction.vehicleOwnerApprovalRequest.create).not.toHaveBeenCalled();
  });

  it('withdraws the pending request while keeping the vehicle DRAFT', async () => {
    const { service, transaction } = setup();
    await service.withdrawOwnerApprovalSubmission(
      managerContext,
      'manager-user-2',
      'vehicle-a',
      {},
    );
    expect(transaction.vehicleOwnerApprovalRequest.update).toHaveBeenCalledWith({
      data: { status: VehicleOwnerApprovalStatus.WITHDRAWN },
      where: { id: 'approval-a' },
    });
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('translates the pending-request uniqueness race into a safe conflict', async () => {
    const { client, service } = setup();
    const conflict = new Prisma.PrismaClientKnownRequestError('duplicate pending request', {
      clientVersion: 'test',
      code: 'P2002',
    });
    client.$transaction.mockRejectedValueOnce(conflict);
    await expect(
      service.submitForOwnerApproval(managerContext, 'manager-user', 'vehicle-a', {}),
    ).rejects.toMatchObject({
      code: 'VEHICLE_OWNER_APPROVAL_ALREADY_PENDING',
      status: 409,
    });
  });

  it('returns a request for changes with Owner reviewer metadata and reason', async () => {
    const { service, transaction } = setup();
    await service.returnOwnerApprovalForChanges(
      'owner-user',
      'vehicle-a',
      'approval-a',
      'Please replace the registration document.',
      {},
    );
    expect(transaction.vehicleOwnerApprovalRequest.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewReason: 'Please replace the registration document.',
        reviewedByUserId: 'owner-user',
        status: VehicleOwnerApprovalStatus.CHANGES_REQUIRED,
      }),
      where: { id: 'approval-a' },
    });
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'VEHICLE_OWNER_APPROVAL_CHANGES_REQUIRED',
        payload: expect.objectContaining({ recipientUserId: 'manager-user' }),
      }),
    });
  });

  it('approves the exact submitted revision and uses the platform-review transition', async () => {
    const { service, transaction } = setup();
    await service.approveOwnerApproval('owner-user', 'vehicle-a', 'approval-a', {
      correlationId: 'request-a',
    });
    expect(transaction.vehicleOwnerApprovalRequest.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewedByUserId: 'owner-user',
        status: VehicleOwnerApprovalStatus.APPROVED,
      }),
      where: { id: 'approval-a' },
    });
    expect(transaction.vehicle.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: VehicleLifecycleStatus.PENDING_APPROVAL,
      }),
      where: { id: 'vehicle-a' },
    });
    expect(transaction.vehicleStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        newStatus: VehicleLifecycleStatus.PENDING_APPROVAL,
        previousStatus: VehicleLifecycleStatus.DRAFT,
      }),
    });
    expect(transaction.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'VEHICLE_OWNER_APPROVAL_APPROVED',
        payload: expect.objectContaining({ recipientUserId: 'manager-user' }),
      }),
    });
  });

  it('fails stale approval without mutating either request or vehicle', async () => {
    const { service, transaction } = setup({
      vehicle: { ...completeVehicle, revision: 8 },
    });
    await expect(
      service.approveOwnerApproval('owner-user', 'vehicle-a', 'approval-a', {}),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_STALE', status: 409 });
    expect(transaction.vehicleOwnerApprovalRequest.update).not.toHaveBeenCalled();
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
    expect(transaction.vehicleStatusHistory.create).not.toHaveBeenCalled();
    expect(transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('blocks future delegated draft mutation paths while approval is pending', async () => {
    const { service, transaction } = setup();
    await expect(
      service.assertDelegatedDraftMutationAllowed(transaction as never, 'vehicle-a'),
    ).rejects.toMatchObject({ code: 'VEHICLE_OWNER_APPROVAL_ALREADY_PENDING' });
  });

  it.each([VehicleLifecycleStatus.DRAFT, VehicleLifecycleStatus.APPROVED])(
    'increments the revision once for an Owner specification mutation in %s',
    async (status) => {
      const vehicleUpdate = vi.fn().mockResolvedValue({});
      const client = {
        vehicle: {
          findFirstOrThrow: vi.fn().mockResolvedValue({
            fuelType: 'GASOLINE',
            powertrain: VehiclePowertrain.ICE,
            status,
          }),
          update: vehicleUpdate,
        },
      };
      const service = new VehiclesService(
        { client } as never,
        { assertDraftCapable: vi.fn().mockResolvedValue(undefined) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      vi.spyOn(service, 'getOwned').mockResolvedValue({ id: 'vehicle-a' } as never);
      await service.update('owner-user', 'vehicle-a', { description: 'Updated listing' });
      expect(vehicleUpdate).toHaveBeenCalledTimes(1);
      expect(vehicleUpdate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Updated listing',
          revision: { increment: 1 },
        }),
        where: { id: 'vehicle-a' },
      });
    },
  );

  it.each([VehicleLifecycleStatus.DRAFT, VehicleLifecycleStatus.APPROVED])(
    'increments the revision once for a material child mutation in %s',
    async (status) => {
      const transaction = {
        vehicle: { update: vi.fn().mockResolvedValue({ revision: 8 }) },
        vehicleFeatureAssignment: {
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const client = {
        $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
          callback(transaction),
        ),
        vehicle: {
          findFirstOrThrow: vi.fn().mockResolvedValue({ status }),
        },
        vehicleFeature: { count: vi.fn().mockResolvedValue(1) },
      };
      const service = new VehiclesService(
        { client } as never,
        { assertDraftCapable: vi.fn().mockResolvedValue(undefined) } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      vi.spyOn(service, 'getOwned').mockResolvedValue({ id: 'vehicle-a' } as never);
      await service.setFeatures('owner-user', 'vehicle-a', { featureIds: ['feature-a'] });
      expect(transaction.vehicle.update).toHaveBeenCalledTimes(1);
      expect(transaction.vehicle.update).toHaveBeenCalledWith({
        data: { revision: { increment: 1 } },
        select: { revision: true },
        where: { id: 'vehicle-a' },
      });
    },
  );
});
