import { useEffect, useRef, useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
import { invalidateRenterVerification } from '../../query/verification-invalidation';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { GuidedOnboarding, OnboardingWelcome } from '../../onboarding/GuidedOnboarding';
import { ownerOnboardingStorage } from '../../onboarding/owner-onboarding-storage';

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
function ownerResumePage(profile: OwnerProfile): number {
  if (
    profile.addressLine1 ||
    profile.barangay ||
    profile.city ||
    profile.province ||
    profile.postalCode
  )
    return 3;
  if (profile.legalName || profile.contactNumber) return 2;
  return 0;
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
    readonly displayName: string | null;
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

function LogoutButton({ variant = 'danger' }: { readonly variant?: 'danger' | 'secondary' }) {
  const auth = useAuth();
  const logout = useMutation({ mutationFn: () => auth.logout() });
  const confirm = () => {
    Alert.alert('Log out of CarShare?', 'You will need to sign in again on this device.', [
      { style: 'cancel', text: 'Cancel' },
      { onPress: () => logout.mutate(), style: 'destructive', text: 'Log out' },
    ]);
  };
  return (
    <>
      <Button
        disabled={logout.isPending}
        label={logout.isPending ? 'Logging out…' : 'Log out'}
        onPress={confirm}
        variant={variant}
      />
      {logout.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          We could not finish logging out. Please try again.
        </Text>
      )}
    </>
  );
}

export function AccountScreen({
  onModeChange,
  ownerCapable,
}: {
  readonly onModeChange: (mode: MobileMode) => void;
  readonly ownerCapable: boolean;
  readonly ownerStatus: OwnerStatus | null;
}) {
  const auth = useAuth();
  const appEnvironment = Constants.expoConfig?.extra?.appEnvironment as string | undefined;
  const navigation = useNavigation<Navigator>();
  const ownerEnrollment = useMutation({
    mutationFn: () => auth.enrollPersona('OWNER'),
    onSuccess: () => onModeChange('owner'),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: () => apiClient.request<Me>('/me') });
  const owner = useQuery({
    queryKey: ['owner'],
    queryFn: () => apiClient.request<OwnerProfile>('/owners/me'),
    retry: false,
  });
  const notificationSummary = useQuery({
    queryKey: ['notification-summary', 'renter'],
    queryFn: () =>
      apiClient.request<{ unreadCount: number }>('/notifications/summary?audience=RENTER'),
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
            accessibilityLabel="Become a Vehicle Owner"
            disabled={ownerEnrollment.isPending}
            onPress={() => ownerEnrollment.mutate()}
          >
            <Icon color={colors.primary} name="arrow-forward-circle" size={32} />
          </Pressable>
        )}
      </Card>
      {ownerEnrollment.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          We could not enable Vehicle Owner access. Check your connection and try again.
        </Text>
      )}
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
      <MenuSection title="Support & settings">
        {appEnvironment === 'staging' && (
          <MenuRow icon="flask-outline" label="Environment" detail="Staging" />
        )}
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
      <LogoutButton />
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

export function OwnerOnboardingScreen({
  onSkip,
  onComplete,
  presentation = 'guided',
}: {
  readonly onSkip?: () => void;
  readonly onComplete?: () => void;
  readonly presentation?: 'guided' | 'profile';
} = {}) {
  const auth = useAuth();
  const navigation = useNavigation<Navigator>();
  const client = useQueryClient();
  const [step, setStep] = useState(0);
  const [document, setDocument] = useState<{
    id: string;
    name: string;
    mimeType: string;
    uri: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [formError, setFormError] = useState('');
  const hydratedOwnerId = useRef<string | null>(null);
  const recordedGuidedEntry = useRef(false);
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
  useEffect(() => {
    if (presentation !== 'guided' || recordedGuidedEntry.current) return;
    recordedGuidedEntry.current = true;
    void auth.recordOwnerOnboardingEntry().catch(() => {
      recordedGuidedEntry.current = false;
    });
  }, [auth, presentation]);
  useEffect(() => {
    if (!owner.data || hydratedOwnerId.current === owner.data.id) return;
    hydratedOwnerId.current = owner.data.id;
    setForm({
      legalName: owner.data.legalName ?? '',
      contactNumber: owner.data.contactNumber ?? '+63',
      addressLine1: owner.data.addressLine1 ?? '',
      barangay: owner.data.barangay ?? '',
      city: owner.data.city ?? '',
      province: owner.data.province ?? '',
      postalCode: owner.data.postalCode ?? '',
    });
    const resumePage = ownerResumePage(owner.data);
    setStep(presentation === 'guided' ? resumePage : Math.max(0, resumePage - 1));
  }, [owner.data, presentation]);
  const start = useMutation({
    mutationFn: () => apiClient.request<OwnerProfile>('/owners/onboarding', { method: 'POST' }),
    onSuccess: async (data) => {
      client.setQueryData(['owner'], data);
      await auth.refreshIdentity();
    },
  });
  const save = useMutation({
    mutationFn: (body: Partial<typeof form>) =>
      apiClient.request<OwnerProfile>('/owners/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => client.setQueryData(['owner'], data),
  });
  const partialDraft = (page: number): Partial<typeof form> => {
    if (page === 1)
      return {
        ...(form.legalName.trim() ? { legalName: form.legalName.trim() } : {}),
        ...(/^\+639\d{9}$/.test(form.contactNumber.trim())
          ? { contactNumber: form.contactNumber.trim() }
          : {}),
      };
    if (page === 2)
      return Object.fromEntries(
        Object.entries({
          addressLine1: form.addressLine1.trim(),
          barangay: form.barangay.trim(),
          city: form.city.trim(),
          province: form.province.trim(),
          postalCode: form.postalCode.trim(),
        }).filter(([, value]) => value),
      );
    return {};
  };
  const navigateTo = (nextPage: number) => {
    if (nextPage > step) {
      const draft = partialDraft(step);
      if (Object.keys(draft).length) void save.mutateAsync(draft).catch(() => undefined);
    }
    setFormError('');
    setStep(Math.max(0, Math.min(4, nextPage)));
  };
  const submit = useMutation({
    mutationFn: async () => {
      await save.mutateAsync(form);
      return apiClient.request('/owners/me/submission', {
        method: 'POST',
        body: JSON.stringify({ verificationFileIds: document ? [document.id] : [] }),
      });
    },
    onSuccess: async () => {
      if (auth.user) await ownerOnboardingStorage.dismiss(auth.user.id);
      onComplete?.();
      await client.invalidateQueries({ queryKey: ['owner'] });
    },
  });
  const submitVerification = () => {
    const missing = [
      ['Legal name', form.legalName],
      ['Address', form.addressLine1],
      ['City / Municipality', form.city],
      ['Province', form.province],
      ['Postal code', form.postalCode],
    ].filter(([, value]) => !value?.trim());
    if (missing.length) {
      setFormError(`Complete the required fields: ${missing.map(([label]) => label).join(', ')}.`);
      return;
    }
    if (!/^\+639\d{9}$/.test(form.contactNumber.trim())) {
      setFormError('Enter a valid Philippine mobile number in +639XXXXXXXXX format.');
      return;
    }
    if (!document) {
      setFormError('Choose a valid owner identity document before submitting.');
      return;
    }
    setFormError('');
    submit.mutate();
  };
  const continueVerification = async () => {
    setFormError('');
    if (step === 0) {
      if (!form.legalName.trim())
        return setFormError('Enter the legal name used for verification.');
      if (!/^\+639\d{9}$/.test(form.contactNumber.trim()))
        return setFormError('Enter a valid Philippine mobile number in +639XXXXXXXXX format.');
    }
    if (
      step === 1 &&
      (!form.addressLine1.trim() ||
        !form.city.trim() ||
        !form.province.trim() ||
        !form.postalCode.trim())
    )
      return setFormError('Complete the required address, city, province, and postal code.');
    if (step === 2 && !document)
      return setFormError('Choose a valid owner identity document before continuing.');
    try {
      if (step < 2) await save.mutateAsync(form);
      setStep((current) => Math.min(current + 1, 3));
    } catch {
      // The shared mutation error remains visible on the current verification step.
    }
  };
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
      setDocument({
        id: uploaded.id,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        uri: asset.uri,
      });
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
        eyebrow="Host on CarShare"
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
            owner.data.status === 'VERIFIED'
              ? 'You’re verified'
              : owner.data.status === 'SUSPENDED'
                ? 'Your Owner account is restricted'
                : 'Your details are under review'
          }
          message={
            owner.data.status === 'VERIFIED'
              ? 'Owner operational features are available in Owner Mode.'
              : owner.data.status === 'SUSPENDED'
                ? 'Contact CarShare support for help with this account restriction.'
                : 'Your documents are preserved securely and are not visible to renters.'
          }
        />
      </NestedScreen>
    );
  const steps = ['Personal', 'Address', 'Document', 'Review'];
  const skip = async () => {
    if (!auth.user) return;
    try {
      await ownerOnboardingStorage.dismiss(auth.user.id);
      if (onSkip) onSkip();
      else if (navigation.canGoBack()) navigation.goBack();
    } catch {
      setFormError('We could not save your setup preference. Please try again.');
    }
  };
  const renderPage = (page: number) => {
    if (page === 0)
      return (
        <OnboardingWelcome
          body="Set up your Vehicle Owner profile so you can prepare your vehicle for listing on CarShare."
          icon="key-outline"
          onNext={() => navigateTo(1)}
          title="List your car and start earning."
        />
      );
    const dataStep = page - 1;
    return (
      <Screen
        safeTop={false}
        title={steps[dataStep]}
        subtitle="Your verification details are private and reviewed only by authorized staff."
      >
        {owner.data.rejectionReason && (
          <Card style={styles.warningCard}>
            <Text style={styles.cardTitle}>Changes requested</Text>
            <Text style={styles.body}>{owner.data.rejectionReason}</Text>
          </Card>
        )}
        {page === 1 && (
          <OwnerOnboardingSection
            helper="Use the legal name and contact number that authorized staff should verify. You can finish missing details later."
            icon="person-outline"
            title="Owner identity"
          >
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
          </OwnerOnboardingSection>
        )}
        {page === 2 && (
          <OwnerOnboardingSection
            helper="Enter any address details you have ready. Missing information remains required before verification submission."
            icon="location-outline"
            title="Residential address"
          >
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
          </OwnerOnboardingSection>
        )}
        {page === 3 && (
          <OwnerOnboardingSection
            helper="Attach one current government-issued identity document when you are ready."
            icon="document-attach-outline"
            title="Owner identity document"
          >
            <Text style={styles.body}>
              The current pilot accepts one clear image or PDF selected from your device.
              Camera-only capture is not required. The backend does not maintain a narrower
              approved-document catalogue, so CarShare does not claim unsupported ID alternatives.
            </Text>
            <Text style={styles.note}>
              Show the complete document, keep all text readable, and avoid glare or cropped edges.
              It is uploaded as sensitive evidence and visible only to authorized reviewers.
            </Text>
            {document?.mimeType.startsWith('image/') && (
              <Image
                accessibilityLabel="Owner identity document preview"
                source={{ uri: document.uri }}
                style={styles.ownerDocumentPreview}
              />
            )}
            <Button
              label={document ? 'Replace document' : 'Choose document'}
              onPress={() => void chooseDocument()}
              variant="secondary"
            />
            {document && <Text style={styles.success}>✓ {document.name}</Text>}
            {uploadError && <Text style={styles.error}>{uploadError}</Text>}
          </OwnerOnboardingSection>
        )}
        {page === 4 && (
          <OwnerOnboardingSection
            helper="Confirm the saved information before sending it for authorized review."
            icon="checkmark-circle-outline"
            title="Review your owner profile"
          >
            <OwnerReviewRow label="Legal name" value={form.legalName} />
            <OwnerReviewRow label="Mobile number" value={form.contactNumber} />
            <OwnerReviewRow
              label="Address"
              value={`${form.addressLine1}, ${form.barangay ? `${form.barangay}, ` : ''}${form.city}, ${form.province} ${form.postalCode}`}
            />
            <OwnerReviewRow
              label="Owner identity document"
              value={document?.name ?? 'Not selected'}
            />
            <Text style={styles.note}>
              Submission remains unavailable until the required profile details and identity
              document are complete. Protected Owner operations remain locked until approval.
            </Text>
          </OwnerOnboardingSection>
        )}
        {formError && <Text style={styles.error}>{formError}</Text>}
        <View style={styles.actions}>
          <Button label="Back" onPress={() => navigateTo(page - 1)} variant="secondary" />
          {page < 4 ? (
            <Button label="Next" onPress={() => navigateTo(page + 1)} />
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
      </Screen>
    );
  };
  if (presentation === 'profile')
    return (
      <NestedScreen
        eyebrow="Owner verification"
        title="Owner profile"
        subtitle="Complete the required information below and submit it for authorized review."
      >
        <StatusBadge
          label={ownerStatusLabel(owner.data.status)}
          tone={owner.data.status === 'VERIFIED' ? 'success' : 'warning'}
        />
        <Card style={styles.ownerProgressCard}>
          <View style={styles.rowBetween}>
            <Text accessibilityRole="header" style={styles.progressText}>
              Step {step + 1} of 4
            </Text>
            <Text style={styles.cardTitle}>{steps[step]}</Text>
          </View>
          <View style={styles.ownerProgressDots}>
            {steps.map((label, index) => (
              <View
                accessibilityLabel={`${label}${index === step ? ', current step' : ''}`}
                key={label}
                style={[styles.ownerProgressDot, index <= step && styles.ownerProgressDotActive]}
              />
            ))}
          </View>
        </Card>
        {owner.data.rejectionReason && (
          <Card style={styles.warningCard}>
            <Text style={styles.cardTitle}>Changes requested</Text>
            <Text style={styles.body}>{owner.data.rejectionReason}</Text>
          </Card>
        )}
        {step === 0 && (
          <OwnerOnboardingSection
            helper="Required for Owner verification. Use the identity information authorized staff should verify."
            icon="person-outline"
            title="Owner identity"
          >
            <Field
              label="Legal name (required)"
              value={form.legalName}
              onChangeText={(legalName) => setForm({ ...form, legalName })}
            />
            <Field
              label="Mobile number (required)"
              value={form.contactNumber}
              onChangeText={(contactNumber) => setForm({ ...form, contactNumber })}
              keyboardType="phone-pad"
            />
          </OwnerOnboardingSection>
        )}
        {step === 1 && (
          <OwnerOnboardingSection
            helper="All location fields marked required must be complete before submission."
            icon="location-outline"
            title="Residential address"
          >
            <Field
              label="Address (required)"
              value={form.addressLine1}
              onChangeText={(addressLine1) => setForm({ ...form, addressLine1 })}
            />
            <Field
              label="Barangay"
              value={form.barangay}
              onChangeText={(barangay) => setForm({ ...form, barangay })}
            />
            <Field
              label="City / Municipality (required)"
              value={form.city}
              onChangeText={(city) => setForm({ ...form, city })}
            />
            <Field
              label="Province (required)"
              value={form.province}
              onChangeText={(province) => setForm({ ...form, province })}
            />
            <Field
              label="Postal code (required)"
              value={form.postalCode}
              onChangeText={(postalCode) => setForm({ ...form, postalCode })}
              keyboardType="number-pad"
            />
          </OwnerOnboardingSection>
        )}
        {step === 2 && (
          <OwnerOnboardingSection
            helper="One current government-issued identity document is required for submission."
            icon="document-attach-outline"
            title="Owner identity document"
          >
            {document?.mimeType.startsWith('image/') && (
              <Image
                accessibilityLabel="Owner identity document preview"
                source={{ uri: document.uri }}
                style={styles.ownerDocumentPreview}
              />
            )}
            <Button
              label={document ? 'Replace required document' : 'Choose required document'}
              onPress={() => void chooseDocument()}
              variant="secondary"
            />
            {document && <Text style={styles.success}>✓ {document.name}</Text>}
            {uploadError && (
              <Text accessibilityRole="alert" style={styles.error}>
                {uploadError}
              </Text>
            )}
          </OwnerOnboardingSection>
        )}
        {step === 3 && (
          <OwnerOnboardingSection
            helper="Confirm the saved information before sending it for authorized review."
            icon="checkmark-circle-outline"
            title="Review your owner profile"
          >
            <OwnerReviewRow label="Legal name" value={form.legalName} />
            <OwnerReviewRow label="Mobile number" value={form.contactNumber} />
            <OwnerReviewRow
              label="Address"
              value={`${form.addressLine1}, ${form.barangay ? `${form.barangay}, ` : ''}${form.city}, ${form.province} ${form.postalCode}`}
            />
            <OwnerReviewRow
              label="Owner identity document"
              value={document?.name ?? 'Not selected'}
            />
          </OwnerOnboardingSection>
        )}
        {formError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {formError}
          </Text>
        )}
        {(save.isError || submit.isError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            {(save.error ?? submit.error)?.message}
          </Text>
        )}
        <View style={styles.actions}>
          {step > 0 && (
            <Button label="Back" onPress={() => setStep(step - 1)} variant="secondary" />
          )}
          {step < 3 ? (
            <Button
              disabled={save.isPending}
              label={save.isPending ? 'Saving…' : 'Save and continue'}
              onPress={() => void continueVerification()}
            />
          ) : (
            <Button
              disabled={submit.isPending}
              label={submit.isPending ? 'Submitting…' : 'Submit for verification'}
              onPress={submitVerification}
            />
          )}
        </View>
      </NestedScreen>
    );
  return (
    <GuidedOnboarding
      currentPage={step}
      onPageChange={navigateTo}
      onSkip={() => void skip()}
      pageCount={5}
    >
      {Array.from({ length: 5 }, (_, page) => renderPage(page))}
    </GuidedOnboarding>
  );
}

export function OwnerProfileScreen() {
  return <OwnerOnboardingScreen presentation="profile" />;
}

function OwnerOnboardingSection({
  children,
  helper,
  icon,
  title,
}: {
  readonly children: React.ReactNode;
  readonly helper: string;
  readonly icon: IconName;
  readonly title: string;
}) {
  return (
    <Card style={styles.ownerSectionCard}>
      <View style={styles.ownerSectionHeader}>
        <View style={styles.ownerSectionIcon}>
          <Icon color={colors.primary} name={icon} size={24} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.body}>{helper}</Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

function OwnerReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.ownerReviewRow}>
      <Text style={styles.menuDetail}>{label}</Text>
      <Text style={styles.body}>{value || 'Not provided'}</Text>
    </View>
  );
}

