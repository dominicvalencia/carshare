import { describe, expect, it, vi } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus, OwnerStaffVehicleScopeMode } from '@carrental/database';
import type { OwnerAccessContext } from '../security/security-context';
import { RentalsService } from './rentals.service';

const context: OwnerAccessContext = {
  capacity: OwnerStaffRole.MANAGER,
  membershipId: 'membership-1',
  membershipStatus: OwnerStaffStatus.ACTIVE,
  ownerProfileId: 'owner-profile-1',
  permissions: ['rentals.view'],
  vehicleScopeMode: OwnerStaffVehicleScopeMode.SELECTED_VEHICLES,
};

function subject(bookings: readonly object[] = [{}]) {
  const ownerAccess = {
    assertBookingAccess: vi.fn().mockResolvedValue({ vehicleId: 'vehicle-1' }),
    vehicleWhere: vi.fn().mockReturnValue({
      ownerProfileId: context.ownerProfileId,
      staffAssignments: { some: { membershipId: context.membershipId } },
    }),
  };
  const serialize = vi.fn().mockImplementation(async () => ({
    disputes: [{ id: 'dispute-1' }],
    postReturnClaims: [{ id: 'claim-1' }],
    publicReference: 'CR-1',
  }));
  const service = Object.assign(Object.create(RentalsService.prototype) as object, {
    database: {
      client: { booking: { findMany: vi.fn().mockResolvedValue(bookings) } },
    },
    evaluateReadiness: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(bookings[0]),
    ownerAccess,
    serialize,
  }) as RentalsService;
  return { ownerAccess, serialize, service };
}

describe('delegated rental reads', () => {
  it('awaits serialized detail before applying the delegated projection', async () => {
    const { ownerAccess, service } = subject();

    await expect(service.ownerDetailForAccess(context, 'CR-1')).resolves.toEqual({
      publicReference: 'CR-1',
    });
    expect(ownerAccess.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'rentals.view');
  });

  it('awaits every serialized list item and keeps the workspace vehicle filter', async () => {
    const { ownerAccess, serialize, service } = subject([{}, {}]);

    const result = await service.listForOwnerAccess(context);

    expect(result).toEqual([{ publicReference: 'CR-1' }, { publicReference: 'CR-1' }]);
    expect(serialize).toHaveBeenCalledTimes(2);
    expect(ownerAccess.vehicleWhere).toHaveBeenCalledWith(context, 'rentals.view');
  });
});
