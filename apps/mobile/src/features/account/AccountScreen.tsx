import { useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import type { OwnerStatus } from '../../auth/auth.types';
import type { MobileMode, RootStackParamList } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { dateTimeLabel, titleCase } from '../../ui/format';
import {
  Button,
  Card,
  Chip,
  Field,
  Icon,
  NestedScreen,
  Screen,
  SectionHeader,
  StateView,
  StatusBadge,
  type IconName,
} from '../../ui/primitives';
import { RenterVerificationWorkflow } from './RenterVerificationWorkflow';
import { AppLockSettings } from '../../app-lock/AppLockSettings';

interface Session {
  readonly id: string;
  readonly deviceName: string | null;
  readonly platform: string;
  readonly lastUsedAt: string;
  readonly revokedAt: string | null;
}
interface OwnerProfile {
  readonly id: string;
  readonly status: OwnerStatus;
  readonly legalName?: string;
  readonly contactNumber?: string;
  readonly addressLine1?: string;
  readonly barangay?: string;
  readonly city?: string;
  readonly province?: string;
  readonly postalCode?: string;
  readonly rejectionReason?: string;
}
interface Me {
  readonly email: string | null;
  readonly mobileNumber: string | null;
  readonly createdAt: string;
  readonly emailVerifiedAt: string | null;
  readonly mobileVerifiedAt: string | null;
  readonly verifications: readonly {
    type: string;
    status: string;
    rejectionReason: string | null;
    submittedAt: string | null;
    updatedAt: string;
    expiresAt: string | null;
  }[];
  readonly profile: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
}
export interface RenterVerificationSnapshot {
  readonly email: string | null;
  readonly emailVerifiedAt: string | null;
  readonly mobileNumber: string | null;
  readonly mobileVerifiedAt: string | null;
  readonly eligibility: {
    readonly eligible: boolean;
    readonly status: string;
    readonly requirements: readonly { readonly field?: string; readonly issue: string }[];
  };
  readonly definitions: readonly {
    readonly acceptedMimeTypes: readonly string[];
    readonly code: string;
    readonly name: string;
    readonly required: boolean;
  }[];
  readonly profile: {
    readonly addressLine1: string | null;
    readonly addressScopeCode: string | null;
    readonly barangay: string | null;
    readonly barangayCode: string | null;
    readonly cityMunicipality: string | null;
    readonly cityMunicipalityCode: string | null;
    readonly dateOfBirth: string | null;
    readonly driverLicenseClass: string | null;
    readonly driverLicenseExpiry: string | null;
    readonly driverLicenseLastFour: string | null;
    readonly driverLicenseRestrictions: string | null;
    readonly emergencyContactMobile: string | null;
    readonly emergencyContactName: string | null;
    readonly emergencyContactRelation: string | null;
    readonly emergencyContactRelationOther: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly middleName: string | null;
    readonly postalCode: string | null;
    readonly province: string | null;
    readonly provinceCode: string | null;
    readonly region: string | null;
    readonly regionCode: string | null;
    readonly renterVerificationDraftStep: number;
  } | null;
  readonly verifications: readonly {
    readonly documents: readonly {
      readonly definition: { readonly code: string; readonly name: string } | null;
      readonly fileAsset: { readonly id: string; readonly originalName: string };
      readonly replacedAt: string | null;
    }[];
    readonly rejectionReason: string | null;
    readonly status: string;
    readonly type: string;
  }[];
}
type Navigator = NavigationProp<RootStackParamList>;

export function AccountScreen({
  onModeChange,
  ownerCapable,
}: {
  readonly onModeChange: (mode: MobileMode) => void;
  readonly ownerCapable: boolean;
}) {
  const auth = useAuth();
  const navigation = useNavigation<Navigator>();
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiClient.request<Me>('/me') });
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<OwnerProfile>('/owners/me'),
    retry: false,
  });
  const notificationSummary = useQuery({
    queryKey: ['notification-summary'],
    queryFn: () => apiClient.request<{ unreadCount: number }>('/notifications/summary'),
  });
  const name =
    me.data?.profile?.displayName ??
    me.data?.profile?.firstName ??
    auth.user?.email?.split('@')[0] ??
    'Driver';
  return (
    <Screen
      eyebrow="Your account"
      title={name}
      subtitle={auth.user?.email ?? auth.user?.mobileNumber ?? undefined}
      action={
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
      }
    >
      <Card style={styles.modeCard}>
        <View style={styles.modeIcon}>
          <Icon color={colors.primary} name="car-sport" size={26} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>
            {ownerCapable ? 'Switch to owner mode' : 'List your car'}
          </Text>
          <Text style={styles.body}>
            {ownerCapable
              ? 'Manage your fleet, requests, rentals and earnings.'
              : 'Start verification and build your first listing.'}
          </Text>
        </View>
        {ownerCapable ? (
          <Pressable
            accessibilityLabel="Switch to owner mode"
            onPress={() => onModeChange('owner')}
          >
            <Icon color={colors.primary} name="arrow-forward-circle" size={32} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="Start owner onboarding"
            onPress={() => navigation.navigate('OwnerOnboarding')}
          >
            <Icon color={colors.primary} name="arrow-forward-circle" size={32} />
          </Pressable>
        )}
      </Card>
      {owner.data && (
        <StatusBadge
          label={`Owner: ${ownerStatusLabel(owner.data.status)}`}
          tone={owner.data.status === 'VERIFIED' ? 'success' : 'warning'}
        />
      )}
      <MenuSection title="Account">
        <MenuRow
          icon="person-outline"
          label="Personal information"
          onPress={() => navigation.navigate('PersonalInformation')}
        />
        <MenuRow
          icon="shield-checkmark-outline"
          label="Verification"
          detail={auth.user?.emailVerified ? 'Email verified' : 'Email verification needed'}
          onPress={() => navigation.navigate('Verification')}
        />
        <MenuRow
          icon="lock-closed-outline"
          label="Login & security"
          onPress={() => navigation.navigate('LoginSecurity')}
        />
        <MenuRow
          icon="phone-portrait-outline"
          label="Active devices"
          onPress={() => navigation.navigate('ActiveDevices')}
        />
      </MenuSection>
      <MenuSection title="Renting">
        <MenuRow
          icon="heart-outline"
          label="Favorites"
          onPress={() => navigation.navigate('Favorites')}
        />
        <MenuRow
          icon="star-outline"
          label="Reviews"
          onPress={() => navigation.navigate('Reviews')}
        />
        <MenuRow
          icon="notifications-outline"
          label="Notifications"
          detail={notificationDetail(notificationSummary.data?.unreadCount)}
          onPress={() => navigation.navigate('Notifications')}
        />
      </MenuSection>
      <MenuSection title="Hosting">
        <MenuRow
          icon="id-card-outline"
          label={ownerCapable ? 'Owner profile' : 'Become an owner'}
          detail={owner.data ? ownerStatusLabel(owner.data.status) : undefined}
          onPress={() => navigation.navigate('OwnerOnboarding')}
        />
      </MenuSection>
      <MenuSection title="Support & settings">
        <MenuRow
          icon="help-circle-outline"
          label="Help & support"
          onPress={() => navigation.navigate('Support')}
        />
        <MenuRow
          icon="settings-outline"
          label="Settings"
          onPress={() => navigation.navigate('Settings')}
        />
      </MenuSection>
      <Button label="Log out" onPress={() => void auth.logout()} variant="secondary" />
    </Screen>
  );
}

