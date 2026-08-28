import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { accountStorageKey, constantTimeEqual, isValidPin } from './policy';

const ITERATIONS = 120_000;

export interface AppLockPerformanceSample {
  readonly operation: 'setup' | 'update' | 'verify';
  readonly derivationMs: number;
  readonly secureStoreReadMs: number;
  readonly secureStoreWriteMs: number;
  readonly comparisonMs: number;
  readonly totalMs: number;
}

let performanceObserver: ((sample: AppLockPerformanceSample) => void) | null = null;
export function setAppLockPerformanceObserver(
  observer: ((sample: AppLockPerformanceSample) => void) | null,
): void {
  performanceObserver = observer;
}

export interface AppLockRecord {
  readonly version: 1;
  readonly salt: string;
  readonly verifier: string;
  readonly biometricsEnabled: boolean;
  readonly lastInactiveAt: number | null;
}

export const appLockStorage = {
  async get(userId: string): Promise<AppLockRecord | null> {
    const value = await SecureStore.getItemAsync(accountStorageKey(userId));
    if (!value) return null;
    try {
      const record = JSON.parse(value) as AppLockRecord;
      return record.version === 1 ? record : null;
    } catch {
      return null;
    }
  },

  async setup(userId: string, pin: string, biometricsEnabled: boolean) {
    const totalStarted = now();
    if (!isValidPin(pin)) throw new Error('App PIN must contain exactly six digits.');
    const salt = getRandomBytes(16);
    const derivationStarted = now();
    const verifier = await derive(pin, salt);
    const derivationMs = now() - derivationStarted;
    const writeStarted = now();
    await save(userId, {
      biometricsEnabled,
      lastInactiveAt: null,
      salt: bytesToHex(salt),
      verifier,
      version: 1,
    });
    performanceObserver?.({
      comparisonMs: 0,
      derivationMs,
      operation: 'setup',
      secureStoreReadMs: 0,
      secureStoreWriteMs: now() - writeStarted,
      totalMs: now() - totalStarted,
    });
  },

  async verify(userId: string, pin: string) {
    const totalStarted = now();
    const readStarted = now();
    const record = await this.get(userId);
    const secureStoreReadMs = now() - readStarted;
    if (!record || !isValidPin(pin)) return false;
    const derivationStarted = now();
    const candidate = await derive(pin, hexToBytes(record.salt));
    const derivationMs = now() - derivationStarted;
    const comparisonStarted = now();
    const valid = constantTimeEqual(candidate, record.verifier);
    const comparisonMs = now() - comparisonStarted;
    performanceObserver?.({
      comparisonMs,
      derivationMs,
      operation: 'verify',
      secureStoreReadMs,
      secureStoreWriteMs: 0,
      totalMs: now() - totalStarted,
    });
    return valid;
  },

  async update(
    userId: string,
    patch: Partial<Pick<AppLockRecord, 'biometricsEnabled' | 'lastInactiveAt'>>,
  ) {
    const totalStarted = now();
    const readStarted = now();
    const record = await this.get(userId);
    const secureStoreReadMs = now() - readStarted;
    if (!record) return;
    const writeStarted = now();
    await save(userId, { ...record, ...patch });
    performanceObserver?.({
      comparisonMs: 0,
      derivationMs: 0,
      operation: 'update',
      secureStoreReadMs,
      secureStoreWriteMs: now() - writeStarted,
      totalMs: now() - totalStarted,
    });
  },

  clearAccount(userId: string) {
    return SecureStore.deleteItemAsync(accountStorageKey(userId));
  },
};

async function derive(pin: string, salt: Uint8Array) {
  return bytesToHex(
    await pbkdf2Async(sha256, pin, salt, { asyncTick: 10, c: ITERATIONS, dkLen: 32 }),
  );
}

function save(userId: string, record: AppLockRecord) {
  return SecureStore.setItemAsync(accountStorageKey(userId), JSON.stringify(record), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
