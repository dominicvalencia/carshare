import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { ImageStyle, StyleProp } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateOnlyField } from '../../ui/DateOnlyField';
import { ensureCameraPermission } from '../../ui/camera-permission';
import {
  BackControl,
  Button,
  Card,
  Field,
  Icon,
  Screen,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { NativeCameraCapture } from '../../ui/NativeCameraCapture';
import type { RenterVerificationSnapshot } from './AccountScreen';
import {
  addressError,
  driverError,
  emergencyError,
  localitySelection,
  normalizeMobile,
  personalError,
  regionSelection,
  scopeSelection,
} from './renter-verification-form';
import { invalidateRenterVerification } from '../../query/verification-invalidation';
import { RenterOnboardingFooter } from '../../onboarding/GuidedOnboarding';

const stages = [
  'Personal information',
  'Residential address',
  'Driver information',
  'Emergency contact',
  'Identity documents',
  'Identity photos',
  'Review & submit',
] as const;

const relationships = [
  ['PARENT', 'Parent'],
  ['SPOUSE', 'Spouse'],
  ['SIBLING', 'Sibling'],
  ['CHILD', 'Child'],
  ['RELATIVE', 'Relative'],
  ['GUARDIAN', 'Guardian'],
  ['FRIEND', 'Friend'],
  ['PARTNER', 'Partner'],
  ['COLLEAGUE', 'Colleague'],
  ['OTHER', 'Other'],
] as const;

type RenterDraft = ReturnType<typeof draftFromSnapshot>;
interface RenterDraftContextValue {
  readonly form: RenterDraft;
  readonly hydrated: boolean;
  readonly setForm: Dispatch<SetStateAction<RenterDraft>>;
  readonly setHydrated: Dispatch<SetStateAction<boolean>>;
}
const RenterDraftContext = createContext<RenterDraftContextValue | null>(null);

export function RenterOnboardingDraftProvider({ children }: { readonly children: ReactNode }) {
  const [form, setForm] = useState(() => draftFromSnapshot());
  const [hydrated, setHydrated] = useState(false);
  return (
    <RenterDraftContext.Provider value={{ form, hydrated, setForm, setHydrated }}>
      {children}
    </RenterDraftContext.Provider>
  );
}

interface AreaOption {
  readonly code: string;
  readonly name: string;
  readonly kind?: string;
  readonly provinceCode?: string | null;
}

interface AreaResponse {
  readonly datasetVersion: string | null;
  readonly items: readonly AreaOption[];
}

export function RenterVerificationWorkflow({
  editingApprovedInitially = false,
  onboardingNavigation,
  onboardingScreen,
  onEditStep,
  onBackBeforeFirstStep,
  progressOffset = 0,
  progressTotal,
  snapshot,
}: {
  readonly editingApprovedInitially?: boolean;
  readonly onboardingNavigation?: {
    readonly onBack: () => void;
    readonly onNext: () => void;
    readonly step: number;
  };
  readonly onboardingScreen?: {
    readonly subtitle: string;
    readonly title: string;
  };
  readonly onEditStep?: (step: number) => void;
  readonly onBackBeforeFirstStep?: () => void;
  readonly progressOffset?: number;
  readonly progressTotal?: number;
  readonly snapshot: RenterVerificationSnapshot;
}) {
  const client = useQueryClient();
  const profile = snapshot.profile;
  const [internalStep, setInternalStep] = useState(() =>
    Math.min(profile?.renterVerificationDraftStep ?? 0, 6),
  );
  const step = onboardingNavigation?.step ?? internalStep;
  const setStep = (next: number) => setInternalStep(next);
  const [formError, setFormError] = useState('');
  const [editingApproved, setEditingApproved] = useState(editingApprovedInitially);
  const [barangaySearch, setBarangaySearch] = useState('');
  const [capturedIdentityPhotos, setCapturedIdentityPhotos] = useState<
    Partial<Record<'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE', ImagePicker.ImagePickerAsset>>
  >({});
  const initialForm = () => ({
    addressLine1: profile?.addressLine1 ?? '',
    addressScopeCode: profile?.addressScopeCode ?? '',
    barangay: profile?.barangay ?? '',
    barangayCode: profile?.barangayCode ?? '',
    cityMunicipality: profile?.cityMunicipality ?? '',
    cityMunicipalityCode: profile?.cityMunicipalityCode ?? '',
    dateOfBirth: profile?.dateOfBirth?.slice(0, 10) ?? '',
    driverLicenseClass: profile?.driverLicenseClass ?? '',
    driverLicenseExpiry: profile?.driverLicenseExpiry?.slice(0, 10) ?? '',
    driverLicenseNumber: '',
    driverLicenseRestrictions: profile?.driverLicenseRestrictions ?? '',
    emergencyContactMobile: profile?.emergencyContactMobile ?? '',
    emergencyContactName: profile?.emergencyContactName ?? '',
    emergencyContactRelation: profile?.emergencyContactRelation ?? '',
    emergencyContactRelationOther: profile?.emergencyContactRelationOther ?? '',
    legalFirstName: profile?.firstName ?? '',
    legalLastName: profile?.lastName ?? '',
    middleName: profile?.middleName ?? '',
    postalCode: profile?.postalCode ?? '',
    province: profile?.province ?? '',
    provinceCode: profile?.provinceCode ?? '',
    region: profile?.region ?? '',
    regionCode: profile?.regionCode ?? '',
  });
  const [localForm, setLocalForm] = useState(initialForm);
  const sharedDraft = useContext(RenterDraftContext);
  const form = onboardingNavigation && sharedDraft ? sharedDraft.form : localForm;
  const setForm = onboardingNavigation && sharedDraft ? sharedDraft.setForm : setLocalForm;
  useEffect(() => {
    if (!onboardingNavigation || !sharedDraft || sharedDraft.hydrated) return;
    sharedDraft.setForm(draftFromSnapshot(snapshot));
    sharedDraft.setHydrated(true);
  }, [onboardingNavigation, sharedDraft, snapshot]);
  const regions = useQuery({
    queryKey: ['geography', 'regions'],
    queryFn: () => apiClient.request<AreaResponse>('/geography/regions'),
  });
  const scopes = useQuery({
    enabled: Boolean(form.regionCode),
    queryKey: ['geography', 'scopes', form.regionCode],
    queryFn: () => apiClient.request<AreaResponse>(`/geography/regions/${form.regionCode}/scopes`),
  });
  const localities = useQuery({
    enabled: Boolean(form.regionCode && form.addressScopeCode),
    queryKey: ['geography', 'localities', form.regionCode, form.addressScopeCode],
    queryFn: () =>
      apiClient.request<AreaResponse>(
        `/geography/regions/${form.regionCode}/localities?scopeCode=${form.addressScopeCode}`,
      ),
  });
  const barangays = useQuery({
    enabled: Boolean(form.cityMunicipalityCode),
    queryKey: ['geography', 'barangays', form.cityMunicipalityCode, barangaySearch],
    queryFn: () =>
      apiClient.request<AreaResponse>(
        `/geography/localities/${form.cityMunicipalityCode}/barangays?query=${encodeURIComponent(
          barangaySearch,
        )}&limit=100`,
      ),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.request<NonNullable<RenterVerificationSnapshot['profile']>>(
        '/renter-verification/profile',
        {
          body: JSON.stringify(body),
          method: 'POST',
        },
      ),
    onSuccess: (updatedProfile) => {
      setFormError('');
      client.setQueryData<RenterVerificationSnapshot>(['renter-verification'], (current) =>
        current
          ? {
              ...current,
              profile: { ...(current.profile ?? updatedProfile), ...updatedProfile },
            }
          : current,
      );
      void invalidateRenterVerification(client);
    },
  });
  const upload = useMutation({
    mutationFn: async ({
      definition,
      asset,
    }: {
      definition: RenterVerificationSnapshot['definitions'][number];
      asset: { uri: string; name: string; mimeType: string };
    }) => {
      const file = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', asset);
      return apiClient.request('/renter-verification/documents', {
        body: JSON.stringify({ definitionCode: definition.code, fileAssetId: file.id }),
        method: 'POST',
      });
    },
    onSuccess: () => {
      void invalidateRenterVerification(client);
    },
  });
  const submit = useMutation({
    mutationFn: () => apiClient.request('/renter-verification/submission', { method: 'POST' }),
    onSuccess: () => {
      void invalidateRenterVerification(client);
      onboardingNavigation?.onNext();
    },
  });
  const documents = useMemo(
    () =>
      new Map(
        snapshot.verifications.flatMap(({ documents: items }) =>
          items
            .filter(({ replacedAt }) => !replacedAt)
            .map((item) => [item.definition?.code, item] as const),
        ),
      ),
    [snapshot.verifications],
  );
  const identityPhotosComplete = (['PROFILE_PHOTO', 'SELFIE_WITH_LICENSE'] as const).every((code) =>
    Boolean(capturedIdentityPhotos[code] || documents.get(code)),
  );
  const pending = ['SUBMITTED', 'UNDER_REVIEW'].includes(snapshot.eligibility.status);
  const locked = snapshot.eligibility.status === 'APPROVED' && !editingApproved;
  const currentDataset = regions.data?.datasetVersion ?? null;
  const emergencySamePhone = Boolean(
    normalizeMobile(form.emergencyContactMobile) &&
    normalizeMobile(form.emergencyContactMobile) === normalizeMobile(snapshot.mobileNumber ?? ''),
  );
  useEffect(() => {
    const error = save.error ?? upload.error ?? submit.error;
    if (error) console.error('Renter verification workflow request failed', error);
  }, [save.error, submit.error, upload.error]);

  const saveStage = (body: Record<string, unknown>, nextStep: number) => {
    setFormError('');
    save.mutate(body, {
      onSuccess: () =>
        onboardingNavigation ? onboardingNavigation.onNext() : setInternalStep(nextStep),
    });
  };
  const back = (nextStep: number) => {
    if (onboardingNavigation) return onboardingNavigation.onBack();
    if (step === 0 && onBackBeforeFirstStep) return onBackBeforeFirstStep();
    setInternalStep(nextStep);
  };
  const advancePersonal = () => {
    const error = personalError(form);
    if (error) return setFormError(error);
    saveStage(
      {
        dateOfBirth: form.dateOfBirth,
        legalFirstName: form.legalFirstName.trim(),
        legalLastName: form.legalLastName.trim(),
        ...(form.middleName.trim() ? { middleName: form.middleName.trim() } : {}),
        stage: 'PERSONAL_INFORMATION',
      },
      1,
    );
  };
  const advanceAddress = () => {
    const error = addressError(form);
    if (error) return setFormError(error);
    saveStage(
      {
        addressLine1: form.addressLine1.trim(),
        addressScopeCode: form.addressScopeCode,
        barangayCode: form.barangayCode,
        cityMunicipalityCode: form.cityMunicipalityCode,
        postalCode: form.postalCode,
        ...(form.provinceCode ? { provinceCode: form.provinceCode } : {}),
        regionCode: form.regionCode,
        stage: 'RESIDENTIAL_ADDRESS',
      },
      2,
    );
  };
  const advanceDriver = () => {
    const error = driverError(form, Boolean(profile?.driverLicenseLastFour));
    if (error) return setFormError(error);
    saveStage(
      {
        driverLicenseClass: form.driverLicenseClass.trim(),
        driverLicenseExpiry: form.driverLicenseExpiry,
        ...(form.driverLicenseNumber.trim()
          ? { driverLicenseNumber: form.driverLicenseNumber.trim() }
          : {}),
        ...(form.driverLicenseRestrictions.trim()
          ? { driverLicenseRestrictions: form.driverLicenseRestrictions.trim() }
          : {}),
        stage: 'DRIVER_INFORMATION',
      },
      3,
    );
  };
  const advanceEmergency = () => {
    const error = emergencyError(form, snapshot.mobileNumber);
    if (error) return setFormError(error);
    saveStage(
      {
        ...(form.emergencyContactName.trim()
          ? {
              emergencyContactMobile: form.emergencyContactMobile.trim(),
              emergencyContactName: form.emergencyContactName.trim(),
              emergencyContactRelation: form.emergencyContactRelation,
              ...(form.emergencyContactRelationOther.trim()
                ? { emergencyContactRelationOther: form.emergencyContactRelationOther.trim() }
                : {}),
            }
          : {}),
        stage: 'EMERGENCY_CONTACT',
      },
      4,
    );
  };
  const personalFields = (
    <View style={styles.personalFields}>
      <Field
        label="Legal first name *"
        placeholder="Enter your first name"
        value={form.legalFirstName}
        onChangeText={(legalFirstName) => setForm({ ...form, legalFirstName })}
      />
      <Field
        label="Legal middle name · Optional"
        placeholder="Enter your middle name"
        value={form.middleName}
        onChangeText={(middleName) => setForm({ ...form, middleName })}
      />
      <Field
        label="Legal last name *"
        placeholder="Enter your last name"
        value={form.legalLastName}
        onChangeText={(legalLastName) => setForm({ ...form, legalLastName })}
      />
      <DateOnlyField
        label="Date of birth *"
        maximumDate={new Date()}
        value={form.dateOfBirth}
        onChange={(dateOfBirth) => setForm({ ...form, dateOfBirth })}
      />
      {formError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {formError}
        </Text>
      )}
    </View>
  );
  const addressFields = (
    <View style={styles.addressFields}>
      <Field
        label="House / building / street *"
        multiline
        placeholder="e.g. 123 Rizal St., ABC Residences"
        value={form.addressLine1}
        onChangeText={(addressLine1) => setForm({ ...form, addressLine1 })}
      />
      <ReferenceSelect
        emptyTitle="No matching regions found."
        label="Region *"
        loading={regions.isPending}
        options={regions.data?.items ?? []}
        placeholder="Select region"
        searchPlaceholder="Search regions"
        selectedCode={form.regionCode}
        selectedLabel={form.region}
        sheetTitle="Select region"
        onSelect={(area) => setForm({ ...form, ...regionSelection(area) })}
      />
      <ReferenceSelect
        disabled={!form.regionCode}
        disabledPlaceholder="Select region first"
        emptyTitle="No matching provinces found."
        label="Province / geographic area *"
        loading={scopes.isPending}
        options={scopes.data?.items ?? []}
        placeholder="Select province"
        searchPlaceholder="Search provinces"
        selectedCode={form.addressScopeCode}
        selectedLabel={scopeLabel(form, scopes.data?.items)}
        sheetTitle="Select province"
        onSelect={(area) => setForm({ ...form, ...scopeSelection(area) })}
      />
      <ReferenceSelect
        disabled={!form.addressScopeCode}
        disabledPlaceholder="Select province first"
        emptyTitle="No matching cities or municipalities found."
        label="City / municipality *"
        loading={localities.isPending}
        options={localities.data?.items ?? []}
        placeholder="Select city or municipality"
        searchPlaceholder="Search cities"
        selectedCode={form.cityMunicipalityCode}
        selectedLabel={form.cityMunicipality}
        sheetTitle="Select city or municipality"
        onSelect={(area) => setForm({ ...form, ...localitySelection(area) })}
      />
      <ReferenceSelect
        disabled={!form.cityMunicipalityCode}
        disabledPlaceholder="Select city first"
        emptyTitle="No matching barangays found."
        label="Barangay *"
        loading={barangays.isPending}
        onSearch={setBarangaySearch}
        options={barangays.data?.items ?? []}
        placeholder="Select barangay"
        searchPlaceholder="Search barangays"
        selectedCode={form.barangayCode}
        selectedLabel={form.barangay}
        sheetTitle="Select barangay"
        onSelect={(area) => setForm({ ...form, barangay: area.name, barangayCode: area.code })}
      />
      <Field
        keyboardType="number-pad"
        label="Postal code *"
        placeholder="e.g. 4301"
        value={form.postalCode}
        onChangeText={(postalCode) => setForm({ ...form, postalCode })}
      />
      {formError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {formError}
        </Text>
      )}
    </View>
  );
  const driverLicenseError = formError.includes('license number') ? formError : undefined;
  const driverClassError = formError.includes('classification') ? formError : undefined;
  const driverExpiryError = formError.includes('expiration date') ? formError : undefined;
  const driverGeneralError =
    formError && !driverLicenseError && !driverClassError && !driverExpiryError
      ? formError
      : undefined;
  const driverFields = (
    <View style={styles.driverFields}>
      {onboardingNavigation && (
        <View accessibilityRole="text" style={styles.privacyHelper}>
          <Icon color={colors.subtleText} name="lock-closed-outline" size={15} />
          <Text style={styles.privacyHelperText}>
            Your license number is stored securely and used only for verification.
          </Text>
        </View>
      )}
      {profile?.driverLicenseLastFour && (
        <View
          accessibilityLabel={`Driver's license number on file ending in ${profile.driverLicenseLastFour}`}
          style={styles.savedLicense}
        >
          <Icon color={colors.primary} name="checkmark-circle" size={20} />
          <View style={styles.flex}>
            <Text style={styles.savedLicenseTitle}>License number on file</Text>
            <Text style={styles.savedLicenseDetail}>Ending in {profile.driverLicenseLastFour}</Text>
          </View>
        </View>
      )}
      <Field
        autoCapitalize="characters"
        autoCorrect={false}
        error={driverLicenseError}
        label={
          profile?.driverLicenseLastFour
            ? 'Replace license number · Optional'
            : "Driver's license number *"
        }
        value={form.driverLicenseNumber}
        onChangeText={(driverLicenseNumber) => setForm({ ...form, driverLicenseNumber })}
        placeholder={
          profile?.driverLicenseLastFour
            ? `Current ends in ${profile.driverLicenseLastFour}`
            : 'Enter license number'
        }
        spellCheck={false}
      />
      <DateOnlyField
        {...(driverExpiryError ? { error: driverExpiryError } : {})}
        label="Expiration date *"
        minimumDate={tomorrow()}
        value={form.driverLicenseExpiry}
        onChange={(driverLicenseExpiry) => setForm({ ...form, driverLicenseExpiry })}
      />
      <Field
        error={driverClassError}
        label="License classification *"
        value={form.driverLicenseClass}
        onChangeText={(driverLicenseClass) => setForm({ ...form, driverLicenseClass })}
        placeholder="e.g. A, A1, B, B1"
      />
      <Field
        label="Restrictions · Optional"
        value={form.driverLicenseRestrictions}
        onChangeText={(driverLicenseRestrictions) =>
          setForm({ ...form, driverLicenseRestrictions })
        }
        placeholder="e.g. Corrective lenses"
      />
      {driverGeneralError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {driverGeneralError}
        </Text>
      )}
    </View>
  );
  const onboardingPrimaryAction = () => {
    if (step === 0) return advancePersonal();
    if (step === 1) return advanceAddress();
    if (step === 2) return advanceDriver();
    if (step === 3) return advanceEmergency();
    if (step === 4 || step === 5) return onboardingNavigation?.onNext();
    if (step === 6) return submit.mutate();
  };
  const onboardingPrimaryLabel =
    step === 6
      ? snapshot.eligibility.status === 'MORE_INFORMATION_REQUIRED'
        ? 'Resubmit verification'
        : 'Submit verification'
      : 'Continue';
  const onboardingBusy =
    (step <= 2 && save.isPending) ||
    ((step === 4 || step === 5) && upload.isPending) ||
    (step === 6 && submit.isPending);
  const editReviewStep = (targetStep: number) => {
    if (onboardingNavigation) return onEditStep?.(targetStep);
    if (targetStep === -1) return onBackBeforeFirstStep?.();
    setInternalStep(targetStep);
  };
  const identityPhotoCodes = ['PROFILE_PHOTO', 'SELFIE_WITH_LICENSE'] as const;
  const identityDefinitions = snapshot.definitions.filter(({ code }) =>
    identityPhotoCodes.includes(code as (typeof identityPhotoCodes)[number]),
  );
  const documentDefinitions = snapshot.definitions.filter(
    ({ code }) =>
      code !== 'SELFIE' &&
      !identityPhotoCodes.includes(code as (typeof identityPhotoCodes)[number]),
  );
  const requiredDocuments = documentDefinitions.filter(({ required }) => required);
  const addedRequiredDocuments = requiredDocuments.filter(({ code }) => documents.has(code));
  const workflowContent = (
    <>
      {!onboardingNavigation && (
        <Card style={snapshot.eligibility.eligible ? undefined : styles.warningCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Rental eligibility</Text>
            <StatusBadge
              label={verificationLabel(snapshot.eligibility.status)}
              tone={snapshot.eligibility.eligible ? 'success' : 'warning'}
            />
          </View>
          <Text style={styles.body}>
            {snapshot.eligibility.eligible
              ? 'You can reserve vehicles and authorize rental payments.'
              : pending
                ? 'Your evidence is with the platform verification team.'
                : 'Search and quotes remain available while you complete verification.'}
          </Text>
        </Card>
      )}
      {!onboardingNavigation && (locked || pending) && (
        <>
          <StateView
            icon={locked ? 'checkmark-circle-outline' : 'time-outline'}
            title={locked ? 'Verification approved' : 'Verification under review'}
            message={
              locked
                ? 'Material identity, address, or driver changes require reverification.'
                : 'Your server-persisted evidence is preserved while authorized staff review it.'
            }
          />
          {locked && (
            <Button
              label="Edit verified details"
              onPress={() => {
                Alert.alert(
                  'Reverification required',
                  'Saving changes to your legal identity, residential address, or driver information returns your verification to draft and pauses rental eligibility until staff approve it again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Continue editing',
                      onPress: () => {
                        setEditingApproved(true);
                        setStep(0);
                      },
                    },
                  ],
                );
              }}
              variant="secondary"
            />
          )}
        </>
      )}
      {!locked && !pending && (
        <>
          {!onboardingNavigation && (
            <Card style={styles.progressCard}>
              <Text style={styles.progressText}>
                Step {step + 1 + progressOffset} of {progressTotal ?? stages.length}
              </Text>
              <Text style={styles.cardTitle}>{stages[step]}</Text>
              <View style={styles.progressDots}>
                {progressOffset > 0 && (
                  <Pressable
                    accessibilityLabel="Go to Contact information"
                    onPress={onBackBeforeFirstStep}
                    style={[styles.progressDot, styles.progressDotActive]}
                  />
                )}
                {stages.map((label, index) => (
                  <Pressable
                    accessibilityLabel={`Go to ${label}`}
                    key={label}
                    onPress={() =>
                      index <= Math.max(profile?.renterVerificationDraftStep ?? 0, step) &&
                      setStep(index)
                    }
                    style={[styles.progressDot, index <= step && styles.progressDotActive]}
                  />
                ))}
              </View>
            </Card>
          )}

          {step === 0 &&
            (onboardingNavigation ? (
              <Card style={styles.personalFormCard}>{personalFields}</Card>
            ) : (
              <SectionCard
                icon="person-outline"
                title="Personal information"
                helper="Use the name and birth date shown on your government-issued identity document."
              >
                {personalFields}
                <NavigationButtons
                  busy={save.isPending}
                  onBack={() => back(0)}
                  onNext={advancePersonal}
                />
              </SectionCard>
            ))}

          {step === 1 &&
            (onboardingNavigation ? (
              <Card style={styles.addressFormCard}>{addressFields}</Card>
            ) : (
              <SectionCard
                icon="location-outline"
                title="Residential address"
                helper={`Searchable official PSA PSGC reference${currentDataset ? ` · ${currentDataset.replaceAll('_', ' ')}` : ''}. Address line and postal code remain renter-entered.`}
              >
                {addressFields}
                <NavigationButtons
                  busy={save.isPending}
                  onBack={() => back(0)}
                  onNext={advanceAddress}
                />
              </SectionCard>
            ))}

          {step === 2 &&
            (onboardingNavigation ? (
              <Card style={styles.driverFormCard}>{driverFields}</Card>
            ) : (
              <SectionCard
                icon="card-outline"
                title="Driver information"
                helper="Your license number is stored securely and used only for verification."
              >
                {driverFields}
                <NavigationButtons
                  busy={save.isPending}
                  onBack={() => back(1)}
                  onNext={advanceDriver}
                />
              </SectionCard>
            ))}

          {step === 3 && (
            <SectionCard
              icon="call-outline"
              title="Emergency contact"
              helper="This person must not be you. Philippine mobile formats are normalized before comparison."
            >
              <Field
                label="Full name"
                value={form.emergencyContactName}
                onChangeText={(emergencyContactName) => setForm({ ...form, emergencyContactName })}
              />
              <ReferenceSelect
                label="Relationship"
                options={relationships.map(([code, name]) => ({ code, name }))}
                selectedLabel={relationshipLabel(form.emergencyContactRelation)}
                onSelect={(option) =>
                  setForm({
                    ...form,
                    emergencyContactRelation: option.code,
                    emergencyContactRelationOther:
                      option.code === 'OTHER' ? form.emergencyContactRelationOther : '',
                  })
                }
              />
              {form.emergencyContactRelation === 'OTHER' && (
                <Field
                  label="Describe relationship *"
                  value={form.emergencyContactRelationOther}
                  onChangeText={(emergencyContactRelationOther) =>
                    setForm({ ...form, emergencyContactRelationOther })
                  }
                />
              )}
              <Field
                error={
                  emergencySamePhone
                    ? 'Emergency contact mobile number must be different from your number.'
                    : undefined
                }
                keyboardType="phone-pad"
                label="Philippine mobile number"
                value={form.emergencyContactMobile}
                onChangeText={(emergencyContactMobile) =>
                  setForm({ ...form, emergencyContactMobile })
                }
                placeholder="09XXXXXXXXX or +639XXXXXXXXX"
              />
              <NavigationButtons
                busy={save.isPending}
                hidden={Boolean(onboardingNavigation)}
                onBack={() => back(2)}
                onNext={() => {
                  const error = emergencyError(form, snapshot.mobileNumber);
                  if (error) return setFormError(error);
                  saveStage(
                    {
                      ...(form.emergencyContactName.trim()
                        ? {
                            emergencyContactMobile: form.emergencyContactMobile.trim(),
                            emergencyContactName: form.emergencyContactName.trim(),
                            emergencyContactRelation: form.emergencyContactRelation,
                            ...(form.emergencyContactRelationOther.trim()
                              ? {
                                  emergencyContactRelationOther:
                                    form.emergencyContactRelationOther.trim(),
                                }
                              : {}),
                          }
                        : {}),
                      stage: 'EMERGENCY_CONTACT',
                    },
                    4,
                  );
                }}
              />
              {step === 3 && formError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {formError}
                </Text>
              )}
            </SectionCard>
          )}

          {step === 4 && (
            <DocumentStage
              definitions={snapshot.definitions.filter(
                ({ code }) =>
                  code !== 'SELFIE' && code !== 'PROFILE_PHOTO' && code !== 'SELFIE_WITH_LICENSE',
              )}
              documents={documents}
              upload={upload}
              showNavigation={!onboardingNavigation}
              onBack={() => back(3)}
              onContinue={() =>
                onboardingNavigation ? onboardingNavigation.onNext() : setInternalStep(5)
              }
            />
          )}

          {step === 5 && (
            <IdentityPhotosStage
              captured={capturedIdentityPhotos}
              definitions={snapshot.definitions.filter(
                ({ code }) => code === 'PROFILE_PHOTO' || code === 'SELFIE_WITH_LICENSE',
              )}
              documents={documents}
              upload={upload}
              showNavigation={!onboardingNavigation}
              onBack={() => back(4)}
              onCapture={(code, asset) =>
                setCapturedIdentityPhotos((current) => ({ ...current, [code]: asset }))
              }
              onContinue={() =>
                onboardingNavigation ? onboardingNavigation.onNext() : setInternalStep(6)
              }
            />
          )}

          {step === 6 && (
            <View style={styles.reviewSections}>
              <ReviewSummarySection
                title="Personal information"
                editLabel="Edit personal information"
                onEdit={() => editReviewStep(0)}
              >
                <Text style={styles.reviewPrimary}>
                  {[form.legalFirstName, form.middleName, form.legalLastName]
                    .filter(Boolean)
                    .join(' ') || 'Required information is missing'}
                </Text>
                {form.dateOfBirth ? (
                  <Text style={styles.reviewBody}>Born {formatReviewDate(form.dateOfBirth)}</Text>
                ) : (
                  <ReviewWarning> Date of birth is missing.</ReviewWarning>
                )}
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Residential address"
                editLabel="Edit residential address"
                onEdit={() => editReviewStep(1)}
              >
                {form.addressLine1 ? (
                  <>
                    <Text style={styles.reviewBody}>{form.addressLine1}</Text>
                    <Text style={styles.reviewBody}>
                      {[form.barangay && `Brgy. ${form.barangay}`, form.cityMunicipality]
                        .filter(Boolean)
                        .join(', ')}
                    </Text>
                    <Text style={styles.reviewBody}>
                      {[form.province || form.region, form.postalCode].filter(Boolean).join(' ')}
                    </Text>
                  </>
                ) : (
                  <ReviewWarning>Residential address is missing.</ReviewWarning>
                )}
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Contact verification"
                editLabel="Edit contact verification"
                onEdit={() => editReviewStep(-1)}
              >
                <ReviewStatusRow
                  label="Email"
                  value={snapshot.email ?? 'Not provided'}
                  complete={Boolean(snapshot.emailVerifiedAt)}
                />
                <ReviewStatusRow
                  label="Mobile"
                  value={snapshot.mobileNumber ?? 'Not provided'}
                  complete={Boolean(snapshot.mobileVerifiedAt)}
                />
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Driver's license"
                editLabel="Edit driver's license"
                onEdit={() => editReviewStep(2)}
              >
                <Text style={styles.reviewPrimary}>
                  {profile?.driverLicenseLastFour || form.driverLicenseNumber
                    ? 'License number on file'
                    : 'License number is missing'}
                </Text>
                {form.driverLicenseClass ? (
                  <Text style={styles.reviewBody}>Class {form.driverLicenseClass}</Text>
                ) : (
                  <ReviewWarning>License class is missing.</ReviewWarning>
                )}
                {form.driverLicenseExpiry ? (
                  <Text style={styles.reviewBody}>
                    Expires {formatReviewDate(form.driverLicenseExpiry)}
                  </Text>
                ) : (
                  <ReviewWarning>Expiration date is missing.</ReviewWarning>
                )}
                <Text style={styles.reviewBody}>
                  Restrictions: {form.driverLicenseRestrictions || 'None'}
                </Text>
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Emergency contact"
                editLabel="Edit emergency contact"
                onEdit={() => editReviewStep(3)}
              >
                {form.emergencyContactName ? (
                  <>
                    <Text style={styles.reviewPrimary}>{form.emergencyContactName}</Text>
                    <Text style={styles.reviewBody}>
                      {[
                        relationshipLabel(form.emergencyContactRelation),
                        form.emergencyContactMobile,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </>
                ) : (
                  <Text style={styles.reviewBody}>Not provided</Text>
                )}
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Identity documents"
                editLabel="Edit identity documents"
                onEdit={() => editReviewStep(4)}
              >
                <Text style={styles.reviewPrimary}>
                  {addedRequiredDocuments.length} of {requiredDocuments.length} required documents
                  added
                </Text>
                {requiredDocuments
                  .filter(({ code }) => !documents.has(code))
                  .map(({ code, name }) => (
                    <ReviewWarning key={code}>{name} is missing.</ReviewWarning>
                  ))}
              </ReviewSummarySection>

              <ReviewSummarySection
                title="Identity photos"
                editLabel="Edit identity photos"
                onEdit={() => editReviewStep(5)}
              >
                <ReviewCompletionRow
                  label="Profile photo"
                  complete={documents.has('PROFILE_PHOTO')}
                />
                <ReviewCompletionRow
                  label="Selfie with driver's license"
                  complete={documents.has('SELFIE_WITH_LICENSE')}
                />
                {identityDefinitions
                  .filter(({ required, code }) => required && !documents.has(code))
                  .map(({ code, name }) => (
                    <ReviewWarning key={code}>{name} is missing.</ReviewWarning>
                  ))}
              </ReviewSummarySection>
              <NavigationButtons
                busy={submit.isPending}
                hidden={Boolean(onboardingNavigation)}
                nextLabel={
                  submit.isPending
                    ? 'Submitting…'
                    : snapshot.eligibility.status === 'MORE_INFORMATION_REQUIRED'
                      ? 'Resubmit verification'
                      : 'Submit verification'
                }
                onBack={() => back(5)}
                onNext={() => submit.mutate()}
              />
            </View>
          )}
        </>
      )}
      {(save.isError || upload.isError || submit.isError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {(save.error ?? upload.error ?? submit.error)?.message ??
            'We couldn’t save your verification details. Please try again.'}
        </Text>
      )}
      {snapshot.verifications.map((verification) =>
        verification.rejectionReason ? (
          <Text key={verification.type} style={styles.error}>
            {verification.rejectionReason}
          </Text>
        ) : null,
      )}
    </>
  );
  if (onboardingNavigation && onboardingScreen) {
    return (
      <Screen
        bottomAccessory={
          <RenterOnboardingFooter
            busy={onboardingBusy}
            disabled={step === 5 && !identityPhotosComplete}
            {...(step === 0 ? {} : { onBack: () => back(step - 1) })}
            onPrimary={onboardingPrimaryAction}
            primaryLabel={onboardingPrimaryLabel}
          />
        }
        contentBottomPadding={spacing.lg}
        safeTop={false}
        scroll
        subtitle={onboardingScreen.subtitle}
        title={onboardingScreen.title}
      >
        {workflowContent}
      </Screen>
    );
  }
  return workflowContent;
}