export function PersonalInformationScreen() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiClient.request<Me>('/me') });
  if (me.isPending)
    return (
      <NestedScreen title="Personal information">
        <StateView loading title="Loading your profile…" />
      </NestedScreen>
    );
  if (me.isError || !me.data)
    return (
      <NestedScreen title="Personal information">
        <StateView
          icon="cloud-offline-outline"
          title="Profile unavailable"
          message={me.error?.message}
          actionLabel="Retry"
          onAction={() => void me.refetch()}
        />
      </NestedScreen>
    );
  return <PersonalInformationForm me={me.data} />;
}

function PersonalInformationForm({ me }: { readonly me: Me }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    firstName: me.profile?.firstName ?? '',
    lastName: me.profile?.lastName ?? '',
    displayName: me.profile?.displayName ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      apiClient.request('/me/profile', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <NestedScreen
      eyebrow="Account"
      title="Personal information"
      subtitle="Keep your marketplace profile up to date."
    >
      <Field
        label="Display name"
        value={form.displayName}
        onChangeText={(displayName) => setForm({ ...form, displayName })}
      />
      <Field
        label="First name"
        value={form.firstName}
        onChangeText={(firstName) => setForm({ ...form, firstName })}
      />
      <Field
        label="Last name"
        value={form.lastName}
        onChangeText={(lastName) => setForm({ ...form, lastName })}
      />
      <Card>
        <Text style={styles.cardTitle}>Contact details</Text>
        <Text style={styles.body}>
          {me.email ?? 'No email'} · {me.mobileNumber ?? 'No mobile number'}
        </Text>
        <Text style={styles.note}>Verified contact changes use the account security flow.</Text>
      </Card>
      <Button
        disabled={save.isPending}
        label={save.isPending ? 'Saving…' : 'Save changes'}
        onPress={() => save.mutate()}
      />
      {save.isError && <Text style={styles.error}>{save.error.message}</Text>}
    </NestedScreen>
  );
}

export function ActiveDevicesScreen() {
  const client = useQueryClient();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiClient.request<Session[]>('/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiClient.request(`/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <NestedScreen
      eyebrow="Security"
      title="Active devices"
      subtitle="Review devices signed in to your account."
    >
      {sessions.isPending && <StateView loading title="Loading devices…" />}
      {sessions.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Devices unavailable"
          message={sessions.error.message}
          actionLabel="Retry"
          onAction={() => void sessions.refetch()}
        />
      )}
      {sessions.data?.map((session) => (
        <Card key={session.id}>
          <View style={styles.row}>
            <Icon name={session.platform === 'IOS' ? 'logo-apple' : 'phone-portrait-outline'} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>
                {session.deviceName ?? titleCase(session.platform)}
              </Text>
              <Text style={styles.body}>Last used {dateTimeLabel(session.lastUsedAt)}</Text>
            </View>
          </View>
          {!session.revokedAt && (
            <Button
              label="Sign out this device"
              onPress={() => revoke.mutate(session.id)}
              variant="ghost"
            />
          )}
        </Card>
      ))}
    </NestedScreen>
  );
}

