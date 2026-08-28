import { useState } from 'react';
import { Modal, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { Button, Card, Icon, PasscodeInput, Screen, StateView } from '../ui/primitives';
import { useAppLock } from './AppLockProvider';
import { APP_LOCK_TIMEOUT_MINUTES, isValidPin } from './policy';

type Mode = 'setup' | 'change' | 'disable' | null;

export function AppLockSettings() {
  const lock = useAppLock();
  const [mode, setMode] = useState<Mode>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    setMode(null);
    setCurrentPin('');
    setPin('');
    setConfirmPin('');
    setError('');
  };
  const submit = async () => {
    setError('');
    if (mode === 'disable') {
      if (!(await lock.disable(currentPin))) return setError('Incorrect current app PIN.');
      close();
      return;
    }
    if (!isValidPin(pin)) return setError('Choose exactly six digits.');
    if (pin !== confirmPin) return setError('PIN confirmation does not match.');
    if (mode === 'setup') await lock.setup(pin, enableBiometrics);
    if (mode === 'change' && !(await lock.changePin(currentPin, pin)))
      return setError('Incorrect current app PIN.');
    close();
  };
  if (lock.loading) return <StateView loading title="Loading app-lock settings…" />;
  return (
    <>
      <Card style={styles.card}>
        <View style={styles.heading}>
          <View style={styles.icon}>
            <Icon color={colors.primary} name="lock-closed-outline" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>App lock</Text>
            <Text style={styles.body}>
              {lock.enabled
                ? `Protected after ${APP_LOCK_TIMEOUT_MINUTES} minutes away from the app.`
                : 'Add a local six-digit PIN without shortening your server session.'}
            </Text>
          </View>
        </View>
        {!lock.enabled ? (
          <Button label="Set up app lock" onPress={() => setMode('setup')} />
        ) : (
          <>
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.label}>Device biometrics</Text>
                <Text style={styles.body}>
                  {lock.biometricsAvailable
                    ? 'Use Face ID, Touch ID, or Android biometrics as an alternate unlock.'
                    : 'No enrolled device biometric is available.'}
                </Text>
              </View>
              <Switch
                disabled={!lock.biometricsAvailable}
                onValueChange={(value) => void lock.setBiometrics(value)}
                value={lock.biometricsEnabled}
              />
            </View>
            <Button label="Lock immediately" onPress={() => void lock.lockNow()} />
            <Button label="Change PIN" onPress={() => setMode('change')} variant="secondary" />
            <Button label="Disable app lock" onPress={() => setMode('disable')} variant="ghost" />
          </>
        )}
      </Card>
      <Modal
        animationType="slide"
        onRequestClose={close}
        presentationStyle="pageSheet"
        visible={mode !== null}
      >
        <Screen
          eyebrow="Local security"
          title={
            mode === 'setup'
              ? 'Set up app lock'
              : mode === 'change'
                ? 'Change app PIN'
                : 'Disable app lock'
          }
          subtitle="Your app PIN is never sent to the API or stored in plaintext."
        >
          {(mode === 'change' || mode === 'disable') && (
            <PinField label="Current 6-digit PIN" value={currentPin} onChange={setCurrentPin} />
          )}
          {mode !== 'disable' && (
            <>
              <PinField label="Choose 6-digit PIN" value={pin} onChange={setPin} />
              <PinField label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />
            </>
          )}
          {mode === 'setup' && lock.biometricsAvailable && (
            <View style={styles.toggleRow}>
              <View style={styles.flex}>
                <Text style={styles.label}>Enable biometrics after PIN setup</Text>
                <Text style={styles.body}>The operating system performs biometric matching.</Text>
              </View>
              <Switch onValueChange={setEnableBiometrics} value={enableBiometrics} />
            </View>
          )}
          {error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Button
            label={mode === 'disable' ? 'Disable app lock' : 'Save PIN'}
            onPress={() => void submit()}
            variant={mode === 'disable' ? 'danger' : 'primary'}
          />
          <Button label="Cancel" onPress={close} variant="ghost" />
        </Screen>
      </Modal>
    </>
  );
}

function PinField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return <PasscodeInput label={label} value={value} onChange={onChange} />;
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
  label: { color: colors.ink, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  toggleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
