import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import Constants from 'expo-constants';
import { Controller, useForm } from 'react-hook-form';
import { useEffect, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import carShareLogo from '../../../assets/carshare-app-icon.png';
import { ApiError, apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import { colors, radius, spacing } from '../../theme/tokens';
import { Card, formKeyboardDismissMode, useKeyboardAwareBottomPadding } from '../../ui/primitives';
import { passwordResetLink } from './password-reset-link';

export function AuthScreenShell({
  children,
  helper,
  onBack,
  title,
}: {
  readonly children: ReactNode;
  readonly helper: string;
  readonly onBack: () => void;
  readonly title: string;
}) {
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: keyboardAwareBottomPadding },
          ]}
          keyboardDismissMode={formKeyboardDismissMode}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.page, styles.authPage]}>
            <View style={styles.authHeader}>
              <Image
                accessibilityLabel="CarShare"
                contentFit="contain"
                source={carShareLogo}
                style={styles.authLogo}
              />
              <Pressable
                accessibilityLabel="Back"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onBack}
                style={styles.backAction}
              >
                <Text style={styles.backActionText}>← Back</Text>
              </Pressable>
              <Text accessibilityRole="header" style={styles.authTitle}>
                {title}
              </Text>
              <Text style={styles.authSubtitle}>{helper}</Text>
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Screen =
  | 'welcome'
  | 'login'
  | 'register'
  | 'forgot'
  | 'check-email'
  | 'reset'
  | 'reset-invalid'
  | 'reset-success'
  | 'email'
  | 'otp';
const credentialsSchema = z.object({
  confirmPassword: z.string(),
  identifier: z.string(),
  password: z.string(),
});
type Credentials = z.infer<typeof credentialsSchema>;
type InvitationAuthContext = {
  readonly roleLabel: string;
  readonly workspaceLabel: string;
};

