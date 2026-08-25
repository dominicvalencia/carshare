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
  Screen,
  SectionHeader,
  StateView,
  StatusBadge,
  type IconName,
} from '../../ui/primitives';

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
  readonly profile: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  } | null;
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
          onPress={() => navigation.navigate('PersonalInformation')}
        />
        <MenuRow
          icon="lock-closed-outline"
          label="Login & security"
          onPress={() => navigation.navigate('Settings')}
        />
        <MenuRow
          icon="phone-portrait-outline"
          label="Active devices"
          onPress={() => navigation.navigate('ActiveDevices')}
        />
      </MenuSection>
      <MenuSection title="Renting">
        <MenuRow icon="heart-outline" label="Favorites" detail="Open from Home or Search" />
        <MenuRow icon="star-outline" label="Reviews" detail="Available after completed rentals" />
        <MenuRow
          icon="notifications-outline"
          label="Notifications"
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
      <Screen title="Personal information">
        <StateView loading title="Loading your profile…" />
      </Screen>
    );
  if (me.isError || !me.data)
    return (
      <Screen title="Personal information">
        <StateView
          icon="cloud-offline-outline"
          title="Profile unavailable"
          message={me.error?.message}
          actionLabel="Retry"
          onAction={() => void me.refetch()}
        />
      </Screen>
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
    <Screen
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
    </Screen>
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
    <Screen
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
    </Screen>
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
      <Screen title="Owner onboarding">
        <StateView loading title="Checking your owner profile…" />
      </Screen>
    );
  if (!owner.data)
    return (
      <Screen
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
      </Screen>
    );
  if (!['DRAFT', 'REJECTED'].includes(owner.data.status))
    return (
      <Screen
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
      </Screen>
    );
  const steps = ['Personal', 'Address', 'Document', 'Review'];
  return (
    <Screen
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
    </Screen>
  );
}

export function SettingsScreen() {
  const auth = useAuth();
  const [pushEnabled, setPushEnabled] = useState(true);
  return (
    <Screen eyebrow="Account" title="Settings">
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
        <MenuRow icon="eye-outline" label="Privacy" detail="Privacy controls will open here." />
        <MenuRow
          icon="document-text-outline"
          label="Terms of service"
          detail="Marketplace terms will open here."
        />
      </MenuSection>
      <Button label="Log out" onPress={() => void auth.logout()} variant="danger" />
    </Screen>
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
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly detail?: string | undefined;
  readonly onPress?: (() => void) | undefined;
}) {
  const content = (
    <>
      <View style={styles.menuIcon}>
        <Icon color={colors.primary} name={icon} size={21} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail && (
          <Text numberOfLines={1} style={styles.menuDetail}>
            {detail}
          </Text>
        )}
      </View>
      {onPress && <Icon color={colors.subtleText} name="chevron-forward" size={19} />}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.menuRow}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.menuRow}>{content}</View>
  );
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
  error: { color: colors.danger },
  flex: { flex: 1 },
  menu: { padding: 0 },
  menuDetail: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
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
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  section: { gap: spacing.xs, marginTop: spacing.sm },
  success: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  warningCard: { backgroundColor: colors.warningSoft },
});
