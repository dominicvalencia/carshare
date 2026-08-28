import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureValues = vi.hoisted(() => new Map<string, string>());
const secureOperations = vi.hoisted(() => ({
  get: vi.fn(async (key: string) => secureValues.get(key) ?? null),
  set: vi.fn(async (key: string, value: string) => void secureValues.set(key, value)),
}));

vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 1),
}));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  deleteItemAsync: async (key: string) => void secureValues.delete(key),
  getItemAsync: secureOperations.get,
  setItemAsync: secureOperations.set,
}));

import {
  appLockStorage,
  setAppLockPerformanceObserver,
  type AppLockPerformanceSample,
} from './storage';

describe('app-lock secure storage', () => {
  beforeEach(() => {
    secureValues.clear();
    vi.clearAllMocks();
    setAppLockPerformanceObserver(null);
  });

  it('stores only a salted verifier and verifies correct/incorrect PINs', async () => {
    await appLockStorage.setup('account-a', '123456', true);
    const record = await appLockStorage.get('account-a');
    expect(record).toMatchObject({ biometricsEnabled: true, version: 1 });
    expect(JSON.stringify(record)).not.toContain('123456');
    await expect(appLockStorage.verify('account-a', '123456')).resolves.toBe(true);
    await expect(appLockStorage.verify('account-a', '654321')).resolves.toBe(false);
  });

  it('restores timestamps and clears only the selected account on logout/recovery', async () => {
    await appLockStorage.setup('account-a', '123456', false);
    await appLockStorage.setup('account-b', '654321', false);
    await appLockStorage.update('account-a', { lastInactiveAt: 1234 });
    await expect(appLockStorage.get('account-a')).resolves.toMatchObject({ lastInactiveAt: 1234 });
    await appLockStorage.clearAccount('account-a');
    await expect(appLockStorage.get('account-a')).resolves.toBeNull();
    await expect(appLockStorage.verify('account-b', '654321')).resolves.toBe(true);
  });

  it('verifies an unlock with one SecureStore read and no redundant write', async () => {
    await appLockStorage.setup('account-a', '123456', false);
    vi.clearAllMocks();
    await expect(appLockStorage.verify('account-a', '123456')).resolves.toBe(true);
    expect(secureOperations.get).toHaveBeenCalledTimes(1);
    expect(secureOperations.set).not.toHaveBeenCalled();
  });

  it('profiles crypto and storage phases without a flaky absolute-time assertion', async () => {
    const samples: AppLockPerformanceSample[] = [];
    setAppLockPerformanceObserver((sample) => samples.push(sample));
    await appLockStorage.setup('performance-account', '123456', false);
    await appLockStorage.verify('performance-account', '123456');
    await appLockStorage.update('performance-account', { lastInactiveAt: 1234 });
    expect(samples.map(({ operation }) => operation)).toEqual(['setup', 'verify', 'update']);
    expect(samples[1]).toMatchObject({ operation: 'verify', secureStoreWriteMs: 0 });
    expect(samples[2]).toMatchObject({ derivationMs: 0, operation: 'update' });
    for (const sample of samples) {
      expect(sample.totalMs).toBeGreaterThanOrEqual(0);
    }
  });
});
