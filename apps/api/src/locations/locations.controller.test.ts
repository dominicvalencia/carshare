import { describe, expect, it, vi } from 'vitest';
import { LocationsController } from './locations.controller';
import { RoleCode } from '@carrental/database';

const principal = { roles: [RoleCode.RENTER], userId: 'renter-1' } as never;
const ownerProfileId = '11000000-0000-4000-8000-000000000001';

describe('booking location endpoints', () => {
  it('preserves marketplace access without requiring an Owner workspace', async () => {
    const provider = { search: vi.fn().mockResolvedValue([]) };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const ownerAccess = { resolve: vi.fn(), requirePermission: vi.fn() };
    const controller = new LocationsController(
      provider as never,
      limits as never,
      ownerAccess as never,
    );

    await controller.search(
      { roles: [RoleCode.RENTER], userId: 'renter-1' } as never,
      { q: 'Lucena City', session: 'session_123' },
    );

    expect(ownerAccess.resolve).not.toHaveBeenCalled();
    expect(ownerAccess.requirePermission).not.toHaveBeenCalled();
  });

  it('allows a delegated Manager only through an active workspace with vehicle creation authority', async () => {
    const provider = { search: vi.fn().mockResolvedValue([]) };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const access = { capacity: 'MANAGER', ownerProfileId };
    const ownerAccess = {
      resolve: vi.fn().mockResolvedValue(access),
      requirePermission: vi.fn(),
    };
    const controller = new LocationsController(
      provider as never,
      limits as never,
      ownerAccess as never,
    );

    await controller.search(
      { roles: [], userId: 'manager-1' } as never,
      { ownerProfileId, q: 'Lucena City', session: 'session_123' },
    );

    expect(ownerAccess.resolve).toHaveBeenCalledWith('manager-1', ownerProfileId);
    expect(ownerAccess.requirePermission).toHaveBeenCalledWith(access, 'vehicles.create');
  });

  it('rejects roleless access without an explicit Owner workspace', async () => {
    const controller = new LocationsController(
      { search: vi.fn() } as never,
      { assertAllowed: vi.fn() } as never,
      { resolve: vi.fn(), requirePermission: vi.fn() } as never,
    );

    await expect(
      controller.search(
        { roles: [], userId: 'staff-1' } as never,
        { q: 'Lucena City', session: 'session_123' },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_WORKSPACE_REQUIRED' });
  });
  it('rate-limits and delegates only normalized search inputs', async () => {
    const provider = { search: vi.fn().mockResolvedValue([]) };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never, {} as never);
    await expect(
      controller.search(principal, { q: '  Lucena City  ', session: 'session_123' }),
    ).resolves.toEqual({ items: [] });
    expect(limits.assertAllowed).toHaveBeenCalledWith('location-search', ['renter-1'], 30, 60);
    expect(provider.search).toHaveBeenCalledWith('Lucena City', 'session_123');
  });

  it('rejects malformed provider references without calling Google', async () => {
    const provider = { details: vi.fn() };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never, {} as never);
    await expect(
      controller.details(principal, '../unsafe', { session: 'session_123' }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCATION_REFERENCE' });
    expect(provider.details).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinate ranges before reverse geocoding', async () => {
    const provider = { reverseGeocode: vi.fn() };
    const limits = { assertAllowed: vi.fn().mockResolvedValue(undefined) };
    const controller = new LocationsController(provider as never, limits as never, {} as never);
    await expect(
      controller.reverse(principal, { latitude: '91', longitude: '121' }),
    ).rejects.toMatchObject({ code: 'INVALID_LOCATION_COORDINATES' });
    expect(provider.reverseGeocode).not.toHaveBeenCalled();
  });
});