function draftFromSnapshot(snapshot?: RenterVerificationSnapshot) {
  const profile = snapshot?.profile;
  return {
    addressLine1: profile?.addressLine1 ?? '',
    addressScopeCode: profile?.addressScopeCode ?? '',
    barangay: profile?.barangay ?? '',
    barangayCode: profile?.barangayCode ?? '',
    cityMunicipality: profile?.cityMunicipality ?? '',
    cityMunicipalityCode: profile?.cityMunicipalityCode ?? '',
    dateOfBirth: profile?.dateOfBirth?.slice(0, 10) ?? '',
    driverLicenseClass: profile?.driverLicenseClass ?? '',
    driverLicenseExpiry: profile?.driverLicenseExpiry?.slice(0, 10) ?? '',
    driverLicenseNumber: '',
    driverLicenseRestrictions: profile?.driverLicenseRestrictions ?? '',
    emergencyContactMobile: profile?.emergencyContactMobile ?? '',
    emergencyContactName: profile?.emergencyContactName ?? '',
    emergencyContactRelation: profile?.emergencyContactRelation ?? '',
    emergencyContactRelationOther: profile?.emergencyContactRelationOther ?? '',
    legalFirstName: profile?.firstName ?? '',
    legalLastName: profile?.lastName ?? '',
    middleName: profile?.middleName ?? '',
    postalCode: profile?.postalCode ?? '',
    province: profile?.province ?? '',
    provinceCode: profile?.provinceCode ?? '',
    region: profile?.region ?? '',
    regionCode: profile?.regionCode ?? '',
  };
}

