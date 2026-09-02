import { beforeEach, describe, expect, it, vi } from 'vitest';
const secureValues = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  deleteItemAsync: async (key: string) => void secureValues.delete(key),
  getItemAsync: async (key: string) => secureValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secureValues.set(key, value),
}));
import { accountStorageKey } from './policy';
import { appLockStorage } from './storage';

describe('biometric app-lock storage', () => {
  beforeEach(() => secureValues.clear());
  it('stores only biometric configuration and inactivity state', async () => {
    await appLockStorage.enable('account-a');
    await expect(appLockStorage.get('account-a')).resolves.toEqual({
      biometricsEnabled: true,
      lastInactiveAt: null,
      version: 2,
    });
    expect(secureValues.get(accountStorageKey('account-a'))).not.toMatch(/salt|verifier|pin/i);
  });
  it('deletes legacy PIN records so users are not trapped', async () => {
    secureValues.set(
      accountStorageKey('legacy'),
      JSON.stringify({ version: 1, salt: 'a', verifier: 'b' }),
    );
    await expect(appLockStorage.get('legacy')).resolves.toBeNull();
    expect(secureValues.has(accountStorageKey('legacy'))).toBe(false);
  });
  it('updates inactivity and clears only the selected account', async () => {
    await appLockStorage.enable('account-a');
    await appLockStorage.enable('account-b');
    await appLockStorage.update('account-a', { lastInactiveAt: 1234 });
    await expect(appLockStorage.get('account-a')).resolves.toMatchObject({ lastInactiveAt: 1234 });
    await appLockStorage.clearAccount('account-a');
    await expect(appLockStorage.get('account-a')).resolves.toBeNull();
    await expect(appLockStorage.get('account-b')).resolves.not.toBeNull();
  });
});
