import { describe, expect, it } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus } from '@carrental/database';
import {
  MANAGER_PERMISSIONS,
  OWNER_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  assertAssignableOwnerPermissions,
  assertActorCanGrantOwnerPermissions,
  assertManagerTargetRole,
  assertOwnerPermissionCodes,
} from './owner-permissions';
import { isUsableOwnerStaffInvitation } from './owner-access.service';

describe('Owner Staff authority policy', () => {
  it('rejects unknown, wildcard, and Owner-only delegated permissions', () => {
    expect(() => assertOwnerPermissionCodes(['vehicles.*'])).toThrow('Unknown Owner permission');
    expect(() => assertOwnerPermissionCodes(['admin.users.view'])).toThrow(
      'Unknown Owner permission',
    );
    for (const permission of OWNER_ONLY_PERMISSIONS) {
      expect(() => assertAssignableOwnerPermissions(OwnerStaffRole.MANAGER, [permission])).toThrow(
        'Owner-only permission',
      );
    }
  });

  it('keeps Manager powerful without granting Owner-only authority', () => {
    expect(MANAGER_PERMISSIONS).toContain('staff.assign_permissions');
    expect(MANAGER_PERMISSIONS).toContain('bookings.cancel');
    expect(MANAGER_PERMISSIONS.some((permission) => OWNER_ONLY_PERMISSIONS.has(permission))).toBe(
      false,
    );
    expect(() => assertManagerTargetRole(OwnerStaffRole.MANAGER)).toThrow('ordinary Staff only');
    expect(() => assertManagerTargetRole(OwnerStaffRole.STAFF)).not.toThrow();
  });

  it('does not introduce platform, verification, refund, payout-execution, or deposit-settlement authority', () => {
    const codes = Object.keys(OWNER_PERMISSIONS);
    expect(codes).not.toContain('verification.approve');
    expect(codes).not.toContain('verification.reject');
    expect(codes).not.toContain('documents.view_verification_evidence');
    expect(codes).not.toContain('security_deposit.settlement.execute');
    expect(codes).not.toContain('refund.execute');
    expect(codes).not.toContain('payout.execute');
    expect(codes.some((code) => code.startsWith('admin.'))).toBe(false);
  });

  it('enforces Manager and ordinary Staff grant ceilings', () => {
    expect(() =>
      assertActorCanGrantOwnerPermissions(
        { capacity: 'OWNER', permissions: [] },
        OwnerStaffRole.MANAGER,
        ['payout_accounts.manage'],
      ),
    ).toThrow('Owner-only permission');
    expect(() =>
      assertActorCanGrantOwnerPermissions(
        { capacity: 'OWNER', permissions: [] },
        OwnerStaffRole.STAFF,
        ['staff.invite'],
      ),
    ).toThrow('Ordinary Staff');
    expect(() =>
      assertActorCanGrantOwnerPermissions(
        { capacity: 'MANAGER', permissions: ['vehicles.view'] },
        OwnerStaffRole.STAFF,
        ['bookings.view'],
      ),
    ).toThrow('outside their delegated set');
  });

  it('accepts only matching, unexpired, unconsumed, unrevoked invitations', () => {
    const invitation = {
      consumedAt: null,
      expiresAt: new Date('2026-10-11T00:00:00Z'),
      membership: { status: OwnerStaffStatus.INVITED },
      revokedAt: null,
    };
    const now = new Date('2026-10-10T00:00:00Z');
    expect(isUsableOwnerStaffInvitation(invitation, true, now)).toBe(true);
    expect(isUsableOwnerStaffInvitation({ ...invitation, revokedAt: now }, true, now)).toBe(false);
    expect(isUsableOwnerStaffInvitation({ ...invitation, consumedAt: now }, true, now)).toBe(false);
    expect(isUsableOwnerStaffInvitation({ ...invitation, expiresAt: now }, true, now)).toBe(false);
    expect(isUsableOwnerStaffInvitation(invitation, false, now)).toBe(false);
  });
});
