import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_ANY_OWNER_PERMISSION,
  REQUIRED_OWNER_PERMISSION,
} from './owner-access.decorator';
import { OwnerAccessGuard } from './owner-access.guard';
import type { OwnerAccessService } from './owner-access.service';

const staffAccess = {
  capacity: 'STAFF' as const,
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE',
  ownerProfileId: 'owner-1',
  permissions: ['vehicles.view', 'known_issues.create'],
  vehicleScopeMode: 'ALL_VEHICLES',
};

function executionContext(request: Record<string, unknown>) {
  return {
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('OwnerAccessGuard', () => {
  it('accepts a delegated member with any one of the allowed permissions', async () => {
    const request = {
      params: { ownerProfileId: 'owner-1' },
      principal: { userId: 'user-1' },
    };
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_ANY_OWNER_PERMISSION
          ? ['vehicles.update_operational_fields', 'known_issues.create']
          : undefined,
      ),
    };
    const access = {
      requirePermission: vi.fn(),
      resolve: vi.fn().mockResolvedValue(staffAccess),
    };
    const guard = new OwnerAccessGuard(
      reflector as unknown as Reflector,
      access as unknown as OwnerAccessService,
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(access.requirePermission).not.toHaveBeenCalled();
    expect(request.principal).toEqual({ userId: 'user-1', ownerAccess: staffAccess });
  });

  it('retains the existing single-permission enforcement', async () => {
    const request = {
      params: { ownerProfileId: 'owner-1' },
      principal: { userId: 'user-1' },
    };
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_OWNER_PERMISSION ? 'vehicles.view' : undefined,
      ),
    };
    const access = {
      requirePermission: vi.fn(),
      resolve: vi.fn().mockResolvedValue(staffAccess),
    };
    const guard = new OwnerAccessGuard(
      reflector as unknown as Reflector,
      access as unknown as OwnerAccessService,
    );

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(access.requirePermission).toHaveBeenCalledWith(staffAccess, 'vehicles.view');
  });

  it('rejects a delegated member without any allowed permission', async () => {
    const request = {
      params: { ownerProfileId: 'owner-1' },
      principal: { userId: 'user-1' },
    };
    const reflector = {
      getAllAndOverride: vi.fn((key: string) =>
        key === REQUIRED_ANY_OWNER_PERMISSION
          ? ['vehicles.update_operational_fields', 'known_issues.create']
          : undefined,
      ),
    };
    const access = {
      requirePermission: vi.fn(() => {
        throw new Error('denied');
      }),
      resolve: vi.fn().mockResolvedValue({ ...staffAccess, permissions: ['vehicles.view'] }),
    };
    const guard = new OwnerAccessGuard(
      reflector as unknown as Reflector,
      access as unknown as OwnerAccessService,
    );

    await expect(guard.canActivate(executionContext(request))).rejects.toThrow('denied');
    expect(access.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['vehicles.view'] }),
      'vehicles.update_operational_fields',
    );
  });
});