export function OwnerOnboardingScreen() {
  const auth = useAuth();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [document, setDocument] = useState<{ id: string; name: string } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [form, setForm] = useState({
    legalName: '',
    contactNumber: '+63',
    addressLine1: '',
    barangay: '',
    city: '',
    province: '',
    postalCode: '',
  });
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<OwnerProfile>('/owners/me'),
    retry: false,
  });
  const start = useMutation({
    mutationFn: () => apiClient.request<OwnerProfile>('/owners/onboarding', { method: 'POST' }),
    onSuccess: async (data) => {
      client.setQueryData(['owner'], data);
      await auth.refreshIdentity();
    },
  });
  const save = useMutation({
    mutationFn: () =>
      apiClient.request('/owners/me', { method: 'PATCH', body: JSON.stringify(form) }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['owner'] }),
  });
  const submit = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      return apiClient.request('/owners/me/submission', {
        method: 'POST',
        body: JSON.stringify({ verificationFileIds: document ? [document.id] : [] }),
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['owner'] }),
  });
  async function chooseDocument() {
    setUploadError('');
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['application/pdf', 'image/*'],
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    try {
      const uploaded = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      });
      setDocument({ id: uploaded.id, name: asset.name });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Document upload failed.');
    }
  }
  if (owner.isPending)
    return (
      <NestedScreen title="Owner onboarding">
        <StateView loading title="Checking your owner profile…" />
      </NestedScreen>
    );
  if (!owner.data)
    return (
      <NestedScreen
        eyebrow="Host on Car Rental"
        title="Share your car with confidence"
        subtitle="Create an owner profile now. Vehicle publication and booking operations unlock after verification."
      >
        <Card>
          <Text style={styles.cardTitle}>What you’ll need</Text>
          <Text style={styles.body}>
            Your contact details, Philippine address, and one valid identity document.
          </Text>
        </Card>
        <Button
          disabled={start.isPending}
          label={start.isPending ? 'Starting…' : 'Start owner onboarding'}
          onPress={() => start.mutate()}
        />
      </NestedScreen>
    );
  if (!['DRAFT', 'REJECTED'].includes(owner.data.status))
    return (
      <NestedScreen
        eyebrow="Owner verification"
        title={ownerStatusLabel(owner.data.status)}
        subtitle="We’ll notify you when your verification status changes."
      >
        <StateView
          icon={owner.data.status === 'VERIFIED' ? 'checkmark-circle-outline' : 'time-outline'}
          title={
            owner.data.status === 'VERIFIED' ? 'You’re verified' : 'Your details are under review'
          }
          message={
            owner.data.status === 'VERIFIED'
              ? 'Owner operational features are available in Owner Mode.'
              : 'Your documents are preserved securely and are not visible to renters.'
          }
        />
      </NestedScreen>
    );
  const steps = ['Personal', 'Address', 'Document', 'Review'];
  return (
    <NestedScreen
      eyebrow={`Step ${step + 1} of ${steps.length}`}
      title={steps[step]}
      subtitle="Your verification details are private and reviewed only by authorized staff."
    >
      <View style={styles.chips}>
        {steps.map((label, index) => (
          <Chip key={label} label={`${index + 1}`} selected={index === step} />
        ))}
      </View>
      {owner.data.rejectionReason && (
        <Card style={styles.warningCard}>
          <Text style={styles.cardTitle}>Changes requested</Text>
          <Text style={styles.body}>{owner.data.rejectionReason}</Text>
        </Card>
      )}
      {step === 0 && (
        <>
          <Field
            label="Legal name"
            value={form.legalName}
            onChangeText={(legalName) => setForm({ ...form, legalName })}
          />
          <Field
            label="Mobile number"
            value={form.contactNumber}
            onChangeText={(contactNumber) => setForm({ ...form, contactNumber })}
            keyboardType="phone-pad"
          />
        </>
      )}
      {step === 1 && (
        <>
          <Field
            label="Address"
            value={form.addressLine1}
            onChangeText={(addressLine1) => setForm({ ...form, addressLine1 })}
          />
          <Field
            label="Barangay"
            value={form.barangay}
            onChangeText={(barangay) => setForm({ ...form, barangay })}
          />
          <Field
            label="City / Municipality"
            value={form.city}
            onChangeText={(city) => setForm({ ...form, city })}
          />
          <Field
            label="Province"
            value={form.province}
            onChangeText={(province) => setForm({ ...form, province })}
          />
          <Field
            label="Postal code"
            value={form.postalCode}
            onChangeText={(postalCode) => setForm({ ...form, postalCode })}
            keyboardType="number-pad"
          />
        </>
      )}
      {step === 2 && (
        <Card>
          <Icon color={colors.primary} name="document-attach-outline" size={30} />
          <Text style={styles.cardTitle}>Identity document</Text>
          <Text style={styles.body}>
            Choose a clear image or PDF. The file is uploaded as sensitive evidence.
          </Text>
          <Button
            label={document ? 'Replace document' : 'Choose document'}
            onPress={() => void chooseDocument()}
            variant="secondary"
          />
          {document && <Text style={styles.success}>✓ {document.name}</Text>}
          {uploadError && <Text style={styles.error}>{uploadError}</Text>}
        </Card>
      )}
      {step === 3 && (
        <Card>
          <Text style={styles.cardTitle}>Review your information</Text>
          <Text style={styles.body}>
            {form.legalName}
            {'\n'}
            {form.contactNumber}
            {'\n'}
            {form.addressLine1}, {form.barangay}
            {'\n'}
            {form.city}, {form.province} {form.postalCode}
          </Text>
          <Text style={styles.body}>Document: {document?.name ?? 'Not selected'}</Text>
          <Text style={styles.note}>
            Submitting confirms these details are accurate. You can create vehicle drafts after
            onboarding begins, but publication requires approval.
          </Text>
        </Card>
      )}
      <View style={styles.actions}>
        {step > 0 && <Button label="Back" onPress={() => setStep(step - 1)} variant="secondary" />}
        {step < 3 ? (
          <Button label="Continue" onPress={() => setStep(step + 1)} />
        ) : (
          <Button
            disabled={!document || submit.isPending}
            label={submit.isPending ? 'Submitting…' : 'Submit for verification'}
            onPress={() => submit.mutate()}
          />
        )}
      </View>
      {(save.isError || submit.isError) && (
        <Text style={styles.error}>{(save.error ?? submit.error)?.message}</Text>
      )}
    </NestedScreen>
  );
}

