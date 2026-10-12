import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from './src/auth/AuthProvider';
import { apiClient } from './src/auth/api-client';
import type { OwnerStatus, OwnerWorkspace } from './src/auth/auth.types';
import { AuthFlow } from './src/features/auth/AuthFlow';
import { AppNavigation } from './src/navigation/AppNavigation';
import type { MobileMode } from './src/navigation/routes';
import { colors, spacing } from './src/theme/tokens';
import { PushRegistration } from './src/notifications/PushRegistration';
import { AppLockProvider, useAppLock } from './src/app-lock/AppLockProvider';
import { AppLockScreen } from './src/app-lock/AppLockScreen';
import {
  BackControl,
  Button,
  Card,
  Field,
  Icon,
  StateView,
  StatusBadge,
} from './src/ui/primitives';
import {
  RenterOnboardingContactPage,
  RenterOnboardingKycPage,
} from './src/features/account/RenterOnboardingPages';
import type { RenterVerificationSnapshot } from './src/features/account/AccountScreen';
import { RenterOnboardingDraftProvider } from './src/features/account/RenterVerificationWorkflow';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { activeRoleStorage } from './src/navigation/active-role-storage';
import { ownerWorkspaceStorage } from './src/navigation/owner-workspace-storage';
import { activeOwnerWorkspaces, resolveOwnerWorkspace } from './src/navigation/owner-workspace';
import { OwnerOnboardingScreen } from './src/features/account/AccountScreen';
import { GuidedOnboarding } from './src/onboarding/GuidedOnboarding';
import {
  RENTER_ONBOARDING_STEPS,
  renterOnboardingPageForKycStep,
  renterOnboardingResumePage,
} from './src/onboarding/renter-onboarding-steps';
import {
  ownerFirstEntryIntentStorage,
  ownerOnboardingStorage,
} from './src/onboarding/owner-onboarding-storage';
import { resolvePersonaMode, shouldPresentOwnerFirstEntry } from './src/navigation/persona-mode';
import { isSafeRecoveryDeepLink } from './src/navigation/deep-links';
import { pendingRecoveryDeepLinkStorage } from './src/navigation/pending-deep-link-storage';
import Constants from 'expo-constants';
import type {
  AcceptOwnerStaffInvitationResponse,
  OwnerStaffInvitationPreview,
} from '@carrental/api-contracts';
import { ApiError } from './src/auth/api-client';
import { staffInvitationLink } from './src/features/staff/staff-invitation-link';
import { staffAccessLink } from './src/features/staff/staff-access-link';
import {
  StaffAccessExperience,
  StaffInvitationSetup,
} from './src/features/staff/StaffAccessExperience';
import type { OwnerStaffAccessAuthorization } from '@carrental/api-contracts';

const OnboardingStack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <AuthProvider>
          <StartupSplashGate />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function StartupSplashGate() {
  const auth = useAuth();
  useEffect(() => {
    if (!auth.booting) void SplashScreen.hideAsync().catch(() => undefined);
  }, [auth.booting]);
  if (auth.booting) return null;
  return <SessionApplication />;
}

function SessionApplication() {
  const auth = useAuth();
  const appScheme = Constants.expoConfig?.extra?.appScheme ?? 'carrental';
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [staffAccessHandle, setStaffAccessHandle] = useState<string | null>(null);
  useEffect(() => {
    const retain = (url: string | null) => {
      const link = staffInvitationLink(url, appScheme);
      if (link.matched) {
        setInvitationToken(link.token ?? '');
        setStaffAccessHandle(null);
        return;
      }
      const access = staffAccessLink(url, appScheme);
      if (access.matched) {
        setStaffAccessHandle(access.handle ?? '');
        setInvitationToken(null);
      }
    };
    void Linking.getInitialURL().then(retain);
    const subscription = Linking.addEventListener('url', ({ url }) => retain(url));
    return () => subscription.remove();
  }, [appScheme]);
  return (
    <PrincipalApplication
      key={auth.user?.id ?? 'anonymous'}
      invitationToken={invitationToken}
      staffAccessHandle={staffAccessHandle}
      onInvitationComplete={() => setInvitationToken(null)}
      onStaffAccessComplete={() => setStaffAccessHandle(null)}
    />
  );
}

