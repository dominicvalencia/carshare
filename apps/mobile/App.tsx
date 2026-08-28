import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as Device from 'expo-device';
import { useEffect, useState } from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { apiClient } from './src/auth/api-client';
import type { OwnerStatus } from './src/auth/auth.types';
import { AuthFlow } from './src/features/auth/AuthFlow';
import { AppNavigation } from './src/navigation/AppNavigation';
import type { MobileMode } from './src/navigation/routes';
import { colors } from './src/theme/tokens';
import { PushRegistration } from './src/notifications/PushRegistration';
import { AppLockProvider, useAppLock } from './src/app-lock/AppLockProvider';
import { AppLockScreen } from './src/app-lock/AppLockScreen';
import { appLockStorage, setAppLockPerformanceObserver } from './src/app-lock/storage';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SessionApplication />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function SessionApplication() {
  const auth = useAuth();
  return <PrincipalApplication key={auth.user?.id ?? 'anonymous'} />;
}

function PrincipalApplication() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

function AppContent() {
  const auth = useAuth();
  const [mode, setMode] = useState<MobileMode>('renter');
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<{ status: OwnerStatus }>('/owners/me'),
    enabled: Boolean(auth.user) && !auth.booting,
    retry: false,
  });
  if (auth.booting)
    return (
      <View style={styles.loading}>
        <Text>Loading secure session…</Text>
      </View>
    );
  if (!auth.user) return <AuthFlow />;
  const ownerCapable = Boolean(owner.data) || auth.user.roles.includes('OWNER');
  return (
    <AppLockProvider userId={auth.user.id}>
      <AppLockPerformanceProbe />
      <ProtectedApplication
        mode={mode}
        onModeChange={setMode}
        ownerCapable={ownerCapable}
        ownerStatus={owner.data?.status ?? null}
      />
    </AppLockProvider>
  );
}

function AppLockPerformanceProbe() {
  useEffect(() => {
    if (!__DEV__) return;
    const screen = Dimensions.get('screen');
    const deviceLabel = `${Device.modelName ?? 'unknown-device'} ${Math.round(screen.width)}x${Math.round(screen.height)} iOS ${String(Platform.Version)}`;
    setAppLockPerformanceObserver((sample) => {
      // Development timing only. PINs, salts, and verifiers are deliberately excluded.
      console.info('[app-lock-performance]', deviceLabel, JSON.stringify(sample));
    });
    if (process.env.EXPO_PUBLIC_APP_LOCK_BENCHMARK === '1') {
      const benchmarkAccount = '__development_app_lock_benchmark__';
      const benchmark = setTimeout(() => {
        void (async () => {
          await appLockStorage.setup(benchmarkAccount, '000000', false);
          await appLockStorage.verify(benchmarkAccount, '000000');
          await appLockStorage.update(benchmarkAccount, { lastInactiveAt: Date.now() });
          await appLockStorage.clearAccount(benchmarkAccount);
        })();
      }, 500);
      return () => {
        clearTimeout(benchmark);
        setAppLockPerformanceObserver(null);
      };
    }
    return () => setAppLockPerformanceObserver(null);
  }, []);
  return null;
}

function ProtectedApplication({
  mode,
  onModeChange,
  ownerCapable,
  ownerStatus,
}: {
  readonly mode: MobileMode;
  readonly onModeChange: (mode: MobileMode) => void;
  readonly ownerCapable: boolean;
  readonly ownerStatus: OwnerStatus | null;
}) {
  const lock = useAppLock();
  if (lock.loading)
    return (
      <View style={styles.loading}>
        <Text>Loading local security…</Text>
      </View>
    );
  if (lock.locked) return <AppLockScreen />;
  return (
    <View style={styles.container}>
      <AppNavigation
        mode={mode}
        onModeChange={onModeChange}
        ownerCapable={ownerCapable}
        ownerStatus={ownerStatus}
      />
      <PushRegistration />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surface, flex: 1 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
});
