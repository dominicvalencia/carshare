import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { appLockStorage } from './storage';
import { shouldLockAfterInactivity } from './policy';
import { appBiometrics } from './biometrics';

interface AppLockContextValue {
  readonly loading: boolean;
  readonly enabled: boolean;
  readonly locked: boolean;
  readonly biometricsEnabled: boolean;
  readonly biometricsAvailable: boolean;
  setup(pin: string, biometrics: boolean): Promise<void>;
  changePin(currentPin: string, newPin: string): Promise<boolean>;
  disable(pin: string): Promise<boolean>;
  setBiometrics(enabled: boolean): Promise<boolean>;
  lockNow(): Promise<void>;
  unlockWithPin(pin: string): Promise<boolean>;
  unlockWithBiometrics(): Promise<boolean>;
  clear(): Promise<void>;
}

const AppLockContext = createContext<AppLockContextValue | null>(null);

export function AppLockProvider({
  userId,
  children,
}: {
  readonly userId: string;
  readonly children: ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const refresh = useCallback(
    async (coldStart = false) => {
      const [record, biometricsAvailable] = await Promise.all([
        appLockStorage.get(userId),
        appBiometrics.available(),
      ]);
      setEnabled(Boolean(record));
      setBiometricsEnabled(Boolean(record?.biometricsEnabled));
      setBiometricsAvailable(biometricsAvailable);
      if (record && (coldStart || shouldLockAfterInactivity(record.lastInactiveAt, Date.now())))
        setLocked(true);
      setLoading(false);
    },
    [userId],
  );

  useEffect(() => {
    const initialization = setTimeout(() => void refresh(true), 0);
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous === 'active' && (next === 'background' || next === 'inactive'))
        void appLockStorage.update(userId, { lastInactiveAt: Date.now() });
      if ((previous === 'background' || previous === 'inactive') && next === 'active')
        void refresh(false);
      previous = next;
    });
    return () => {
      clearTimeout(initialization);
      subscription.remove();
    };
  }, [refresh, userId]);

  const value = useMemo<AppLockContextValue>(
    () => ({
      biometricsAvailable,
      biometricsEnabled,
      clear: async () => {
        await appLockStorage.clearAccount(userId);
        setEnabled(false);
        setLocked(false);
        setBiometricsEnabled(false);
      },
      changePin: async (currentPin, newPin) => {
        if (!(await appLockStorage.verify(userId, currentPin))) return false;
        await appLockStorage.setup(userId, newPin, biometricsEnabled);
        return true;
      },
      disable: async (pin) => {
        if (!(await appLockStorage.verify(userId, pin))) return false;
        await appLockStorage.clearAccount(userId);
        setEnabled(false);
        setLocked(false);
        setBiometricsEnabled(false);
        return true;
      },
      enabled,
      loading,
      locked,
      lockNow: async () => {
        if (!enabled) return;
        await appLockStorage.update(userId, { lastInactiveAt: Date.now() });
        setLocked(true);
      },
      setBiometrics: async (nextEnabled) => {
        if (nextEnabled && !biometricsAvailable) return false;
        if (nextEnabled) {
          if (!(await appBiometrics.confirmEnable())) return false;
        } else if (biometricsEnabled && !(await appBiometrics.confirmDisable())) {
          return false;
        }
        await appLockStorage.update(userId, { biometricsEnabled: nextEnabled });
        setBiometricsEnabled(nextEnabled);
        return true;
      },
      setup: async (pin, biometrics) => {
        if (biometrics && biometricsAvailable) {
          if (!(await appBiometrics.confirmEnable())) biometrics = false;
        }
        await appLockStorage.setup(userId, pin, biometrics && biometricsAvailable);
        setEnabled(true);
        setBiometricsEnabled(biometrics && biometricsAvailable);
        setLocked(false);
      },
      unlockWithBiometrics: async () => {
        if (!biometricsEnabled || !biometricsAvailable) return false;
        const success = await appBiometrics.unlock();
        if (success) {
          setLocked(false);
        }
        return success;
      },
      unlockWithPin: async (pin) => {
        const valid = await appLockStorage.verify(userId, pin);
        if (valid) {
          setLocked(false);
        }
        return valid;
      },
    }),
    [biometricsAvailable, biometricsEnabled, enabled, loading, locked, userId],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock() {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock must be used inside AppLockProvider.');
  return value;
}
