import * as SecureStore from 'expo-secure-store';

const key = (userId: string) => `owner-onboarding-dismissed_${userId}`;
const firstEntryIntentKey = (userId: string) => `owner-first-entry-intent_${userId}`;

export const ownerOnboardingStorage = {
  dismiss: (userId: string) => SecureStore.setItemAsync(key(userId), 'true'),
  async isDismissed(userId: string): Promise<boolean> {
    return (await SecureStore.getItemAsync(key(userId))) === 'true';
  },
};

export const ownerFirstEntryIntentStorage = {
  clear(userId: string) {
    return SecureStore.deleteItemAsync(firstEntryIntentKey(userId));
  },
  async exists(userId: string): Promise<boolean> {
    return (await SecureStore.getItemAsync(firstEntryIntentKey(userId))) === 'true';
  },
  set(userId: string) {
    return SecureStore.setItemAsync(firstEntryIntentKey(userId), 'true');
  },
};
