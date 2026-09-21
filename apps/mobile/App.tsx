import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { Button, Icon } from './src/ui/primitives';
import {
  RenterOnboardingContactPage,
  RenterOnboardingKycPage,
} from './src/features/account/RenterOnboardingPages';
import { RenterOnboardingDraftProvider } from './src/features/account/RenterVerificationWorkflow';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { activeRoleStorage } from './src/navigation/active-role-storage';
import { OwnerOnboardingScreen } from './src/features/account/AccountScreen';
import { GuidedOnboarding, OnboardingWelcome } from './src/onboarding/GuidedOnboarding';
import {
  ownerFirstEntryIntentStorage,
  ownerOnboardingStorage,
} from './src/onboarding/owner-onboarding-storage';
import { resolvePersonaMode, shouldPresentOwnerFirstEntry } from './src/navigation/persona-mode';
import { isSafeRecoveryDeepLink } from './src/navigation/deep-links';
import { pendingRecoveryDeepLinkStorage } from './src/navigation/pending-deep-link-storage';
import Constants from 'expo-constants';

const OnboardingStack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <AuthProvider>
          <SessionApplication />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
  const userId = auth.user?.id;
  const [mode, setMode] = useState<MobileMode>('renter');
  const [restoredModeKey, setRestoredModeKey] = useState<string | null>(null);
  const [ownerGuideState, setOwnerGuideState] = useState<{
    readonly dismissed: boolean;
    readonly firstEntryIntent: boolean;
    readonly userId: string;
  } | null>(null);
  const appScheme = Constants.expoConfig?.extra?.appScheme ?? 'carrental';
  useEffect(() => {
    const retain = (url: string | null) => {
      if (!auth.user && url && isSafeRecoveryDeepLink(url, appScheme))
        void pendingRecoveryDeepLinkStorage.set(url);
    };
    void Linking.getInitialURL().then(retain);
    const subscription = Linking.addEventListener('url', ({ url }) => retain(url));
    return () => subscription.remove();
  }, [appScheme, auth.user]);
  useEffect(() => {
    if (!auth.user) return;
    let active = true;
    void pendingRecoveryDeepLinkStorage.get().then(async (url) => {
      if (!active || !url || !isSafeRecoveryDeepLink(url, appScheme)) return;
      await pendingRecoveryDeepLinkStorage.clear();
      setTimeout(() => void Linking.openURL(url), 0);
    });
    return () => {
      active = false;
    };
  }, [appScheme, auth.user]);
  const roles = auth.user?.roles ?? [];
  const renterCapable = roles.includes('RENTER');
  const ownerRole = roles.includes('OWNER');
  const modeResolutionKey = userId
    ? `${userId}:${auth.user?.profile?.initialMarketplacePersona ?? 'NONE'}:${renterCapable}:${ownerRole}`
    : null;
  useEffect(() => {
    if (!userId || !modeResolutionKey) return;
    let active = true;
    void activeRoleStorage
      .get(userId)
      .then((stored) => {
        if (!active) return;
        setMode(
          resolvePersonaMode({
            initialPersona: auth.user?.profile?.initialMarketplacePersona ?? null,
            ownerEnabled: ownerRole,
            renterEnabled: renterCapable,
            savedMode: stored,
          }) ?? 'renter',
        );
      })
      .finally(() => {
        if (active) setRestoredModeKey(modeResolutionKey);
      });
    return () => {
      active = false;
    };
  }, [
    auth.user?.profile?.initialMarketplacePersona,
    modeResolutionKey,
    ownerRole,
    renterCapable,
    userId,
  ]);
  useEffect(() => {
    if (!userId || !ownerRole) return;
    let active = true;
    void Promise.all([
      ownerOnboardingStorage.isDismissed(userId),
      ownerFirstEntryIntentStorage.exists(userId),
    ]).then(([dismissed, firstEntryIntent]) => {
      if (active) setOwnerGuideState({ dismissed, firstEntryIntent, userId });
    });
    return () => {
      active = false;
    };
  }, [ownerRole, userId]);
  const ownerGuideReady = !userId || !ownerRole || ownerGuideState?.userId === userId;
  const ownerGuideDismissed = Boolean(
    ownerGuideState && ownerGuideState.userId === userId && ownerGuideState.dismissed,
  );
  const ownerFirstEntryIntent = Boolean(
    ownerGuideState && ownerGuideState.userId === userId && ownerGuideState.firstEntryIntent,
  );
  const changeMode = useCallback(
    (nextMode: MobileMode) => {
      setMode(nextMode);
      if (userId) {
        void activeRoleStorage.set(userId, nextMode);
        if (
          nextMode === 'owner' &&
          ownerRole &&
          !auth.user?.profile?.ownerOnboardingFirstEnteredAt
        ) {
          setOwnerGuideState({ dismissed: false, firstEntryIntent: true, userId });
          void ownerFirstEntryIntentStorage.set(userId);
        }
      }
    },
    [auth.user?.profile?.ownerOnboardingFirstEnteredAt, ownerRole, userId],
  );
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<{ status: OwnerStatus }>('/owners/me'),
    enabled: Boolean(auth.user) && ownerRole && !auth.booting,
    retry: false,
  });
  if (auth.booting)
    return (
      <View style={styles.loading}>
        <Text>Loading secure session…</Text>
      </View>
    );
  if (!auth.user) return <AuthFlow />;
  if (!renterCapable && !ownerRole) return <PersonaSelection />;
  if (restoredModeKey !== modeResolutionKey || !ownerGuideReady)
    return (
      <View style={styles.loading}>
        <Text>Restoring your workspace…</Text>
      </View>
    );
  if (mode === 'renter' && auth.renterOnboardingPending)
    return (
      <NavigationContainer>
        <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
          <OnboardingStack.Screen name="RenterOnboarding">
            {() => <RenterOnboarding onSkip={() => void auth.skipRenterOnboarding()} />}
          </OnboardingStack.Screen>
        </OnboardingStack.Navigator>
      </NavigationContainer>
    );
  if (!renterCapable && ownerRole && owner.isPending)
    return (
      <View style={styles.loading}>
        <Text>Restoring Vehicle Owner setup…</Text>
      </View>
    );
  if (
    !ownerGuideDismissed &&
    owner.data &&
    shouldPresentOwnerFirstEntry({
      firstEntryIntent: ownerFirstEntryIntent,
      initialPersona: auth.user.profile?.initialMarketplacePersona ?? null,
      mode,
      ownerEnabled: ownerRole,
      ownerOnboardingFirstEnteredAt: auth.user.profile?.ownerOnboardingFirstEnteredAt ?? null,
    })
  )
    return (
      <NavigationContainer>
        <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
          <OnboardingStack.Screen name="OwnerOnboarding" options={{ gestureEnabled: false }}>
            {() => (
              <OwnerOnboardingScreen
                onSkip={() => {
                  setOwnerGuideState({ dismissed: true, firstEntryIntent: false, userId: userId! });
                }}
              />
            )}
          </OnboardingStack.Screen>
        </OnboardingStack.Navigator>
      </NavigationContainer>
    );
  const ownerCapable = Boolean(owner.data) || ownerRole;
  return (
    <AppLockProvider userId={auth.user.id}>
      <ProtectedApplication
        mode={mode}
        onModeChange={changeMode}
        ownerCapable={ownerCapable}
        ownerStatus={owner.data?.status ?? null}
      />
    </AppLockProvider>
  );
}