function PrincipalApplication({
  invitationToken,
  staffAccessHandle,
  onInvitationComplete,
  onStaffAccessComplete,
}: {
  readonly invitationToken: string | null;
  readonly staffAccessHandle: string | null;
  readonly onInvitationComplete: () => void;
  readonly onStaffAccessComplete: () => void;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent
        invitationToken={invitationToken}
        staffAccessHandle={staffAccessHandle}
        onInvitationComplete={onInvitationComplete}
        onStaffAccessComplete={onStaffAccessComplete}
      />
    </QueryClientProvider>
  );
}

function AppContent({
  invitationToken,
  staffAccessHandle,
  onInvitationComplete,
  onStaffAccessComplete,
}: {
  readonly invitationToken: string | null;
  readonly staffAccessHandle: string | null;
  readonly onInvitationComplete: () => void;
  readonly onStaffAccessComplete: () => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userId = auth.user?.id;
  const [mode, setMode] = useState<MobileMode>('renter');
  const [restoredModeKey, setRestoredModeKey] = useState<string | null>(null);
  const [restoredWorkspaceKey, setRestoredWorkspaceKey] = useState<string | null>(null);
  const [activeOwnerProfileId, setActiveOwnerProfileId] = useState<string | null>(null);
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
  const ownerWorkspaces = activeOwnerWorkspaces(auth.user?.ownerWorkspaces ?? []);
  const ownerEnabled = ownerWorkspaces.length > 0;
  const workspaceResolutionKey = userId
    ? `${userId}:${ownerWorkspaces
        .map(
          ({ ownerProfileId, membershipStatus, permissions }) =>
            `${ownerProfileId}:${membershipStatus}:${permissions.join(',')}`,
        )
        .join('|')}`
    : null;
  const activeWorkspace =
    ownerWorkspaces.find(({ ownerProfileId }) => ownerProfileId === activeOwnerProfileId) ?? null;
  const modeResolutionKey = userId
    ? `${userId}:${auth.user?.profile?.initialMarketplacePersona ?? 'NONE'}:${renterCapable}:${ownerEnabled}`
    : null;
  useEffect(() => {
    if (!userId || !workspaceResolutionKey) return;
    let active = true;
    void ownerWorkspaceStorage
      .get(userId)
      .then((saved) => {
        if (!active) return;
        const resolved = resolveOwnerWorkspace(auth.user?.ownerWorkspaces ?? [], saved);
        setActiveOwnerProfileId(resolved?.ownerProfileId ?? null);
        if (resolved) void ownerWorkspaceStorage.set(userId, resolved.ownerProfileId);
        else void ownerWorkspaceStorage.clear(userId);
      })
      .finally(() => {
        if (active) setRestoredWorkspaceKey(workspaceResolutionKey);
      });
    return () => {
      active = false;
    };
  }, [auth.user?.ownerWorkspaces, userId, workspaceResolutionKey]);
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
            ownerEnabled,
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
    ownerEnabled,
    renterCapable,
    userId,
  ]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && auth.user) void auth.refreshIdentity();
    });
    return () => subscription.remove();
  }, [auth]);
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
  const activateStaffWorkspace = (workspace: OwnerStaffAccessAuthorization) => {
    setActiveOwnerProfileId(workspace.ownerProfileId);
    setMode('owner');
    if (auth.user) {
      void ownerWorkspaceStorage.set(auth.user.id, workspace.ownerProfileId);
      void activeRoleStorage.set(auth.user.id, 'owner');
    }
  };
  if (staffAccessHandle !== null)
    return (
      <StaffAccessExperience
        handle={staffAccessHandle}
        onAuthenticated={(workspace) => {
          activateStaffWorkspace(workspace);
          onStaffAccessComplete();
        }}
        onComplete={onStaffAccessComplete}
      />
    );
  if (invitationToken !== null)
    return (
      <StaffInvitationAcceptance
        token={invitationToken}
        onAccepted={(ownerProfileId) => {
          setActiveOwnerProfileId(ownerProfileId);
          setMode('owner');
          if (auth.user) {
            void ownerWorkspaceStorage.set(auth.user.id, ownerProfileId);
            void activeRoleStorage.set(auth.user.id, 'owner');
          }
        }}
        onAuthenticated={(workspace) => {
          activateStaffWorkspace(workspace);
          onInvitationComplete();
        }}
        onComplete={onInvitationComplete}
      />
    );
  if (!auth.user) return <AuthFlow />;
  if (!renterCapable && !ownerEnabled) return <PersonaSelection />;
  if (
    restoredModeKey !== modeResolutionKey ||
    restoredWorkspaceKey !== workspaceResolutionKey ||
    !ownerGuideReady
  )
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
  const ownerCapable = ownerEnabled;
  const changeWorkspace = (ownerProfileId: string) => {
    if (!ownerWorkspaces.some((workspace) => workspace.ownerProfileId === ownerProfileId)) return;
    setActiveOwnerProfileId(ownerProfileId);
    void ownerWorkspaceStorage.set(auth.user!.id, ownerProfileId);
    for (const queryKey of [
      ['owner-workspace'],
      ['owner-home'],
      ['owner-home-upcoming'],
      ['owner-staff'],
      ['conversations'],
      ['conversation'],
      ['messages'],
      ['claim'],
    ])
      void queryClient.invalidateQueries({ queryKey });
  };
  return (
    <AppLockProvider userId={auth.user.id}>
      <ProtectedApplication
        mode={mode}
        onModeChange={changeMode}
        ownerCapable={ownerCapable}
        ownerStatus={activeWorkspace?.ownerProfileStatus ?? owner.data?.status ?? null}
        ownerWorkspace={activeWorkspace}
        ownerWorkspaces={ownerWorkspaces}
        onOwnerWorkspaceChange={changeWorkspace}
      />
    </AppLockProvider>
  );
}

