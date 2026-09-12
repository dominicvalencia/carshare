import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { GoogleLocationProvider, normalizeGoogleLocation } from './google-location.provider';

const manila = {
  displayName: { text: 'Ayala Triangle Gardens' },
  formattedAddress: 'Ayala Avenue, Makati, Metro Manila, Philippines',
  location: { latitude: 14.556, longitude: 121.023 },
  addressComponents: [
    { longText: 'Ayala Avenue', types: ['route'] },
    { longText: 'Bel-Air', types: ['sublocality_level_1'] },
    { longText: 'Makati', types: ['locality'] },
    { longText: 'Metro Manila', types: ['administrative_area_level_1'] },
    { longText: '1226', types: ['postal_code'] },
    { longText: 'Philippines', shortText: 'PH', types: ['country'] },
  ],
};

describe('Google location provider', () => {
  it('normalizes minimized Philippine provider data without leaking raw fields', () => {
    expect(normalizeGoogleLocation(manila)).toEqual({
      addressLine1: 'Ayala Avenue',
      barangay: 'Bel-Air',
      city: 'Makati',
      country: 'PH',
      displayName: 'Ayala Triangle Gardens',
      latitude: 14.556,
      longitude: 121.023,
      postalCode: '1226',
      province: 'Metro Manila',
    });
  });
  it('allows optional barangay, postal code and street number', () => {
    const value = normalizeGoogleLocation({
      ...manila,
      addressComponents: manila.addressComponents.filter(
        (item) => !item.types.some((type) => ['sublocality_level_1', 'postal_code'].includes(type)),
      ),
    });
    expect(value).not.toHaveProperty('barangay');
    expect(value).not.toHaveProperty('postalCode');
  });
  it.each([
    ['Lucena City', 'Quezon', 13.9414, 121.623],
    ['Cebu City', 'Cebu', 10.3157, 123.8854],
    ['Baguio City', 'Benguet', 16.4023, 120.596],
  ])(
    'normalizes provincial Philippine locations without NCR assumptions',
    (city, province, latitude, longitude) => {
      expect(
        normalizeGoogleLocation({
          displayName: { text: `${city} landmark` },
          location: { latitude, longitude },
          formattedAddress: `${city}, ${province}, Philippines`,
          addressComponents: [
            { longText: city, types: ['locality'] },
            { longText: province, types: ['administrative_area_level_1'] },
            { longText: 'Philippines', shortText: 'PH', types: ['country'] },
          ],
        }),
      ).toMatchObject({ city, province, country: 'PH', latitude, longitude });
    },
  );
  it('rejects overseas, malformed and out-of-range results', () => {
    expect(() =>
      normalizeGoogleLocation({
        ...manila,
        addressComponents: manila.addressComponents.map((item) =>
          item.types.includes('country') ? { ...item, shortText: 'US' } : item,
        ),
      }),
    ).toThrow('unavailable');
    expect(() =>
      normalizeGoogleLocation({ ...manila, location: { latitude: 91, longitude: 121 } }),
    ).toThrow('unavailable');
  });
  it('uses a server key and minimizes autocomplete responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          suggestions: [
            {
              placePrediction: {
                placeId: 'place_123',
                structuredFormat: {
                  mainText: { text: 'SM City Lucena' },
                  secondaryText: { text: 'Lucena City, Quezon' },
                },
              },
            },
          ],
        }),
      }),
    );
    const provider = new GoogleLocationProvider(
      new ConfigService({
        GEOCODING_PROVIDER: 'google',
        GOOGLE_MAPS_SERVER_KEY: 'not-a-real-key',
      }) as never,
    );
    await expect(provider.search('SM City', 'session_123')).resolves.toEqual([
      {
        displayName: 'SM City Lucena',
        providerReference: 'place_123',
        secondaryText: 'Lucena City, Quezon',
      },
    ]);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toContain('places:autocomplete');
    const request = call[1] as RequestInit;
    expect((request.headers as Record<string, string>)['X-Goog-FieldMask']).not.toContain('*');
    vi.unstubAllGlobals();
  });
});