export function VerificationScreen() {
  const auth = useAuth();
  const client = useQueryClient();
  const [mobileNumber, setMobileNumber] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [emailToken, setEmailToken] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
  });
  const requestEmail = useMutation({
    mutationFn: () =>
      apiClient.request<{ message: string }>('/auth/email-verification/requests', {
        method: 'POST',
      }),
    onSuccess: () => {
      setContactMessage('Verification sent. It expires according to the account security policy.');
      void developmentInbox.refetch();
    },
  });
  const requestMobile = useMutation({
    mutationFn: () =>
      apiClient.request<{ challengeId?: string; mobileNumber: string }>(
        '/auth/mobile-verification/requests',
        {
          body: JSON.stringify({
            mobileNumber: mobileNumber || verification.data?.mobileNumber,
            platform: 'UNKNOWN',
          }),
          method: 'POST',
        },
      ),
    onSuccess: (result) => {
      setChallengeId(result.challengeId ?? '');
      setMobileNumber(result.mobileNumber);
      setOtpCode('');
      setContactMessage(
        result.challengeId ? 'Verification code sent.' : 'This mobile number is already verified.',
      );
      void developmentInbox.refetch();
      void refreshVerification(client, auth.refreshIdentity);
    },
  });
  const verifyMobile = useMutation({
    mutationFn: () =>
      apiClient.request('/auth/otp/verifications', {
        body: JSON.stringify({ challengeId, code: otpCode, platform: 'UNKNOWN' }),
        method: 'POST',
      }),
    onSuccess: () => {
      setChallengeId('');
      setOtpCode('');
      setContactMessage('Mobile number verified successfully.');
      void refreshVerification(client, auth.refreshIdentity);
    },
  });
  const verifyEmail = useMutation({
    mutationFn: () =>
      apiClient.request('/auth/email-verification/confirmations', {
        body: JSON.stringify({ token: emailToken.trim() }),
        method: 'POST',
      }),
    onSuccess: () => {
      setEmailToken('');
      setContactMessage('Email address verified successfully.');
      void refreshVerification(client, auth.refreshIdentity);
    },
  });
  const developmentInbox = useQuery({
    enabled: false,
    queryKey: ['development-auth-deliveries'],
    queryFn: () =>
      apiClient.request<{
        items: readonly {
          id: string;
          channel: 'EMAIL' | 'SMS';
          template: string;
          secret: string;
          createdAt: string;
        }[];
      }>('/development/auth-deliveries'),
    retry: false,
  });
  const latestEmail = developmentInbox.data?.items.find(
    ({ channel, template }) => channel === 'EMAIL' && template === 'EMAIL_VERIFICATION',
  );
  const latestOtp = developmentInbox.data?.items.find(
    ({ channel, template }) => channel === 'SMS' && template === 'MOBILE_VERIFICATION_OTP',
  );
  return (
    <NestedScreen
      eyebrow="Account"
      title="Verification"
      subtitle="Contact and identity checks are separate from your personal profile."
    >
      {verification.isPending && <StateView loading title="Checking verification…" />}
      {verification.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Verification unavailable"
          message={verification.error.message}
          actionLabel="Retry"
          onAction={() => void verification.refetch()}
        />
      )}
      {verification.data && (
        <>
          <Card style={styles.contactCard}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>Contact information</Text>
                <Text style={styles.body}>
                  Verified email and mobile are required before booking.
                </Text>
              </View>
              <Icon color={colors.primary} name="call-outline" />
            </View>
            <VerificationCard
              label="Email"
              value={verification.data.email ?? 'No email address'}
              verified={Boolean(verification.data.emailVerifiedAt)}
            >
              {!verification.data.emailVerifiedAt && verification.data.email && (
                <>
                  <Button
                    disabled={requestEmail.isPending}
                    label={requestEmail.isPending ? 'Sending…' : 'Verify email'}
                    onPress={() => requestEmail.mutate()}
                    variant="secondary"
                  />
                  <Field
                    label="Email verification token"
                    placeholder="Paste the token from the verification email"
                    returnKeyType="done"
                    value={emailToken}
                    onChangeText={setEmailToken}
                  />
                  <Button
                    disabled={!emailToken.trim() || verifyEmail.isPending}
                    label={verifyEmail.isPending ? 'Verifying…' : 'Confirm email'}
                    onPress={() => verifyEmail.mutate()}
                  />
                </>
              )}
            </VerificationCard>
            <VerificationCard
              label="Mobile number"
              value={verification.data.mobileNumber ?? 'Not added'}
              verified={Boolean(verification.data.mobileVerifiedAt)}
            >
              <Field
                keyboardType="phone-pad"
                label={verification.data.mobileNumber ? 'Mobile number' : 'Add mobile number'}
                placeholder="09XXXXXXXXX"
                returnKeyType="done"
                value={mobileNumber || verification.data.mobileNumber || ''}
                onChangeText={setMobileNumber}
              />
              <Button
                disabled={
                  requestMobile.isPending || !(mobileNumber || verification.data.mobileNumber)
                }
                label={
                  requestMobile.isPending
                    ? 'Sending…'
                    : verification.data.mobileVerifiedAt
                      ? 'Change and reverify'
                      : 'Send verification code'
                }
                onPress={() => {
                  requestMobile.mutate();
                }}
                variant="secondary"
              />
              {challengeId && (
                <>
                  <Field
                    keyboardType="number-pad"
                    label="6-digit mobile verification code"
                    placeholder="123456"
                    returnKeyType="done"
                    value={otpCode}
                    onChangeText={(value) => setOtpCode(value.replaceAll(/\D/g, '').slice(0, 6))}
                  />
                  <Button
                    disabled={otpCode.length !== 6 || verifyMobile.isPending}
                    label={verifyMobile.isPending ? 'Verifying…' : 'Verify mobile'}
                    onPress={() => verifyMobile.mutate()}
                  />
                </>
              )}
            </VerificationCard>
            {__DEV__ && (
              <Button
                label={
                  developmentInbox.isFetching
                    ? 'Checking local inbox…'
                    : 'Open local verification inbox'
                }
                onPress={() => void developmentInbox.refetch()}
                variant="ghost"
              />
            )}
            {__DEV__ && developmentInbox.isSuccess && (
              <Card style={styles.localInbox}>
                <Text style={styles.cardTitle}>Local/test delivery</Text>
                <Text style={styles.note}>
                  This viewer is API-restricted to local/test and only shows this account’s
                  deliveries.
                </Text>
                {latestEmail && (
                  <Button
                    label="Use latest email token"
                    onPress={() => setEmailToken(latestEmail.secret)}
                    variant="secondary"
                  />
                )}
                {latestOtp && (
                  <Button
                    label={`Use latest mobile code (${latestOtp.secret})`}
                    onPress={() => setOtpCode(latestOtp.secret)}
                    variant="secondary"
                  />
                )}
                {!latestEmail && !latestOtp && (
                  <Text style={styles.body}>No local verification deliveries yet.</Text>
                )}
              </Card>
            )}
            {__DEV__ && developmentInbox.isError && (
              <Text style={styles.note}>
                Local delivery viewer is unavailable outside local/test environments.
              </Text>
            )}
            {contactMessage && <Text style={styles.success}>{contactMessage}</Text>}
            {(requestEmail.error ||
              requestMobile.error ||
              verifyMobile.error ||
              verifyEmail.error) && (
              <Text accessibilityRole="alert" style={styles.error}>
                {
                  (
                    requestEmail.error ??
                    requestMobile.error ??
                    verifyMobile.error ??
                    verifyEmail.error
                  )?.message
                }
              </Text>
            )}
          </Card>
          <RenterVerificationWorkflow snapshot={verification.data} />
        </>
      )}
    </NestedScreen>
  );
}

