import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors, radius, spacing } from '../theme/tokens';
import { Button, Icon } from '../ui/primitives';
import { useAppLock } from './AppLockProvider';

export function AppLockScreen() {
  const auth = useAuth();
  const lock = useAppLock();
  const [error, setError] = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const automaticBiometricAttempted = useRef(false);
  const biometricUnlock = useCallback(async () => {
    if (authenticating) return;
    setAuthenticating(true);
    setError('');
    const success = await lock.unlockWithBiometrics();
    if (!success)
      setError('Biometric authentication was cancelled or did not match. Try again or log out.');
    setAuthenticating(false);
  }, [authenticating, lock]);
  useEffect(() => {
    if (automaticBiometricAttempted.current || !lock.locked || !lock.biometricsAvailable) return;
    automaticBiometricAttempted.current = true;
    const prompt = setTimeout(() => void biometricUnlock(), 150);
    return () => clearTimeout(prompt);
  }, [biometricUnlock, lock.biometricsAvailable, lock.locked]);
  const recover = async () => {
    await lock.clear();
    await auth.logout();
  };
  return (
    <View style={styles.screen}>
      <View style={styles.icon}>
        <Icon color={colors.primary} name="lock-closed" size={34} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        Car Rental is locked
      </Text>
      <Text style={styles.body}>
        Authenticate with your device biometrics to continue. Biometric matching is handled by the
        operating system.
      </Text>
      <View style={styles.form}>
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {authenticating && (
          <View style={styles.progress}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Checking securely…</Text>
          </View>
        )}
        {lock.biometricsAvailable && (
          <Button
            icon="finger-print-outline"
            label="Try Again"
            onPress={() => void biometricUnlock()}
            variant="secondary"
          />
        )}
        <Button label="Log Out" onPress={() => void recover()} variant="ghost" />
      </View>
      <Text style={styles.note}>
        Logging out clears this account’s local app-lock setup and ends the authenticated session.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 22, textAlign: 'center' },
  error: { color: colors.danger, fontWeight: '700', textAlign: 'center' },
  form: { gap: spacing.md, maxWidth: 420, width: '100%' },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  note: {
    color: colors.subtleText,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 420,
    textAlign: 'center',
  },
  progress: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  screen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900', textAlign: 'center' },
});
