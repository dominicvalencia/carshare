import type {
  BeginOwnerStaffInvitationSetupResponse,
  OwnerStaffAccessAuthorization,
  OwnerStaffAccessLinkResolution,
  RequestStaffPasswordResetResponse,
  VerifyStaffPasswordResetResponse,
} from '@carrental/api-contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import { colors, spacing } from '../../theme/tokens';
import { activeRoleStorage } from '../../navigation/active-role-storage';
import { ownerWorkspaceStorage } from '../../navigation/owner-workspace-storage';
import { Button, Card, Field, StateView } from '../../ui/primitives';
import { AuthScreenShell } from '../auth/AuthFlow';

interface CompletionProperties {
  readonly onAuthenticated: (workspace: OwnerStaffAccessAuthorization) => void;
  readonly onComplete: () => void;
}

export function StaffAccessExperience({
  handle,
  onAuthenticated,
  onComplete,
}: CompletionProperties & { readonly handle: string }) {
  const auth = useAuth();
  const [recovering, setRecovering] = useState(false);
  const resolution = useQuery({
    enabled: Boolean(handle),
    queryKey: ['owner-staff-access-resolution', handle],
    queryFn: () =>
      apiClient.request<OwnerStaffAccessLinkResolution>(
        `/owner/staff-access/${encodeURIComponent(handle)}`,
      ),
    retry: false,
  });
  const authorize = useMutation({
    mutationFn: () =>
      apiClient.request<OwnerStaffAccessAuthorization>(
        `/owner/staff-access/${encodeURIComponent(handle)}/authorize`,
        { method: 'POST' },
      ),
    onSuccess: async (workspace) => {
      await auth.refreshIdentity();
      onAuthenticated(workspace);
    },
  });
  useEffect(() => {
    if (resolution.data?.valid && auth.user && authorize.isIdle) authorize.mutate();
  }, [auth.user, authorize, resolution.data?.valid]);
  if (!handle || resolution.isError || resolution.data?.valid === false)
    return (
      <AccessState
        actionLabel="Go back"
        message="Ask the Owner for the current Staff access link."
        onAction={onComplete}
        title="Staff access link unavailable"
      />
    );
  if (resolution.isPending)
    return <AccessState loading message="Checking this link securely…" title="Staff access" />;
  if (auth.user) {
    if (authorize.isError)
      return (
        <AccessState
          actionLabel="Back to app"
          message="This Staff access link is for active Staff and Managers."
          onAction={onComplete}
          title="Access unavailable"
        />
      );
    return <AccessState loading message="Opening your Owner workspace…" title="Staff access" />;
  }
  if (recovering)
    return (
      <StaffPasswordRecovery
        handle={handle}
        onBack={() => setRecovering(false)}
        onComplete={() => setRecovering(false)}
      />
    );
  return (
    <AuthScreenShell
      helper="Sign in to access this Owner workspace."
      onBack={onComplete}
      title="Staff access"
    >
      <StaffLoginForm
        handle={handle}
        onAuthenticated={onAuthenticated}
        onForgotPassword={() => setRecovering(true)}
      />
    </AuthScreenShell>
  );
}

