import { describe, expect, it, vi } from 'vitest';
import { AdminRole, AdminStatus, RoleCode, UserStatus } from '@carrental/database';
import { PolicyGuard } from './policy.guard';
import { REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './authorization.decorator';

function context(principal: Record<string, unknown>) {
  return {
    getClass: vi.fn(),
    getHandler: vi.fn(),
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as never;
}

function principal(overrides: Record<string, unknown> = {}) {
  return {
    adminRole: AdminRole.STAFF,
    adminStatus: AdminStatus.ACTIVE,
    adminUserId: 'admin-id',
    permissions: ['support.read'],
    roles: [RoleCode.ADMIN],
    sessionId: 'session-id',
    status: UserStatus.ACTIVE,
    userId: 'credential-id',
    ...overrides,
  };
}

describe('PolicyGuard administrative enforcement', () => {
  it('rejects a direct API request without the declared permission', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_PERMISSIONS ? ['staff.view'] : undefined,
      ),
    };
    expect(() => new PolicyGuard(reflector as never).canActivate(context(principal()))).toThrow(
      'The required permission is not assigned.',
    );
  });

  it('accepts only when the explicit permission is present', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_PERMISSIONS ? ['staff.view'] : undefined,
      ),
    };
    expect(
      new PolicyGuard(reflector as never).canActivate(
        context(principal({ permissions: ['staff.view'] })),
      ),
    ).toBe(true);
  });

  it('maps dedicated STAFF only to legacy ADMIN gates, never SUPER_ADMIN-only gates', () => {
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_ROLES ? [RoleCode.SUPER_ADMIN] : undefined,
      ),
    };
    expect(() =>
      new PolicyGuard(reflector as never).canActivate(context(principal({ roles: [] }))),
    ).toThrow('The required role is not assigned.');
  });
});