export function VerificationScreen({ onBack }: { readonly onBack?: () => void } = {}) {
  const auth = useAuth();
  const client = useQueryClient();
  const [mobileNumber, setMobileNumber] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [emailToken, setEmailToken] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [mobileMessage, setMobileMessage] = useState('');
  const [mobileCooldown, setMobileCooldown] = useState(0);
  const [changingMobile, setChangingMobile] = useState(false);
  const [verificationSection, setVerificationSection] = useState<'contact' | 'details'>('contact');
  useEffect(() => {
    if (mobileCooldown <= 0) return;
    const timer = setInterval(() => setMobileCooldown((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [mobileCooldown]);
  const verification = useQuery({
    queryKey: ['renter-verification'],
    queryFn: () => apiClient.request<RenterVerificationSnapshot>('/renter-verification'),
    refetchInterval: (query) =>
      ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFORMATION_REQUIRED'].includes(
        query.state.data?.eligibility.status ?? '',
      )
        ? 5_000
        : false,
  });
  useRefreshOnFocusAndForeground(() => void refreshVerification(client, auth.refreshIdentity));
  const requestEmail = useMutation({
    mutationFn: () =>
      apiClient.request<{ message: string }>('/auth/email-verification/requests', {
        method: 'POST',
      }),
    onSuccess: () => {
      setEmailMessage('Verification sent. It expires according to the account security policy.');
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
      if (result.challengeId) setMobileCooldown(60);
      setMobileMessage(
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
      setMobileMessage('✓ Mobile number verified successfully.');
      setChangingMobile(false);
      client.setQueryData<RenterVerificationSnapshot>(['renter-verification'], (current) =>
        current ? { ...current, mobileVerifiedAt: new Date().toISOString() } : current,
      );
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
      setEmailMessage('✓ Email address verified successfully.');
      client.setQueryData<RenterVerificationSnapshot>(['renter-verification'], (current) =>
        current ? { ...current, emailVerifiedAt: new Date().toISOString() } : current,
      );
      void refreshVerification(client, auth.refreshIdentity);
    },
  });
  const developmentInbox = useQuery({
    enabled: false,
    queryKey: ['development-auth-deliveries'],
    queryFn: () => {
      if (!__DEV__) throw new Error('Development verification deliveries are disabled.');
      return apiClient.request<{
        items: readonly {
          id: string;
          channel: 'EMAIL' | 'SMS';
          template: string;
          secret: string;
          createdAt: string;
        }[];
      }>('/development/auth-deliveries');
    },
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
      onBack={onBack}
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
          {verificationSection === 'contact' ? (
            <>
              <Card style={styles.ownerProgressCard}>
                <View style={styles.rowBetween}>
                  <Text accessibilityRole="header" style={styles.progressText}>
                    Step 1 of 8
                  </Text>
                  <Text style={styles.cardTitle}>Contact information</Text>
                </View>
                <View style={styles.ownerProgressDots}>
                  {Array.from({ length: 8 }, (_, index) => (
                    <View
                      accessibilityLabel={
                        index === 0
                          ? 'Contact information, current step'
                          : `Verification step ${index + 1}`
                      }
                      key={index}
                      style={[
                        styles.ownerProgressDot,
                        index === 0 && styles.ownerProgressDotActive,
                      ]}
                    />
                  ))}
                </View>
              </Card>
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
                    <View style={styles.verificationActions}>
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
                        onChangeText={(value) => {
                          verifyEmail.reset();
                          setEmailMessage('');
                          setEmailToken(value);
                        }}
                      />
                      <Button
                        disabled={!emailToken.trim() || verifyEmail.isPending}
                        label={verifyEmail.isPending ? 'Verifying…' : 'Confirm email'}
                        onPress={() => {
                          verifyEmail.reset();
                          setEmailMessage('');
                          verifyEmail.mutate();
                        }}
                      />
                      {emailMessage && <Text style={styles.success}>{emailMessage}</Text>}
                      {(requestEmail.error || verifyEmail.error) && (
                        <Text accessibilityRole="alert" style={styles.error}>
                          {contactVerificationError(
                            requestEmail.error ?? verifyEmail.error,
                            'email',
                          )}
                        </Text>
                      )}
                    </View>
                  )}
                </VerificationCard>
                <VerificationCard
                  label="Mobile number"
                  value={verification.data.mobileNumber ?? 'Not added'}
                  verified={Boolean(verification.data.mobileVerifiedAt)}
                >
                  {verification.data.mobileVerifiedAt && !changingMobile ? (
                    <View style={styles.verificationActions}>
                      <Text style={styles.success}>✓ Mobile number verified</Text>
                      <Button
                        label="Change"
                        onPress={() => {
                          requestMobile.reset();
                          verifyMobile.reset();
                          setChallengeId('');
                          setMobileMessage(
                            'Enter the new number. It will remain unverified until you confirm its code.',
                          );
                          setMobileNumber('');
                          setChangingMobile(true);
                        }}
                        variant="secondary"
                      />
                    </View>
                  ) : (
                    <>
                      <View style={styles.verificationActions}>
                        {changingMobile && <Text style={styles.note}>{mobileMessage}</Text>}
                        <Field
                          keyboardType="phone-pad"
                          label={
                            verification.data.mobileNumber ? 'Mobile number' : 'Add mobile number'
                          }
                          placeholder="09XXXXXXXXX"
                          returnKeyType="done"
                          value={mobileNumber || verification.data.mobileNumber || ''}
                          onChangeText={setMobileNumber}
                        />
                        <Button
                          disabled={
                            requestMobile.isPending ||
                            mobileCooldown > 0 ||
                            !(mobileNumber || verification.data.mobileNumber)
                          }
                          label={
                            requestMobile.isPending
                              ? 'Sending…'
                              : mobileCooldown > 0
                                ? `Resend in ${mobileCooldown}s`
                                : challengeId
                                  ? 'Resend verification code'
                                  : 'Send verification code'
                          }
                          onPress={() => requestMobile.mutate()}
                          variant="secondary"
                        />
                        {requestMobile.error && (
                          <Text accessibilityRole="alert" style={styles.error}>
                            {contactVerificationError(requestMobile.error, 'mobile')}
                          </Text>
                        )}
                      </View>
                      {challengeId && (
                        <View style={styles.verificationActions}>
                          <Field
                            keyboardType="number-pad"
                            label="6-digit mobile verification code"
                            placeholder="123456"
                            returnKeyType="done"
                            value={otpCode}
                            onChangeText={(value) =>
                              setOtpCode(value.replaceAll(/\D/g, '').slice(0, 6))
                            }
                          />
                          <Button
                            disabled={otpCode.length !== 6 || verifyMobile.isPending}
                            label={verifyMobile.isPending ? 'Verifying…' : 'Verify mobile'}
                            onPress={() => verifyMobile.mutate()}
                          />
                          {mobileMessage && <Text style={styles.success}>{mobileMessage}</Text>}
                          {verifyMobile.error && (
                            <Text accessibilityRole="alert" style={styles.error}>
                              {contactVerificationError(verifyMobile.error, 'mobile')}
                            </Text>
                          )}
                        </View>
                      )}
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
                        onPress={() => {
                          verifyEmail.reset();
                          requestEmail.reset();
                          setEmailMessage('');
                          setEmailToken(latestEmail.secret);
                        }}
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
              </Card>
              <Button label="Continue" onPress={() => setVerificationSection('details')} />
            </>
          ) : (
            <RenterVerificationWorkflow
              onBackBeforeFirstStep={() => setVerificationSection('contact')}
              progressOffset={1}
              progressTotal={8}
              snapshot={verification.data}
            />
          )}
        </>
      )}
    </NestedScreen>
  );
}

function contactVerificationError(error: unknown, channel: 'email' | 'mobile') {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('invalid') || message.includes('expired'))
    return channel === 'email'
      ? 'Incorrect or expired verification code. Please check the code and try again.'
      : 'Incorrect or expired mobile code. Please check the code and try again.';
  if (message.includes('wait') || message.includes('rate') || message.includes('too many'))
    return 'Please wait before requesting another verification code.';
  return "We couldn't complete verification right now. Please try again.";
}

async function refreshVerification(
  client: ReturnType<typeof useQueryClient>,
  refreshIdentity: () => Promise<void>,
) {
  await Promise.all([invalidateRenterVerification(client), refreshIdentity()]);
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
      <LogoutButton />
    </NestedScreen>
  );
}

export function SettingsScreen() {
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
      <LogoutButton />
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
  const auth = useAuth();
  const navigation = useNavigation<Navigator>();
  const renterEnabled = Boolean(auth.user?.roles.includes('RENTER'));
  const renterSetupPending = Boolean(
    renterEnabled && !auth.user?.profile?.renterOnboardingCompletedAt,
  );
  const renterEnrollment = useMutation({
    mutationFn: () => auth.enrollPersona('RENTER'),
    onSuccess: () => onModeChange('renter'),
  });
  return (
    <Screen
      eyebrow="Owner mode"
      title="Manage your business"
      subtitle="Fleet operations, earnings, payouts and owner settings."
    >
      <Card style={styles.modeCard}>
        <Icon color={colors.primary} name="person-circle-outline" size={32} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>
            {renterSetupPending
              ? 'Continue Renter Setup'
              : renterEnabled
                ? 'Switch to renter mode'
                : 'Start Renting Cars'}
          </Text>
          <Text style={styles.body}>
            {renterSetupPending
              ? 'Finish your guided Renter setup when you are ready.'
              : renterEnabled
                ? 'Search and book cars with the same account.'
                : 'Add Renter access to this account and begin guided setup.'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={
            renterSetupPending
              ? 'Continue Renter Setup'
              : renterEnabled
                ? 'Switch to renter mode'
                : 'Start Renting Cars'
          }
          disabled={renterEnrollment.isPending}
          onPress={() => (renterEnabled ? onModeChange('renter') : renterEnrollment.mutate())}
        >
          <Icon color={colors.primary} name="swap-horizontal" size={28} />
        </Pressable>
      </Card>
      {renterEnrollment.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          We could not enable Renter access. Check your connection and try again.
        </Text>
      )}
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
            navigation.navigate(ownerStatus === 'VERIFIED' ? 'OwnerEarnings' : 'OwnerProfile')
          }
        />
        <MenuRow
          icon="id-card-outline"
          label="Owner Profile"
          detail={ownerStatusLabel(ownerStatus ?? 'DRAFT')}
          accessibilityLabel={`Owner Profile. ${ownerStatusLabel(ownerStatus ?? 'DRAFT')}`}
          onPress={() => navigation.navigate('OwnerProfile')}
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
      <LogoutButton />
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
  accessibilityLabel,
  onPress,
  disabled = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly accessibilityLabel?: string | undefined;
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
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.menuRow}
    >
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
    DRAFT: 'Verification required',
    PENDING_VERIFICATION: 'Verification pending',
    VERIFIED: 'Verified',
    REJECTED: 'Changes required',
    SUSPENDED: 'Account restricted',
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
  verificationActions: { gap: spacing.md, marginTop: spacing.sm },
  menuDetail: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  ownerProgressCard: { gap: spacing.sm },
  ownerProgressDot: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    flex: 1,
    height: 5,
  },
  ownerProgressDotActive: { backgroundColor: colors.primary },
  ownerProgressDots: { flexDirection: 'row', gap: spacing.xs },
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
  ownerDocumentPreview: {
    aspectRatio: 1.58,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    width: '100%',
  },
  ownerReviewRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  ownerSetupCard: { gap: spacing.md },
  ownerSectionCard: { gap: spacing.md },
  ownerSectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  ownerSectionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  progressText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
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