function StaffInvitationAcceptance({
  token,
  onAccepted,
  onAuthenticated,
  onComplete,
}: {
  readonly token: string;
  readonly onAccepted: (ownerProfileId: string) => void;
  readonly onAuthenticated: (workspace: OwnerStaffAccessAuthorization) => void;
  readonly onComplete: () => void;
}) {
  const auth = useAuth();
  const [authScreen, setAuthScreen] = useState<'login' | 'register' | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [result, setResult] = useState<AcceptOwnerStaffInvitationResponse | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const preview = useQuery({
    enabled: Boolean(token),
    queryKey: ['owner-staff-invitation-preview', token],
    queryFn: () =>
      apiClient.request<OwnerStaffInvitationPreview>(
        `/owner/staff-invitations/preview?token=${encodeURIComponent(token)}`,
      ),
    retry: false,
  });
  const acceptInvitation = useMutation({
    mutationFn: () =>
      apiClient.request<AcceptOwnerStaffInvitationResponse>('/owner/staff-invitations/accept', {
        body: JSON.stringify({ token }),
        method: 'POST',
      }),
    onSuccess: async (accepted) => {
      setResult(accepted);
      await auth.refreshIdentity();
      onAccepted(accepted.ownerProfileId);
    },
  });
  const requestMobileVerification = useMutation({
    mutationFn: () =>
      apiClient.request<{ challengeId?: string }>(
        '/owner/staff-invitations/mobile-verification/requests',
        { body: JSON.stringify({ platform: 'UNKNOWN', token }), method: 'POST' },
      ),
    onSuccess: ({ challengeId: nextChallengeId }) => {
      setChallengeId(nextChallengeId ?? '');
      setOtpCode('');
    },
  });
  const verifyMobile = useMutation({
    mutationFn: () =>
      apiClient.request('/auth/otp/verifications', {
        body: JSON.stringify({ challengeId, code: otpCode, platform: 'UNKNOWN' }),
        method: 'POST',
      }),
    onSuccess: async () => {
      await auth.refreshIdentity();
      acceptInvitation.reset();
      setChallengeId('');
      setOtpCode('');
    },
  });
  if (!token)
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationShell}>
        <StateView
          icon="alert-circle-outline"
          title="Invitation link unavailable"
          message="This Staff invitation link is incomplete. Ask the Owner to send it again."
          actionLabel="Back"
          onAction={onComplete}
        />
      </SafeAreaView>
    );
  if (preview.isPending)
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationShell}>
        <StateView
          loading
          title="Loading invitation"
          message="Checking this invitation securely…"
        />
      </SafeAreaView>
    );
  if (preview.isError) {
    const previewCode = preview.error instanceof ApiError ? preview.error.code : null;
    const previewState = invitationErrorState(previewCode);
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationShell}>
        <StateView
          icon={previewState.icon}
          title={previewState.title}
          message={previewState.message}
          actionLabel="Go to app"
          onAction={onComplete}
        />
      </SafeAreaView>
    );
  }
  const invitation = preview.data;
  if (invitation.state !== 'PENDING') {
    const terminal = invitationState(invitation.state);
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationShell}>
        <StateView
          icon={terminal.icon}
          title={terminal.title}
          message={terminal.message}
          actionLabel="Go to app"
          onAction={onComplete}
        />
      </SafeAreaView>
    );
  }
  const invitationCard = <InvitationContext invitation={invitation} />;
  if (!auth.user) {
    if (showSetup)
      return (
        <StaffInvitationSetup
          invitationToken={token}
          onAuthenticated={onAuthenticated}
          onBack={() => setShowSetup(false)}
          roleLabel={invitation.roleLabel}
          workspaceLabel={invitation.workspaceLabel}
        />
      );
    if (authScreen)
      return (
        <AuthFlow
          invitationContext={{
            roleLabel: invitation.roleLabel,
            workspaceLabel: invitation.workspaceLabel,
          }}
          initialScreen={authScreen}
          onBackToContext={() => setAuthScreen(null)}
        />
      );
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationPage}>
        <View style={styles.invitationHeader}>
          <BackControl label="Back" onPress={onComplete} />
          <Text accessibilityRole="header" style={styles.invitationTitle}>
            Staff invitation
          </Text>
          <Text style={styles.invitationHelper}>
            Review the invitation, then sign in or set up your CarShare account to continue.
          </Text>
        </View>
        {invitationCard}
        <View style={styles.invitationActions}>
          <Button label="Log in" onPress={() => setAuthScreen('login')} />
          <Button label="Set up account" variant="secondary" onPress={() => setShowSetup(true)} />
        </View>
      </SafeAreaView>
    );
  }
  if (result)
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.invitationShell}>
        <StateView
          icon="checkmark-circle-outline"
          title="Invitation accepted"
          message={`You now have ${invitation.roleLabel} access to ${invitation.workspaceLabel}.`}
          actionLabel="Continue"
          onAction={onComplete}
        />
      </SafeAreaView>
    );
  const error = acceptInvitation.error;
  const errorCode = error instanceof ApiError ? error.code : null;
  const state = invitationErrorState(errorCode);
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.invitationPage}>
      <View style={styles.invitationHeader}>
        <BackControl label="Back" onPress={onComplete} />
        <Text accessibilityRole="header" style={styles.invitationTitle}>
          Staff invitation
        </Text>
        <Text style={styles.invitationHelper}>
          Confirm that you want to join this Owner workspace.
        </Text>
      </View>
      {invitationCard}
      {errorCode ? (
        <StateView icon={state.icon} title={state.title} message={state.message} compact />
      ) : null}
      {!acceptInvitation.isPending ? (
        <View style={styles.invitationActions}>
          {errorCode === 'MOBILE_VERIFICATION_REQUIRED' ? (
            challengeId ? (
              <View style={styles.invitationVerification}>
                <Field
                  keyboardType="number-pad"
                  label="6-digit mobile verification code"
                  placeholder="123456"
                  value={otpCode}
                  onChangeText={(value) => setOtpCode(value.replaceAll(/\D/g, '').slice(0, 6))}
                />
                <Button
                  disabled={otpCode.length !== 6 || verifyMobile.isPending}
                  label={verifyMobile.isPending ? 'Verifying…' : 'Verify mobile'}
                  onPress={() => verifyMobile.mutate()}
                />
                {verifyMobile.error ? (
                  <Text accessibilityRole="alert" style={styles.invitationError}>
                    We couldn’t verify that code. Check it and try again.
                  </Text>
                ) : null}
              </View>
            ) : (
              <Button
                disabled={requestMobileVerification.isPending}
                label={
                  requestMobileVerification.isPending ? 'Sending code…' : 'Verify mobile number'
                }
                onPress={() => requestMobileVerification.mutate()}
              />
            )
          ) : errorCode === 'INVITATION_DESTINATION_MISMATCH' ? (
            <Button label="Switch account" onPress={() => void auth.logout()} />
          ) : !errorCode ? (
            <Button label="Accept invitation" onPress={() => acceptInvitation.mutate()} />
          ) : null}
          <Button label="Back" variant="ghost" onPress={onComplete} />
        </View>
      ) : null}
      {acceptInvitation.isPending ? (
        <StateView
          loading
          title="Accepting invitation"
          message="Checking your account securely…"
          compact
        />
      ) : null}
    </SafeAreaView>
  );
}