export function AuthFlow({
  invitationContext,
  initialScreen = 'welcome',
  onBackToContext,
}: {
  readonly invitationContext?: InvitationAuthContext | undefined;
  readonly initialScreen?: Screen;
  readonly onBackToContext?: () => void;
} = {}) {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [resetEmail, setResetEmail] = useState('');
  const [resetToken, setResetToken] = useState('');
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding();
  useEffect(() => {
    const appScheme = Constants.expoConfig?.extra?.appScheme ?? 'carrental';
    const openResetLink = (url: string | null) => {
      const link = passwordResetLink(url, appScheme);
      if (!link.matched) return;
      setResetToken(link.token ?? '');
      setScreen(link.token ? 'reset' : 'reset-invalid');
    };
    void Linking.getInitialURL().then(openResetLink);
    const subscription = Linking.addEventListener('url', ({ url }) => openResetLink(url));
    return () => subscription.remove();
  }, []);
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safeArea}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: keyboardAwareBottomPadding },
          ]}
          keyboardDismissMode={formKeyboardDismissMode}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {screen === 'welcome' ? (
            <Welcome onSelect={setScreen} />
          ) : (
            <CredentialScreen
              key={screen}
              invitationContext={invitationContext}
              mode={screen}
              onBack={() => {
                if (onBackToContext && (screen === 'login' || screen === 'register')) {
                  onBackToContext();
                  return;
                }
                setScreen(screen === 'forgot' || screen === 'reset' ? 'login' : 'welcome');
              }}
              onResetRequested={(email) => {
                setResetEmail(email);
                setScreen('check-email');
              }}
              onSelect={setScreen}
              resetEmail={resetEmail}
              resetToken={resetToken}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Welcome({ onSelect }: { readonly onSelect: (screen: Screen) => void }) {
  return (
    <View style={[styles.page, styles.welcomePage]}>
      <View style={styles.brandBlock}>
        <Image
          accessibilityLabel="CarShare"
          contentFit="contain"
          source={carShareLogo}
          style={styles.logo}
        />
        <Text style={styles.eyebrow}>PHILIPPINES CAR SHARING</Text>
        <Text accessibilityRole="header" style={styles.title}>
          Rent cars nearby. Or earn by hosting yours.
        </Text>
        <Text style={styles.body}>
          Discover a car when you need one, or become an owner when you’re ready to share yours.
        </Text>
      </View>
      <View style={styles.welcomeActions}>
        <Button label="Create account" onPress={() => onSelect('register')} />
        <Button label="Log in" secondary onPress={() => onSelect('login')} />
      </View>
    </View>
  );
}

function CredentialScreen({
  invitationContext,
  mode,
  onBack,
  onResetRequested,
  onSelect,
  resetEmail,
  resetToken,
}: {
  readonly invitationContext?: InvitationAuthContext | undefined;
  readonly mode: Screen;
  readonly onBack: () => void;
  readonly onResetRequested: (email: string) => void;
  readonly onSelect: (screen: Screen) => void;
  readonly resetEmail: string;
  readonly resetToken: string;
}) {
  const auth = useAuth();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const schema = credentialsSchema.superRefine((value, context) => {
    if (value.identifier.trim().length < 3) {
      context.addIssue({
        code: 'custom',
        message:
          mode === 'otp'
            ? 'Enter a Philippine mobile number.'
            : mode === 'reset' || mode === 'email'
              ? 'Enter the verification token.'
              : 'Enter your email or mobile number.',
        path: ['identifier'],
      });
    }
    if (
      (mode === 'register' || mode === 'forgot') &&
      !z.email().safeParse(value.identifier.trim()).success
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid email address.',
        path: ['identifier'],
      });
    }
    if ((mode === 'register' || mode === 'reset') && value.password.length < 12) {
      context.addIssue({
        code: 'custom',
        message: 'Use at least 12 characters.',
        path: ['password'],
      });
    }
    if ((mode === 'register' || mode === 'reset') && value.confirmPassword !== value.password) {
      context.addIssue({
        code: 'custom',
        message: 'Passwords do not match.',
        path: ['confirmPassword'],
      });
    }
  });
  const form = useForm<Credentials>({
    defaultValues: {
      confirmPassword: '',
      identifier: mode === 'reset' ? resetToken : '',
      password: '',
    },
    resolver: zodResolver(schema),
  });
  const mutation = useMutation({
    mutationFn: ({ identifier, password }: Credentials) =>
      mode === 'register' ? auth.register(identifier, password) : auth.login(identifier, password),
  });
  const utility = useMutation({
    mutationFn: async ({ identifier, password }: Credentials) => {
      if (mode === 'forgot')
        return apiClient.request('/auth/password-reset/requests', {
          body: JSON.stringify({ email: identifier }),
          method: 'POST',
        });
      if (mode === 'reset')
        return apiClient.request('/auth/password-reset/confirmations', {
          body: JSON.stringify({ token: identifier, newPassword: password }),
          method: 'POST',
        });
      if (mode === 'email')
        return apiClient.request('/auth/email-verification/confirmations', {
          body: JSON.stringify({ token: identifier }),
          method: 'POST',
        });
      if (mode === 'otp')
        return apiClient.request('/auth/otp/requests', {
          body: JSON.stringify({ mobileNumber: identifier, purpose: 'LOGIN', platform: 'UNKNOWN' }),
          method: 'POST',
        });
    },
    onError: (error) => {
      if (
        mode === 'reset' &&
        error instanceof ApiError &&
        ['PASSWORD_RESET_TOKEN_EXPIRED', 'PASSWORD_RESET_TOKEN_INVALID'].includes(error.code)
      )
        onSelect('reset-invalid');
    },
    onSuccess: () => {
      if (mode === 'forgot') onResetRequested(form.getValues('identifier').trim());
      if (mode === 'reset') onSelect('reset-success');
    },
  });
  const standard = mode === 'login' || mode === 'register';
  const submit = form.handleSubmit((values) => {
    mutation.reset();
    utility.reset();
    if (standard) mutation.mutate(values);
    else utility.mutate(values);
  });
  const defaultTitle = {
    login: 'Welcome back',
    register: 'Create your account',
    forgot: 'Forgot password',
    'check-email': 'Check your email',
    reset: 'Create new password',
    'reset-invalid': 'Reset link expired',
    'reset-success': 'Password updated',
    email: 'Verify email',
    otp: 'Mobile OTP',
    welcome: '',
  }[mode];
  const title = mode === 'register' && invitationContext ? 'Set up your account' : defaultTitle;
  const registration = mode === 'register';
  const login = mode === 'login';
  const brandedCredentialScreen = ['forgot', 'login', 'register', 'reset'].includes(mode);
  if (mode === 'check-email')
    return (
      <AuthStatusScreen
        body={`We sent a password reset link to ${maskEmail(resetEmail)}.`}
        buttonLabel="Back to log in"
        onPress={() => onSelect('login')}
        title="Check your email"
      />
    );
  if (mode === 'reset-invalid')
    return (
      <AuthStatusScreen
        body="This password reset link is invalid or has expired."
        buttonLabel="Request a new link"
        onPress={() => onSelect('forgot')}
        secondaryButtonLabel="Back to log in"
        onSecondaryPress={() => onSelect('login')}
        title="Reset link expired"
      />
    );
  if (mode === 'reset-success')
    return (
      <AuthStatusScreen
        body="Your password has been changed successfully."
        buttonLabel="Log in"
        onPress={() => onSelect('login')}
        title="Password updated"
      />
    );
  return (
    <View style={[styles.page, brandedCredentialScreen && styles.authPage]}>
      {brandedCredentialScreen ? (
        <View style={styles.authHeader}>
          <Image
            accessibilityLabel="CarShare"
            contentFit="contain"
            source={carShareLogo}
            style={styles.authLogo}
          />
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
            style={styles.backAction}
          >
            <Text style={styles.backActionText}>← Back</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.authTitle}>
            {title}
          </Text>
          <Text style={styles.authSubtitle}>
            {registration && invitationContext
              ? 'Create your CarShare account to continue.'
              : registration
                ? 'Start renting cars now. You can become a host anytime.'
                : login
                  ? 'Log in to continue with CarShare.'
                  : mode === 'forgot'
                    ? "Enter the email linked to your account and we'll send you a password reset link."
                    : 'Choose a new password for your CarShare account.'}
          </Text>
        </View>
      ) : (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {invitationContext && standard ? <InvitationContextCard context={invitationContext} /> : null}
      {mode !== 'reset' && (
        <Controller
          control={form.control}
          name="identifier"
          render={({ field: { onBlur, onChange, value } }) => (
            <View style={brandedCredentialScreen && styles.authField}>
              {brandedCredentialScreen && (
                <Text style={styles.fieldLabel}>
                  {registration || mode === 'forgot' ? 'Email' : 'Email or mobile'}
                </Text>
              )}
              <TextInput
                accessibilityLabel={
                  mode === 'otp'
                    ? 'Philippine mobile number'
                    : mode === 'email'
                      ? 'Verification token'
                      : registration || mode === 'forgot'
                        ? 'Email'
                        : 'Email or mobile number'
                }
                autoCapitalize="none"
                autoComplete={registration || mode === 'forgot' ? 'email' : undefined}
                keyboardType={registration || mode === 'forgot' ? 'email-address' : 'default'}
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder={
                  mode === 'otp'
                    ? '+63 mobile number'
                    : mode === 'email'
                      ? 'Verification token'
                      : registration || mode === 'forgot'
                        ? 'you@example.com'
                        : 'Email or mobile'
                }
                placeholderTextColor={colors.placeholder}
                style={[
                  styles.input,
                  brandedCredentialScreen && styles.authInput,
                  Boolean(form.formState.errors.identifier) && styles.inputError,
                ]}
                value={value}
              />
            </View>
          )}
        />
      )}
      {mode !== 'reset' && form.formState.errors.identifier?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.identifier.message}</Text>
      )}
      {(standard || mode === 'reset') && (
        <Controller
          control={form.control}
          name="password"
          render={({ field: { onBlur, onChange, value } }) =>
            brandedCredentialScreen ? (
              <View style={styles.authField}>
                <Text style={styles.fieldLabel}>
                  {mode === 'reset' ? 'New password' : 'Password'}
                </Text>
                <View
                  style={[
                    styles.secureInputShell,
                    Boolean(form.formState.errors.password) && styles.inputError,
                  ]}
                >
                  <TextInput
                    accessibilityLabel={mode === 'reset' ? 'New password' : 'Password'}
                    autoComplete={
                      registration || mode === 'reset' ? 'new-password' : 'current-password'
                    }
                    onBlur={onBlur}
                    onChangeText={onChange}
                    placeholder={mode === 'reset' ? 'New password' : 'Password'}
                    placeholderTextColor={colors.placeholder}
                    secureTextEntry={!passwordVisible}
                    style={styles.secureInput}
                    textContentType={registration || mode === 'reset' ? 'newPassword' : 'password'}
                    value={value}
                  />
                  <Pressable
                    accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setPasswordVisible((visible) => !visible)}
                    style={styles.visibilityAction}
                  >
                    <Text style={styles.visibilityActionText}>
                      {passwordVisible ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </View>
                {login && (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => onSelect('forgot')}
                    style={styles.forgotPasswordAction}
                  >
                    <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <TextInput
                accessibilityLabel={mode === 'reset' ? 'New password' : 'Password'}
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder={mode === 'reset' ? 'New password' : 'Password'}
                placeholderTextColor={colors.placeholder}
                secureTextEntry
                style={styles.input}
                value={value}
              />
            )
          }
        />
      )}
      {mode === 'register' && (
        <Text style={[styles.requirement, registration && styles.authRequirement]}>
          Use 12–128 characters and avoid common passwords.
        </Text>
      )}
      {form.formState.errors.password?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.password.message}</Text>
      )}
      {(mode === 'register' || mode === 'reset') && (
        <Controller
          control={form.control}
          name="confirmPassword"
          render={({ field: { onBlur, onChange, value } }) => (
            <View style={styles.authField}>
              <Text style={styles.fieldLabel}>
                {mode === 'reset' ? 'Confirm new password' : 'Confirm password'}
              </Text>
              <View
                style={[
                  styles.secureInputShell,
                  Boolean(form.formState.errors.confirmPassword) && styles.inputError,
                ]}
              >
                <TextInput
                  accessibilityLabel={
                    mode === 'reset' ? 'Confirm new password' : 'Confirm password'
                  }
                  autoComplete="new-password"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  placeholder={mode === 'reset' ? 'Confirm new password' : 'Re-enter your password'}
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry={!confirmPasswordVisible}
                  style={styles.secureInput}
                  textContentType="newPassword"
                  value={value}
                />
                <Pressable
                  accessibilityLabel={
                    confirmPasswordVisible ? 'Hide confirm password' : 'Show confirm password'
                  }
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => setConfirmPasswordVisible((visible) => !visible)}
                  style={styles.visibilityAction}
                >
                  <Text style={styles.visibilityActionText}>
                    {confirmPasswordVisible ? 'Hide' : 'Show'}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
      {form.formState.errors.confirmPassword?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.confirmPassword.message}</Text>
      )}
      {mode === 'reset' && <Text style={styles.requirement}>Use 12–128 characters.</Text>}
      <Button
        disabled={mutation.isPending || utility.isPending}
        label={
          mutation.isPending || utility.isPending
            ? 'Please wait…'
            : login
              ? 'Log in'
              : mode === 'forgot'
                ? 'Send reset link'
                : mode === 'reset'
                  ? 'Reset password'
                  : 'Continue'
        }
        onPress={() => {
          void submit();
        }}
      />
      {!brandedCredentialScreen && (
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      )}
      {(mutation.error || utility.error) && (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {registration
            ? 'We couldn’t create your account. Check your details and try again.'
            : login
              ? loginErrorMessage(mutation.error)
              : mode === 'forgot'
                ? 'We couldn’t send the reset link. Please try again.'
                : mode === 'reset'
                  ? 'We couldn’t update your password. Please try again.'
                  : (mutation.error ?? utility.error)?.message}
        </Text>
      )}
    </View>
  );
}

