import { apiClient } from '../auth/api-client';

export interface CarShareLocation {
  readonly displayName: string;
  readonly addressLine1?: string;
  readonly barangay?: string;
  readonly city: string;
  readonly province: string;
  readonly postalCode?: string;
  readonly country: 'PH';
  readonly latitude: number;
  readonly longitude: number;
}
export interface PlaceSuggestion {
  readonly providerReference: string;
  readonly displayName: string;
  readonly secondaryText: string;
}
export interface BookingLocationProvider {
  searchPlaces(query: string, sessionToken: string): Promise<readonly PlaceSuggestion[]>;
  resolvePlace(reference: string, sessionToken: string): Promise<CarShareLocation>;
  reverseGeocode(latitude: number, longitude: number): Promise<CarShareLocation>;
}

export const bookingLocationProvider: BookingLocationProvider = {
  async searchPlaces(query, sessionToken) {
    const response = await apiClient.request<{ items: readonly PlaceSuggestion[] }>(
      `/locations/search?q=${encodeURIComponent(query)}&session=${encodeURIComponent(sessionToken)}`,
    );
    return response.items;
  },
  resolvePlace(reference, sessionToken) {
    return apiClient.request(
      `/locations/places/${encodeURIComponent(reference)}?session=${encodeURIComponent(sessionToken)}`,
    );
  },
  reverseGeocode(latitude, longitude) {
    return apiClient.request(`/locations/reverse?latitude=${latitude}&longitude=${longitude}`);
  },
};

export function locationLabel(location: CarShareLocation) {
  return [
    location.displayName,
    location.addressLine1,
    location.barangay,
    location.city,
    location.province,
    location.postalCode,
  ]
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .join(', ');
}