function SectionCard({
  children,
  helper,
  icon,
  title,
}: {
  readonly children: React.ReactNode;
  readonly helper: string;
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly title: string;
}) {
  return (
    <Card style={styles.sectionCard}>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionIcon}>
          <Icon color={colors.primary} name={icon} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.note}>{helper}</Text>
        </View>
      </View>
      {children}
    </Card>
  );
}

function ReferenceSelect({
  disabled = false,
  disabledPlaceholder = 'Select the previous field first',
  emptyTitle = 'No matching options found.',
  label,
  loading = false,
  onSearch,
  onSelect,
  options,
  placeholder = 'Search and select',
  searchPlaceholder = 'Type to search',
  selectedCode = '',
  selectedLabel,
  sheetTitle = label.replace(' *', ''),
}: {
  readonly disabled?: boolean;
  readonly disabledPlaceholder?: string;
  readonly emptyTitle?: string;
  readonly label: string;
  readonly loading?: boolean;
  readonly onSearch?: (query: string) => void;
  readonly onSelect: (option: AreaOption) => void;
  readonly options: readonly AreaOption[];
  readonly placeholder?: string;
  readonly searchPlaceholder?: string;
  readonly selectedCode?: string;
  readonly selectedLabel: string;
  readonly sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [headerHeight, setHeaderHeight] = useState(0);
  const [listContentHeight, setListContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const visible = onSearch
    ? options
    : options.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()));
  const bottomAllowance = Math.max(safeArea.bottom, spacing.md);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: listContentHeight,
        headerHeight,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: bottomAllowance,
      }),
    [bottomAllowance, headerHeight, listContentHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(360, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  useEffect(() => {
    if (!open || headerHeight <= 0 || listContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [headerHeight, listContentHeight, measuredLayout.height, open, sheetHeight, visible.length]);
  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
  };
  return (
    <View style={styles.selectField}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.selectButton, disabled && styles.selectButtonDisabled]}
      >
        <Text numberOfLines={2} style={selectedLabel ? styles.selectValue : styles.placeholder}>
          {selectedLabel || (disabled ? disabledPlaceholder : placeholder)}
        </Text>
        <Icon
          color={disabled ? colors.placeholder : colors.primary}
          name="chevron-down"
          size={19}
        />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.selectorModalRoot}
        >
          <View style={styles.selectorBackdrop} />
          <Reanimated.View
            accessibilityViewIsModal
            style={[styles.selectorSheet, animatedSheetStyle]}
          >
            <View
              onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
              style={styles.selectorHeader}
            >
              <BackControl onPress={close} />
              <Text accessibilityRole="header" style={styles.selectorTitle}>
                {sheetTitle}
              </Text>
              <View style={styles.searchBox}>
                <Icon color={colors.subtleText} name="search" size={19} />
                <TextInput
                  accessibilityLabel={searchPlaceholder}
                  autoCapitalize="words"
                  autoFocus={false}
                  onChangeText={(value) => {
                    setQuery(value);
                    onSearch?.(value);
                  }}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={colors.placeholder}
                  style={styles.searchInput}
                  value={query}
                />
              </View>
            </View>
            {loading ? (
              <StateView loading title="Loading options…" />
            ) : (
              <FlatList
                contentContainerStyle={[
                  styles.selectorListContent,
                  { paddingBottom: bottomAllowance },
                ]}
                data={visible}
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                keyExtractor={(item) => item.code}
                ListEmptyComponent={<StateView icon="search-outline" title={emptyTitle} />}
                nestedScrollEnabled
                onContentSizeChange={(_width, height) => setListContentHeight(height)}
                renderItem={({ item, index }) => {
                  const selected = item.code === selectedCode || item.name === selectedLabel;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      onPress={() => {
                        Keyboard.dismiss();
                        onSelect(item);
                        setQuery('');
                        onSearch?.('');
                        setOpen(false);
                      }}
                      style={[
                        styles.option,
                        selected && styles.optionSelected,
                        index < visible.length - 1 && styles.optionDivider,
                      ]}
                    >
                      <Text style={styles.optionText}>{item.name}</Text>
                      {selected && (
                        <Icon color={colors.primary} name="checkmark-circle" size={22} />
                      )}
                    </Pressable>
                  );
                }}
                scrollEnabled={measuredLayout.scrollEnabled}
                showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
                style={styles.selectorList}
              />
            )}
          </Reanimated.View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DocumentStage({
  definitions,
  documents,
  showNavigation,
  upload,
  onBack,
  onContinue,
}: {
  readonly definitions: RenterVerificationSnapshot['definitions'];
  readonly documents: Map<
    string | undefined,
    RenterVerificationSnapshot['verifications'][number]['documents'][number]
  >;
  readonly showNavigation: boolean;
  readonly upload: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      {
        definition: RenterVerificationSnapshot['definitions'][number];
        asset: { uri: string; name: string; mimeType: string };
      }
    >
  >;
  readonly onBack: () => void;
  readonly onContinue: () => void;
}) {
  const requiredDefinitions = definitions.filter(({ required }) => required);
  const requiredAdded = requiredDefinitions.filter(({ code }) => documents.has(code)).length;
  return (
    <View style={styles.documentStage}>
      <View style={styles.documentSummary}>
        <Icon color={colors.primary} name="documents-outline" size={18} />
        <Text style={styles.documentSummaryText}>
          {requiredAdded} of {requiredDefinitions.length} required documents added
        </Text>
      </View>
      {definitions.map((definition) => {
        const document = documents.get(definition.code);
        return (
          <DocumentCaptureRow
            fileAssetId={document?.fileAsset.id}
            definition={definition}
            documentName={document?.fileAsset.originalName}
            key={definition.code}
            showRequirementLabel={requiredDefinitions.length !== definitions.length}
            upload={upload}
          />
        );
      })}
      {showNavigation && (
        <NavigationButtons busy={upload.isPending} onBack={onBack} onNext={onContinue} />
      )}
    </View>
  );
}

