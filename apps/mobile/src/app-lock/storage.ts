import * as SecureStore from 'expo-secure-store';
import { accountStorageKey } from './policy';

export interface AppLockRecord {
  readonly version: 2;
  readonly biometricsEnabled: true;
  readonly lastInactiveAt: number | null;
}

export const appLockStorage = {
  async get(userId: string): Promise<AppLockRecord | null> {
    const key = accountStorageKey(userId);
    const value = await SecureStore.getItemAsync(key);
    if (!value) return null;
    try {
      const record = JSON.parse(value) as {
        version?: number;
        biometricsEnabled?: boolean;
        lastInactiveAt?: number | null;
      };
      if (record.version === 2 && record.biometricsEnabled === true) return record as AppLockRecord;
      await SecureStore.deleteItemAsync(key);
      return null;
    } catch {
      await SecureStore.deleteItemAsync(key);
      return null;
    }
  },
  async enable(userId: string) {
    await save(userId, { biometricsEnabled: true, lastInactiveAt: null, version: 2 });
  },
  async update(userId: string, patch: Pick<Partial<AppLockRecord>, 'lastInactiveAt'>) {
    const record = await this.get(userId);
    if (!record) return;
    await save(userId, { ...record, ...patch });
  },
  clearAccount(userId: string) {
    return SecureStore.deleteItemAsync(accountStorageKey(userId));
  },
};

function save(userId: string, record: AppLockRecord) {
  return SecureStore.setItemAsync(accountStorageKey(userId), JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
