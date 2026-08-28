import { beforeEach, describe, expect, it, vi } from 'vitest';

const localAuthentication = vi.hoisted(() => ({
  authenticateAsync: vi.fn(),
  hasHardwareAsync: vi.fn(),
  isEnrolledAsync: vi.fn(),
}));

vi.mock('expo-local-authentication', () => localAuthentication);

import { appBiometrics } from './biometrics';

describe('operating-system biometric adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires both biometric hardware and enrollment', async () => {
    localAuthentication.hasHardwareAsync.mockResolvedValue(true);
    localAuthentication.isEnrolledAsync.mockResolvedValue(true);
    await expect(appBiometrics.available()).resolves.toBe(true);
    localAuthentication.isEnrolledAsync.mockResolvedValue(false);
    await expect(appBiometrics.available()).resolves.toBe(false);
  });

  it('accepts only an OS-reported biometric success', async () => {
    localAuthentication.authenticateAsync.mockResolvedValue({ success: true });
    await expect(appBiometrics.unlock()).resolves.toBe(true);
    localAuthentication.authenticateAsync.mockResolvedValue({
      error: 'authentication_failed',
      success: false,
    });
    await expect(appBiometrics.unlock()).resolves.toBe(false);
  });

  it('keeps the app locked when the biometric prompt is cancelled', async () => {
    localAuthentication.authenticateAsync.mockResolvedValue({
      error: 'user_cancel',
      success: false,
    });
    await expect(appBiometrics.unlock()).resolves.toBe(false);
  });

  it('requires an OS authentication result before disabling biometrics', async () => {
    localAuthentication.authenticateAsync.mockResolvedValue({ success: true });
    await expect(appBiometrics.confirmDisable()).resolves.toBe(true);
    localAuthentication.authenticateAsync.mockResolvedValue({
      error: 'user_cancel',
      success: false,
    });
    await expect(appBiometrics.confirmDisable()).resolves.toBe(false);
  });
});
