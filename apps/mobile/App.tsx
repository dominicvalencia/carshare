import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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

const OnboardingStack = createNativeStackNavigator();

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
  const userId = auth.user?.id;
  const [mode, setMode] = useState<MobileMode>('renter');
  const [modeReady, setModeReady] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void activeRoleStorage
      .get(userId)
      .then((stored) => {
        if (active) setMode(stored);
      })
      .finally(() => {
        if (active) setModeReady(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const changeMode = useCallback(
    (nextMode: MobileMode) => {
      setMode(nextMode);
      if (userId) void activeRoleStorage.set(userId, nextMode);
    },
    [userId],
  );
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
  if (!modeReady)
    return (
      <View style={styles.loading}>
        <Text>Restoring your workspace…</Text>
      </View>
    );
  if (auth.renterOnboardingPending)
    return (
      <NavigationContainer>
        <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
          <OnboardingStack.Screen name="RenterOnboarding">
            {() => <RenterOnboarding onSkip={() => void auth.skipRenterOnboarding()} />}
          </OnboardingStack.Screen>
        </OnboardingStack.Navigator>
      </NavigationContainer>
    );
  const ownerCapable = Boolean(owner.data) || auth.user.roles.includes('OWNER');
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

function RenterOnboarding({ onSkip }: { readonly onSkip: () => void }) {
  const [stage, setStage] = useState(0);
  const { width } = useWindowDimensions();
  const [translateX] = useState(() => new Animated.Value(0));
  useEffect(() => translateX.setValue(-stage * width), [stage, translateX, width]);
  const settle = useCallback(
    (nextStage: number) => {
      const boundedStage = Math.max(0, Math.min(7, nextStage));
      Animated.spring(translateX, {
        damping: 24,
        mass: 0.8,
        stiffness: 240,
        toValue: -boundedStage * width,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setStage(boundedStage);
      });
    },
    [translateX, width],
  );
  const pager = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_event, gesture) => {
          const atFirst = stage === 0 && gesture.dx > 0;
          const atLast = stage === 7 && gesture.dx < 0;
          const resistance = atFirst || atLast ? 0.25 : 1;
          translateX.setValue(-stage * width + gesture.dx * resistance);
        },
        onPanResponderRelease: (_event, gesture) => {
          const advance = gesture.dx < -width * 0.2 || gesture.vx < -0.5;
          const retreat = gesture.dx > width * 0.2 || gesture.vx > 0.5;
          if (advance && stage < 7) settle(stage + 1);
          else if (retreat && stage > 0) settle(stage - 1);
          else settle(stage);
        },
        onPanResponderTerminate: () => settle(stage),
      }),
    [settle, stage, translateX, width],
  );
  const renderPage = (page: number) => {
    if (page === 0)
      return (
        <ScrollView
          contentContainerStyle={styles.onboardingWelcome}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.onboardingHero}>
            <View style={styles.onboardingIcon}>
              <Icon color={colors.primary} name="car-sport-outline" size={52} />
            </View>
            <Text style={styles.onboardingEyebrow}>WELCOME TO CAR RENTAL</Text>
            <Text accessibilityRole="header" style={styles.onboardingTitle}>
              Your next drive starts here.
            </Text>
            <Text style={styles.onboardingBody}>
              Find and book vehicles from trusted owners. Complete your verification when you’re
              ready to rent.
            </Text>
          </View>
          <View style={styles.onboardingActions}>
            <Button label="Next" onPress={() => settle(1)} />
          </View>
        </ScrollView>
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
  const pages = Array.from({ length: 8 }, (_, page) => page);
  return (
    <RenterOnboardingDraftProvider>
      <SafeAreaView
        accessibilityHint="Swipe left for next or right for previous"
        edges={['top', 'bottom']}
        style={styles.onboardingShell}
        {...pager.panHandlers}
      >
        <View style={styles.onboardingProgressHeader}>
          <PageIndicator count={8} current={stage} />
          <Button label="Skip onboarding" onPress={onSkip} variant="ghost" />
        </View>
        <View style={styles.onboardingViewport} {...pager.panHandlers}>
          <Animated.View
            style={[
              styles.onboardingTrack,
              { transform: [{ translateX }], width: width * pages.length },
            ]}
          >
            {pages.map((page) => (
              <View key={page} style={{ width }}>
                {renderPage(page)}
              </View>
            ))}
          </Animated.View>
        </View>
      </SafeAreaView>
    </RenterOnboardingDraftProvider>
  );
}

function PageIndicator({ count, current }: { readonly count: number; readonly current: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Onboarding page ${current + 1} of ${count}`}
      style={styles.pageDots}
    >
      <Text style={styles.pageStatus}>
        {current + 1} / {count}
      </Text>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.pageDot, index === current && styles.pageDotActive]} />
      ))}
    </View>
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
  onboardingActions: { gap: 12 },
  onboardingBody: { color: colors.subtleText, fontSize: 18, lineHeight: 27, textAlign: 'center' },
  onboardingEyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  onboardingHero: { alignItems: 'center', flex: 1, gap: 18, justifyContent: 'center' },
  onboardingIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  onboardingProgressHeader: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 20 },
  onboardingShell: { backgroundColor: colors.surface, flex: 1 },
  onboardingTrack: { flex: 1, flexDirection: 'row' },
  onboardingTitle: { color: colors.ink, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  onboardingViewport: { flex: 1, overflow: 'hidden' },
  onboardingWelcome: { flexGrow: 1, padding: 24 },
  pageDot: { backgroundColor: colors.border, borderRadius: 4, height: 8, width: 8 },
  pageDotActive: { backgroundColor: colors.primary, width: 24 },
  pageDots: { flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center' },
  pageStatus: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
});
