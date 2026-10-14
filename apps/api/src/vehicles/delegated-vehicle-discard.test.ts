import { describe, expect, it, vi } from 'vitest';
import {
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  VehicleLifecycleStatus,
  VehicleOwnerApprovalStatus,
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

function setup(options?: {
  approvalStatus?: VehicleOwnerApprovalStatus | null;
  creatorMembershipId?: string | null;
  status?: VehicleLifecycleStatus;
}) {
  const approval =
    options?.approvalStatus === null
      ? null
      : {
          id: 'approval-a',
          status: options?.approvalStatus ?? VehicleOwnerApprovalStatus.PENDING,
          submittedAt: new Date(),
        };
  const vehicle = {
    createdByMembershipId: options?.creatorMembershipId ?? 'membership-manager',
    id: 'vehicle-a',
    ownerProfileId: 'owner-profile',
    status: options?.status ?? VehicleLifecycleStatus.DRAFT,
  };
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-a' }) },
    vehicle: {
      findFirst: vi.fn().mockResolvedValue(vehicle),
      update: vi.fn().mockResolvedValue({}),
    },
    vehicleOwnerApprovalRequest: {
      findFirst: vi.fn().mockResolvedValue(approval),
      update: vi.fn().mockResolvedValue({}),
    },
    vehicleStatusHistory: { create: vi.fn().mockResolvedValue({ id: 'history-a' }) },
  };
  const client = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    fileAsset: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    vehiclePhoto: { findMany: vi.fn().mockResolvedValue([]) },
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
  return { ownerAccess, service, transaction };
}

