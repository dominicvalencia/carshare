export interface LocationSuggestion {
  readonly label: string;
  readonly detail: string;
  readonly city: string;
  readonly province: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface LocationSearchProvider {
  readonly mode: 'development-fallback' | 'provider';
  suggestions(query?: string): Promise<readonly LocationSuggestion[]>;
}

const philippineAreas: readonly LocationSuggestion[] = [
  {
    label: 'Metro Manila',
    detail: 'Makati, BGC, Quezon City and nearby',
    city: 'Makati City',
    province: 'Metro Manila',
    latitude: 14.5547,
    longitude: 121.0244,
  },
  {
    label: 'Quezon City',
    detail: 'Quezon City and nearby',
    city: 'Quezon City',
    province: 'Metro Manila',
    latitude: 14.676,
    longitude: 121.0437,
  },
  {
    label: 'Cebu City',
    detail: 'Cebu and Mactan area',
    city: 'Cebu City',
    province: 'Cebu',
    latitude: 10.3157,
    longitude: 123.8854,
  },
  {
    label: 'Davao City',
    detail: 'Metro Davao',
    city: 'Davao City',
    province: 'Davao del Sur',
    latitude: 7.1907,
    longitude: 125.4553,
  },
  {
    label: 'Baguio City',
    detail: 'Baguio and La Trinidad',
    city: 'Baguio City',
    province: 'Benguet',
    latitude: 16.4023,
    longitude: 120.596,
  },
  {
    label: 'Iloilo City',
    detail: 'Metro Iloilo',
    city: 'Iloilo City',
    province: 'Iloilo',
    latitude: 10.7202,
    longitude: 122.5621,
  },
  {
    label: 'Lucena City',
    detail: 'Lucena and nearby Quezon',
    city: 'Lucena City',
    province: 'Quezon',
    latitude: 13.9414,
    longitude: 121.623,
  },
];

class DevelopmentLocationSearchProvider implements LocationSearchProvider {
  readonly mode = 'development-fallback' as const;

  async suggestions(query = ''): Promise<readonly LocationSuggestion[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return philippineAreas;
    return philippineAreas.filter((area) =>
      `${area.label} ${area.detail} ${area.province}`.toLowerCase().includes(normalized),
    );
  }
}

/** Replace this binding after a production geocoding provider and credentials are approved. */
export const locationSearchProvider: LocationSearchProvider =
  new DevelopmentLocationSearchProvider();

export const developmentLocationSuggestions = philippineAreas;