async function refreshVerification(
  client: ReturnType<typeof useQueryClient>,
  refreshIdentity: () => Promise<void>,
) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['renter-verification'] }),
    client.invalidateQueries({ queryKey: ['me'] }),
    client.invalidateQueries({ queryKey: ['bookings'] }),
    refreshIdentity(),
  ]);
}

export function LegacyRenterVerificationWorkflow({
  snapshot,
}: {
  readonly snapshot: RenterVerificationSnapshot;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    addressLine1: snapshot.profile?.addressLine1 ?? '',
    barangay: snapshot.profile?.barangay ?? '',
    cityMunicipality: snapshot.profile?.cityMunicipality ?? '',
    dateOfBirth: snapshot.profile?.dateOfBirth?.slice(0, 10) ?? '',
    driverLicenseClass: snapshot.profile?.driverLicenseClass ?? '',
    driverLicenseExpiry: snapshot.profile?.driverLicenseExpiry?.slice(0, 10) ?? '',
    driverLicenseNumber: snapshot.profile?.driverLicenseLastFour
      ? `••••${snapshot.profile.driverLicenseLastFour}`
      : '',
    driverLicenseRestrictions: snapshot.profile?.driverLicenseRestrictions ?? '',
    emergencyContactMobile: snapshot.profile?.emergencyContactMobile ?? '',
    emergencyContactName: snapshot.profile?.emergencyContactName ?? '',
    emergencyContactRelation: snapshot.profile?.emergencyContactRelation ?? '',
    legalFirstName: snapshot.profile?.firstName ?? '',
    legalLastName: snapshot.profile?.lastName ?? '',
    middleName: snapshot.profile?.middleName ?? '',
    postalCode: snapshot.profile?.postalCode ?? '',
    province: snapshot.profile?.province ?? '',
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['renter-verification'] });
    void client.invalidateQueries({ queryKey: ['me'] });
  };
  const save = useMutation({
    mutationFn: () =>
      apiClient.request('/renter-verification/profile', {
        body: JSON.stringify(form),
        method: 'POST',
      }),
    onSuccess: () => {
      refresh();
      setStep(1);
    },
  });
  const upload = useMutation({
    mutationFn: async (definition: RenterVerificationSnapshot['definitions'][number]) => {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        type: [...definition.acceptedMimeTypes],
      });
      if (result.canceled) return null;
      const selected = result.assets[0];
      if (!selected) return null;
      const file = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        mimeType: selected.mimeType ?? 'application/octet-stream',
        name: selected.name,
        uri: selected.uri,
      });
      return apiClient.request('/renter-verification/documents', {
        body: JSON.stringify({ definitionCode: definition.code, fileAssetId: file.id }),
        method: 'POST',
      });
    },
    onSuccess: refresh,
  });
  const submit = useMutation({
    mutationFn: () => apiClient.request('/renter-verification/submission', { method: 'POST' }),
    onSuccess: refresh,
  });
  const documents = new Map(
    snapshot.verifications.flatMap(({ documents: items }) =>
      items.filter(({ replacedAt }) => !replacedAt).map((item) => [item.definition?.code, item]),
    ),
  );
  const pending = ['SUBMITTED', 'UNDER_REVIEW'].includes(snapshot.eligibility.status);
  const locked = snapshot.eligibility.status === 'APPROVED';
  return (
    <>
      <Card style={snapshot.eligibility.eligible ? undefined : styles.warningCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Rental eligibility</Text>
          <StatusBadge
            label={renterVerificationLabel(snapshot.eligibility.status)}
            tone={snapshot.eligibility.eligible ? 'success' : 'warning'}
          />
        </View>
        <Text style={styles.body}>
          {snapshot.eligibility.eligible
            ? 'You can reserve vehicles and authorize rental payments.'
            : pending
              ? 'Your evidence is with the platform verification team.'
              : 'Search and quotes remain available. Complete these checks before reserving.'}
        </Text>
        {snapshot.eligibility.requirements.map(({ issue }) => (
          <Text key={issue} style={styles.note}>
            • {verificationRequirementLabel(issue)}
          </Text>
        ))}
      </Card>
      {!locked && !pending && (
        <View style={styles.actions}>
          {['Personal details', 'Documents', 'Review'].map((label, index) => (
            <Chip
              key={label}
              label={`${index + 1}. ${label}`}
              selected={step === index}
              onPress={() => setStep(index)}
            />
          ))}
        </View>
      )}
      {!locked && !pending && step === 0 && (
        <Card>
          <Text style={styles.cardTitle}>Legal identity and address</Text>
          <Field
            label="Legal first name"
            value={form.legalFirstName}
            onChangeText={(value) => setForm({ ...form, legalFirstName: value })}
          />
          <Field
            label="Middle name (optional)"
            value={form.middleName}
            onChangeText={(value) => setForm({ ...form, middleName: value })}
          />
          <Field
            label="Legal last name"
            value={form.legalLastName}
            onChangeText={(value) => setForm({ ...form, legalLastName: value })}
          />
          <Field
            label="Date of birth (YYYY-MM-DD)"
            value={form.dateOfBirth}
            onChangeText={(value) => setForm({ ...form, dateOfBirth: value })}
          />
          <Field
            label="Address line"
            value={form.addressLine1}
            onChangeText={(value) => setForm({ ...form, addressLine1: value })}
          />
          <Field
            label="Barangay (optional)"
            value={form.barangay}
            onChangeText={(value) => setForm({ ...form, barangay: value })}
          />
          <Field
            label="City / municipality"
            value={form.cityMunicipality}
            onChangeText={(value) => setForm({ ...form, cityMunicipality: value })}
          />
          <Field
            label="Province"
            value={form.province}
            onChangeText={(value) => setForm({ ...form, province: value })}
          />
          <Field
            keyboardType="number-pad"
            label="Postal code"
            value={form.postalCode}
            onChangeText={(value) => setForm({ ...form, postalCode: value })}
          />
          <SectionHeader title="Driver information" />
          <Field
            label="Driver’s license number"
            value={form.driverLicenseNumber}
            onChangeText={(value) => setForm({ ...form, driverLicenseNumber: value })}
          />
          <Field
            label="License expiry (YYYY-MM-DD)"
            value={form.driverLicenseExpiry}
            onChangeText={(value) => setForm({ ...form, driverLicenseExpiry: value })}
          />
          <Field
            label="Classification"
            value={form.driverLicenseClass}
            onChangeText={(value) => setForm({ ...form, driverLicenseClass: value })}
          />
          <Field
            label="Restrictions (optional)"
            value={form.driverLicenseRestrictions}
            onChangeText={(value) => setForm({ ...form, driverLicenseRestrictions: value })}
          />
          <SectionHeader title="Emergency contact (optional)" />
          <Field
            label="Name"
            value={form.emergencyContactName}
            onChangeText={(value) => setForm({ ...form, emergencyContactName: value })}
          />
          <Field
            keyboardType="phone-pad"
            label="Philippine mobile (+639…)"
            value={form.emergencyContactMobile}
            onChangeText={(value) => setForm({ ...form, emergencyContactMobile: value })}
          />
          <Field
            label="Relationship"
            value={form.emergencyContactRelation}
            onChangeText={(value) => setForm({ ...form, emergencyContactRelation: value })}
          />
          <Button
            disabled={save.isPending}
            label={save.isPending ? 'Saving…' : 'Save and continue'}
            onPress={() => save.mutate()}
          />
        </Card>
      )}
      {!locked && !pending && step === 1 && (
        <Card>
          <Text style={styles.cardTitle}>Required private documents</Text>
          <Text style={styles.note}>
            Files remain private. Vehicle owners never receive these documents.
          </Text>
          {snapshot.definitions.map((definition) => {
            const document = documents.get(definition.code);
            return (
              <View key={definition.code} style={styles.documentRow}>
                <View style={styles.flex}>
                  <Text style={styles.body}>
                    {definition.name}
                    {definition.required ? ' *' : ''}
                  </Text>
                  <Text style={styles.note}>
                    {document?.fileAsset.originalName ?? 'Not uploaded'}
                  </Text>
                </View>
                <Button
                  disabled={upload.isPending}
                  label={document ? 'Replace' : 'Upload'}
                  onPress={() => upload.mutate(definition)}
                  variant="secondary"
                />
              </View>
            );
          })}
          <Button label="Continue to review" onPress={() => setStep(2)} />
        </Card>
      )}
      {!locked && !pending && step === 2 && (
        <Card>
          <Text style={styles.cardTitle}>Submit to platform verification</Text>
          <Text style={styles.body}>
            Authorized staff will review your identity, driver eligibility, address evidence and
            selfie. A real external KYC provider is not enabled.
          </Text>
          <Button
            disabled={submit.isPending}
            label={
              submit.isPending
                ? 'Submitting…'
                : snapshot.eligibility.status === 'MORE_INFORMATION_REQUIRED'
                  ? 'Resubmit verification'
                  : 'Submit verification'
            }
            onPress={() => submit.mutate()}
          />
        </Card>
      )}
      {snapshot.verifications.map((item) =>
        item.rejectionReason ? (
          <Text key={item.type} style={styles.error}>
            {titleCase(item.type)}: {item.rejectionReason}
          </Text>
        ) : null,
      )}
      {(save.isError || upload.isError || submit.isError) && (
        <Text style={styles.error}>{(save.error ?? upload.error ?? submit.error)?.message}</Text>
      )}
    </>
  );
}

