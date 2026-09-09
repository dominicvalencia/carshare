import { describe, expect, it } from 'vitest';
import { AdminRole } from '@carrental/database';
import {
  ADMIN_PERMISSIONS,
  STAFF_PERMISSION_PROFILES,
  SUPER_ADMIN_DEFAULT_PERMISSIONS,
  assertPermissionCodes,
  effectiveAdminPermissions,
} from './admin-permissions';

describe('administrative permission registry', () => {
  it('contains only real repository capabilities and staff lifecycle permissions', () => {
    expect(ADMIN_PERMISSIONS).toMatchObject({
      'audit.read': expect.any(String),
      'renters.verifications.review': expect.any(String),
      'staff.permissions.manage': expect.any(String),
      'staff.suspend': expect.any(String),
    });
    for (const profile of Object.values(STAFF_PERMISSION_PROFILES))
      expect(() => assertPermissionCodes(profile)).not.toThrow();
  });

  it('rejects arbitrary permission names and never gives STAFF wildcard access', () => {
    expect(() => assertPermissionCodes(['system.owner.promote'])).toThrow(
      'Unknown administrative permission.',
    );
    expect(effectiveAdminPermissions(AdminRole.STAFF, ['support.read'])).toEqual(['support.read']);
  });

  it('gives OWNER the approved registry without a persisted wildcard', () => {
    expect(effectiveAdminPermissions(AdminRole.OWNER, [])).toEqual(Object.keys(ADMIN_PERMISSIONS));
    expect(effectiveAdminPermissions(AdminRole.OWNER, [])).not.toContain('*');
  });

  it('keeps templates scoped and reserves owner business configuration', () => {
    expect(STAFF_PERMISSION_PROFILES.FINANCE_STAFF).toContain('payments.read');
    expect(STAFF_PERMISSION_PROFILES.FINANCE_STAFF).not.toContain('renters.verifications.review');
    expect(STAFF_PERMISSION_PROFILES.VERIFICATION_STAFF).toContain('renters.verifications.review');
    expect(STAFF_PERMISSION_PROFILES.SUPPORT_STAFF).not.toContain('refunds.approve');
    expect(STAFF_PERMISSION_PROFILES.OPERATIONS_STAFF).not.toContain('staff.permissions.manage');
    expect(SUPER_ADMIN_DEFAULT_PERMISSIONS).toContain('staff.permissions.manage');
    expect(SUPER_ADMIN_DEFAULT_PERMISSIONS).not.toContain('commissions.manage');
  });
});
