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
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateOnlyField } from '../../ui/DateOnlyField';
import { ensureCameraPermission } from '../../ui/camera-permission';
import { Button, Card, Field, Icon, Screen, StateView, StatusBadge } from '../../ui/primitives';
import { SecureCameraPhotoSlot, securePhotoPreviewStyle } from '../../ui/SecureCameraPhotoSlot';
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

const stages = [
  'Personal information',
  'Residential address',
  'Driver information',
  'Emergency contact',
  'Identity documents',
  'Selfie',
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
  onboardingNavigation,
  onBackBeforeFirstStep,
  progressOffset = 0,
  progressTotal,
  snapshot,
}: {
  readonly onboardingNavigation?: {
    readonly onBack: () => void;
    readonly onNext: () => void;
    readonly step: number;
  };
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
  const [editingApproved, setEditingApproved] = useState(false);
  const [barangaySearch, setBarangaySearch] = useState('');
  const [capturedSelfie, setCapturedSelfie] = useState<ImagePicker.ImagePickerAsset | null>(null);
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
  return (
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

          {step === 0 && (
            <SectionCard
              icon="person-outline"
              title="Personal information"
              helper="Use the name and birth date shown on your government-issued identity document."
            >
              <Field
                label="Legal first name *"
                value={form.legalFirstName}
                onChangeText={(legalFirstName) => setForm({ ...form, legalFirstName })}
              />
              <Field
                label="Legal middle name"
                value={form.middleName}
                onChangeText={(middleName) => setForm({ ...form, middleName })}
              />
              <Field
                label="Legal last name *"
                value={form.legalLastName}
                onChangeText={(legalLastName) => setForm({ ...form, legalLastName })}
              />
              <DateOnlyField
                label="Date of birth *"
                maximumDate={new Date()}
                value={form.dateOfBirth}
                onChange={(dateOfBirth) => setForm({ ...form, dateOfBirth })}
              />
              <NavigationButtons
                busy={save.isPending}
                onBack={() => back(0)}
                onNext={advancePersonal}
              />
              {step === 0 && formError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {formError}
                </Text>
              )}
            </SectionCard>
          )}

          {step === 1 && (
            <SectionCard
              icon="location-outline"
              title="Residential address"
              helper={`Searchable official PSA PSGC reference${currentDataset ? ` · ${currentDataset.replaceAll('_', ' ')}` : ''}. Address line and postal code remain renter-entered.`}
            >
              <Field
                label="House / building / street *"
                multiline
                value={form.addressLine1}
                onChangeText={(addressLine1) => setForm({ ...form, addressLine1 })}
              />
              <ReferenceSelect
                label="Region *"
                loading={regions.isPending}
                options={regions.data?.items ?? []}
                selectedLabel={form.region}
                onSelect={(area) => {
                  setForm({ ...form, ...regionSelection(area) });
                }}
              />
              <ReferenceSelect
                disabled={!form.regionCode}
                label="Province / geographic area *"
                loading={scopes.isPending}
                options={scopes.data?.items ?? []}
                selectedLabel={scopeLabel(form, scopes.data?.items)}
                onSelect={(area) => setForm({ ...form, ...scopeSelection(area) })}
              />
              <ReferenceSelect
                disabled={!form.addressScopeCode}
                label="City / municipality *"
                loading={localities.isPending}
                options={localities.data?.items ?? []}
                selectedLabel={form.cityMunicipality}
                onSelect={(area) => setForm({ ...form, ...localitySelection(area) })}
              />
              <ReferenceSelect
                disabled={!form.cityMunicipalityCode}
                label="Barangay *"
                loading={barangays.isPending}
                onSearch={setBarangaySearch}
                options={barangays.data?.items ?? []}
                selectedLabel={form.barangay}
                onSelect={(area) =>
                  setForm({ ...form, barangay: area.name, barangayCode: area.code })
                }
              />
              <Field
                keyboardType="number-pad"
                label="Postal code *"
                value={form.postalCode}
                onChangeText={(postalCode) => setForm({ ...form, postalCode })}
              />
              <NavigationButtons
                busy={save.isPending}
                onBack={() => back(0)}
                onNext={advanceAddress}
              />
              {step === 1 && formError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {formError}
                </Text>
              )}
            </SectionCard>
          )}

          {step === 2 && (
            <SectionCard
              icon="card-outline"
              title="Driver information"
              helper="The full license number is normalized, hashed, and never returned by the API."
            >
              <Field
                label={
                  profile?.driverLicenseLastFour
                    ? 'New license number (leave blank to keep current)'
                    : 'Driver’s license number *'
                }
                value={form.driverLicenseNumber}
                onChangeText={(driverLicenseNumber) => setForm({ ...form, driverLicenseNumber })}
                placeholder={
                  profile?.driverLicenseLastFour
                    ? `Current ends in ${profile.driverLicenseLastFour}`
                    : 'Letters and numbers shown on license'
                }
              />
              <DateOnlyField
                label="Expiration date *"
                minimumDate={tomorrow()}
                value={form.driverLicenseExpiry}
                onChange={(driverLicenseExpiry) => setForm({ ...form, driverLicenseExpiry })}
              />
              <Field
                label="License classification *"
                value={form.driverLicenseClass}
                onChangeText={(driverLicenseClass) => setForm({ ...form, driverLicenseClass })}
                placeholder="As printed on the license"
              />
              <Field
                label="Restrictions"
                value={form.driverLicenseRestrictions}
                onChangeText={(driverLicenseRestrictions) =>
                  setForm({ ...form, driverLicenseRestrictions })
                }
                placeholder="If applicable"
              />
              <NavigationButtons
                busy={save.isPending}
                onBack={() => back(1)}
                onNext={advanceDriver}
              />
              {step === 2 && formError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {formError}
                </Text>
              )}
            </SectionCard>
          )}

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
              definitions={snapshot.definitions.filter(({ code }) => code !== 'SELFIE')}
              documents={documents}
              upload={upload}
              onBack={() => back(3)}
              onContinue={() =>
                onboardingNavigation ? onboardingNavigation.onNext() : setInternalStep(5)
              }
            />
          )}

          {step === 5 && (
            <SelfieStage
              captured={capturedSelfie}
              definition={snapshot.definitions.find(({ code }) => code === 'SELFIE')}
              document={documents.get('SELFIE')}
              upload={upload}
              onBack={() => back(4)}
              onCapture={setCapturedSelfie}
              onContinue={() =>
                onboardingNavigation ? onboardingNavigation.onNext() : setInternalStep(6)
              }
            />
          )}

          {step === 6 && (
            <SectionCard
              icon="checkmark-done-outline"
              title="Review & submit"
              helper="Nothing is submitted automatically. Confirm the information below before sending it to authorized verification staff."
            >
              <ReviewGroup title="Personal information">
                <ReviewRow label="First name" value={form.legalFirstName} />
                <ReviewRow label="Middle name" value={form.middleName || 'Not provided'} />
                <ReviewRow label="Last name" value={form.legalLastName} />
                <ReviewRow label="Display name" value={profile?.displayName ?? 'Not set'} />
                <ReviewRow label="Date of birth" value={form.dateOfBirth} />
              </ReviewGroup>
              <ReviewGroup title="Address">
                <ReviewRow label="Street / address line" value={form.addressLine1} />
                <ReviewRow label="Barangay" value={form.barangay} />
                <ReviewRow label="City / municipality" value={form.cityMunicipality} />
                <ReviewRow label="Province" value={form.province || 'Not applicable'} />
                <ReviewRow label="Region" value={form.region} />
                <ReviewRow label="Postal code" value={form.postalCode} />
              </ReviewGroup>
              <ReviewGroup title="Contact">
                <ReviewRow label="Email" value={snapshot.email ?? 'Not provided'} />
                <ReviewRow label="Mobile" value={snapshot.mobileNumber ?? 'Not provided'} />
              </ReviewGroup>
              <ReviewGroup title="Driver information">
                <ReviewRow
                  label="License number"
                  value={
                    profile?.driverLicenseLastFour
                      ? `•••• ${profile.driverLicenseLastFour}`
                      : form.driverLicenseNumber
                        ? `•••• ${form.driverLicenseNumber.replaceAll(/[^a-zA-Z0-9]/g, '').slice(-4)}`
                        : 'Not provided'
                  }
                />
                <ReviewRow label="Expiration" value={form.driverLicenseExpiry} />
                <ReviewRow label="Class" value={form.driverLicenseClass} />
                <ReviewRow label="Restrictions" value={form.driverLicenseRestrictions || 'None'} />
              </ReviewGroup>
              <ReviewGroup title="Emergency contact">
                <ReviewRow label="Name" value={form.emergencyContactName || 'Not provided'} />
                <ReviewRow
                  label="Relationship"
                  value={
                    form.emergencyContactName
                      ? relationshipLabel(form.emergencyContactRelation)
                      : 'Not provided'
                  }
                />
                <ReviewRow label="Mobile" value={form.emergencyContactMobile || 'Not provided'} />
              </ReviewGroup>
              <ReviewGroup title="Document completion">
                {snapshot.definitions.map((definition) => (
                  <ReviewRow
                    key={definition.code}
                    label={definition.name}
                    value={
                      documents.has(definition.code)
                        ? 'Completed'
                        : definition.required
                          ? 'Required'
                          : 'Optional'
                    }
                  />
                ))}
              </ReviewGroup>
              <Text style={styles.note}>
                A camera selfie is evidence for manual review. It is not certified liveness
                verification.
              </Text>
              <NavigationButtons
                busy={submit.isPending}
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
            </SectionCard>
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
  label,
  loading = false,
  onSearch,
  onSelect,
  options,
  selectedLabel,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly loading?: boolean;
  readonly onSearch?: (query: string) => void;
  readonly onSelect: (option: AreaOption) => void;
  readonly options: readonly AreaOption[];
  readonly selectedLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = onSearch
    ? options
    : options.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <View style={styles.selectField}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.selectButton, disabled && styles.disabled]}
      >
        <Text numberOfLines={2} style={selectedLabel ? styles.selectValue : styles.placeholder}>
          {selectedLabel || (disabled ? 'Select the previous field first' : 'Search and select')}
        </Text>
        <Icon color={colors.primary} name="chevron-down" size={19} />
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
        visible={open}
      >
        <Screen scroll={false} eyebrow="Searchable selector" title={label}>
          <View style={styles.searchBox}>
            <Icon color={colors.subtleText} name="search" size={19} />
            <TextInput
              autoFocus={false}
              onChangeText={(value) => {
                setQuery(value);
                onSearch?.(value);
              }}
              placeholder="Type to search"
              placeholderTextColor={colors.placeholder}
              style={styles.searchInput}
              value={query}
            />
          </View>
          {loading ? (
            <StateView loading title="Loading options…" />
          ) : (
            <FlatList
              data={visible}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.code}
              ListEmptyComponent={
                <StateView
                  icon="search-outline"
                  title="No matching options"
                  message="Check the spelling or choose the previous address level again."
                />
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    onSelect(item);
                    setQuery('');
                    onSearch?.('');
                    setOpen(false);
                  }}
                  style={styles.option}
                >
                  <Text style={styles.optionText}>{item.name}</Text>
                  <Icon color={colors.primary} name="chevron-forward" size={18} />
                </Pressable>
              )}
            />
          )}
          <Button
            label="Cancel"
            onPress={() => {
              Keyboard.dismiss();
              setOpen(false);
            }}
            variant="ghost"
          />
        </Screen>
      </Modal>
    </View>
  );
}

