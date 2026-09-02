import * as LocalAuthentication from 'expo-local-authentication';

export const appBiometrics = {
  async available() {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  },

  async confirmEnable() {
    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      promptMessage: 'Enable biometric app unlock',
    });
    return result.success;
  },

  async confirmDisable() {
    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Keep enabled',
      disableDeviceFallback: false,
      promptMessage: 'Confirm disabling biometric app unlock',
    });
    return result.success;
  },

  async unlock() {
    const result = await LocalAuthentication.authenticateAsync({
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
      promptMessage: 'Unlock Car Rental',
    });
    return result.success;
  },
};