function DocumentCaptureRow({
  definition,
  documentName,
  fileAssetId,
  showRequirementLabel,
  upload,
}: {
  readonly definition: RenterVerificationSnapshot['definitions'][number];
  readonly documentName?: string | undefined;
  readonly fileAssetId?: string | undefined;
  readonly showRequirementLabel: boolean;
  readonly upload: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      {
        definition: RenterVerificationSnapshot['definitions'][number];
        asset: { uri: string; name: string; mimeType: string };
      }
    >
  >;
}) {
  const [captured, setCaptured] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cameraVisible, setCameraVisible] = useState(false);
  const added = Boolean(captured || documentName);
  const capture = async () => {
    if (!(await ensureCameraPermission())) return;
    setCameraVisible(true);
  };
  return (
    <>
      <NativeCameraCapture
        captureLabel={`Capture ${definition.name.toLocaleLowerCase()}`}
        facing="back"
        guide={documentCaptureGuide(definition.code)}
        onCancel={() => setCameraVisible(false)}
        onCapture={(picture) => {
          setCameraVisible(false);
          const asset: ImagePicker.ImagePickerAsset = {
            fileName: `${definition.code.toLowerCase()}-${Date.now()}.${picture.format}`,
            height: picture.height,
            mimeType: `image/${picture.format === 'jpg' ? 'jpeg' : 'png'}`,
            type: 'image',
            uri: picture.uri,
            width: picture.width,
          };
          setCaptured(asset);
          upload.mutate({
            definition,
            asset: {
              mimeType: asset.mimeType ?? 'image/jpeg',
              name: asset.fileName ?? `${definition.code.toLowerCase()}-${Date.now()}.jpg`,
              uri: asset.uri,
            },
          });
        }}
        quality={0.9}
        visible={cameraVisible}
      />
      <Card style={[styles.documentCard, added && styles.documentCardAdded]}>
        <View style={styles.documentCardHeading}>
          <Text accessibilityRole="header" style={styles.documentTitle}>
            {definition.name}
          </Text>
          <StatusBadge label={added ? 'Added' : 'Not added'} tone={added ? 'success' : 'warning'} />
        </View>
        <Text style={styles.documentGuidance}>{documentGuidance(definition.code)}</Text>
        {showRequirementLabel && (
          <Text style={styles.documentRequirement}>
            {definition.required ? 'Required' : 'Optional'}
          </Text>
        )}
        {added ? (
          <View style={styles.documentAddedRow}>
            {captured?.uri ? (
              <Image
                accessibilityLabel={`${definition.name} camera preview`}
                source={{ uri: captured.uri }}
                style={styles.documentThumbnail}
              />
            ) : fileAssetId ? (
              <AuthorizedDocumentPreview compact fileAssetId={fileAssetId} name={definition.name} />
            ) : null}
            <Pressable
              accessibilityLabel={`Retake ${definition.name.toLocaleLowerCase()}`}
              accessibilityRole="button"
              disabled={upload.isPending}
              onPress={() => void capture()}
              style={styles.documentTextAction}
            >
              <Icon color={colors.primary} name="camera-outline" size={18} />
              <Text style={styles.documentTextActionLabel}>
                {upload.isPending ? 'Uploading…' : 'Retake'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.documentCaptureAction}>
            <Button
              compact
              disabled={upload.isPending}
              icon="camera-outline"
              label={upload.isPending ? 'Uploading…' : 'Capture'}
              onPress={() => void capture()}
              variant="secondary"
            />
          </View>
        )}
      </Card>
    </>
  );
}

