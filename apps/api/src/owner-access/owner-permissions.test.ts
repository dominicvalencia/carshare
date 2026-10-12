import { describe, expect, it } from 'vitest';
import { OwnerStaffRole, OwnerStaffStatus } from '@carrental/database';
import {
  MANAGER_PERMISSIONS,
  MANAGER_ONLY_PERMISSIONS,
  DEFAULT_OWNER_STAFF_PERMISSIONS,
  OPERATIONS_STAFF_PERMISSIONS,
  OWNER_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  VEHICLE_SCOPED_OWNER_PERMISSIONS,
  SUPPORT_STAFF_PERMISSIONS,
  assertAssignableOwnerPermissions,
  assertActorCanGrantOwnerPermissions,
  assertManagerTargetRole,
  assertOwnerPermissionCodes,
  withDefaultOwnerStaffPermissions,
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

  it('makes vehicle creation Manager-default without granting it to Staff presets or custom Staff', () => {
    expect(OWNER_PERMISSIONS['vehicles.create']).toBe(
      'Create a new vehicle inside an authorized Owner workspace',
    );
    expect(MANAGER_PERMISSIONS).toContain('vehicles.create');
    expect(OPERATIONS_STAFF_PERMISSIONS).not.toContain('vehicles.create' as never);
    expect(SUPPORT_STAFF_PERMISSIONS).not.toContain('vehicles.create' as never);
    expect(MANAGER_ONLY_PERMISSIONS).toContain('vehicles.create');
    expect(VEHICLE_SCOPED_OWNER_PERMISSIONS).not.toContain('vehicles.create');
    expect(() =>
      assertAssignableOwnerPermissions(OwnerStaffRole.STAFF, ['vehicles.create']),
    ).toThrow('Manager-only permission');
    expect(() =>
      assertAssignableOwnerPermissions(OwnerStaffRole.MANAGER, ['vehicles.create']),
    ).not.toThrow();
    expect(Object.keys(OWNER_PERMISSIONS)).toContain('vehicles.create');
  });

  it('makes own-activity visibility a default for every delegated preset and custom access', () => {
    expect(DEFAULT_OWNER_STAFF_PERMISSIONS).toEqual(['audit.view_own_actions']);
    expect(MANAGER_PERMISSIONS).toContain('audit.view_own_actions');
    expect(OPERATIONS_STAFF_PERMISSIONS).toContain('audit.view_own_actions');
    expect(SUPPORT_STAFF_PERMISSIONS).toContain('audit.view_own_actions');
    expect(withDefaultOwnerStaffPermissions([])).toEqual(['audit.view_own_actions']);
    expect(withDefaultOwnerStaffPermissions(['vehicles.view'])).toEqual([
      'vehicles.view',
      'audit.view_own_actions',
    ]);
  });

  it('keeps the default audit permission strictly actor-owned', () => {
    expect(OWNER_PERMISSIONS['audit.view_own_actions']).toContain('actor’s own');
    expect(Object.keys(OWNER_PERMISSIONS).filter((code) => code.startsWith('audit.'))).toEqual([
      'audit.view_own_actions',
    ]);
    expect(DEFAULT_OWNER_STAFF_PERMISSIONS).not.toContain('audit.read' as never);
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
