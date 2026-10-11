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
    listForOwnerAccess: vi.fn().mockResolvedValue([]),
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
});