export function AuthorizedDocumentPreview({
  compact = false,
  fallback,
  fileAssetId,
  name,
  style,
}: {
  readonly compact?: boolean;
  readonly fallback?: ReactNode;
  readonly fileAssetId: string;
  readonly name: string;
  readonly style?: StyleProp<ImageStyle>;
}) {
  const grant = useQuery({
    queryKey: ['renter-document-preview', fileAssetId],
    queryFn: () =>
      apiClient.request<{ readonly contentPath: string; readonly expiresAt: string }>(
        `/files/${fileAssetId}/access-grants`,
        { method: 'POST' },
      ),
    refetchInterval: 4 * 60 * 1000,
    staleTime: 3 * 60 * 1000,
  });
  if (!grant.data && fallback) return fallback;
  if (!grant.data)
    return (
      <Text style={styles.note}>
        {grant.isError
          ? 'Preview unavailable. Tap Retake to replace it.'
          : 'Loading secure preview…'}
      </Text>
    );
  return (
    <Image
      accessibilityLabel={`${name} secure preview`}
      onError={() => void grant.refetch()}
      source={{ uri: apiClient.assetUrl(grant.data.contentPath) }}
      style={[compact ? styles.documentThumbnail : styles.documentPreview, style]}
    />
  );
}

function documentGuidance(code: string): string {
  if (code.includes('FRONT')) return 'Keep all edges and text visible.';
  if (code.includes('BACK')) return 'Avoid glare and blur.';
  if (code.includes('ADDRESS')) return 'Capture the full page in even lighting.';
  return 'Capture the full document clearly.';
}