function InvitationContext({ invitation }: { readonly invitation: OwnerStaffInvitationPreview }) {
  return (
    <Card style={styles.invitationCard}>
      <Text style={styles.invitationCardLabel}>YOU’VE BEEN INVITED TO JOIN</Text>
      <Text style={styles.invitationWorkspace}>{invitation.workspaceLabel}</Text>
      <View style={styles.invitationRoleRow}>
        <View style={styles.invitationRoleCopy}>
          <Text style={styles.invitationCardLabel}>ROLE</Text>
          <Text style={styles.invitationRole}>{invitation.roleLabel}</Text>
        </View>
        <StatusBadge
          label={invitation.channel === 'SMS' ? 'SMS invitation' : 'Email invitation'}
          tone="neutral"
        />
      </View>
      <Text style={styles.invitationCardHelper}>
        You’ll have access based on the permissions assigned by the Owner.
      </Text>
    </Card>
  );
}

function invitationState(state: OwnerStaffInvitationPreview['state']) {
  if (state === 'EXPIRED')
    return {
      icon: 'time-outline' as const,
      title: 'Invitation expired',
      message:
        'This invitation is no longer valid. Ask the Owner or Manager to send a new invitation.',
    };
  if (state === 'REVOKED')
    return {
      icon: 'close-circle-outline' as const,
      title: 'Invitation revoked',
      message: 'This invitation is no longer available.',
    };
  return {
    icon: 'checkmark-circle-outline' as const,
    title: 'Invitation already accepted',
    message: 'This invitation has already been used.',
  };
}

