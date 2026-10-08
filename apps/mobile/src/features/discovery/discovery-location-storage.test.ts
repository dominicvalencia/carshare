import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStore = vi.hoisted(() => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

vi.mock('expo-secure-store', () => secureStore);

import {
  discoveryLocationStorage,
  parsePersistedDiscoveryLocation,
} from './discovery-location-storage';

const lucena = {
  city: 'Lucena City',
  detail: 'Lucena and nearby Quezon',
  label: 'Lucena City',
  latitude: 13.9414,
  longitude: 121.623,
  province: 'Quezon',
};

describe('discovery location storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists an explicit location in an account-scoped record', async () => {
    await discoveryLocationStorage.set('renter-1', lucena);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'discovery-location_renter-1',
      JSON.stringify(lucena),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
  });

  it('restores valid manual locations and rejects unsafe records', async () => {
    secureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(lucena));
    await expect(discoveryLocationStorage.get('renter-1')).resolves.toEqual(lucena);
    expect(parsePersistedDiscoveryLocation('{"latitude":999}')).toBeNull();
    expect(parsePersistedDiscoveryLocation('not-json')).toBeNull();
  });

  it('clears manual authority before device-derived Nearby becomes active', async () => {
    await discoveryLocationStorage.clear('renter-1');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('discovery-location_renter-1');
  });
});