function loginErrorMessage(error: Error | null): string {
  if (!(error instanceof ApiError)) return 'We couldn’t log you in. Please try again.';
  if (error.code === 'INVALID_CREDENTIALS')
    return 'The email, mobile number, or password is incorrect.';
  if (error.code === 'NETWORK_ERROR')
    return 'CarShare could not reach the service. Check your connection and try again.';
  if (error.status === 429) return 'Too many login attempts. Wait a moment and try again.';
  if (['ACCOUNT_DEACTIVATED', 'ACCOUNT_SUSPENDED'].includes(error.code)) return error.message;
  return 'We couldn’t log you in. Please try again.';
}

function InvitationContextCard({ context }: { readonly context: InvitationAuthContext }) {
  return (
    <Card style={styles.invitationContextCard}>
      <View
        accessible
        accessibilityLabel={`Joining ${context.workspaceLabel} as ${context.roleLabel}`}
        style={styles.invitationContextContent}
      >
        <Text style={styles.invitationContextEyebrow}>JOINING</Text>
        <Text style={styles.invitationContextWorkspace}>{context.workspaceLabel}</Text>
        <View style={styles.invitationContextRoleRow}>
          <Text style={styles.invitationContextRoleLabel}>Role</Text>
          <Text style={styles.invitationContextRole}>{context.roleLabel}</Text>
        </View>
      </View>
    </Card>
  );
}

