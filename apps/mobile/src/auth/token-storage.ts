import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'carrental.refresh-token';

export const tokenStorage = {
  clear: () => SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string) =>
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
};
