import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { ApplicationException } from '../common/errors/application.exception';

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

export interface LocationSuggestion {
  readonly providerReference: string;
  readonly displayName: string;
  readonly secondaryText: string;
}

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude?: number; longitude?: number };
};

const PROVIDER_TIMEOUT_MS = 5_000;

@Injectable()
export class GoogleLocationProvider {
  constructor(private readonly configuration: ConfigService<ApiEnvironment, true>) {}

  async search(query: string, sessionToken: string): Promise<readonly LocationSuggestion[]> {
    const payload = await this.request<{
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
          structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
        };
      }>;
    }>(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        body: JSON.stringify({
          input: query,
          includedRegionCodes: ['ph'],
          languageCode: 'en',
          regionCode: 'PH',
          sessionToken,
        }),
        method: 'POST',
      },
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
      'LOCATION_SEARCH_UNAVAILABLE',
    );
    return (payload.suggestions ?? [])
      .flatMap(({ placePrediction }) => {
        if (!placePrediction?.placeId) return [];
        return [
          {
            providerReference: placePrediction.placeId,
            displayName:
              placePrediction.structuredFormat?.mainText?.text ??
              placePrediction.text?.text ??
              'Selected place',
            secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? '',
          },
        ];
      })
      .slice(0, 8);
  }

  async details(providerReference: string, sessionToken: string): Promise<CarShareLocation> {
    const place = await this.request<GooglePlace>(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(providerReference)}?languageCode=en&regionCode=PH&sessionToken=${encodeURIComponent(sessionToken)}`,
      { method: 'GET' },
      'id,displayName,formattedAddress,shortFormattedAddress,addressComponents,location',
      'LOCATION_DETAILS_UNAVAILABLE',
    );
    return normalizeGoogleLocation(place);
  }

  async reverseGeocode(latitude: number, longitude: number): Promise<CarShareLocation> {
    const payload = await this.request<{ results?: GooglePlace[] }>(
      `https://geocode.googleapis.com/v4/geocode/location?location.latitude=${latitude}&location.longitude=${longitude}&languageCode=en&regionCode=PH`,
      { method: 'GET' },
      'results.formattedAddress,results.addressComponents,results.location',
      'LOCATION_GEOCODING_UNAVAILABLE',
    );
    const place = payload.results?.[0];
    if (!place) throw unavailable('LOCATION_GEOCODING_UNAVAILABLE');
    return normalizeGoogleLocation({ ...place, location: { latitude, longitude } });
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    fieldMask: string | undefined,
    code: string,
  ): Promise<T> {
    if (this.configuration.getOrThrow('GEOCODING_PROVIDER', { infer: true }) !== 'google')
      throw unavailable(code);
    const key = this.configuration.getOrThrow('GOOGLE_MAPS_SERVER_KEY', { infer: true });
    const target = new URL(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const response = await fetch(target, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(target.hostname.endsWith('googleapis.com') ? { 'X-Goog-Api-Key': key } : {}),
          ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}),
        },
      });
      if (!response.ok) throw unavailable(code);
      return (await response.json()) as T;
    } catch {
      throw unavailable(code);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function component(components: AddressComponent[], types: string[]) {
  return components.find((item) => item.types?.some((type) => types.includes(type)))?.longText;
}

export function normalizeGoogleLocation(place: GooglePlace): CarShareLocation {
  const latitude = place.location?.latitude;
  const longitude = place.location?.longitude;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude! < -90 ||
    latitude! > 90 ||
    longitude! < -180 ||
    longitude! > 180
  )
    throw unavailable('INVALID_LOCATION_COORDINATES');
  const components = place.addressComponents ?? [];
  const countryCode = components
    .find((item) => item.types?.includes('country'))
    ?.shortText?.toUpperCase();
  if (countryCode !== 'PH') throw unavailable('INVALID_LOCATION_COUNTRY');
  const city = component(components, ['locality', 'postal_town', 'administrative_area_level_2']);
  const province = component(components, ['administrative_area_level_1']);
  const barangay = component(components, ['sublocality_level_1', 'sublocality', 'neighborhood']);
  const postalCode = component(components, ['postal_code']);
  if (!city || !province) throw unavailable('LOCATION_DETAILS_UNAVAILABLE');
  const streetNumber = component(components, ['street_number']);
  const route = component(components, ['route']);
  return {
    displayName:
      place.displayName?.text ?? place.shortFormattedAddress ?? place.formattedAddress ?? city,
    ...(streetNumber || route
      ? { addressLine1: [streetNumber, route].filter(Boolean).join(' ') }
      : place.formattedAddress
        ? { addressLine1: place.formattedAddress }
        : {}),
    ...(barangay ? { barangay } : {}),
    city,
    province,
    ...(postalCode ? { postalCode } : {}),
    country: 'PH',
    latitude: latitude!,
    longitude: longitude!,
  };
}

function unavailable(code: string) {
  return new ApplicationException(
    code,
    'Location service is temporarily unavailable. Please try again.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
