import { describe, expect, it, vi } from 'vitest';
import { OwnerWorkspaceClaimsController } from './owner-workspace-claims.controller';

const context = {
  capacity: 'MANAGER' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE' as const,
  ownerProfileId: 'owner-profile-1',
  permissions: ['claims.view', 'claims.create', 'claims.respond'],
  vehicleScopeMode: 'SELECTED_VEHICLES' as const,
};
const principal = {
  ownerAccess: context,
  permissions: [],
  roles: [],
  sessionId: 'session-1',
  status: 'ACTIVE' as const,
  userId: 'manager-user-1',
};
const authority = {
  id: 'booking-1',
  ownerUserId: 'owner-user-1',
  publicReference: 'CR-1',
  vehicleId: 'vehicle-1',
};

function setup() {
  const claims = {
    addOwnerEvidenceForAccess: vi.fn().mockResolvedValue({ id: 'claim-1' }),
    createOwnerClaim: vi.fn().mockResolvedValue({ id: 'claim-1' }),
    ownerClaimsForAccess: vi.fn().mockResolvedValue({ items: [] }),
  };
  const access = {
    assertBookingAccess: vi.fn().mockResolvedValue(authority),
    assertClaimAccess: vi.fn().mockResolvedValue({ claimId: 'claim-1', ...authority }),
    auditDelegatedAction: vi.fn().mockResolvedValue(undefined),
  };
  return {
    access,
    claims,
    controller: new OwnerWorkspaceClaimsController(claims as never, access as never),
  };
}

describe('OwnerWorkspaceClaimsController', () => {
  it('lists claims through the workspace projection', async () => {
    const { claims, controller } = setup();
    await controller.list(principal as never, {} as never);
    expect(claims.ownerClaimsForAccess).toHaveBeenCalledWith(context, {});
  });

  it('separates claim owner authority from the real delegated actor', async () => {
    const { access, claims, controller } = setup();
    await controller.create(
      principal as never,
      'CR-1',
      { category: 'DAMAGE', description: 'Damage' } as never,
      { headers: {} } as never,
    );
    expect(access.assertBookingAccess).toHaveBeenCalledWith(context, 'CR-1', 'claims.create');
    expect(claims.createOwnerClaim).toHaveBeenCalledWith(
      'owner-user-1',
      'CR-1',
      expect.any(Object),
      expect.any(Object),
      { actorUserId: 'manager-user-1', ownerUserId: 'owner-user-1' },
    );
  });
});