function AuthStatusScreen({
  body,
  buttonLabel,
  onSecondaryPress,
  onPress,
  secondaryButtonLabel,
  title,
}: {
  readonly body: string;
  readonly buttonLabel: string;
  readonly onSecondaryPress?: () => void;
  readonly onPress: () => void;
  readonly secondaryButtonLabel?: string;
  readonly title: string;
}) {
  return (
    <View style={[styles.page, styles.authPage]}>
      <View accessibilityLiveRegion="polite" style={styles.authHeader}>
        <Image
          accessibilityLabel="CarShare"
          contentFit="contain"
          source={carShareLogo}
          style={styles.authLogo}
        />
        <Text accessibilityRole="header" style={styles.authTitle}>
          {title}
        </Text>
        <Text style={styles.authSubtitle}>{body}</Text>
      </View>
      <Button label={buttonLabel} onPress={onPress} />
      {secondaryButtonLabel && onSecondaryPress && (
        <Button label={secondaryButtonLabel} onPress={onSecondaryPress} secondary />
      )}
    </View>
  );
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return 'your email address';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authField: { marginTop: spacing.md },
  authHeader: { alignItems: 'flex-start', marginBottom: spacing.sm },
  authInput: { marginTop: 0 },
  authLogo: { borderRadius: radius.md, height: 64, marginBottom: spacing.sm, width: 64 },
  authPage: { justifyContent: 'flex-start', paddingTop: spacing.lg },
  authRequirement: { lineHeight: 18 },
  authSubtitle: { color: colors.subtleText, fontSize: 16, lineHeight: 23 },
  authTitle: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: '800',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  backAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  backActionText: { color: colors.primary, fontSize: 16, fontWeight: '700' },
  body: { color: colors.subtleText, fontSize: 17, lineHeight: 26, marginBottom: spacing.lg },
  brandBlock: { alignItems: 'flex-start' },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.onPrimary, fontWeight: '700' },
  error: { color: '#A12626', marginTop: spacing.md },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginBottom: spacing.xs },
  forgotPasswordAction: { alignSelf: 'flex-end', justifyContent: 'center', minHeight: 44 },
  forgotPasswordText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  inputError: { borderColor: colors.danger },
  invitationContextCard: { marginBottom: spacing.xs },
  invitationContextContent: { gap: spacing.xs },
  invitationContextEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  invitationContextRole: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  invitationContextRoleLabel: { color: colors.subtleText, fontSize: 14 },
  invitationContextRoleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  invitationContextWorkspace: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  link: { color: colors.primary, marginTop: spacing.lg, textAlign: 'center' },
  logo: { borderRadius: radius.lg, height: 112, marginBottom: spacing.xl, width: 112 },
  requirement: { color: colors.subtleText, fontSize: 13, marginTop: spacing.xs },
  page: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  secondary: { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 },
  secondaryText: { color: colors.primary },
  secureInput: { color: colors.ink, flex: 1, minHeight: 52, paddingHorizontal: spacing.md },
  secureInputShell: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
  },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  scrollContent: { flexGrow: 1 },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '800',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  visibilityAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 60,
    paddingHorizontal: spacing.sm,
  },
  visibilityActionText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  welcomeActions: { gap: spacing.xs },
  welcomePage: { justifyContent: 'space-between', minHeight: 620, paddingVertical: spacing.xxl },
});
