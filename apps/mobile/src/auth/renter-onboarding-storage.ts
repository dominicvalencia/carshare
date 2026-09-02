import * as SecureStore from 'expo-secure-store';

// Expo SecureStore keys only support alphanumerics plus `.`, `-`, and `_`.
const key = (userId: string) => `renter-onboarding_${userId}`;

export const renterOnboardingStorage = {
  async isPending(userId: string) {
    return (await SecureStore.getItemAsync(key(userId))) === 'pending';
  },
  markPending(userId: string) {
    return SecureStore.setItemAsync(key(userId), 'pending');
  },
  clear(userId: string) {
    return SecureStore.deleteItemAsync(key(userId));
  },
};
