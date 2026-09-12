import { describe, expect, it } from 'vitest';
import { publicMapDistanceKm, publicMapPosition } from './public-map-position';

describe('public map position privacy', () => {
  it('returns a stable cell center that is deliberately different from the private point', () => {
    const exact = { latitude: 14.576421, longitude: 121.043713 };
    const first = publicMapPosition(exact.latitude, exact.longitude);
    const repeated = publicMapPosition(exact.latitude, exact.longitude);
    expect(first).toEqual(repeated);
    expect(first.mapLatitude).not.toBe(exact.latitude);
    expect(first.mapLongitude).not.toBe(exact.longitude);
    expect(first.precision).toBe('APPROXIMATE_CELL');
  });

  it('co-locates vehicles in the same privacy cell instead of creating samples to average', () => {
    expect(publicMapPosition(14.571, 121.041)).toEqual(publicMapPosition(14.579, 121.049));
  });

  it('coarsens public map distance to whole kilometers', () => {
    expect(publicMapDistanceKm(1.237418)).toBe(1);
    expect(publicMapDistanceKm(1.6)).toBe(2);
  });
});