function documentCaptureGuide(code: string) {
  if (code === 'PROOF_OF_ADDRESS')
    return {
      instructions: [
        'Fit the document inside the frame.',
        'Make sure the text is clear and readable.',
      ],
      title: 'Proof of residential address',
      type: 'DOCUMENT' as const,
    };
  const title =
    code === 'DRIVER_LICENSE_FRONT'
      ? "Driver's license — Front"
      : code === 'DRIVER_LICENSE_BACK'
        ? "Driver's license — Back"
        : 'Government-issued ID';
  return {
    instructions: [
      'Fit the entire ID inside the frame.',
      'Avoid glare and keep all corners visible.',
    ],
    title,
    type: 'ID_CARD' as const,
  };
}

function IdentityPhotosStage({
  captured,
  definitions,
  documents,
  upload,
  onBack,
  onCapture,
  onContinue,
  showNavigation,
}: {
  readonly captured: Partial<
    Record<'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE', ImagePicker.ImagePickerAsset>
  >;
  readonly definitions: RenterVerificationSnapshot['definitions'];
  readonly documents: ReadonlyMap<
    string | undefined,
    RenterVerificationSnapshot['verifications'][number]['documents'][number]
  >;
  readonly upload: ReturnType<
    typeof useMutation<
      unknown,
      Error,
      {
        definition: RenterVerificationSnapshot['definitions'][number];
        asset: { uri: string; name: string; mimeType: string };
      }
    >
  >;
  readonly onBack: () => void;
  readonly onCapture: (
    code: 'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE',
    asset: ImagePicker.ImagePickerAsset,
  ) => void;
  readonly onContinue: () => void;
  readonly showNavigation: boolean;
}) {
  const [activeCapture, setActiveCapture] = useState<
    'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE' | null
  >(null);
  const activeDefinition = definitions.find(({ code }) => code === activeCapture);
  const acceptAsset = (asset: ImagePicker.ImagePickerAsset) => {
    if (activeCapture) onCapture(activeCapture, asset);
    if (activeDefinition) {
      upload.mutate({
        definition: activeDefinition,
        asset: {
          mimeType: asset.mimeType ?? 'image/jpeg',
          name: asset.fileName ?? `${activeDefinition.code.toLowerCase()}-${Date.now()}.jpg`,
          uri: asset.uri,
        },
      });
    }
  };
  const capture = async (code: 'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE') => {
    if (!(await ensureCameraPermission())) return;
    setActiveCapture(code);
  };
  const addedCount = (['PROFILE_PHOTO', 'SELFIE_WITH_LICENSE'] as const).filter(
    (code) => captured[code] || documents.get(code),
  ).length;
  return (
    <>
      <NativeCameraCapture
        captureLabel={activeCapture === 'PROFILE_PHOTO' ? 'Take profile photo' : 'Take photo'}
        facing="front"
        guide={
          activeCapture === 'PROFILE_PHOTO'
            ? {
                instructions: [
                  'Center your face inside the frame.',
                  'Look straight ahead and use good lighting.',
                ],
                title: 'Profile photo',
                type: 'PROFILE_PHOTO',
              }
            : {
                instructions: [
                  "Center your face in the oval and hold your driver's license inside the box.",
                  'Keep both fully visible and avoid glare.',
                ],
                title: "Selfie with driver's license",
                type: 'SELFIE_WITH_ID',
              }
        }
        onCancel={() => setActiveCapture(null)}
        onCapture={(picture) => {
          setActiveCapture(null);
          acceptAsset({
            fileName: `${activeCapture?.toLowerCase() ?? 'identity-photo'}-${Date.now()}.${picture.format}`,
            height: picture.height,
            mimeType: `image/${picture.format === 'jpg' ? 'jpeg' : 'png'}`,
            type: 'image',
            uri: picture.uri,
            width: picture.width,
          });
        }}
        visible={Boolean(activeCapture)}
      />
      <View style={styles.identityPhotoHeader}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Identity photos
        </Text>
        <Text style={styles.note}>{addedCount} of 2 photos added</Text>
      </View>
      <IdentityPhotoCard
        captured={captured.PROFILE_PHOTO}
        code="PROFILE_PHOTO"
        document={documents.get('PROFILE_PHOTO')}
        helper="This photo will appear on your renter profile and will also be used for identity review."
        guidance={[
          'Face the camera in good lighting',
          'Remove sunglasses or anything covering your face',
        ]}
        title="Profile photo"
        uploadPending={upload.isPending}
        onCapture={capture}
      />
      <IdentityPhotoCard
        captured={captured.SELFIE_WITH_LICENSE}
        code="SELFIE_WITH_LICENSE"
        document={documents.get('SELFIE_WITH_LICENSE')}
        helper="Private verification evidence only. This photo will never be used as your profile photo."
        guidance={[
          "Hold your driver's license beside your face so both are clearly visible",
          'Keep your face and license edges visible and avoid glare',
        ]}
        title="Selfie with driver's license"
        uploadPending={upload.isPending}
        onCapture={capture}
      />
      <Text style={styles.selfieReviewNote}>
        These photos are manually reviewed and do not prove certified liveness.
      </Text>
      {showNavigation && (
        <Card style={styles.selfieCard}>
          <NavigationButtons busy={upload.isPending} onBack={onBack} onNext={onContinue} />
        </Card>
      )}
    </>
  );
}

