import { describe, expect, it } from 'vitest';
import {
  interleaveSimilarity,
  qualifiedForAnchor,
  qualifySimilarity,
  selectDiverseSavedAnchors,
  type SimilarityVehicle,
} from './saved-similarity';

const vehicle = (id: string, overrides: Partial<SimilarityVehicle> = {}): SimilarityVehicle => ({
  id,
  categoryId: 'suv',
  dailyRateMinor: 200_000,
  distanceKm: 4,
  make: 'Honda',
  powertrain: 'ICE',
  ratingReviewCount: 0,
  seats: 5,
  transmission: 'AUTOMATIC',
  ...overrides,
});

describe('saved-car deterministic similarity', () => {
  it('selects newest anchors from distinct category, powertrain, and seat clusters', () => {
    const anchors = selectDiverseSavedAnchors([
      vehicle('suv-new'),
      vehicle('suv-old'),
      vehicle('ev', { categoryId: 'sedan', powertrain: 'BATTERY_ELECTRIC' }),
      vehicle('mpv', { categoryId: 'mpv', seats: 7 }),
      vehicle('extra', { categoryId: 'hatchback' }),
    ]);
    expect(anchors.map(({ id }) => id)).toEqual(['suv-new', 'ev', 'mpv']);
  });

  it('implements all tiers and requires two meaningful matching signals', () => {
    const anchor = vehicle('anchor');
    expect(qualifySimilarity(anchor, vehicle('tier-1'))?.tier).toBe(1);
    expect(
      qualifySimilarity(anchor, vehicle('tier-2', { powertrain: 'BATTERY_ELECTRIC' }))?.tier,
    ).toBe(2);
    expect(qualifySimilarity(anchor, vehicle('tier-3', { categoryId: 'sedan' }))?.tier).toBe(3);
    expect(
      qualifySimilarity(anchor, vehicle('tier-4', { powertrain: 'BATTERY_ELECTRIC', seats: 7 }))
        ?.tier,
    ).toBe(4);
    expect(
      qualifySimilarity(
        anchor,
        vehicle('price-only', {
          categoryId: 'sedan',
          powertrain: 'BATTERY_ELECTRIC',
          seats: 7,
        }),
      ),
    ).toBeNull();
    expect(
      qualifySimilarity(
        anchor,
        vehicle('nearby-only', {
          categoryId: 'sedan',
          dailyRateMinor: 500_000,
          distanceKm: 0,
          make: 'Honda',
          powertrain: 'BATTERY_ELECTRIC',
          ratingReviewCount: 100,
          seats: 7,
        }),
      ),
    ).toBeNull();
  });

  it('uses deterministic tie ordering without treating ratings as similarity', () => {
    const anchor = vehicle('anchor');
    const ranked = qualifiedForAnchor(anchor, [
      vehicle('far', { distanceKm: 8, ratingReviewCount: 100 }),
      vehicle('near', { distanceKm: 2, ratingReviewCount: 0 }),
      vehicle('seat', { seats: 6, distanceKm: 1 }),
    ]);
    expect(ranked.map(({ vehicle: item }) => item.id)).toEqual(['near', 'far', 'seat']);
  });

  it('interleaves anchors, excludes saved IDs, removes duplicates, and caps six', () => {
    const anchorA = vehicle('a');
    const anchorB = vehicle('b', { categoryId: 'sedan', powertrain: 'BATTERY_ELECTRIC' });
    const common = vehicle('common');
    const queueA = qualifiedForAnchor(anchorA, [common, ...['1', '2', '3', '4'].map(vehicle)]);
    const queueB = qualifiedForAnchor(anchorB, [
      vehicle('b-saved', { categoryId: 'sedan', powertrain: 'BATTERY_ELECTRIC' }),
      common,
      ...['5', '6', '7', '8'].map((id) =>
        vehicle(id, { categoryId: 'sedan', powertrain: 'BATTERY_ELECTRIC' }),
      ),
    ]);
    const result = interleaveSimilarity([queueA, queueB], new Set(['a', 'b', 'b-saved']));
    expect(result).toHaveLength(6);
    expect(new Set(result.map(({ vehicle: item }) => item.id)).size).toBe(6);
    expect(result.map(({ vehicle: item }) => item.id)).not.toContain('b-saved');
    expect(result.some(({ vehicle: item }) => item.id === '5')).toBe(true);
  });
});
