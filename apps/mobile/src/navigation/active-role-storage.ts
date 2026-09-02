import * as SecureStore from 'expo-secure-store';
import type { MobileMode } from './routes';

const key = (userId: string) => `active-role_${userId}`;

export const activeRoleStorage = {
  async get(userId: string): Promise<MobileMode> {
    return (await SecureStore.getItemAsync(key(userId))) === 'owner' ? 'owner' : 'renter';
  },
  set(userId: string, mode: MobileMode) {
    return SecureStore.setItemAsync(key(userId), mode);
  },
};
