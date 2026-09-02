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
  readonly biometricsAvailable: boolean;
  enable(): Promise<boolean>;
  disable(): Promise<boolean>;
  lockNow(): Promise<void>;
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
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const refresh = useCallback(
    async (coldStart = false) => {
      const [record, available] = await Promise.all([
        appLockStorage.get(userId),
        appBiometrics.available(),
      ]);
      setEnabled(Boolean(record));
      setBiometricsAvailable(available);
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
      if (enabled && previous === 'active' && (next === 'background' || next === 'inactive'))
        void appLockStorage.update(userId, { lastInactiveAt: Date.now() });
      if ((previous === 'background' || previous === 'inactive') && next === 'active')
        void refresh(false);
      previous = next;
    });
    return () => {
      clearTimeout(initialization);
      subscription.remove();
    };
  }, [enabled, refresh, userId]);
  const value = useMemo<AppLockContextValue>(
    () => ({
      biometricsAvailable,
      clear: async () => {
        await appLockStorage.clearAccount(userId);
        setEnabled(false);
        setLocked(false);
      },
      disable: async () => {
        if (!(await appBiometrics.confirmDisable())) return false;
        await appLockStorage.clearAccount(userId);
        setEnabled(false);
        setLocked(false);
        return true;
      },
      enable: async () => {
        if (!biometricsAvailable || !(await appBiometrics.confirmEnable())) return false;
        await appLockStorage.enable(userId);
        setEnabled(true);
        setLocked(false);
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
      unlockWithBiometrics: async () => {
        if (!enabled || !biometricsAvailable) return false;
        const success = await appBiometrics.unlock();
        if (success) setLocked(false);
        return success;
      },
    }),
    [biometricsAvailable, enabled, loading, locked, userId],
  );
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}
export function useAppLock() {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock must be used inside AppLockProvider.');
  return value;
}
