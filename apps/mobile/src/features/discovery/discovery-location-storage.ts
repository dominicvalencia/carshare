import * as SecureStore from 'expo-secure-store';

export type DiscoveryLocationSource = 'USER_SELECTED' | 'DEVICE_LOCATION' | 'FALLBACK';

export interface PersistedDiscoveryLocation {
  readonly label: string;
  readonly detail: string;
  readonly city: string;
  readonly province: string;
  readonly latitude: number;
  readonly longitude: number;
}

const key = (accountId: string) => `discovery-location_${accountId}`;

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function parsePersistedDiscoveryLocation(
  value: string | null,
): PersistedDiscoveryLocation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof parsed.label !== 'string' ||
      typeof parsed.detail !== 'string' ||
      typeof parsed.city !== 'string' ||
      typeof parsed.province !== 'string' ||
      !parsed.label.trim() ||
      !parsed.city.trim() ||
      !validCoordinate(parsed.latitude, 90) ||
      !validCoordinate(parsed.longitude, 180)
    )
      return null;
    return {
      city: parsed.city,
      detail: parsed.detail,
      label: parsed.label,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      province: parsed.province,
    };
  } catch {
    return null;
  }
}

export const discoveryLocationStorage = {
  async clear(accountId: string) {
    try {
      await SecureStore.deleteItemAsync(key(accountId));
    } catch {
      // Discovery remains usable with its safe fallback when preference storage is unavailable.
    }
  },
  async get(accountId: string) {
    try {
      return parsePersistedDiscoveryLocation(await SecureStore.getItemAsync(key(accountId)));
    } catch {
      return null;
    }
  },
  async set(accountId: string, location: PersistedDiscoveryLocation) {
    try {
      await SecureStore.setItemAsync(key(accountId), JSON.stringify(location), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } catch {
      // Discovery remains usable for this session when preference storage is unavailable.
    }
  },
};
