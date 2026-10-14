import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceRentalsController } from './owner-workspace-rentals.controller';

const context = {
  capacity: 'STAFF' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE' as const,
  ownerProfileId: 'owner-profile-1',
  permissions: [
    'rentals.view',
    'handover.perform',
    'return.perform',
    'inspections.create',
    'inspections.update',
  ],
  vehicleScopeMode: 'SELECTED_VEHICLES' as const,
};
const principal = {
  ownerAccess: context,
  permissions: [],
  roles: [],
  sessionId: 'session-1',
  status: 'ACTIVE' as const,
  userId: 'staff-user-1',
};
const booking = {
  id: 'booking-1',
  ownerUserId: 'owner-user-1',
  publicReference: 'CR-1',
  vehicleId: 'vehicle-1',
};

function setup() {
  const rentals = {
    confirmReturn: vi.fn().mockResolvedValue({}),
    escalatePickupDiscrepancy: vi.fn().mockResolvedValue({}),
    listForOwnerAccess: vi.fn().mockResolvedValue([]),
    ownerDetailForAccess: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
    reportOverdueHandoverRecovery: vi.fn().mockResolvedValue({ publicReference: 'CR-1' }),
    requestInspectionCorrection: vi.fn().mockResolvedValue({ id: 'correction-1' }),
    respondToPickupDiscrepancy: vi.fn().mockResolvedValue({}),
    submitInspection: vi.fn().mockResolvedValue({}),
    verifyPickup: vi.fn().mockResolvedValue({}),
  };
  const access = {
    assertBookingAccess: vi.fn().mockResolvedValue(booking),
    auditDelegatedAction: vi.fn().mockResolvedValue(undefined),
    requirePermission: vi.fn(),
  };
  return {
    access,
    controller: new OwnerWorkspaceRentalsController(rentals as never, access as never),
    rentals,
  };
}

describe('OwnerWorkspaceRentalsController', () => {
  it('lists only through the resolved workspace context', async () => {
    const { controller, rentals } = setup();
    await controller.list(principal as never);
    expect(rentals.listForOwnerAccess).toHaveBeenCalledWith(context);
  });

  it('loads rental detail through the resolved workspace context', async () => {
    const { controller, rentals } = setup();
    await controller.detail(principal as never, 'CR-1');
    expect(rentals.ownerDetailForAccess).toHaveBeenCalledWith(context, 'CR-1');
  });

  it('separates the owner of record from the delegated pickup actor', async () => {
    const { access, controller, rentals } = setup();
    await controller.verifyPickup(principal as never, 'CR-1', { code: '123456' }, {
      headers: {},
    } as never);
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'handover.perform');
    expect(rentals.verifyPickup).toHaveBeenCalledWith(
      'owner-user-1',
      'CR-1',
      '123456',
      expect.any(Object),
      'staff-user-1',
    );
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'staff-user-1',
        permission: 'handover.perform',
        vehicleId: 'vehicle-1',
      }),
    );
  });

  it('requires both inspection permissions for pickup evidence submission', async () => {
    const { access, controller, rentals } = setup();
    await controller.pickupInspection(
      principal as never,
      'CR-1',
      {} as never,
      { headers: {} } as never,
    );
    expect(access.requirePermission).toHaveBeenCalledWith(context, 'inspections.create');
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'inspections.update');
    expect(rentals.submitInspection).toHaveBeenCalledWith(
      'staff-user-1',
      'CR-1',
      'PICKUP',
      {},
      expect.any(Object),
      { actorUserId: 'staff-user-1', ownerUserId: 'owner-user-1' },
    );
  });

  it('uses return.perform for owner review of renter-submitted return evidence', async () => {
    const { access, controller, rentals } = setup();
    await controller.confirmReturn(principal as never, 'CR-1', { decision: 'AGREED' }, {
      headers: {},
    } as never);
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'return.perform');
    expect(rentals.confirmReturn).toHaveBeenCalledWith(
      'staff-user-1',
      'CR-1',
      { decision: 'AGREED' },
      expect.any(Object),
      { actorUserId: 'staff-user-1', ownerUserId: 'owner-user-1' },
    );
  });

  it('requires both operational permissions and returns the scoped recovery projection', async () => {
    const { access, controller, rentals } = setup();
    const result = await controller.overdueRecovery(
      principal as never,
      'CR-1',
      {
        acknowledged: true,
        acknowledgementVersion: 'OVERDUE_HANDOVER_RECOVERY_V1',
        reportedPickupAt: '2026-10-07T02:24:00.000Z',
        reportedReturnAt: '2026-10-09T04:43:00.000Z',
        scope: 'BOTH',
      },
      { headers: {} } as never,
    );

    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'handover.perform');
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'return.perform');
    expect(rentals.reportOverdueHandoverRecovery).toHaveBeenCalledWith(
      'owner-user-1',
      'CR-1',
      expect.objectContaining({ scope: 'BOTH' }),
      expect.any(Object),
      'staff-user-1',
    );
    expect(rentals.ownerDetailForAccess).toHaveBeenCalledWith(context, 'CR-1');
    expect(access.auditDelegatedAction).toHaveBeenCalledTimes(2);
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'staff-user-1',
        permission: 'handover.perform',
        vehicleId: 'vehicle-1',
      }),
    );
    expect(access.auditDelegatedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'staff-user-1',
        permission: 'return.perform',
        vehicleId: 'vehicle-1',
      }),
    );
    expect(result).toEqual({ publicReference: 'CR-1' });
  });

  it('routes delegated discrepancy coordination through handover authority', async () => {
    const { access, controller, rentals } = setup();
    await controller.respondToPickupDiscrepancy(
      principal as never,
      'CR-1',
      { responseText: 'Condition acknowledged.', responseType: 'ACKNOWLEDGE_CONDITION' } as never,
      { headers: {} } as never,
    );
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'handover.perform');
    expect(rentals.respondToPickupDiscrepancy).toHaveBeenCalledWith(
      'owner-user-1',
      'CR-1',
      expect.any(Object),
      expect.any(Object),
      'staff-user-1',
    );
    expect(rentals.ownerDetailForAccess).toHaveBeenCalledWith(context, 'CR-1');
  });

  it('routes inspection correction through scoped inspection authority', async () => {
    const { access, controller, rentals } = setup();
    await controller.requestCorrection(
      principal as never,
      'CR-1',
      'inspection-1',
      { proposedOdometerMeters: '1000', reason: 'Correct the recorded odometer reading.' },
      { headers: {} } as never,
    );
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'inspections.update');
    expect(rentals.requestInspectionCorrection).toHaveBeenCalledWith(
      'owner-user-1',
      'CR-1',
      'inspection-1',
      expect.any(Object),
      expect.any(Object),
      'staff-user-1',
    );
  });
});