function StaffLoginForm({
  handle,
  onAuthenticated,
  onForgotPassword,
}: {
  readonly handle: string;
  readonly onAuthenticated: (workspace: OwnerStaffAccessAuthorization) => void;
  readonly onForgotPassword: () => void;
}) {
  const auth = useAuth();
  const [mobileNumber, setMobileNumber] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const login = useMutation({
    mutationFn: () => apiClient.loginStaffAccess(handle, { mobileNumber, password }),
    onSuccess: async (result) => {
      await Promise.all([
        ownerWorkspaceStorage.set(result.user.id, result.authorizedWorkspace.ownerProfileId),
        activeRoleStorage.set(result.user.id, 'owner'),
      ]);
      await auth.acceptAuthentication(result);
      onAuthenticated(result.authorizedWorkspace);
    },
  });
  return (
    <View style={styles.form}>
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="phone-pad"
        label="Mobile number"
        onChangeText={setMobileNumber}
        placeholder="+63 mobile number"
        value={mobileNumber}
      />
      <View>
        <Field
          autoCapitalize="none"
          autoCorrect={false}
          label="Password"
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry={!passwordVisible}
          value={password}
        />
        <PasswordVisibility
          visible={passwordVisible}
          onPress={() => setPasswordVisible((value) => !value)}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onForgotPassword}
        style={styles.forgotPasswordAction}
      >
        <Text style={styles.forgotPasswordText}>Forgot password?</Text>
      </Pressable>
      <Button
        disabled={!mobileNumber.trim() || !password || login.isPending}
        label={login.isPending ? 'Logging in…' : 'Log in'}
        onPress={() => login.mutate()}
      />
      {login.isError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>Unable to access this workspace</Text>
          <Text style={styles.errorText}>
            Check your mobile number and password, or ask the Owner if your Staff access is still
            active.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function StaffPasswordRecovery({
  handle,
  onBack,
  onComplete,
}: {
  readonly handle: string;
  readonly onBack: () => void;
  readonly onComplete: () => void;
}) {
  const [stage, setStage] = useState<'mobile' | 'otp' | 'password' | 'success'>('mobile');
  const [mobileNumber, setMobileNumber] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  const request = useMutation({
    mutationFn: () =>
      apiClient.request<RequestStaffPasswordResetResponse>(
        `/owner/staff-access/${encodeURIComponent(handle)}/password-reset/requests`,
        { body: JSON.stringify({ mobileNumber }), method: 'POST' },
      ),
    onSuccess: (result) => {
      setChallengeId(result.challengeId);
      setCode('');
      setCooldown(60);
      setStage('otp');
    },
  });
  const verify = useMutation({
    mutationFn: () =>
      apiClient.request<VerifyStaffPasswordResetResponse>(
        `/owner/staff-access/${encodeURIComponent(handle)}/password-reset/verify`,
        { body: JSON.stringify({ challengeId, code }), method: 'POST' },
      ),
    onSuccess: ({ resetToken: token }) => {
      setResetToken(token);
      setStage('password');
    },
  });
  const complete = useMutation({
    mutationFn: () =>
      apiClient.request<void>(
        `/owner/staff-access/${encodeURIComponent(handle)}/password-reset/complete`,
        { body: JSON.stringify({ confirmPassword, password, resetToken }), method: 'POST' },
      ),
    onSuccess: () => setStage('success'),
  });
  const mismatch = Boolean(confirmPassword && password !== confirmPassword);
  if (stage === 'success')
    return (
      <SafeAreaView edges={['top', 'bottom']} style={styles.stateShell}>
        <StateView
          actionLabel="Back to Staff login"
          message="Use your mobile number and new password to log in."
          onAction={onComplete}
          title="Password updated"
        />
      </SafeAreaView>
    );
  const title =
    stage === 'mobile'
      ? 'Reset Staff password'
      : stage === 'otp'
        ? 'Verify mobile'
        : 'Create new password';
  const helper =
    stage === 'mobile'
      ? 'Enter the mobile number linked to your active Staff access.'
      : stage === 'otp'
        ? 'Enter the verification code sent to your Staff mobile number.'
        : 'Choose a new password for your Staff account.';
  return (
    <AuthScreenShell
      helper={helper}
      onBack={stage === 'mobile' ? onBack : () => setStage(stage === 'password' ? 'otp' : 'mobile')}
      title={title}
    >
      <View style={styles.form}>
        {stage === 'mobile' ? (
          <>
            <Field
              keyboardType="phone-pad"
              label="Mobile number"
              onChangeText={setMobileNumber}
              placeholder="+63 mobile number"
              value={mobileNumber}
            />
            <Button
              disabled={!mobileNumber.trim() || request.isPending}
              label={request.isPending ? 'Sending code…' : 'Send verification code'}
              onPress={() => request.mutate()}
            />
          </>
        ) : null}
        {stage === 'otp' ? (
          <>
            <Field
              keyboardType="number-pad"
              label="Verification code"
              onChangeText={(value) => setCode(value.replaceAll(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              value={code}
            />
            <Button
              disabled={code.length !== 6 || verify.isPending}
              label={verify.isPending ? 'Verifying…' : 'Verify'}
              onPress={() => verify.mutate()}
            />
            <Button
              disabled={request.isPending || cooldown > 0}
              label={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              onPress={() => request.mutate()}
              variant="ghost"
            />
          </>
        ) : null}
        {stage === 'password' ? (
          <>
            <View>
              <Field
                error={password && password.length < 12 ? 'Use at least 12 characters.' : undefined}
                label="Password"
                onChangeText={setPassword}
                secureTextEntry={!passwordVisible}
                value={password}
              />
              <PasswordVisibility
                visible={passwordVisible}
                onPress={() => setPasswordVisible((value) => !value)}
              />
            </View>
            <View>
              <Field
                error={mismatch ? 'Passwords do not match.' : undefined}
                label="Confirm password"
                onChangeText={setConfirmPassword}
                secureTextEntry={!confirmVisible}
                value={confirmPassword}
              />
              <PasswordVisibility
                visible={confirmVisible}
                onPress={() => setConfirmVisible((value) => !value)}
              />
            </View>
            <Button
              disabled={password.length < 12 || !confirmPassword || mismatch || complete.isPending}
              label={complete.isPending ? 'Updating password…' : 'Update password'}
              onPress={() => complete.mutate()}
            />
          </>
        ) : null}
        {request.isError || verify.isError || complete.isError ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            We couldn’t continue password recovery. Check your details and try again.
          </Text>
        ) : null}
      </View>
    </AuthScreenShell>
  );
}

export function StaffInvitationSetup({
  invitationToken,
  onAuthenticated,
  onBack,
  roleLabel,
  workspaceLabel,
}: {
  readonly invitationToken: string;
  readonly onAuthenticated: (workspace: OwnerStaffAccessAuthorization) => void;
  readonly onBack: () => void;
  readonly roleLabel: string;
  readonly workspaceLabel: string;
}) {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);
  const begin = useMutation({
    mutationFn: () =>
      apiClient.request<BeginOwnerStaffInvitationSetupResponse>('/owner/staff-invitations/setup', {
        body: JSON.stringify({ confirmPassword, password, token: invitationToken }),
        method: 'POST',
      }),
    onSuccess: (result) => {
      setChallengeId(result.challengeId);
      setCode('');
      setCooldown(60);
    },
  });
  const complete = useMutation({
    mutationFn: () =>
      apiClient.completeStaffInvitationSetup({ challengeId, code, token: invitationToken }),
    onSuccess: async (result) => {
      await Promise.all([
        ownerWorkspaceStorage.set(result.user.id, result.authorizedWorkspace.ownerProfileId),
        activeRoleStorage.set(result.user.id, 'owner'),
      ]);
      await auth.acceptAuthentication(result);
      onAuthenticated(result.authorizedWorkspace);
    },
  });
  const mismatch = Boolean(confirmPassword && password !== confirmPassword);
  const short = Boolean(password && password.length < 12);
  return (
    <AuthScreenShell
      helper={
        challengeId
          ? 'We sent a verification code to the mobile number from your invitation.'
          : 'Create a password to activate your Staff account.'
      }
      onBack={onBack}
      title={challengeId ? 'Verify your mobile number' : 'Set up your account'}
    >
      <Card style={styles.contextCard}>
        <Text style={styles.contextEyebrow}>JOINING</Text>
        <Text numberOfLines={2} style={styles.contextTitle}>
          {workspaceLabel}
        </Text>
        <Text style={styles.contextRole}>Role · {roleLabel}</Text>
      </Card>
      {challengeId ? (
        <View style={styles.form}>
          <Field
            keyboardType="number-pad"
            label="Verification code"
            onChangeText={(value) => setCode(value.replaceAll(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            value={code}
          />
          <Button
            disabled={code.length !== 6 || complete.isPending}
            label={complete.isPending ? 'Verifying…' : 'Verify'}
            onPress={() => complete.mutate()}
          />
          <Button
            disabled={begin.isPending || cooldown > 0}
            label={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            variant="ghost"
            onPress={() => begin.mutate()}
          />
          {complete.isError || begin.isError ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              We couldn’t verify that code. Check it and try again.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.form}>
          <View>
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              error={short ? 'Use at least 12 characters.' : undefined}
              label="Password"
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry={!passwordVisible}
              value={password}
            />
            <PasswordVisibility
              visible={passwordVisible}
              onPress={() => setPasswordVisible((value) => !value)}
            />
          </View>
          <Text style={styles.requirement}>Use 12–128 characters and avoid common passwords.</Text>
          <View>
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              error={mismatch ? 'Passwords do not match.' : undefined}
              label="Confirm password"
              onChangeText={setConfirmPassword}
              placeholder="Re-enter your password"
              secureTextEntry={!confirmVisible}
              value={confirmPassword}
            />
            <PasswordVisibility
              visible={confirmVisible}
              onPress={() => setConfirmVisible((value) => !value)}
            />
          </View>
          <Button
            disabled={password.length < 12 || mismatch || !confirmPassword || begin.isPending}
            label={begin.isPending ? 'Sending code…' : 'Continue'}
            onPress={() => begin.mutate()}
          />
          {begin.isError ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              We couldn’t start account setup. If you already have an account, go back and log in.
            </Text>
          ) : null}
        </View>
      )}
    </AuthScreenShell>
  );
}

function PasswordVisibility({
  visible,
  onPress,
}: {
  readonly visible: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={styles.visibility}
    >
      <Text style={styles.visibilityText}>{visible ? 'Hide' : 'Show'}</Text>
    </Pressable>
  );
}

function AccessState({
  actionLabel,
  loading,
  message,
  onAction,
  title,
}: {
  readonly actionLabel?: string;
  readonly loading?: boolean;
  readonly message: string;
  readonly onAction?: () => void;
  readonly title: string;
}) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.stateShell}>
      <StateView
        {...(actionLabel ? { actionLabel } : {})}
        loading={loading}
        message={message}
        {...(onAction ? { onAction } : {})}
        title={title}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  contextCard: { marginTop: spacing.md },
  contextEyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  contextRole: { color: colors.subtleText, fontSize: 15, marginTop: spacing.xs },
  contextTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.xs },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  errorTitle: { color: colors.danger, fontSize: 16, fontWeight: '800', marginTop: spacing.sm },
  form: { gap: spacing.sm, marginTop: spacing.md },
  forgotPasswordAction: { alignSelf: 'flex-end', justifyContent: 'center', minHeight: 44 },
  forgotPasswordText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  requirement: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  stateShell: { backgroundColor: colors.surface, flex: 1, justifyContent: 'center' },
  visibility: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    position: 'absolute',
    right: spacing.xs,
    top: 27,
  },
  visibilityText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});