function IdentityPhotoCard({
  captured,
  code,
  document,
  guidance,
  helper,
  onCapture,
  title,
  uploadPending,
}: {
  readonly captured: ImagePicker.ImagePickerAsset | undefined;
  readonly code: 'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE';
  readonly document:
    RenterVerificationSnapshot['verifications'][number]['documents'][number] | undefined;
  readonly guidance: readonly string[];
  readonly helper: string;
  readonly onCapture: (code: 'PROFILE_PHOTO' | 'SELFIE_WITH_LICENSE') => Promise<void>;
  readonly title: string;
  readonly uploadPending: boolean;
}) {
  const added = Boolean(captured || document);
  return (
    <Card style={styles.selfieCard}>
      <View style={styles.selfieHeading}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {title}
        </Text>
        <StatusBadge label={added ? 'Added' : 'Not added'} tone={added ? 'success' : 'warning'} />
      </View>
      <Text style={styles.selfieCameraNote}>{helper}</Text>
      <View style={styles.selfieGuidance}>
        {guidance.map((item) => (
          <Text key={item} style={styles.documentGuidance}>
            • {item}
          </Text>
        ))}
      </View>
      <Text style={styles.selfieReviewNote}>Camera only. Gallery uploads aren’t allowed.</Text>
      {added ? (
        <View style={styles.documentAddedRow}>
          {captured?.uri ? (
            <Image
              accessibilityLabel={`${title} preview`}
              source={{ uri: captured.uri }}
              style={styles.selfiePreview}
            />
          ) : document?.fileAsset.id ? (
            <AuthorizedDocumentPreview
              compact
              fileAssetId={document.fileAsset.id}
              name={title}
              style={styles.selfiePreview}
            />
          ) : null}
          <Pressable
            accessibilityLabel={`Retake ${title.toLowerCase()}`}
            accessibilityRole="button"
            disabled={uploadPending}
            onPress={() => void onCapture(code)}
            style={styles.documentTextAction}
          >
            <Icon color={colors.primary} name="camera-outline" size={18} />
            <Text style={styles.documentTextActionLabel}>
              {uploadPending ? 'Uploading…' : 'Retake'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.selfieCaptureAction}>
          <Button
            compact
            disabled={uploadPending}
            icon="camera-outline"
            label={uploadPending ? 'Uploading…' : 'Take photo'}
            onPress={() => void onCapture(code)}
            variant="secondary"
          />
        </View>
      )}
    </Card>
  );
}

