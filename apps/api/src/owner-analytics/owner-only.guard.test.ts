import { describe, expect, it } from 'vitest';
import { AdminRole } from '@carrental/database';
import { OwnerOnlyGuard } from './owner-only.guard';

function context(adminRole?: AdminRole) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ principal: adminRole ? { adminRole } : undefined }),
    }),
  } as never;
}

describe('OwnerOnlyGuard', () => {
  it('allows OWNER', () => {
    expect(new OwnerOnlyGuard().canActivate(context(AdminRole.OWNER))).toBe(true);
  });

  it.each([AdminRole.SUPER_ADMIN, AdminRole.STAFF, undefined])(
    'denies non-owner principal %s',
    (role) => {
      expect(() => new OwnerOnlyGuard().canActivate(context(role))).toThrow(
        'Business-owner analytics access is required.',
      );
    },
  );
});