function invitationErrorState(code: string | null) {
  if (code === 'MOBILE_VERIFICATION_REQUIRED')
    return {
      icon: 'phone-portrait-outline' as const,
      title: 'Verify your mobile number',
      message:
        'This invitation was sent to your mobile number. Verify that number on your CarShare account before continuing.',
    };
  if (code === 'INVITATION_DESTINATION_MISMATCH')
    return {
      icon: 'person-circle-outline' as const,
      title: 'This invitation belongs to a different account',
      message: 'Sign in with the CarShare account that uses the invited mobile number.',
    };
  if (code === 'OWNER_STAFF_INVITATION_EXPIRED')
    return {
      icon: 'time-outline' as const,
      title: 'Invitation expired',
      message: 'Ask the Owner to send a new invitation.',
    };
  if (code === 'OWNER_STAFF_INVITATION_REVOKED')
    return {
      icon: 'close-circle-outline' as const,
      title: 'Invitation revoked',
      message: 'This invitation is no longer active.',
    };
  if (code === 'OWNER_STAFF_INVITATION_CONSUMED')
    return {
      icon: 'checkmark-circle-outline' as const,
      title: 'Invitation already used',
      message: 'This invitation has already been accepted.',
    };
  if (code)
    return {
      icon: 'alert-circle-outline' as const,
      title: 'Invitation unavailable',
      message: 'This invitation could not be accepted. Ask the Owner to send it again.',
    };
  return {
    icon: 'people-outline' as const,
    title: 'Join Owner workspace',
    message: 'Accept this invitation to help manage this Owner workspace.',
  };
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
  const resumeApplied = useRef(false);
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
  });
  useEffect(() => {
    if (resumeApplied.current || !verification.data) return;
    resumeApplied.current = true;
    setStage(renterOnboardingResumePage(verification.data));
  }, [verification.data]);
  const renderPage = (page: number) => {
    const definition = RENTER_ONBOARDING_STEPS[page];
    if (!definition) return null;
    if (definition.id === 'CONTACT_VERIFICATION')
      return <RenterOnboardingContactPage onBack={() => setStage(0)} onNext={() => setStage(2)} />;
    if (!('kycStep' in definition)) return null;
    return (
      <RenterOnboardingKycPage
        step={definition.kycStep}
        onBack={() => setStage(page - 1)}
        onEdit={(targetStep) =>
          setStage(targetStep === -1 ? 1 : renterOnboardingPageForKycStep(targetStep))
        }
        onNext={() => (definition.id === 'REVIEW' ? onSkip() : setStage(page + 1))}
      />
    );
  };
  return (
    <RenterOnboardingDraftProvider>
      <GuidedOnboarding
        currentPage={stage}
        onPageChange={setStage}
        onSkip={onSkip}
        pageCount={RENTER_ONBOARDING_STEPS.length}
        pageKeys={RENTER_ONBOARDING_STEPS.map(({ id }) => id)}
      >
        {RENTER_ONBOARDING_STEPS.map((_step, page) => renderPage(page))}
      </GuidedOnboarding>
    </RenterOnboardingDraftProvider>
  );
}

