import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@carrental/database';
import type { DatabaseService } from '../infrastructure/database/database.service';
import type { PublicVehicleEligibilityService } from './public-eligibility.service';
import type { PublicProjectionService } from './public-projection.service';
import { RecordRenterSearchDto } from './discovery.dto';
import {
  coarseSearchCenter,
  committedSearchDates,
  RECENT_SEARCH_LIMIT,
  RECENT_VEHICLE_LIMIT,
  RenterHistoryService,
} from './renter-history.service';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'discovery.controller.ts'),
  'utf8',
);
const detailSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'public-vehicles.service.ts'),
  'utf8',
);

const searchInput: RecordRenterSearchDto = {
  source: 'PLACE',
  city: 'Makati City',
  province: 'Metro Manila',
  latitude: 14.556789,
  longitude: 121.024567,
  radiusKm: 25,
  datesExplicit: false,
};

function fixture() {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
    renterRecentSearch: {
      create: vi.fn().mockResolvedValue({ id: 'search-1', searchedAt: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    renterRecentVehicleView: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const client = {
    $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    renterRecentSearch: { findMany: vi.fn().mockResolvedValue([]) },
    renterRecentVehicleView: { findMany: vi.fn().mockResolvedValue([]) },
    userFavorite: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const eligibility = { findEligible: vi.fn().mockResolvedValue([]) };
  const projection = { detail: vi.fn((vehicle: { id: string }) => ({ vehicleId: vehicle.id })) };
  return {
    client,
    transaction,
    eligibility,
    projection,
    service: new RenterHistoryService(
      { client } as unknown as DatabaseService,
      eligibility as unknown as PublicVehicleEligibilityService,
      projection as unknown as PublicProjectionService,
    ),
  };
}

describe('renter history foundation', () => {
  it('stores only coarse location and omits provisional dates from committed searches', async () => {
    const { service, transaction } = fixture();
    await service.recordSearch('user-1', searchInput);
    expect(coarseSearchCenter(searchInput.latitude)).toBe(14.6);
    expect(transaction.renterRecentSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          placeLabel: 'Makati City',
          centerLatitude: 14.6,
          centerLongitude: 121,
          rentalStart: null,
          rentalEnd: null,
        }),
      }),
    );
    expect(transaction.renterRecentSearch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: RECENT_SEARCH_LIMIT, where: { userId: 'user-1' } }),
    );
  });

  it('preserves explicitly selected dates and rejects fabricated or invalid date pairs', () => {
    const explicit = {
      ...searchInput,
      datesExplicit: true,
      start: '2026-09-25T09:00:00.000Z',
      end: '2026-09-27T09:00:00.000Z',
    };
    expect(committedSearchDates(explicit).rentalStart?.toISOString()).toBe(explicit.start);
    expect(() => committedSearchDates({ ...explicit, datesExplicit: false })).toThrow();
    expect(() => committedSearchDates({ ...explicit, end: explicit.start })).toThrow();
  });

  it('does not persist device city or precise coordinates', async () => {
    const { service, transaction } = fixture();
    await service.recordSearch('user-1', { ...searchInput, source: 'DEVICE' });
    expect(transaction.renterRecentSearch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          placeLabel: 'Current area',
          city: '',
          province: '',
          centerLatitude: 0,
          centerLongitude: 0,
        }),
      }),
    );
  });

  it('moves repeated vehicle views to the top via one user/vehicle upsert and prunes excess', async () => {
    const { service, transaction } = fixture();
    transaction.renterRecentVehicleView.findMany.mockResolvedValue([{ vehicleId: 'old' }]);
    await service.recordVehicleView('user-1', 'vehicle-1');
    await service.recordVehicleView('user-1', 'vehicle-1');
    expect(transaction.renterRecentVehicleView.upsert).toHaveBeenCalledTimes(2);
    expect(transaction.renterRecentVehicleView.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_vehicleId: { userId: 'user-1', vehicleId: 'vehicle-1' } },
        update: { viewedAt: expect.any(Date) },
      }),
    );
    expect(transaction.renterRecentVehicleView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: RECENT_VEHICLE_LIMIT, where: { userId: 'user-1' } }),
    );
    expect(transaction.renterRecentVehicleView.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', vehicleId: { in: ['old'] } },
    });
  });

  it('reads only the current renter’s bounded, ordered searches', async () => {
    const { service, client } = fixture();
    client.renterRecentSearch.findMany.mockResolvedValue([
      {
        id: 'device-search',
        criteria: { source: 'DEVICE' },
        centerLatitude: new Prisma.Decimal(0),
        centerLongitude: new Prisma.Decimal(0),
      },
    ]);
    const result = await service.listSearches('user-1');
    expect(result.items[0]).toMatchObject({ centerLatitude: null, centerLongitude: null });
    expect(client.renterRecentSearch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ searchedAt: 'desc' }, { id: 'desc' }],
        take: RECENT_SEARCH_LIMIT,
        where: { userId: 'user-1' },
      }),
    );
  });

  it('excludes ineligible vehicles and reuses the public detail projection', async () => {
    const { service, client, eligibility, projection } = fixture();
    client.renterRecentVehicleView.findMany.mockResolvedValue([
      { vehicleId: 'eligible', viewedAt: new Date('2026-09-22T01:00:00Z') },
      { vehicleId: 'private', viewedAt: new Date('2026-09-21T01:00:00Z') },
    ]);
    eligibility.findEligible.mockResolvedValue([{ id: 'eligible' }]);
    const result = await service.listVehicleViews('user-1');
    expect(eligibility.findEligible).toHaveBeenCalledWith(
      ['eligible', 'private'],
      undefined,
      'user-1',
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.vehicle).toEqual({ vehicleId: 'eligible' });
    expect(projection.detail).toHaveBeenCalledTimes(1);
    expect(client.renterRecentVehicleView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: RECENT_VEHICLE_LIMIT, where: { userId: 'user-1' } }),
    );
  });

  it('guards reads by renter role and never writes history for guest Detail views', () => {
    expect(source).toMatch(
      /@Controller\('me\/discovery-history'\)[\s\S]*?@RequireRoles\(RoleCode\.RENTER\)/,
    );
    expect(source).toContain('@UseGuards(AccessTokenGuard, PolicyGuard)');
    expect(source).toContain('this.history.listSearches(principal.userId)');
    expect(source).toContain('this.history.listVehicleViews(principal.userId)');
    expect(detailSource).toContain('if (principal?.roles.includes(RoleCode.RENTER))');
    expect(detailSource).toContain('this.history.recordVehicleView(principal.userId, id)');
  });
});