describe('delegated vehicle draft visibility and discard', () => {
  it.each([
    ['private draft', null, false],
    ['pending Owner review', VehicleOwnerApprovalStatus.PENDING, true],
    ['changes required', VehicleOwnerApprovalStatus.CHANGES_REQUIRED, true],
    ['withdrawn submission', VehicleOwnerApprovalStatus.WITHDRAWN, false],
  ])('projects Manager-created %s to the Owner correctly', (_label, status, visible) => {
    const { service } = setup();
    const record = {
      createdByMembershipId: 'membership-manager',
      ownerApprovalRequests: status ? [{ status }] : [],
      status: VehicleLifecycleStatus.DRAFT,
    };
    expect(
      Reflect.apply(
        (
          service as unknown as {
            vehicleVisibleToViewer: (vehicle: unknown, viewer: unknown) => boolean;
          }
        ).vehicleVisibleToViewer,
        service,
        [record, { kind: 'OWNER' }],
      ),
    ).toBe(visible);
  });

  it('keeps Owner-created drafts and post-Owner-approval vehicles visible', () => {
    const { service } = setup();
    const visible = (record: object) =>
      Reflect.apply(
        (
          service as unknown as {
            vehicleVisibleToViewer: (vehicle: unknown, viewer: unknown) => boolean;
          }
        ).vehicleVisibleToViewer,
        service,
        [record, { kind: 'OWNER' }],
      );
    expect(
      visible({
        createdByMembershipId: null,
        ownerApprovalRequests: [],
        status: VehicleLifecycleStatus.DRAFT,
      }),
    ).toBe(true);
    expect(
      visible({
        createdByMembershipId: 'membership-manager',
        ownerApprovalRequests: [{ status: VehicleOwnerApprovalStatus.APPROVED }],
        status: VehicleLifecycleStatus.PENDING_APPROVAL,
      }),
    ).toBe(true);
  });

  it('keeps a private draft visible only to its creating Manager', () => {
    const { service } = setup();
    const record = {
      createdByMembershipId: 'membership-manager',
      ownerApprovalRequests: [],
      status: VehicleLifecycleStatus.DRAFT,
    };
    const visible = (membershipId: string) =>
      Reflect.apply(
        (
          service as unknown as {
            vehicleVisibleToViewer: (vehicle: unknown, viewer: unknown) => boolean;
          }
        ).vehicleVisibleToViewer,
        service,
        [record, { context: { ...managerContext, membershipId }, kind: 'DELEGATED' }],
      );
    expect(visible('membership-manager')).toBe(true);
    expect(visible('membership-other')).toBe(false);
  });

  it('restricts Staff to approved live vehicles regardless of creator provenance', () => {
    const { service } = setup();
    const visible = (createdByMembershipId: string | null, status: VehicleLifecycleStatus) =>
      Reflect.apply(
        (
          service as unknown as {
            vehicleVisibleToViewer: (vehicle: unknown, viewer: unknown) => boolean;
          }
        ).vehicleVisibleToViewer,
        service,
        [
          { createdByMembershipId, ownerApprovalRequests: [], status },
          {
            context: { ...managerContext, capacity: 'STAFF', membershipId: 'membership-staff' },
            kind: 'DELEGATED',
          },
        ],
      );

    expect(visible(null, VehicleLifecycleStatus.DRAFT)).toBe(false);
    expect(visible('membership-staff', VehicleLifecycleStatus.DRAFT)).toBe(false);
    expect(visible('membership-manager', VehicleLifecycleStatus.PENDING_APPROVAL)).toBe(false);
    expect(visible(null, VehicleLifecycleStatus.APPROVED)).toBe(true);
  });

  it('archives its creator-owned draft and withdraws a pending request atomically', async () => {
    const { ownerAccess, service, transaction } = setup();
    await service.discardDelegatedDraft(managerContext, 'manager-user', 'vehicle-a', {
      correlationId: 'request-a',
    });
    expect(ownerAccess.assertVehicleAccess).toHaveBeenCalledWith(
      managerContext,
      'vehicle-a',
      'vehicles.create',
    );
    expect(transaction.vehicleOwnerApprovalRequest.update).toHaveBeenCalledWith({
      data: { status: VehicleOwnerApprovalStatus.WITHDRAWN },
      where: { id: 'approval-a' },
    });
    expect(transaction.vehicle.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: VehicleLifecycleStatus.ARCHIVED }),
      where: { id: 'vehicle-a' },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'OWNER_WORKSPACE_VEHICLE_DRAFT_DISCARDED',
        actorUserId: 'manager-user',
        metadata: expect.objectContaining({
          membershipId: 'membership-manager',
          priorApprovalStatus: VehicleOwnerApprovalStatus.PENDING,
        }),
      }),
    });
  });

  it('preserves non-pending approval history when discarding a returned draft', async () => {
    const { service, transaction } = setup({
      approvalStatus: VehicleOwnerApprovalStatus.CHANGES_REQUIRED,
    });
    await service.discardDelegatedDraft(managerContext, 'manager-user', 'vehicle-a', {});
    expect(transaction.vehicleOwnerApprovalRequest.update).not.toHaveBeenCalled();
    expect(transaction.vehicle.update).toHaveBeenCalled();
  });

  it.each([
    ['another Manager', managerContext, 'membership-other', VehicleLifecycleStatus.DRAFT],
    [
      'ordinary Staff',
      { ...managerContext, capacity: 'STAFF' as const },
      'membership-manager',
      VehicleLifecycleStatus.DRAFT,
    ],
    [
      'Manager without create permission',
      { ...managerContext, permissions: ['vehicles.view'] },
      'membership-manager',
      VehicleLifecycleStatus.DRAFT,
    ],
    [
      'platform-review vehicle',
      managerContext,
      'membership-manager',
      VehicleLifecycleStatus.PENDING_APPROVAL,
    ],
    ['approved vehicle', managerContext, 'membership-manager', VehicleLifecycleStatus.APPROVED],
  ])('denies discard for %s', async (_label, context, creatorMembershipId, status) => {
    const { ownerAccess, service, transaction } = setup({ creatorMembershipId, status });
    if (!context.permissions.includes('vehicles.create')) {
      ownerAccess.requirePermission.mockImplementationOnce(() => {
        throw new Error('permission denied');
      });
    }
    await expect(
      service.discardDelegatedDraft(context, 'actor-user', 'vehicle-a', {}),
    ).rejects.toBeDefined();
    expect(transaction.vehicle.update).not.toHaveBeenCalled();
  });
});
