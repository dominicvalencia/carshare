import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { apiClient } from './src/auth/api-client';
import type { OwnerStatus } from './src/auth/auth.types';
import { AuthFlow } from './src/features/auth/AuthFlow';
import { AppNavigation } from './src/navigation/AppNavigation';
import type { MobileMode } from './src/navigation/routes';
import { colors } from './src/theme/tokens';
import { PushRegistration } from './src/notifications/PushRegistration';

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
    <View style={styles.container}>
      <AppNavigation
        mode={mode}
        onModeChange={setMode}
        ownerCapable={ownerCapable}
        ownerStatus={owner.data?.status ?? null}
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
