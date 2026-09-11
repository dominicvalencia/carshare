import * as SecureStore from 'expo-secure-store';
import type { MobileMode } from './routes';

const key = (userId: string) => `active-role_${userId}`;

export const activeRoleStorage = {
  clear(userId: string) {
    return SecureStore.deleteItemAsync(key(userId));
  },
  async get(userId: string): Promise<MobileMode | null> {
    const value = await SecureStore.getItemAsync(key(userId));
    return value === 'owner' || value === 'renter' ? value : null;
  },
  set(userId: string, mode: MobileMode) {
    return SecureStore.setItemAsync(key(userId), mode);
  },
};
