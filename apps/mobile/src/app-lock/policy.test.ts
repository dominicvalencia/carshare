import { describe, expect, it } from 'vitest';
import {
  APP_LOCK_TIMEOUT_MS,
  accountStorageKey,
  constantTimeEqual,
  isValidPin,
  shouldLockAfterInactivity,
} from './policy';

describe('app lock policy', () => {
  it('does not lock below the five-minute threshold', () => {
    expect(shouldLockAfterInactivity(1_000, 1_000 + APP_LOCK_TIMEOUT_MS - 1)).toBe(false);
  });

  it('locks at and above the threshold', () => {
    expect(shouldLockAfterInactivity(1_000, 1_000 + APP_LOCK_TIMEOUT_MS)).toBe(true);
    expect(shouldLockAfterInactivity(1_000, 1_000 + APP_LOCK_TIMEOUT_MS + 60_000)).toBe(true);
  });

  it('restores unlocked state when no background timestamp exists', () => {
    expect(shouldLockAfterInactivity(null, Date.now())).toBe(false);
  });

  it('validates exactly six numeric PIN digits', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('12345a')).toBe(false);
  });

  it('isolates secure-storage records by account', () => {
    expect(accountStorageKey('account-a')).not.toBe(accountStorageKey('account-b'));
  });

  it('compares derived verifiers without early equality exits', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});
