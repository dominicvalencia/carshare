import { describe, expect, it, vi } from 'vitest';
import type { PublicVehicleRecord } from './public-eligibility.service';
import { SavedSimilarityService } from './saved-similarity.service';

const publicVehicle = (
  id: string,
  overrides: {
    categoryId?: string;
    dailyRateMinor?: number;
    ownerUserId?: string;
    powertrain?: string;
    seats?: number;
  } = {},
) =>
  ({
    id,
    category: { code: 'SUV', id: overrides.categoryId ?? 'suv', name: 'SUV' },
    fuelType: 'GASOLINE',
    location: { city: 'Makati City', country: 'PH', province: 'Metro Manila' },
    make: 'Honda',
    model: id,
    modelYear: 2025,
    ownerProfile: { userId: overrides.ownerUserId ?? 'owner' },
    photos: [{ fileAsset: { id: `photo-${id}` }, id: `photo-${id}`, isCover: true }],
    policyVersions: [
      {
        availabilityPolicy: 'EVERY_DAY',
        currency: 'PHP',
        dailyRateMinor: overrides.dailyRateMinor ?? 200_000,
      },
    ],
    powertrain: overrides.powertrain ?? 'ICE',
    seatCount: overrides.seats ?? 5,
    transmission: 'AUTOMATIC',
  }) as unknown as PublicVehicleRecord;

describe('SavedSimilarityService', () => {
  it('returns no recommendations without saved anchors or a safe active location', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new SavedSimilarityService(
      { client: { userFavorite: { findMany } } } as never,
      { findEligible: vi.fn() } as never,
      { checkMany: vi.fn() } as never,
      { card: vi.fn() } as never,
    );
    await expect(service.recommend('renter', { radius: 25 })).resolves.toEqual({ items: [] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'renter' } }));
  });

  it('batches eligibility, excludes saved and date-conflicting cars, and reuses card projection', async () => {
    const anchor = publicVehicle('saved');
    const availableA = publicVehicle('a');
    const availableB = publicVehicle('b');
    const conflict = publicVehicle('conflict');
    const findEligible = vi
      .fn()
      .mockResolvedValueOnce([anchor])
      .mockResolvedValueOnce([availableA, availableB, conflict]);
    const checkMany = vi.fn().mockResolvedValue(
      new Map([
        ['a', { advisory: true, available: true, reasons: [] }],
        ['b', { advisory: true, available: true, reasons: [] }],
        ['conflict', { advisory: true, available: false, reasons: ['BOOKING_CONFLICT'] }],
      ]),
    );
    const card = vi.fn((vehicle: PublicVehicleRecord, _distance, _favorite, availability) => ({
      availability: availability ?? {
        advisory: true,
        available: true,
        warning: 'No rental dates were checked. Availability is not guaranteed.',
      },
      approximateLocation: { city: vehicle.location!.city, province: vehicle.location!.province },
      vehicleId: vehicle.id,
    }));
    const service = new SavedSimilarityService(
      {
        client: {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'saved', distanceKm: 1 },
            { id: 'a', distanceKm: 2 },
            { id: 'b', distanceKm: 3 },
            { id: 'conflict', distanceKm: 4 },
            { id: 'ineligible', distanceKm: 5 },
          ]),
          ratingProjection: { findMany: vi.fn().mockResolvedValue([]) },
          userFavorite: { findMany: vi.fn().mockResolvedValue([{ vehicleId: 'saved' }]) },
        },
      } as never,
      { findEligible } as never,
      { checkMany } as never,
      { card } as never,
    );
    const result = await service.recommend('renter', {
      end: '2026-10-03T09:00:00.000Z',
      latitude: '14.6',
      longitude: '121.0',
      radius: 25,
      start: '2026-10-02T09:00:00.000Z',
    });
    expect(result.items.map(({ vehicleId }) => vehicleId)).toEqual(['a', 'b']);
    expect(JSON.stringify(result)).not.toContain('latitude');
    expect(JSON.stringify(result)).not.toContain('longitude');
    expect(checkMany).toHaveBeenCalledTimes(1);
    expect(card).toHaveBeenCalledTimes(2);
  });

  it('keeps no-date availability advisory and omits fewer than two qualified results', async () => {
    const anchor = publicVehicle('saved');
    const candidate = publicVehicle('only');
    const service = new SavedSimilarityService(
      {
        client: {
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'only', distanceKm: 2 }]),
          ratingProjection: { findMany: vi.fn().mockResolvedValue([]) },
          userFavorite: { findMany: vi.fn().mockResolvedValue([{ vehicleId: 'saved' }]) },
        },
      } as never,
      {
        findEligible: vi.fn().mockResolvedValueOnce([anchor]).mockResolvedValueOnce([candidate]),
      } as never,
      { checkMany: vi.fn() } as never,
      { card: vi.fn() } as never,
    );
    await expect(
      service.recommend('renter', { latitude: '14.6', longitude: '121.0', radius: 25 }),
    ).resolves.toEqual({ items: [] });
  });

  it('projects successful no-date recommendations as advisory without availability checks', async () => {
    const anchor = publicVehicle('saved');
    const candidateA = publicVehicle('a');
    const candidateB = publicVehicle('b');
    const checkMany = vi.fn();
    const card = vi.fn((vehicle: PublicVehicleRecord, _distance, _favorite, availability) => ({
      availability: availability ?? {
        advisory: true,
        available: true,
        warning: 'No rental dates were checked. Availability is not guaranteed.',
      },
      vehicleId: vehicle.id,
    }));
    const service = new SavedSimilarityService(
      {
        client: {
          $queryRaw: vi.fn().mockResolvedValue([
            { id: 'a', distanceKm: 2 },
            { id: 'b', distanceKm: 3 },
          ]),
          ratingProjection: { findMany: vi.fn().mockResolvedValue([]) },
          userFavorite: { findMany: vi.fn().mockResolvedValue([{ vehicleId: 'saved' }]) },
        },
      } as never,
      {
        findEligible: vi
          .fn()
          .mockResolvedValueOnce([anchor])
          .mockResolvedValueOnce([candidateA, candidateB]),
      } as never,
      { checkMany } as never,
      { card } as never,
    );

    const result = await service.recommend('renter', {
      latitude: '14.6',
      longitude: '121.0',
      radius: 25,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.every(({ availability }) => availability.advisory)).toBe(true);
    expect(checkMany).not.toHaveBeenCalled();
    expect(card).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      false,
      undefined,
      null,
      undefined,
    );
  });
});