function NavigationButtons({
  busy,
  hidden = false,
  nextLabel = 'Continue',
  onBack,
  onNext,
}: {
  readonly busy: boolean;
  readonly hidden?: boolean;
  readonly nextLabel?: string;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  if (hidden) return null;
  return (
    <View style={styles.buttonRow}>
      <Button label="Back" onPress={onBack} variant="secondary" />
      <Button disabled={busy} label={nextLabel} onPress={onNext} />
    </View>
  );
}

function ReviewSummarySection({
  children,
  editLabel,
  onEdit,
  title,
}: {
  readonly children: ReactNode;
  readonly editLabel?: string;
  readonly onEdit?: () => void;
  readonly title: string;
}) {
  return (
    <Card style={styles.reviewSummaryCard}>
      <View style={styles.reviewSummaryHeading}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {title}
        </Text>
        {editLabel && onEdit && (
          <Pressable
            accessibilityLabel={editLabel}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onEdit}
            style={styles.reviewEditAction}
          >
            <Text style={styles.reviewEditLabel}>Edit</Text>
          </Pressable>
        )}
      </View>
      {children}
    </Card>
  );
}

function ReviewStatusRow({
  complete,
  label,
  value,
}: {
  readonly complete: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.reviewStatusRow}>
      <View style={styles.flex}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewBody}>{value}</Text>
      </View>
      <StatusBadge
        label={complete ? 'Verified' : 'Not verified'}
        tone={complete ? 'success' : 'warning'}
      />
    </View>
  );
}

function ReviewCompletionRow({
  complete,
  label,
}: {
  readonly complete: boolean;
  readonly label: string;
}) {
  return (
    <View
      accessibilityLabel={`${label}, ${complete ? 'Added' : 'Missing'}`}
      style={styles.reviewCompletionRow}
    >
      <Icon
        color={complete ? colors.primary : colors.warning}
        name={complete ? 'checkmark-circle' : 'alert-circle-outline'}
        size={18}
      />
      <Text style={styles.reviewBody}>
        {label} · {complete ? 'Added' : 'Missing'}
      </Text>
    </View>
  );
}

function ReviewWarning({ children }: { readonly children: ReactNode }) {
  return (
    <View accessibilityRole="alert" style={styles.reviewWarning}>
      <Icon color={colors.warning} name="alert-circle-outline" size={17} />
      <Text style={styles.reviewWarningText}>{children}</Text>
    </View>
  );
}

function formatReviewDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date;
}
function relationshipLabel(code: string) {
  return relationships.find(([value]) => value === code)?.[1] ?? '';
}
function scopeLabel(
  form: { addressScopeCode: string; province: string },
  options?: readonly AreaOption[],
) {
  return form.province || options?.find(({ code }) => code === form.addressScopeCode)?.name || '';
}
function verificationLabel(status: string) {
  return (
    (
      {
        APPROVED: 'Verified renter',
        MORE_INFORMATION_REQUIRED: 'More information required',
        REJECTED: 'Verification rejected',
        SUBMITTED: 'Verification pending',
        SUSPENDED: 'Verification suspended',
        UNDER_REVIEW: 'Under review',
      } as Record<string, string>
    )[status] ?? 'Verification incomplete'
  );
}

const styles = StyleSheet.create({
  addressFields: { gap: spacing.sm },
  addressFormCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: { color: colors.subtleText, lineHeight: 21 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  documentCapture: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  documentAddedRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  documentCaptureAction: { alignSelf: 'flex-start', minWidth: 132 },
  documentCard: { gap: spacing.xs, padding: spacing.md },
  documentCardAdded: { paddingVertical: spacing.xs },
  documentCardHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  documentGuidance: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  documentPreview: {
    aspectRatio: 1.58,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    width: '100%',
  },
  documentRequirement: {
    color: colors.subtleText,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  documentStage: { gap: spacing.xs },
  documentSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  documentSummaryText: { color: colors.subtleText, fontSize: 13, fontWeight: '700' },
  documentTextAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  documentTextActionLabel: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  documentThumbnail: {
    aspectRatio: 1.58,
    backgroundColor: colors.muted,
    borderRadius: radius.sm,
    height: 56,
  },
  documentTitle: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  driverFields: { gap: spacing.xs },
  driverFormCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  error: { color: colors.danger, fontWeight: '700', lineHeight: 20 },
  flex: { flex: 1 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  note: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionDivider: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionSelected: { backgroundColor: colors.primarySoft },
  optionText: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  personalFields: { gap: spacing.md },
  personalFormCard: { padding: spacing.md },
  placeholder: { color: colors.subtleText, flex: 1, fontSize: 14 },
  privacyHelper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  privacyHelperText: { color: colors.subtleText, flex: 1, fontSize: 12, lineHeight: 18 },
  progressCard: { gap: spacing.xs },
  progressDot: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    flex: 1,
    height: 6,
    minWidth: 20,
  },
  progressDotActive: { backgroundColor: colors.primary },
  progressDots: { flexDirection: 'row', gap: spacing.xxs },
  progressText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  reviewBody: { color: colors.subtleText, fontSize: 14, lineHeight: 20 },
  reviewCompletionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 28,
  },
  reviewEditAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.xs,
  },
  reviewEditLabel: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  reviewLabel: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  reviewPrimary: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  reviewSections: { gap: spacing.sm },
  reviewStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  reviewSummaryCard: { gap: spacing.xs, padding: spacing.md },
  reviewSummaryHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  reviewWarning: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reviewWarningText: { color: colors.warning, flex: 1, fontSize: 13, lineHeight: 18 },
  savedLicense: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  savedLicenseDetail: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  savedLicenseTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  searchInput: { color: colors.ink, flex: 1, fontSize: 15 },
  sectionCard: { gap: spacing.md },
  sectionHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  sectionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' },
  selectButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  selectButtonDisabled: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
  },
  selectField: { gap: spacing.xs },
  selectValue: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '700' },
  selectorBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  selectorHeader: { gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  selectorList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  selectorListContent: { flexGrow: 0 },
  selectorModalRoot: { flex: 1, justifyContent: 'flex-end' },
  selectorSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  selectorTitle: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  selfieCameraNote: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  selfieCaptureAction: { alignSelf: 'flex-start', minWidth: 136 },
  selfieCard: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selfieGuidance: { gap: spacing.xxs },
  selfieHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  identityPhotoHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  selfiePreview: {
    aspectRatio: 1,
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    height: 88,
    width: 88,
  },
  selfieReviewNote: { color: colors.subtleText, fontSize: 11, lineHeight: 15 },
  warningCard: { backgroundColor: colors.warningSoft },
});
