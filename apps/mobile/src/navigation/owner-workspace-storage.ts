import * as SecureStore from 'expo-secure-store';

const key = (userId: string) => `active-owner-workspace_${userId}`;

export const ownerWorkspaceStorage = {
  clear(userId: string) {
    return SecureStore.deleteItemAsync(key(userId));
  },
  get(userId: string) {
    return SecureStore.getItemAsync(key(userId));
  },
  set(userId: string, ownerProfileId: string) {
    return SecureStore.setItemAsync(key(userId), ownerProfileId);
  },
};