function renterVerificationLabel(status: string) {
  return (
    {
      APPROVED: 'Verified renter',
      MORE_INFORMATION_REQUIRED: 'More information required',
      REJECTED: 'Verification rejected',
      SUBMITTED: 'Verification pending',
      SUSPENDED: 'Verification suspended',
      UNDER_REVIEW: 'Under review',
    }[status] ?? 'Verification incomplete'
  );
}

function verificationRequirementLabel(issue: string) {
  return (
    {
      ACTIVE_ACCOUNT_REQUIRED: 'Active account required',
      APPROVED_IDENTITY_REQUIRED: 'Identity approval required',
      APPROVED_VALID_DRIVER_LICENSE_REQUIRED: 'Valid driver’s license approval required',
      VERIFIED_EMAIL_REQUIRED: 'Verified email required',
      VERIFIED_PHILIPPINE_MOBILE_REQUIRED: 'Verified Philippine mobile required',
    }[issue] ?? titleCase(issue)
  );
}

function VerificationCard({
  children,
  label,
  value,
  verified,
}: {
  readonly children?: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly verified: boolean;
}) {
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text style={styles.body}>{value}</Text>
        </View>
        <StatusBadge
          label={verified ? 'Verified' : 'Not verified'}
          tone={verified ? 'success' : 'warning'}
        />
      </View>
      {children}
    </Card>
  );
}

