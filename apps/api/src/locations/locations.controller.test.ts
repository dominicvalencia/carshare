import { describe, expect, it, vi } from 'vitest';
import { LocationsController } from './locations.controller';
import { AdminRole, AdminStatus, RoleCode, UserStatus } from '@carrental/database';
import { REQUIRED_ROLES } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';

const principal = { userId: 'renter-1' } as never;

describe('booking location endpoints', () => {
  it('allows either marketplace persona without opening the endpoint to administrative roles', () => {
    const roles = Reflect.getMetadata(REQUIRED_ROLES, LocationsController) as RoleCode[];
    expect(roles).toEqual([RoleCode.RENTER, RoleCode.OWNER]);
    expect(roles).not.toContain(RoleCode.ADMIN);
    expect(roles).not.toContain(RoleCode.SUPER_ADMIN);
  });
  it('allows renter, owner, and dual marketplace principals but denies roleless and admin-only principals', () => {
    const roles = Reflect.getMetadata(REQUIRED_ROLES, LocationsController) as RoleCode[];
    const reflector = {
      getAllAndOverride: vi.fn((key: string) => (key === REQUIRED_ROLES ? roles : undefined)),
    };
    const guard = new PolicyGuard(reflector as never);
    const requestPrincipal = (marketplaceRoles: RoleCode[], administrative = false) => ({
      ...(administrative
        ? {
            adminRole: AdminRole.OWNER,
            adminStatus: AdminStatus.ACTIVE,
            adminUserId: 'admin-1',
          }
        : {}),
      permissions: [],
      roles: marketplaceRoles,
      sessionId: 'session-1',
      status: UserStatus.ACTIVE,
      userId: 'user-1',
    });
    const context = (value: ReturnType<typeof requestPrincipal> | undefined) =>
      ({
        getClass: vi.fn(),
        getHandler: vi.fn(),
        switchToHttp: () => ({ getRequest: () => ({ principal: value }) }),
      }) as never;

    expect(guard.canActivate(context(requestPrincipal([RoleCode.RENTER])))).toBe(true);
    expect(guard.canActivate(context(requestPrincipal([RoleCode.OWNER])))).toBe(true);
    expect(guard.canActivate(context(requestPrincipal([RoleCode.RENTER, RoleCode.OWNER])))).toBe(
      true,
    );
    expect(() => guard.canActivate(context(requestPrincipal([])))).toThrow(
      'The required role is not assigned.',
    );
    expect(() => guard.canActivate(context(requestPrincipal([], true)))).toThrow(
      'The required role is not assigned.',
    );
    expect(guard.canActivate(context(undefined))).toBe(false);
  });
  it('rate-limits and delegates only normalized search inputs', async () => {
    const provider = { search: vi.fn().mockResolvedValue([]) };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never);
    await expect(
      controller.search(principal, { q: '  Lucena City  ', session: 'session_123' }),
    ).resolves.toEqual({ items: [] });
    expect(limits.assertAllowed).toHaveBeenCalledWith('location-search', ['renter-1'], 30, 60);
    expect(provider.search).toHaveBeenCalledWith('Lucena City', 'session_123');
  });

  it('rejects malformed provider references without calling Google', async () => {
    const provider = { details: vi.fn() };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never);
    await expect(
      controller.details(principal, '../unsafe', { session: 'session_123' }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCATION_REFERENCE' });
    expect(provider.details).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinate ranges before reverse geocoding', async () => {
    const provider = { reverseGeocode: vi.fn() };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never);
    await expect(
      controller.reverse(principal, { latitude: '91', longitude: '121' }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCATION_COORDINATES' });
    expect(provider.reverseGeocode).not.toHaveBeenCalled();
  });
});