function DocumentStage({
  definitions,
  documents,
  upload,
  onBack,
  onContinue,
}: {
  readonly definitions: RenterVerificationSnapshot['definitions'];
  readonly documents: Map<
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
  readonly onContinue: () => void;
}) {
  return (
    <SectionCard
      icon="documents-outline"
      title="Identity documents"
      helper="Capture each document now with the rear camera. Images remain private and sensitive; owners cannot access them."
    >
      {definitions.map((definition) => {
        const document = documents.get(definition.code);
        return (
          <DocumentCaptureRow
            fileAssetId={document?.fileAsset.id}
            definition={definition}
            documentName={document?.fileAsset.originalName}
            key={definition.code}
            upload={upload}
          />
        );
      })}
      <NavigationButtons busy={upload.isPending} onBack={onBack} onNext={onContinue} />
    </SectionCard>
  );
}

function DocumentCaptureRow({
  definition,
  documentName,
  fileAssetId,
  upload,
}: {
  readonly definition: RenterVerificationSnapshot['definitions'][number];
  readonly documentName?: string | undefined;
  readonly fileAssetId?: string | undefined;
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
  const capture = async () => {
    if (!(await ensureCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
      mediaTypes: ['images'],
      quality: 0.9,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) {
      setCaptured(asset);
      upload.mutate({
        definition,
        asset: {
          mimeType: asset.mimeType ?? 'image/jpeg',
          name: asset.fileName ?? `${definition.code.toLowerCase()}-${Date.now()}.jpg`,
          uri: asset.uri,
        },
      });
    }
  };
  return (
    <SecureCameraPhotoSlot
      busy={upload.isPending}
      guidance={documentGuidance(definition.code)}
      name={definition.name}
      onCapture={() => void capture()}
      persistedPreview={
        fileAssetId ? (
          <AuthorizedDocumentPreview fileAssetId={fileAssetId} name={definition.name} />
        ) : undefined
      }
      previewUri={captured?.uri}
      required={definition.required}
      uploaded={Boolean(documentName)}
    />
  );
}

function AuthorizedDocumentPreview({
  fileAssetId,
  name,
}: {
  readonly fileAssetId: string;
  readonly name: string;
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
      style={securePhotoPreviewStyle}
    />
  );
}

function documentGuidance(code: string): string {
  if (code.includes('FRONT'))
    return 'Place the front inside the frame; keep all edges and text visible.';
  if (code.includes('BACK')) return 'Place the back inside the frame; avoid glare and blur.';
  if (code.includes('ADDRESS')) return 'Capture the full proof-of-address page in even lighting.';
  return 'Keep the entire government document inside the frame and make text readable.';
}

function SelfieStage({
  captured,
  definition,
  document,
  upload,
  onBack,
  onCapture,
  onContinue,
}: {
  readonly captured: ImagePicker.ImagePickerAsset | null;
  readonly definition: RenterVerificationSnapshot['definitions'][number] | undefined;
  readonly document:
    RenterVerificationSnapshot['verifications'][number]['documents'][number] | undefined;
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
  readonly onCapture: (asset: ImagePicker.ImagePickerAsset | null) => void;
  readonly onContinue: () => void;
}) {
  const [nativeCameraVisible, setNativeCameraVisible] = useState(false);
  const acceptAsset = (asset: ImagePicker.ImagePickerAsset) => {
    onCapture(asset);
    if (definition) {
      upload.mutate({
        definition,
        asset: {
          mimeType: asset.mimeType ?? 'image/jpeg',
          name: asset.fileName ?? `selfie-${Date.now()}.jpg`,
          uri: asset.uri,
        },
      });
    }
  };
  const capture = async () => {
    if (!(await ensureCameraPermission())) return;
    if (Platform.OS === 'android') {
      setNativeCameraVisible(true);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      cameraType: ImagePicker.CameraType.front,
      mediaTypes: ['images'],
      quality: 0.85,
    });
    const asset = result.canceled ? undefined : result.assets[0];
    if (asset) acceptAsset(asset);
  };
  return (
    <>
      <NativeCameraCapture
        facing="front"
        onCancel={() => setNativeCameraVisible(false)}
        onCapture={(picture) => {
          setNativeCameraVisible(false);
          acceptAsset({
            fileName: `selfie-${Date.now()}.${picture.format}`,
            height: picture.height,
            mimeType: `image/${picture.format === 'jpg' ? 'jpeg' : 'png'}`,
            type: 'image',
            uri: picture.uri,
            width: picture.width,
          });
        }}
        visible={nativeCameraVisible}
      />
      <SectionCard
        icon="camera-outline"
        title="Selfie verification"
        helper="Use the front camera in good lighting. Center your face, remove sunglasses, and capture a new photo."
      >
        <Card style={styles.guidanceCard}>
          <Text style={styles.cardTitle}>Camera-only evidence</Text>
          <Text style={styles.note}>
            No gallery or file-picker action is available for the selfie. A submitted selfie is
            manually reviewed and does not prove certified liveness.
          </Text>
        </Card>
        {captured ? (
          <>
            <Image
              accessibilityLabel="Captured selfie preview"
              source={{ uri: captured.uri }}
              style={styles.selfiePreview}
            />
            <View style={styles.buttonRow}>
              <Button label="Retake" onPress={() => void capture()} variant="secondary" />
              {upload.isPending && <Text style={styles.note}>Uploading securely…</Text>}
            </View>
          </>
        ) : (
          <Button
            icon="camera-outline"
            label={document ? 'Retake selfie' : 'Open camera'}
            onPress={() => void capture()}
          />
        )}
        {document && <Text style={styles.success}>✓ Selfie submitted for manual review</Text>}
        <NavigationButtons busy={upload.isPending} onBack={onBack} onNext={onContinue} />
      </SectionCard>
    </>
  );
}

function NavigationButtons({
  busy,
  nextLabel = 'Continue',
  onBack,
  onNext,
}: {
  readonly busy: boolean;
  readonly nextLabel?: string;
  readonly onBack: () => void;
  readonly onNext: () => void;
}) {
  return (
    <View style={styles.buttonRow}>
      <Button label="Back" onPress={onBack} variant="secondary" />
      <Button disabled={busy} label={nextLabel} onPress={onNext} />
    </View>
  );
}

function ReviewRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.reviewRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.body}>{value}</Text>
    </View>
  );
}

function ReviewGroup({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.reviewGroup}>
      <Text style={styles.reviewGroupTitle}>{title}</Text>
      {children}
    </View>
  );
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
  body: { color: colors.subtleText, lineHeight: 21 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  documentCapture: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  documentPreview: {
    aspectRatio: 1.58,
    backgroundColor: colors.muted,
    borderRadius: radius.md,
    width: '100%',
  },
  error: { color: colors.danger, fontWeight: '700', lineHeight: 20 },
  flex: { flex: 1 },
  guidanceCard: { backgroundColor: colors.primarySoft, gap: spacing.xs },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  note: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  option: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  optionText: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '700' },
  placeholder: { color: colors.subtleText, flex: 1, fontSize: 14 },
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
  reviewRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xxs,
    paddingVertical: spacing.sm,
  },
  reviewGroup: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
  },
  reviewGroupTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    paddingTop: spacing.md,
  },
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
  selectField: { gap: spacing.xs },
  selectValue: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '700' },
  selfiePreview: {
    aspectRatio: 0.85,
    backgroundColor: colors.muted,
    borderRadius: radius.lg,
    width: '100%',
  },
  success: { color: colors.primary, fontWeight: '800' },
  warningCard: { backgroundColor: colors.warningSoft },
});