function ProtectedApplication({
  mode,
  onModeChange,
  ownerCapable,
  ownerStatus,
  ownerWorkspace,
  ownerWorkspaces,
  onOwnerWorkspaceChange,
}: {
  readonly mode: MobileMode;
  readonly onModeChange: (mode: MobileMode) => void;
  readonly ownerCapable: boolean;
  readonly ownerStatus: OwnerStatus | null;
  readonly ownerWorkspace: OwnerWorkspace | null;
  readonly ownerWorkspaces: readonly OwnerWorkspace[];
  readonly onOwnerWorkspaceChange: (ownerProfileId: string) => void;
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
        ownerWorkspace={ownerWorkspace}
        ownerWorkspaces={ownerWorkspaces}
        onOwnerWorkspaceChange={onOwnerWorkspaceChange}
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
  invitationActions: { gap: spacing.sm, width: '100%' },
  invitationCard: { gap: spacing.sm, width: '100%' },
  invitationCardHelper: { color: colors.subtleText, fontSize: 14, lineHeight: 20 },
  invitationCardLabel: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  invitationHeader: { gap: spacing.xs, width: '100%' },
  invitationError: { color: colors.danger, fontSize: 14 },
  invitationHelper: { color: colors.subtleText, fontSize: 16, lineHeight: 23 },
  invitationPage: {
    backgroundColor: colors.surface,
    flex: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  invitationRole: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  invitationRoleCopy: { flex: 1, gap: spacing.xxs },
  invitationRoleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  invitationShell: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  invitationTitle: { color: colors.ink, fontSize: 34, fontWeight: '900' },
  invitationWorkspace: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  invitationVerification: { gap: spacing.sm, width: '100%' },
});