export function LoginSecurityScreen() {
  const navigation = useNavigation<Navigator>();
  const auth = useAuth();
  return (
    <NestedScreen
      eyebrow="Account security"
      title="Login & security"
      subtitle="Review how your account is protected."
    >
      <MenuSection title="Access">
        <MenuRow
          icon="phone-portrait-outline"
          label="Active devices"
          detail="Review and revoke signed-in sessions"
          onPress={() => navigation.navigate('ActiveDevices')}
        />
        <MenuRow
          disabled
          icon="key-outline"
          label="Change password"
          detail="Use Forgot password from sign in during the pilot"
        />
      </MenuSection>
      <AppLockSettings />
      <Card>
        <Text style={styles.cardTitle}>Security reminder</Text>
        <Text style={styles.body}>
          Never share verification codes or passwords. Car Rental support will never ask for them.
        </Text>
      </Card>
      <Button label="Log out" onPress={() => void auth.logout()} variant="danger" />
    </NestedScreen>
  );
}

export function SettingsScreen() {
  const auth = useAuth();
  const [pushEnabled, setPushEnabled] = useState(true);
  return (
    <NestedScreen eyebrow="Account" title="Settings">
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Push notifications</Text>
            <Text style={styles.body}>Booking, rental, payment and support updates.</Text>
          </View>
          <Switch
            onValueChange={setPushEnabled}
            trackColor={{ true: colors.primarySoft }}
            thumbColor={pushEnabled ? colors.primary : undefined}
            value={pushEnabled}
          />
        </View>
      </Card>
      <MenuSection title="Legal">
        <MenuRow disabled icon="eye-outline" label="Privacy" detail="Not yet available in pilot" />
        <MenuRow
          icon="document-text-outline"
          label="Terms of service"
          detail="Not yet available in pilot"
          disabled
        />
      </MenuSection>
      <Button label="Log out" onPress={() => void auth.logout()} variant="danger" />
    </NestedScreen>
  );
}

