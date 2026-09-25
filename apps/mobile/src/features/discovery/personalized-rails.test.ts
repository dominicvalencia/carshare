import { describe, expect, it } from 'vitest';
import { uniqueRailVehicles } from './explore-rails';
import {
  latestReconstructibleSearch,
  recentVehicleCards,
  reconstructSearch,
  type HistorySearchRecord,
  type RecentVehicleRecord,
} from './personalized-rails';

const makati: HistorySearchRecord = {
  id: 'search-1',
  placeLabel: 'Makati City',
  city: 'Makati City',
  province: 'Metro Manila',
  centerLatitude: 14.6,
  centerLongitude: 121,
  radiusKm: 25,
  rentalStart: null,
  rentalEnd: null,
  criteria: { source: 'PLACE' },
  searchedAt: '2026-09-22T01:00:00.000Z',
};

const vehicle: RecentVehicleRecord = {
  viewedAt: '2026-09-22T02:00:00.000Z',
  vehicle: {
    vehicleId: 'vehicle-1',
    make: 'Honda',
    model: 'City',
    year: 2024,
    favorite: true,
    location: { city: 'Makati City', province: 'Metro Manila' },
    pricing: { currency: 'PHP', dailyRateMinor: 210000 },
    photos: [{ contentPath: '/public/cover' }],
    rating: { averageRating: '4.6', reviewCount: 9 },
  },
};

describe('Task 13D personalized rail authority', () => {
  it('omits both personalized rails when account history is empty', () => {
    expect(latestReconstructibleSearch([])).toBeNull();
    expect(recentVehicleCards([])).toEqual([]);
  });

  it('keeps server-provided newest-first view order, deduplicates, and uses public card fields', () => {
    const older = {
      ...vehicle,
      viewedAt: '2026-09-21T02:00:00.000Z',
      vehicle: { ...vehicle.vehicle, vehicleId: 'vehicle-2', favorite: false },
    };
    const cards = recentVehicleCards([vehicle, older, vehicle]);
    expect(cards.map(({ vehicleId }) => vehicleId)).toEqual(['vehicle-1', 'vehicle-2']);
    expect(cards[0]).toMatchObject({
      favorite: true,
      coverPhoto: { contentPath: '/public/cover' },
      approximateLocation: { city: 'Makati City' },
      displayPrice: { amountMinor: 210000, label: 'From' },
    });
    expect(cards[0]).not.toHaveProperty('latitude');
  });

  it('permits the same truthful car across a personalized and contextual rail', () => {
    const recent = recentVehicleCards([vehicle]);
    const contextual = uniqueRailVehicles([recent[0]!]);
    expect(recent[0]?.vehicleId).toBe(contextual[0]?.vehicleId);
  });

  it('selects the newest reconstructible committed search, skipping unsafe history', () => {
    const currentArea = {
      ...makati,
      id: 'newer-device',
      centerLatitude: null,
      centerLongitude: null,
      criteria: { source: 'DEVICE' },
    };
    expect(latestReconstructibleSearch([currentArea, makati])?.title).toBe(
      'Continue exploring Makati City',
    );
  });

  it('never invents dates for a saved search without explicit dates', () => {
    const restored = reconstructSearch(makati)!;
    const query = new URLSearchParams(restored.query);
    expect(restored.start).toBeNull();
    expect(restored.end).toBeNull();
    expect(query.has('start')).toBe(false);
    expect(query.has('end')).toBe(false);
    expect(query.get('latitude')).toBe('14.6');
    expect(query.get('radius')).toBe('25');
    expect(query.get('limit')).toBe('6');
  });

  it('preserves explicit dates and saved category/filter criteria', () => {
    const restored = reconstructSearch({
      ...makati,
      rentalStart: '2026-09-25T09:00:00.000Z',
      rentalEnd: '2026-09-27T09:00:00.000Z',
      criteria: {
        source: 'PLACE',
        categoryId: 'suv-category',
        make: 'Honda',
        seats: 7,
        transmission: 'AUTOMATIC',
        powertrain: 'BATTERY_ELECTRIC',
        minPrice: 12345,
        maxPrice: 260000,
        handover: 'DELIVERY_AVAILABLE',
      },
    })!;
    const query = new URLSearchParams(restored.query);
    expect(query.get('start')).toBe('2026-09-25T09:00:00.000Z');
    expect(query.get('end')).toBe('2026-09-27T09:00:00.000Z');
    expect(query.get('categoryId')).toBe('suv-category');
    expect(query.get('make')).toBe('Honda');
    expect(query.get('seats')).toBe('7');
    expect(query.get('transmission')).toBe('AUTOMATIC');
    expect(query.get('powertrain')).toBe('BATTERY_ELECTRIC');
    expect(query.get('minPrice')).toBe('12345');
    expect(query.get('maxPrice')).toBe('260000');
    expect(query.get('handover')).toBe('DELIVERY_AVAILABLE');
    expect(restored.minPrice).toBe('123.45');
  });

  it('omits incomplete, unsafe, or unrecognized saved criteria', () => {
    expect(reconstructSearch({ ...makati, centerLatitude: null })).toBeNull();
    expect(reconstructSearch({ ...makati, rentalStart: '2026-09-25T09:00:00.000Z' })).toBeNull();
    expect(reconstructSearch({ ...makati, criteria: { source: 'PLACE', secret: 'x' } })).toBeNull();
    expect(
      reconstructSearch({ ...makati, criteria: { source: 'PLACE', seats: 'seven' } }),
    ).toBeNull();
    expect(
      reconstructSearch({ ...makati, criteria: { source: 'PLACE', powertrain: 'UNKNOWN' } }),
    ).toBeNull();
    expect(reconstructSearch({ ...makati, city: '' })).toBeNull();
    expect(reconstructSearch({ ...makati, rentalStart: undefined as unknown as null })).toBeNull();
  });
});
