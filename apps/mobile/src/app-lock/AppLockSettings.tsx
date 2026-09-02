import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { Button, Card, Icon, StateView } from '../ui/primitives';
import { useAppLock } from './AppLockProvider';
import { APP_LOCK_TIMEOUT_MINUTES } from './policy';

export function AppLockSettings() {
  const lock = useAppLock();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const change = async () => {
    setPending(true);
    setError('');
    const success = lock.enabled ? await lock.disable() : await lock.enable();
    if (!success)
      setError(
        lock.biometricsAvailable
          ? 'Biometric authentication was cancelled or unsuccessful.'
          : 'Set up Face ID, Touch ID, or supported Android biometrics in device settings first.',
      );
    setPending(false);
  };
  if (lock.loading) return <StateView loading title="Loading app-lock settings…" />;
  return (
    <Card style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.icon}>
          <Icon color={colors.primary} name="lock-closed-outline" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.title}>Biometric app lock</Text>
          <Text style={styles.body}>
            {lock.enabled
              ? `Protected after ${APP_LOCK_TIMEOUT_MINUTES} minutes away from the app.`
              : 'Use Face ID, Touch ID, or supported Android biometrics to protect the app.'}
          </Text>
        </View>
      </View>
      <Text style={styles.body}>
        Your operating system performs biometric matching. Car Rental does not receive or store
        biometric data.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button
        disabled={pending || (!lock.enabled && !lock.biometricsAvailable)}
        label={
          pending
            ? 'Authenticating…'
            : lock.enabled
              ? 'Disable biometric app lock'
              : 'Enable biometric app lock'
        }
        onPress={() => void change()}
        variant={lock.enabled ? 'ghost' : 'primary'}
      />
      {lock.enabled && (
        <Button label="Lock immediately" onPress={() => void lock.lockNow()} variant="secondary" />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  card: { gap: spacing.md },
  error: { color: colors.danger, fontWeight: '700' },
  flex: { flex: 1 },
  heading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: '900' },
});