export function OwnerMoreScreen({
  onModeChange,
  ownerStatus,
}: {
  readonly onModeChange: (mode: MobileMode) => void;
  readonly ownerStatus: OwnerStatus | null;
}) {
  const navigation = useNavigation<Navigator>();
  return (
    <Screen
      eyebrow="Owner mode"
      title="Manage your business"
      subtitle="Fleet operations, earnings, payouts and owner settings."
    >
      <Card style={styles.modeCard}>
        <Icon color={colors.primary} name="person-circle-outline" size={32} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Switch to renter mode</Text>
          <Text style={styles.body}>Search and book cars with the same account.</Text>
        </View>
        <Pressable
          accessibilityLabel="Switch to renter mode"
          onPress={() => onModeChange('renter')}
        >
          <Icon color={colors.primary} name="swap-horizontal" size={28} />
        </Pressable>
      </Card>
      <StatusBadge
        label={ownerStatusLabel(ownerStatus ?? 'DRAFT')}
        tone={ownerStatus === 'VERIFIED' ? 'success' : 'warning'}
      />
      <MenuSection title="Operations">
        <MenuRow
          icon="key-outline"
          label="Active rentals"
          onPress={() => navigation.navigate('OwnerRentals')}
        />
        <MenuRow
          icon="wallet-outline"
          label="Earnings & payouts"
          detail={ownerStatus === 'VERIFIED' ? undefined : 'Available after verification'}
          onPress={() =>
            navigation.navigate(ownerStatus === 'VERIFIED' ? 'OwnerEarnings' : 'OwnerOnboarding')
          }
        />
        <MenuRow
          icon="id-card-outline"
          label="Owner profile"
          onPress={() => navigation.navigate('OwnerOnboarding')}
        />
      </MenuSection>
      <MenuSection title="Help & settings">
        <MenuRow
          icon="notifications-outline"
          label="Notifications"
          onPress={() => navigation.navigate('Notifications')}
        />
        <MenuRow
          icon="help-circle-outline"
          label="Help & support"
          onPress={() => navigation.navigate('Support')}
        />
        <MenuRow
          icon="settings-outline"
          label="Owner settings"
          onPress={() => navigation.navigate('Settings')}
        />
      </MenuSection>
    </Screen>
  );
}

function MenuSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      <Card style={styles.menu}>{children}</Card>
    </View>
  );
}
function MenuRow({
  icon,
  label,
  detail,
  onPress,
  disabled = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly onPress?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
}) {
  const content = (
    <>
      <View style={styles.menuIcon}>
        <Icon color={colors.primary} name={icon} size={21} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, disabled && styles.menuDisabled]}>{label}</Text>
        {detail && (
          <Text numberOfLines={1} style={styles.menuDetail}>
            {detail}
          </Text>
        )}
      </View>
      {onPress && <Icon color={colors.subtleText} name="chevron-forward" size={19} />}
    </>
  );
  return onPress && !disabled ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.menuRow}>
      {content}
    </Pressable>
  ) : (
    <View accessibilityState={{ disabled: true }} style={styles.menuRow}>
      {content}
    </View>
  );
}
function notificationDetail(count: number | undefined): string {
  if (count === undefined) return 'Checking for updates…';
  return count
    ? `${count} unread notification${count === 1 ? '' : 's'}`
    : 'No unread notifications';
}
function ownerStatusLabel(status: OwnerStatus): string {
  return {
    DRAFT: 'Draft',
    PENDING_VERIFICATION: 'Under review',
    VERIFIED: 'Verified',
    REJECTED: 'Changes requested',
    SUSPENDED: 'Suspended',
  }[status];
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  avatarText: { color: colors.onPrimary, fontSize: 22, fontWeight: '800' },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: 3 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: spacing.xs },
  contactCard: { gap: spacing.md },
  error: { color: colors.danger },
  flex: { flex: 1 },
  menu: { padding: 0 },
  localInbox: { backgroundColor: colors.primarySoft, gap: spacing.sm },
  menuDetail: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  menuDisabled: { color: colors.subtleText },
  menuIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  menuLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  menuRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modeCard: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  modeIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  note: { color: colors.subtleText, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  documentRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  section: { gap: spacing.xs, marginTop: spacing.sm },
  success: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  warningCard: { backgroundColor: colors.warningSoft },
});
