import * as SecureStore from 'expo-secure-store';

const key = 'carshare.pendingRecoveryDeepLink';

export const pendingRecoveryDeepLinkStorage = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  },
  async set(value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },
};