function PersonaSelection() {
  const auth = useAuth();
  const [selected, setSelected] = useState<'RENTER' | 'OWNER' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const choose = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await auth.enrollPersona(selected);
    } catch {
      setError('We could not save your choice. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.personaShell}>
      <View style={styles.personaContent}>
        <Text style={styles.onboardingEyebrow}>WELCOME TO CARSHARE</Text>
        <Text accessibilityRole="header" style={styles.onboardingTitle}>
          How would you like to use CarShare?
        </Text>
        <Text style={styles.personaSupporting}>
          You can add the other option later from your profile.
        </Text>
        <PersonaOption
          description="Find and book vehicles from CarShare owners."
          icon="car-sport-outline"
          label="Rent a car"
          onPress={() => setSelected('RENTER')}
          selected={selected === 'RENTER'}
        />
        <PersonaOption
          description="Earn by listing your vehicle for verified renters."
          icon="key-outline"
          label="List my car"
          onPress={() => setSelected('OWNER')}
          selected={selected === 'OWNER'}
        />
        {error ? (
          <Text accessibilityRole="alert" style={styles.personaError}>
            {error}
          </Text>
        ) : null}
        <Button
          disabled={!selected || submitting}
          label={submitting ? 'Saving…' : 'Continue'}
          onPress={() => void choose()}
        />
      </View>
    </SafeAreaView>
  );
}

function PersonaOption({
  description,
  icon,
  label,
  onPress,
  selected,
}: {
  readonly description: string;
  readonly icon: 'car-sport-outline' | 'key-outline';
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.personaOption, selected && styles.personaOptionSelected]}
    >
      <Icon color={colors.primary} name={icon} size={32} />
      <View style={styles.personaOptionCopy}>
        <Text style={styles.personaOptionTitle}>{label}</Text>
        <Text style={styles.personaSupporting}>{description}</Text>
      </View>
      <Icon
        color={selected ? colors.primary : colors.border}
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={26}
      />
    </Pressable>
  );
}

function RenterOnboarding({ onSkip }: { readonly onSkip: () => void }) {
  const [stage, setStage] = useState(0);
  const settle = setStage;
  const renderPage = (page: number) => {
    if (page === 0)
      return (
        <OnboardingWelcome
          body="Find and book vehicles from trusted owners. Complete your verification when you’re ready to rent."
          icon="car-sport-outline"
          onNext={() => settle(1)}
          title="Your next drive starts here."
        />
      );
    if (page === 2)
      return <RenterOnboardingContactPage onBack={() => settle(1)} onNext={() => settle(3)} />;
    const kycStep = ({ 1: 0, 3: 1, 4: 2, 5: 4, 6: 5, 7: 6 } as Record<number, number>)[page];
    return (
      <RenterOnboardingKycPage
        step={kycStep ?? 0}
        onBack={() => settle(page - 1)}
        onNext={() => (page === 7 ? onSkip() : settle(page + 1))}
      />
    );
  };
  return (
    <RenterOnboardingDraftProvider>
      <GuidedOnboarding currentPage={stage} onPageChange={setStage} onSkip={onSkip} pageCount={8}>
        {Array.from({ length: 8 }, (_, page) => renderPage(page))}
      </GuidedOnboarding>
    </RenterOnboardingDraftProvider>
  );
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
  onboardingEyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  onboardingTitle: { color: colors.ink, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  personaContent: { flex: 1, gap: 18, justifyContent: 'center', padding: 24 },
  personaError: { color: colors.danger, fontSize: 14 },
  personaOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    padding: 20,
  },
  personaOptionCopy: { flex: 1, gap: 4 },
  personaOptionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  personaOptionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  personaShell: { backgroundColor: colors.surface, flex: 1 },
  personaSupporting: { color: colors.subtleText, fontSize: 16, lineHeight: 23 },
});
