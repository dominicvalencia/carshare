import { describe, expect, it } from 'vitest';
import { locationDisplayLabel, type CarShareLocation } from './booking-location-provider';

describe('locationDisplayLabel', () => {
  it('removes repeated address segments for presentation without mutating canonical fields', () => {
    const location: CarShareLocation = {
      addressLine1: '123 Main Street',
      barangay: 'Barangay Uno',
      city: 'Makati City',
      country: 'PH',
      displayName: '123 Main Street, Barangay Uno, Makati City',
      latitude: 14.5547,
      longitude: 121.0244,
      postalCode: '1200',
      province: 'Metro Manila',
    };
    const before = { ...location };

    expect(locationDisplayLabel(location)).toBe(
      '123 Main Street, Barangay Uno, Makati City, Metro Manila, 1200',
    );
    expect(location).toEqual(before);
  });

  it('deduplicates case-insensitively while preserving the first formatted segment', () => {
    const location: CarShareLocation = {
      city: 'Cebu City',
      country: 'PH',
      displayName: 'Ayala Center Cebu, Cebu City',
      latitude: 10.3181,
      longitude: 123.9056,
      province: 'CEBU CITY',
    };

    expect(locationDisplayLabel(location)).toBe('Ayala Center Cebu, Cebu City');
  });

  it('does not repeat a postal code already included in a formatted provider segment', () => {
    const location: CarShareLocation = {
      city: 'Lucena City',
      country: 'PH',
      displayName: 'XH29+88H, Lucena City, 4301 Quezon, Philippines',
      latitude: 13.9414,
      longitude: 121.6236,
      postalCode: '4301',
      province: 'Calabarzon',
    };
    const before = { ...location };

    expect(locationDisplayLabel(location)).toBe(
      'XH29+88H, Lucena City, 4301 Quezon, Philippines, Calabarzon',
    );
    expect(location).toEqual(before);
  });
});
