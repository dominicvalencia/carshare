import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { apiClient } from './src/auth/api-client';
import type { OwnerStatus } from './src/auth/auth.types';
import { AuthFlow } from './src/features/auth/AuthFlow';
import { AppNavigation } from './src/navigation/AppNavigation';
import type { MobileMode } from './src/navigation/routes';
import { colors, spacing } from './src/theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const auth = useAuth();
  const [mode, setMode] = useState<MobileMode>('renter');
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<{ status: OwnerStatus }>('/owners/me'),
    enabled: auth.user?.roles.includes('OWNER') ?? false,
    retry: false,
  });
  if (auth.booting)
    return (
      <View style={styles.loading}>
        <Text>Loading secure session…</Text>
      </View>
    );
  if (!auth.user) return <AuthFlow />;
  const ownerEnabled = owner.data?.status === 'VERIFIED';
  return (
    <View style={styles.container}>
      <View style={styles.modeBar}>
        <Text style={styles.brand}>Car Rental</Text>
        <View style={styles.modeControl}>
          {(['renter', 'owner'] as const).map((availableMode) => {
            const selected = mode === availableMode;
            const disabled = availableMode === 'owner' && !ownerEnabled;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                key={availableMode}
                onPress={() => setMode(availableMode)}
                style={[styles.modeButton, selected && styles.modeButtonSelected]}
              >
                <Text
                  style={[
                    styles.modeLabel,
                    selected && styles.modeLabelSelected,
                    disabled && styles.disabled,
                  ]}
                >
                  {availableMode === 'renter' ? 'Renter' : 'Owner'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <AppNavigation mode={mode} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  container: { backgroundColor: colors.surface, flex: 1 },
  disabled: { opacity: 0.4 },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  modeBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  modeButton: { borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  modeButtonSelected: { backgroundColor: colors.primary },
  modeControl: {
    backgroundColor: colors.muted,
    borderRadius: 999,
    flexDirection: 'row',
    padding: 2,
  },
  modeLabel: { color: colors.subtleText, fontSize: 13, fontWeight: '600' },
  modeLabelSelected: { color: colors.onPrimary },
});
