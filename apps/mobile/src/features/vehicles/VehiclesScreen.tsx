import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SecurityDepositPolicyCatalog } from '@carrental/api-contracts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import { ensureCameraPermission } from '../../ui/camera-permission';
import { domainLabel, money, vehicleStatusLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { SearchableReferenceSelector } from '../../ui/SearchableReferenceSelector';
import { LocationPicker } from '../../location/LocationPicker';
import { locationLabel, type CarShareLocation } from '../../location/booking-location-provider';
import { SecureCameraPhotoSlot, securePhotoPreviewStyle } from '../../ui/SecureCameraPhotoSlot';
import { DepositTierSelector } from './DepositTierSelector';
import {
  BackControl,
  Button,
  formKeyboardDismissMode,
  Icon,
  StateView,
  StatusBadge,
  useKeyboardAwareBottomPadding,
} from '../../ui/primitives';

interface Reference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly required?: boolean;
}
interface SafeFile {
  readonly id: string;
  readonly originalName: string;
  readonly contentGrant?: { readonly contentPath: string } | null;
}
interface VehiclePhoto {
  readonly id: string;
  readonly perspective: string;
  readonly displayOrder: number;
  readonly isCover: boolean;
  readonly fileAsset: SafeFile;
}
interface VehicleDocument {
  readonly id: string;
  readonly definitionId: string;
  readonly definition: Reference;
  readonly replacedAt: string | null;
  readonly fileAsset: SafeFile;
}
interface Policy {
  readonly version: number;
  readonly dailyRateMinor: number;
  readonly currency: string;
  readonly securityDeposit: {
    readonly amountMinor: number | null;
    readonly currency: string | null;
    readonly required: boolean;
  };
  readonly securityDepositAmountMinor: number | null;
  readonly securityDepositCurrency: string | null;
  readonly securityDepositRequired: boolean;
  readonly minimumRentalDays: number;
  readonly maximumRentalDays: number;
  readonly mileagePolicy: string;
  readonly includedKilometersPerDay: number | null;
  readonly excessKilometerRateMinor: number | null;
  readonly turnaroundMinutes: number;
  readonly availabilityPolicy: string;
  readonly monday: boolean;
  readonly tuesday: boolean;
  readonly wednesday: boolean;
  readonly thursday: boolean;
  readonly friday: boolean;
  readonly saturday: boolean;
  readonly sunday: boolean;
  readonly fuelReturnPolicy: string | null;
  readonly fuelTolerancePercent: number | null;
  readonly evReturnPolicy: string | null;
  readonly evRequiredPercentage: number | null;
  readonly evTolerancePercent: number | null;
  readonly shortDurationDiscountBps: number | null;
  readonly weeklyDiscountBps: number | null;
  readonly extendedTripDiscountBps: number | null;
  readonly monthlyDiscountBps: number | null;
  readonly supportsRenterPickup: boolean;
  readonly supportsOwnerDelivery: boolean;
  readonly supportsRenterReturn: boolean;
  readonly supportsOwnerCollection: boolean;
  readonly fulfillmentServiceRadiusMeters: number | null;
  readonly deliveryFeeMinor: number | null;
  readonly collectionFeeMinor: number | null;
  readonly fulfillmentMinimumNoticeMinutes: number;
}
interface VehicleBlock {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
}
interface AvailabilityToday {
  readonly state: 'AVAILABLE' | 'BOOKED' | 'OWNER_BLOCKED' | 'MARKETPLACE_UNAVAILABLE';
  readonly blockReason: string | null;
  readonly blockedUntil: string | null;
}
interface Vehicle {
  readonly id: string;
  readonly status: string;
  readonly operationalStatus: string;
  readonly availabilityToday?: AvailabilityToday;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
  readonly variant: string | null;
  readonly transmission: string | null;
  readonly fuelType: string | null;
  readonly seatCount: number | null;
  readonly doorCount: number | null;
  readonly color: string | null;
  readonly plateNumber: string | null;
  readonly description: string | null;
  readonly categoryId: string | null;
  readonly category?: Reference | null;
  readonly powertrain: string | null;
  readonly reviewReason: string | null;
  readonly lastCompletedSection: string | null;
  readonly features: Array<{ readonly featureId: string }>;
  readonly photos: VehiclePhoto[];
  readonly documents: VehicleDocument[];
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly city: string;
    readonly province: string;
    readonly pickupAreaLabel: string | null;
    readonly regionCode: string | null;
    readonly addressScopeCode: string | null;
    readonly provinceCode: string | null;
    readonly cityMunicipalityCode: string | null;
    readonly barangayCode: string | null;
    readonly barangay: string | null;
    readonly addressLine1: string | null;
    readonly landmark: string | null;
  } | null;
  readonly policyVersions: Policy[];
  readonly knownIssues: VehicleKnownIssue[];
}

interface VehicleKnownIssue {
  readonly id: string;
  readonly category: string;
  readonly vehicleArea: string;
  readonly classification: string;
  readonly description: string;
  readonly status: 'ACTIVE' | 'RESOLVED';
  readonly createdAt: string;
  readonly resolvedAt: string | null;
  readonly evidence: readonly { readonly fileAsset: SafeFile }[];
}

const steps = [
  'Details',
  'Features',
  'Photos',
  'Documents',
  'Location',
  'Policies',
  'Review',
] as const;
const transitionalVehicleStatuses = ['DRAFT', 'SUBMITTED', 'AWAITING_REVIEW', 'UNDER_REVIEW'];
const perspectives = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR_DASHBOARD',
  'INTERIOR',
  'DASHBOARD',
  'CARGO',
  'ADDITIONAL',
] as const;

export function VehiclesScreen() {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editStep, setEditStep] = useState<number | undefined>();
  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiClient.request<Vehicle[]>('/owner/vehicles'),
    refetchInterval: (query) =>
      query.state.data?.some((vehicle) => transitionalVehicleStatuses.includes(vehicle.status))
        ? 5_000
        : false,
    refetchOnWindowFocus: true,
  });
  const create = useMutation({
    mutationFn: () => apiClient.request<Vehicle>('/owner/vehicles', { body: '{}', method: 'POST' }),
    onSuccess: (vehicle) => {
      setSelectedId(vehicle.id);
      setEditing(true);
      void client.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
  if (selectedId && !editing)
    return (
      <VehicleDetail
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={(step) => {
          setEditStep(step);
          setEditing(true);
        }}
      />
    );
  if (selectedId)
    return (
      <VehicleEditor
        id={selectedId}
        {...(editStep === undefined ? {} : { initialStep: editStep })}
        onClose={() => {
          setEditing(false);
          setEditStep(undefined);
          void client.invalidateQueries({ queryKey: ['vehicles'] });
        }}
      />
    );
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>OWNER FLEET</Text>
        <Text style={styles.title}>My vehicles</Text>
        <Text style={styles.body}>
          Drafts save on the server, so you can leave and resume at any time.
        </Text>
        <Pressable style={styles.primaryButton} onPress={() => create.mutate()}>
          <Text style={styles.primaryText}>Add vehicle</Text>
        </Pressable>
        {create.error && <Text style={styles.error}>{create.error.message}</Text>}
        {vehicles.isPending && <StateView loading title="Loading your fleet…" />}
        {vehicles.isError && (
          <StateView
            icon="cloud-offline-outline"
            title="Fleet unavailable"
            message={vehicles.error.message}
            actionLabel="Retry"
            onAction={() => void vehicles.refetch()}
          />
        )}
        {vehicles.data?.map((vehicle) => (
          <Pressable
            key={vehicle.id}
            accessibilityLabel={`${vehicle.make ?? ''} ${vehicle.model ?? 'vehicle'}. Marketplace status: ${vehicleStatusLabel(vehicle.status)}. Vehicle availability: ${availabilityTodayLabel(vehicle.availabilityToday)}.`}
            accessibilityRole="button"
            onPress={() => setSelectedId(vehicle.id)}
            style={styles.fleetCard}
          >
            <VehicleImage
              contentPath={vehicle.photos[0]?.fileAsset.contentGrant?.contentPath}
              style={styles.fleetImage}
            />
            <View style={styles.fleetContent}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {vehicle.make && vehicle.model
                  ? `${vehicle.modelYear ?? ''} ${vehicle.make} ${vehicle.model}`.trim()
                  : 'Untitled vehicle draft'}
              </Text>
              <StatusBadge
                label={vehicleStatusLabel(vehicle.status)}
                tone={vehicleTone(vehicle.status)}
              />
              <Text style={styles.body}>{vehicleStatusLabel(vehicle.operationalStatus)}</Text>
              <Text style={styles.availabilityText}>
                {availabilityTodayLabel(vehicle.availabilityToday)}
              </Text>
              {vehicle.category && <Text style={styles.body}>{vehicle.category.name}</Text>}
              {vehicle.location && (
                <Text numberOfLines={1} style={styles.body}>
                  {vehicle.location.city}, {vehicle.location.province}
                </Text>
              )}
              {vehicle.policyVersions[0] && (
                <Text style={styles.rate}>
                  {money(vehicle.policyVersions[0].dailyRateMinor)} / day
                </Text>
              )}
              {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
              <Text style={styles.link}>Manage vehicle →</Text>
            </View>
          </Pressable>
        ))}
        {!vehicles.isPending && !vehicles.isError && vehicles.data?.length === 0 && (
          <StateView
            icon="car-sport-outline"
            title="No vehicles yet"
            message="Add a vehicle to start a draft. You can finish it before owner verification is complete."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VehicleDetail({
  id,
  onClose,
  onEdit,
}: {
  readonly id: string;
  readonly onClose: () => void;
  readonly onEdit: (step?: number) => void;
}) {
  const [managingAvailability, setManagingAvailability] = useState(false);
  const [managingKnownIssues, setManagingKnownIssues] = useState(false);
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(`/owner/vehicles/${id}`),
    refetchInterval: (query) =>
      transitionalVehicleStatuses.includes(query.state.data?.status ?? '') ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
  const operationalStatus = useMutation({
    mutationFn: (status: string) =>
      apiClient.request(`/owner/vehicles/${id}/operational-status`, {
        body: JSON.stringify({ status }),
        method: 'PATCH',
      }),
    onSuccess: () => void vehicle.refetch(),
  });
  if (vehicle.isPending) return <StateView loading title="Loading vehicle…" />;
  if (vehicle.isError || !vehicle.data)
    return <StateView title="Vehicle unavailable" message={vehicle.error?.message} />;
  const value = vehicle.data;
  if (managingAvailability)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.page}>
          <BackControl label="Vehicle detail" onPress={() => setManagingAvailability(false)} />
          <AvailabilityStep id={id} vehicle={value} onSaved={() => void vehicle.refetch()} />
        </ScrollView>
      </SafeAreaView>
    );
  if (managingKnownIssues)
    return (
      <KnownIssuesManager
        id={id}
        onClose={() => {
          setManagingKnownIssues(false);
          void vehicle.refetch();
        }}
      />
    );
  const cover = value.photos.find(({ isCover }) => isCover) ?? value.photos[0];
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page}>
        <BackControl label="Fleet" onPress={onClose} />
        <VehicleImage
          contentPath={cover?.fileAsset.contentGrant?.contentPath}
          style={styles.hero}
        />
        <Text style={styles.title}>
          {value.make} {value.model}
        </Text>
        <Text style={styles.body}>
          {value.modelYear ?? '—'} · {value.category?.name ?? 'Vehicle'} ·{' '}
          {domainLabel(value.fuelType)}
        </Text>
        <StatusBadge label={vehicleStatusLabel(value.status)} tone={vehicleTone(value.status)} />
        <View style={styles.wrap}>
          <Choice label="Edit vehicle" selected={false} onPress={() => onEdit()} />
        </View>
        <DetailSection title="Vehicle details">
          <Text style={styles.body}>
            {domainLabel(value.transmission)} · {domainLabel(value.powertrain)} ·{' '}
            {value.color ?? 'Color not set'} · {value.seatCount ?? '—'} seats
          </Text>
        </DetailSection>
        <DetailSection title="Registration / verification">
          <Text style={styles.body}>
            {value.documents.filter(({ replacedAt }) => !replacedAt).length} documents attached ·{' '}
            {value.plateNumber ?? 'Plate not set'}
          </Text>
        </DetailSection>
        <DetailSection title="Private pickup location">
          <Text style={styles.body}>
            {value.location ? ownerPrivateLocationLabel(value.location) : 'Not configured'}
          </Text>
          {['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(value.status) && (
            <Button label="Change location" onPress={() => onEdit(4)} variant="secondary" />
          )}
        </DetailSection>
        <DetailSection title="Pricing & usage">
          <Text style={styles.body}>
            {value.policyVersions[0]
              ? `${money(value.policyVersions[0].dailyRateMinor)} / day · ${value.policyVersions[0].turnaroundMinutes / 60}h turnaround`
              : 'Not configured'}
          </Text>
        </DetailSection>
        <DetailSection title="Handover options">
          <Text style={styles.body}>{ownerHandoverSummary(value.policyVersions[0])}</Text>
          <Button label="Edit handover options" onPress={() => onEdit(5)} variant="secondary" />
        </DetailSection>
        <DetailSection title="Known vehicle issues">
          <Text style={styles.cardTitle}>
            {value.knownIssues.filter(({ status }) => status === 'ACTIVE').length} active
          </Text>
          {value.knownIssues
            .filter(({ status }) => status === 'ACTIVE')
            .slice(0, 3)
            .map((issue) => (
              <Text key={issue.id} style={styles.body}>
                {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
              </Text>
            ))}
          <Button
            label="Manage issues"
            onPress={() => setManagingKnownIssues(true)}
            variant="secondary"
          />
        </DetailSection>
        <DetailSection title="Marketplace status">
          <Text style={styles.cardTitle}>{ownerMarketplaceStatus(value)}</Text>
          <Text style={styles.body}>{ownerMarketplaceExplanation(value)}</Text>
          {value.status === 'APPROVED' && (
            <Button
              disabled={operationalStatus.isPending}
              label={
                operationalStatus.isPending
                  ? 'Saving…'
                  : value.operationalStatus === 'AVAILABLE'
                    ? 'Mark temporarily unavailable'
                    : 'Mark available'
              }
              onPress={() =>
                operationalStatus.mutate(
                  value.operationalStatus === 'AVAILABLE' ? 'TEMPORARILY_UNAVAILABLE' : 'AVAILABLE',
                )
              }
              variant="secondary"
            />
          )}
          {operationalStatus.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {operationalStatus.error.message}
            </Text>
          )}
        </DetailSection>
        <DetailSection title="Availability">
          <Text style={styles.cardTitle}>{availabilityTodayLabel(value.availabilityToday)}</Text>
          <Text style={styles.body}>{availabilityTodayDetail(value.availabilityToday)}</Text>
          <Button
            label="Manage availability"
            onPress={() => setManagingAvailability(true)}
            variant="secondary"
          />
        </DetailSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function KnownIssuesManager({
  id,
  onClose,
}: {
  readonly id: string;
  readonly onClose: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const descriptionRef = useRef<TextInput>(null);
  const scrollOffsetY = useRef(0);
  const scrollToFormAfterLayout = useRef(false);
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding(spacing.xl);
  const client = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [category, setCategory] = useState('SCRATCH');
  const [vehicleArea, setVehicleArea] = useState('PASSENGER_SIDE');
  const [classification, setClassification] = useState('COSMETIC');
  const [description, setDescription] = useState('');
  const [descriptionError, setDescriptionError] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState<number | 'new' | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [evidence, setEvidence] = useState<
    { readonly fileAsset: SafeFile; readonly previewUri?: string }[]
  >([]);
  const issues = useQuery({
    queryKey: ['vehicle-known-issues', id],
    queryFn: () => apiClient.request<VehicleKnownIssue[]>(`/owner/vehicles/${id}/known-issues`),
  });
  const reset = () => {
    setShowForm(false);
    setEditingId(null);
    setCategory('SCRATCH');
    setVehicleArea('PASSENGER_SIDE');
    setClassification('COSMETIC');
    setDescription('');
    setDescriptionError('');
    setEvidenceBusy(null);
    setEvidenceError('');
    setEvidence([]);
  };
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/known-issues${editingId ? `/${editingId}` : ''}`, {
        body: JSON.stringify({
          category,
          classification,
          description: description.trim(),
          evidenceFileAssetIds: evidence.map(({ fileAsset }) => fileAsset.id),
          vehicleArea,
        }),
        method: editingId ? 'PATCH' : 'POST',
      }),
    onSuccess: () => {
      reset();
      void client.invalidateQueries({ queryKey: ['vehicle-known-issues', id] });
      void client.invalidateQueries({ queryKey: ['vehicle', id] });
    },
  });
  const resolve = useMutation({
    mutationFn: (issueId: string) =>
      apiClient.request(`/owner/vehicles/${id}/known-issues/${issueId}/resolution`, {
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['vehicle-known-issues', id] });
      void client.invalidateQueries({ queryKey: ['vehicle', id] });
    },
  });
  const captureEvidence = async (replaceIndex?: number) => {
    if (!(await ensureCameraPermission())) return;
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.back,
      mediaTypes: ['images'],
      quality: 0.85,
    });
    const asset = result.assets?.[0];
    if (!asset) return;
    setEvidenceBusy(replaceIndex ?? 'new');
    setEvidenceError('');
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'SENSITIVE', {
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? 'known-vehicle-issue.jpg',
        uri: asset.uri,
      });
      setEvidence((current) => {
        const next = { fileAsset: file, previewUri: asset.uri };
        return replaceIndex === undefined
          ? [...current, next]
          : current.map((value, index) => (index === replaceIndex ? next : value));
      });
    } catch (caught) {
      setEvidenceError(
        caught instanceof Error ? caught.message : 'The supporting photo could not be uploaded.',
      );
    } finally {
      setEvidenceBusy(null);
    }
  };
  const active = issues.data?.filter(({ status }) => status === 'ACTIVE') ?? [];
  const resolved = issues.data?.filter(({ status }) => status === 'RESOLVED') ?? [];
  useEffect(() => {
    const keyboardShown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      if (descriptionRef.current?.isFocused()) {
        descriptionRef.current.measureInWindow((_x, y, _width, height) => {
          const overlap = y + height + spacing.sm - endCoordinates.screenY;
          if (overlap <= 0) return;
          scrollRef.current?.scrollTo({
            animated: true,
            y: scrollOffsetY.current + overlap,
          });
        });
      }
    });
    return () => keyboardShown.remove();
  }, []);
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={[
            styles.knownIssuesPage,
            { paddingBottom: keyboardAwareBottomPadding },
          ]}
          keyboardDismissMode={formKeyboardDismissMode}
          keyboardShouldPersistTaps="handled"
          onScroll={({ nativeEvent }) => {
            scrollOffsetY.current = nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          <BackControl label="Vehicle detail" onPress={onClose} />
          <Text style={styles.knownIssuesTitle}>Known vehicle issues ({active.length})</Text>
          <Text style={styles.knownIssuesHelper}>
            Record the current known vehicle condition once. Active issues are preloaded into future
            pickup inspections.
          </Text>
          {active.map((issue) => (
            <View key={issue.id} style={styles.knownIssueCard}>
              <Text style={styles.cardTitle}>
                {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
              </Text>
              <Text style={styles.status}>{domainLabel(issue.classification)}</Text>
              <Text style={styles.body}>{issue.description}</Text>
              <Text style={styles.body}>{issue.evidence.length} supporting photo(s)</Text>
              <View style={styles.knownIssueCardActions}>
                <Button
                  label="Edit"
                  variant="secondary"
                  onPress={() => {
                    scrollToFormAfterLayout.current = true;
                    setEditingId(issue.id);
                    setCategory(issue.category);
                    setVehicleArea(issue.vehicleArea);
                    setClassification(issue.classification);
                    setDescription(issue.description);
                    setEvidence(issue.evidence.map(({ fileAsset }) => ({ fileAsset })));
                    setShowForm(true);
                  }}
                />
                <Button
                  label="Mark as resolved"
                  variant="danger"
                  onPress={() =>
                    Alert.alert(
                      'Has this issue been fixed or is it no longer present?',
                      'Resolved issues remain in vehicle history and stop preloading into future handovers.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Mark resolved', onPress: () => resolve.mutate(issue.id) },
                      ],
                    )
                  }
                />
              </View>
            </View>
          ))}
          {!showForm && (
            <View style={styles.knownIssueAddAction}>
              <Button
                label={active.length ? '+ Add another issue' : 'Add issue'}
                onPress={() => {
                  scrollToFormAfterLayout.current = true;
                  setShowForm(true);
                }}
              />
            </View>
          )}
          {showForm && (
            <View
              onLayout={({ nativeEvent }) => {
                if (scrollToFormAfterLayout.current) {
                  scrollToFormAfterLayout.current = false;
                  scrollRef.current?.scrollTo({
                    animated: true,
                    y: Math.max(0, nativeEvent.layout.y - spacing.md),
                  });
                }
              }}
              style={styles.knownIssueForm}
            >
              <Text style={styles.cardTitle}>
                {editingId ? 'Edit issue' : 'Add existing issue'}
              </Text>
              <View style={styles.knownIssueFields}>
                <SearchableReferenceSelector
                  label="What’s the issue?"
                  onChange={setCategory}
                  options={knownIssueCategoryOptions}
                  value={category}
                />
                <SearchableReferenceSelector
                  label="Where is it?"
                  onChange={setVehicleArea}
                  options={knownIssueAreaOptions}
                  value={vehicleArea}
                />
                <SearchableReferenceSelector
                  label="How serious is it?"
                  onChange={setClassification}
                  options={knownIssueClassificationOptions}
                  value={classification}
                />
              </View>
              <Text accessibilityLiveRegion="polite" style={styles.classificationHelper}>
                {knownIssueClassificationExplanation(classification)}
              </Text>
              <Text style={styles.knownIssuePrompt}>Describe the issue</Text>
              <TextInput
                accessibilityLabel="Describe the issue"
                multiline
                onChangeText={(value) => {
                  setDescription(value);
                  if (value.trim().length >= 3) setDescriptionError('');
                }}
                placeholder="Add a clear description"
                placeholderTextColor={colors.placeholder}
                ref={descriptionRef}
                style={styles.input}
                value={description}
              />
              {descriptionError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {descriptionError}
                </Text>
              ) : null}
              <Text style={styles.knownIssuePrompt}>Photos</Text>
              <Text style={styles.body}>
                Add private supporting photos. They are visible only to authorized reviewers.
              </Text>
              <View style={styles.knownIssuePhotos}>
                {evidence.map((item, index) => (
                  <SecureCameraPhotoSlot
                    busy={evidenceBusy === index}
                    compactRemoveOverlay
                    guidance="Capture the affected area clearly."
                    key={item.fileAsset.id}
                    name={`Photo ${index + 1}`}
                    onCapture={() => void captureEvidence(index)}
                    onRemove={() =>
                      setEvidence((current) =>
                        current.filter((_, valueIndex) => valueIndex !== index),
                      )
                    }
                    persistedPreview={
                      !item.previewUri ? (
                        <VehicleImage
                          accessibilityLabel={`Known issue photo ${index + 1}`}
                          contentPath={item.fileAsset.contentGrant?.contentPath}
                          style={securePhotoPreviewStyle}
                        />
                      ) : undefined
                    }
                    previewUri={item.previewUri}
                    required={false}
                    uploaded
                  />
                ))}
                {evidence.length < 10 ? (
                  <SecureCameraPhotoSlot
                    busy={evidenceBusy === 'new'}
                    captureLabel="Add photo"
                    guidance="Use the rear camera to add supporting condition evidence."
                    hideHeader
                    name="Add photo"
                    onCapture={() => void captureEvidence()}
                    required={false}
                    uploaded={false}
                  />
                ) : null}
              </View>
              {evidenceError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {evidenceError} Try again when ready.
                </Text>
              ) : null}
              <View style={styles.knownIssueActions}>
                <Button
                  disabled={save.isPending}
                  label={save.isPending ? 'Saving…' : 'Save issue'}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (description.trim().length < 3) {
                      setDescriptionError('Please enter at least 3 characters.');
                      return;
                    }
                    save.mutate();
                  }}
                />
                {save.error ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {save.error.message}
                  </Text>
                ) : null}
                <Button label="Cancel" onPress={reset} variant="secondary" />
              </View>
            </View>
          )}
          {resolved.length > 0 ? (
            <View style={styles.resolvedIssuesSection}>
              <Text style={styles.knownIssuesSectionTitle}>
                Resolved issues ({resolved.length})
              </Text>
              {resolved.map((issue) => (
                <View key={issue.id} style={styles.knownIssueCard}>
                  <Text style={styles.cardTitle}>
                    {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
                  </Text>
                  <Text style={styles.body}>
                    {domainLabel(issue.classification)} · {issue.description}
                  </Text>
                  <Text style={styles.body}>
                    Resolved{' '}
                    {issue.resolvedAt
                      ? new Date(issue.resolvedAt).toLocaleDateString('en-PH')
                      : '—'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function knownIssueClassificationExplanation(classification: string): string {
  if (classification === 'OPERATIONAL') {
    return 'A vehicle feature or system is not working correctly and requires review before the vehicle can be rented. Examples: air conditioning, window, sensor, or another functional issue.';
  }
  if (classification === 'SAFETY_CRITICAL') {
    return 'A condition that could make the vehicle unsafe to drive. The vehicle cannot be rented until this issue is resolved. Examples: brakes, unsafe tires, steering, serious overheating, or a critical safety warning.';
  }
  return 'Appearance-only damage that does not affect normal vehicle operation or safety. Examples: scratch, small dent, stain, or rim scuff.';
}

const knownIssueCategoryOptions = [
  'SCRATCH',
  'DENT',
  'CRACK',
  'PAINT_DAMAGE',
  'WHEEL_OR_RIM',
  'TIRE',
  'GLASS',
  'INTERIOR',
  'WARNING_LIGHT',
  'MECHANICAL_OR_OPERATIONAL',
  'OTHER',
].map((value) => ({ code: value, id: value, name: domainLabel(value) }));

const knownIssueAreaOptions = [
  'FRONT_BUMPER',
  'REAR_BUMPER',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'WINDSHIELD',
  'WHEEL_OR_TIRE',
  'INTERIOR',
  'DASHBOARD',
  'OTHER',
].map((value) => ({ code: value, id: value, name: domainLabel(value) }));

const knownIssueClassificationOptions = ['COSMETIC', 'OPERATIONAL', 'SAFETY_CRITICAL'].map(
  (value) => ({ code: value, id: value, name: domainLabel(value) }),
);

function DetailSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function VehicleEditor({
  id,
  initialStep,
  onClose,
}: {
  readonly id: string;
  readonly initialStep?: number;
  readonly onClose: () => void;
}) {
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding(spacing.xl);
  const client = useQueryClient();
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(`/owner/vehicles/${id}`),
  });
  const [selectedStep, setSelectedStep] = useState<number | null>(initialStep ?? null);
  const [wizardError, setWizardError] = useState('');
  const completedSection = vehicle.data?.lastCompletedSection;
  const completedIndex = steps.findIndex((section) => section.toUpperCase() === completedSection);
  const restoredStep =
    completedSection === 'AVAILABILITY'
      ? steps.length - 1
      : Math.min(completedIndex + 1, steps.length - 1);
  const step = selectedStep ?? Math.max(0, restoredStep);
  const advance = () => {
    setWizardError('');
    setSelectedStep(Math.min(step + 1, steps.length - 1));
  };
  const refresh = () => void client.invalidateQueries({ queryKey: ['vehicle', id] });
  const action = useMutation({
    mutationFn: ({
      path,
      body,
      method = 'POST',
    }: {
      path: string;
      body?: object;
      method?: string;
    }) =>
      apiClient.request(`/owner/vehicles/${id}${path}`, {
        ...(body ? { body: JSON.stringify(body) } : {}),
        method,
      }),
    onSuccess: refresh,
  });
  const continueDraft = useMutation({
    mutationFn: () => markSectionComplete(id, steps[step] ?? 'Review'),
    onSuccess: advance,
  });
  const continueEditor = () => {
    if (continueDraft.isPending) return;
    if (step === 2 && value.photos.length < 5) {
      setWizardError(
        `Add ${5 - value.photos.length} more required vehicle photo${5 - value.photos.length === 1 ? '' : 's'} before continuing.`,
      );
      return;
    }
    setWizardError('');
    continueDraft.mutate();
  };
  if (vehicle.isPending)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.editorStateHeader}>
          <BackControl label="Fleet" onPress={onClose} />
        </View>
        <StateView loading title="Loading vehicle draft…" />
      </SafeAreaView>
    );
  if (vehicle.isError || !vehicle.data)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.editorStateHeader}>
          <BackControl label="Fleet" onPress={onClose} />
        </View>
        <StateView
          icon="cloud-offline-outline"
          title="Vehicle unavailable"
          message={vehicle.error?.message}
          actionLabel="Retry"
          onAction={() => void vehicle.refetch()}
        />
      </SafeAreaView>
    );
  const value = vehicle.data;
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={styles.editorHeader}>
        <BackControl label="Fleet" onPress={onClose} />
        <View>
          <Text style={styles.cardTitle}>
            {value.make ?? 'Vehicle'} {value.model ?? 'draft'}
          </Text>
          <Text style={styles.body}>{vehicleStatusLabel(value.status)}</Text>
        </View>
      </View>
      <View
        style={styles.progressPanel}
        accessibilityLabel={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}
      >
        <View style={styles.progressCopy}>
          <Text style={styles.progressStep}>
            Step {step + 1} of {steps.length}
          </Text>
          <Text style={styles.progressTitle}>{steps[step]}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
        </View>
      </View>
      <KeyboardAvoidingView style={styles.flex}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={[styles.editorBody, { paddingBottom: keyboardAwareBottomPadding }]}
          keyboardDismissMode={formKeyboardDismissMode}
          keyboardShouldPersistTaps="handled"
        >
          {step === 0 && <DetailsStep vehicle={value} onSaved={refresh} onContinue={advance} />}
          {step === 1 && (
            <FeaturesStep
              id={id}
              selectedFeatureIds={value.features.map((item) => item.featureId)}
              onSaved={refresh}
              onContinue={advance}
            />
          )}
          {step === 2 && <PhotosStep id={id} photos={value.photos} onSaved={refresh} />}
          {step === 3 && <DocumentsStep id={id} documents={value.documents} onSaved={refresh} />}
          {step === 4 && (
            <LocationStep id={id} vehicle={value} onSaved={refresh} onContinue={advance} />
          )}
          {step === 5 && (
            <PolicyStep id={id} vehicle={value} onSaved={refresh} onContinue={advance} />
          )}
          {step === 6 && <ReviewStep vehicle={value} action={action.mutate} />}
          {action.error && <Text style={styles.error}>{action.error.message}</Text>}
          {wizardError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {wizardError}
            </Text>
          )}
        </ScrollView>
        <View style={styles.editorActions}>
          {step > 0 && (
            <Pressable
              accessibilityRole="button"
              style={[styles.secondaryButton, styles.editorActionButton]}
              onPress={() => {
                setWizardError('');
                setSelectedStep(Math.max(0, step - 1));
              }}
            >
              <Text>Previous</Text>
            </Pressable>
          )}
          {step < steps.length - 1 && ![0, 1, 4, 5].includes(step) && (
            <Pressable
              accessibilityRole="button"
              disabled={continueDraft.isPending}
              style={[styles.primaryButton, styles.editorActionButton]}
              onPress={continueEditor}
            >
              <Text style={styles.primaryText}>
                {continueDraft.isPending ? 'Saving…' : 'Continue'}
              </Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailsStep({
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const categories = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/categories'),
  });
  const makes = useQuery({
    queryKey: ['vehicle-makes'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/makes'),
  });
  const [form, setForm] = useState({
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    modelYear: vehicle.modelYear?.toString() ?? '',
    categoryId: vehicle.categoryId ?? '',
    variant: vehicle.variant ?? '',
    transmission: vehicle.transmission ?? 'AUTOMATIC',
    powertrain: vehicle.powertrain ?? 'ICE',
    fuelType:
      vehicle.fuelType ?? (vehicle.powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE'),
    seatCount: vehicle.seatCount?.toString() ?? '5',
    doorCount: vehicle.doorCount?.toString() ?? '4',
    color: vehicle.color ?? '',
    plateNumber: vehicle.plateNumber ?? '',
    description: vehicle.description ?? '',
  });
  const selectedMake = makes.data?.find(({ name }) => name === vehicle.make || name === form.make);
  const models = useQuery({
    enabled: Boolean(selectedMake),
    queryKey: ['vehicle-models', selectedMake?.id],
    queryFn: () =>
      apiClient.request<Reference[]>(
        `/owner/vehicle-reference-data/models?makeId=${selectedMake?.id ?? ''}`,
      ),
  });
  const listedModel = models.data?.some(({ name }) => name === form.model) ?? false;
  const [customModel, setCustomModel] = useState(Boolean(vehicle.model) && !listedModel);
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${vehicle.id}`, {
        body: JSON.stringify({
          ...form,
          lastCompletedSection: 'DETAILS',
          modelYear: Number(form.modelYear),
          seatCount: Number(form.seatCount),
          doorCount: Number(form.doorCount),
        }),
        method: 'PATCH',
      }),
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Basic details">
      <SearchableReferenceSelector
        label="Make"
        options={(makes.data ?? []).map((item) => ({ ...item, id: item.name }))}
        value={form.make}
        onChange={(make) => {
          setForm({ ...form, make, model: '' });
          setCustomModel(false);
        }}
      />
      <SearchableReferenceSelector
        label="Model"
        options={[
          ...(models.data ?? []).map((item) => ({ ...item, id: item.name })),
          { id: 'OTHER', code: 'OTHER', name: 'Other / Model not listed' },
        ]}
        value={customModel ? 'OTHER' : form.model}
        onChange={(model) => {
          setCustomModel(model === 'OTHER');
          setForm({ ...form, model: model === 'OTHER' ? '' : model });
        }}
      />
      {customModel && (
        <Field
          label="Enter model"
          value={form.model}
          onChange={(model) => setForm({ ...form, model })}
          placeholder="Manufacturer model name"
        />
      )}
      <Field
        label="Model year"
        value={form.modelYear}
        onChange={(modelYear) => setForm({ ...form, modelYear })}
        keyboard="numeric"
      />
      <SearchableReferenceSelector
        label="Vehicle type"
        options={categories.data ?? []}
        value={form.categoryId}
        onChange={(categoryId) => setForm({ ...form, categoryId })}
      />
      <SearchableReferenceSelector
        label="Powertrain"
        options={[
          { id: 'ICE', code: 'ICE', name: 'Combustion engine' },
          { id: 'HYBRID', code: 'HYBRID', name: 'Hybrid' },
          { id: 'PLUG_IN_HYBRID', code: 'PLUG_IN_HYBRID', name: 'Plug-in Hybrid' },
          { id: 'BATTERY_ELECTRIC', code: 'BATTERY_ELECTRIC', name: 'Electric' },
        ]}
        value={form.powertrain}
        onChange={(powertrain) =>
          setForm({
            ...form,
            powertrain,
            fuelType: powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE',
          })
        }
      />
      {form.powertrain !== 'BATTERY_ELECTRIC' && (
        <SearchableReferenceSelector
          label="Fuel"
          options={[
            { id: 'GASOLINE', code: 'GASOLINE', name: 'Gasoline' },
            { id: 'DIESEL', code: 'DIESEL', name: 'Diesel' },
            { id: 'HYBRID', code: 'HYBRID', name: 'Hybrid fuel system' },
            { id: 'OTHER', code: 'OTHER', name: 'Other' },
          ]}
          value={form.fuelType}
          onChange={(fuelType) => setForm({ ...form, fuelType })}
        />
      )}
      <Field label="Color" value={form.color} onChange={(color) => setForm({ ...form, color })} />
      <Field
        label="Plate number (private)"
        value={form.plateNumber}
        onChange={(plateNumber) => setForm({ ...form, plateNumber })}
      />
      <Field
        label="Description"
        value={form.description}
        onChange={(description) => setForm({ ...form, description })}
      />
      <Save mutation={save} label="Save and continue" />
    </Section>
  );
}

function FeaturesStep({
  id,
  selectedFeatureIds,
  onSaved,
  onContinue,
}: {
  readonly id: string;
  readonly selectedFeatureIds: string[];
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-features'],
    queryFn: () => apiClient.request<Reference[]>('/owner/vehicle-reference-data/features'),
  });
  const [selected, setSelected] = useState<string[]>(selectedFeatureIds);
  const save = useMutation({
    mutationFn: async () => {
      await apiClient.request(`/owner/vehicles/${id}/features`, {
        body: JSON.stringify({ featureIds: selected }),
        method: 'PUT',
      });
      return markSectionComplete(id, 'Features');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Features">
      <Text style={styles.body}>Choose structured features renters can filter later.</Text>
      <View style={styles.wrap}>
        {definitions.data?.map((feature) => (
          <Choice
            key={feature.id}
            selected={selected.includes(feature.id)}
            label={feature.name}
            onPress={() =>
              setSelected(
                selected.includes(feature.id)
                  ? selected.filter((item) => item !== feature.id)
                  : [...selected, feature.id],
              )
            }
          />
        ))}
      </View>
      <Save disabled={!location} mutation={save} label="Save and continue" />
    </Section>
  );
}

function PhotosStep({
  id,
  photos,
  onSaved,
}: {
  readonly id: string;
  readonly photos: VehiclePhoto[];
  readonly onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const displayedPhotos = [...photos].sort(
    (left, right) =>
      Number(right.isCover) - Number(left.isCover) || left.displayOrder - right.displayOrder,
  );
  const upload = async (perspective: string, camera: boolean) => {
    setError('');
    if (camera && !(await ensureCameraPermission())) return;
    const result = camera
      ? await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.back,
          mediaTypes: ['images'],
          quality: 0.85,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          selectionLimit: 1,
        });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'PRIVATE', {
        uri: asset.uri,
        name: asset.fileName ?? `${perspective}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      const displayOrder = Math.max(-1, ...photos.map((photo) => photo.displayOrder)) + 1;
      await apiClient.request(`/owner/vehicles/${id}/photos`, {
        body: JSON.stringify({
          fileAssetId: file.id,
          perspective,
          displayOrder,
          isCover: photos.length === 0,
        }),
        method: 'POST',
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    }
  };
  const reorder = async (
    next: VehiclePhoto[],
    coverId = next.find(({ isCover }) => isCover)?.id,
  ) => {
    if (!coverId) return;
    try {
      await apiClient.request(`/owner/vehicles/${id}/photos/order`, {
        body: JSON.stringify({
          photos: next.map((photo, displayOrder) => ({
            photoId: photo.id,
            displayOrder,
            isCover: photo.id === coverId,
          })),
        }),
        method: 'PUT',
      });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not reorder photos.');
    }
  };
  const setCover = (photoId: string) => {
    const selected = photos.find(({ id: value }) => value === photoId);
    if (!selected) return;
    void reorder([selected, ...photos.filter(({ id }) => id !== photoId)], photoId);
  };
  const remove = async (photoId: string) => {
    try {
      await apiClient.request(`/owner/vehicles/${id}/photos/${photoId}`, { method: 'DELETE' });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Removal failed.');
    }
  };
  return (
    <Section title="Vehicle photos">
      <Text style={styles.body}>
        Add clear photos of the exterior and interior. Your cover photo appears first in search
        results. Photos remain private until the listing is approved.
      </Text>
      {perspectives.map((perspective) => {
        const present = displayedPhotos.filter((photo) => photo.perspective === perspective);
        const multiple = ['INTERIOR', 'DASHBOARD', 'CARGO', 'ADDITIONAL'].includes(perspective);
        return (
          <View key={perspective} style={styles.card}>
            <Text style={styles.cardTitle}>{domainLabel(perspective)}</Text>
            {present.map((photo) => (
              <View key={photo.id} style={styles.photoPreviewRow}>
                <VehicleImage
                  contentPath={photo.fileAsset.contentGrant?.contentPath}
                  style={styles.photoPreview}
                />
                <View style={styles.flex}>
                  <Text style={styles.body}>{photo.isCover ? 'Cover' : 'Vehicle photo'}</Text>
                  <View style={styles.photoActions}>
                    {!photo.isCover && (
                      <Button
                        label="Set cover"
                        onPress={() => setCover(photo.id)}
                        variant="secondary"
                      />
                    )}
                    <Button label="Remove" onPress={() => void remove(photo.id)} variant="danger" />
                  </View>
                </View>
              </View>
            ))}
            {(multiple || present.length === 0) && (
              <View style={styles.wrap}>
                <Choice
                  label="Take photo"
                  selected={false}
                  onPress={() => void upload(perspective, true)}
                />
                <Choice
                  label="Upload photo"
                  selected={false}
                  onPress={() => void upload(perspective, false)}
                />
              </View>
            )}
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

function DocumentsStep({
  id,
  documents,
  onSaved,
}: {
  readonly id: string;
  readonly documents: VehicleDocument[];
  readonly onSaved: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-documents'],
    queryFn: () =>
      apiClient.request<Reference[]>('/owner/vehicle-reference-data/document-definitions'),
  });
  const [error, setError] = useState('');
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const upload = async (definition: Reference, camera: boolean) => {
    if (camera && !(await ensureCameraPermission())) return;
    const cameraResult = camera
      ? await ImagePicker.launchCameraAsync({
          cameraType: ImagePicker.CameraType.back,
          mediaTypes: ['images'],
          quality: 0.9,
        })
      : null;
    const pickerResult = camera
      ? null
      : await DocumentPicker.getDocumentAsync({
          copyToCacheDirectory: true,
          type: ['application/pdf', 'image/*'],
        });
    if (cameraResult?.canceled || pickerResult?.canceled) return;
    const asset = camera ? cameraResult?.assets[0] : pickerResult?.assets[0];
    if (!asset) return;
    try {
      const file = await apiClient.upload<SafeFile>('/files', 'SENSITIVE', {
        uri: asset.uri,
        name: 'name' in asset ? asset.name : (asset.fileName ?? `${definition.code}.jpg`),
        mimeType: asset.mimeType ?? (camera ? 'image/jpeg' : 'application/octet-stream'),
      });
      const current = documents.find(
        (document) => document.definitionId === definition.id && !document.replacedAt,
      );
      await apiClient.request(`/owner/vehicles/${id}/documents`, {
        body: JSON.stringify({
          definitionId: definition.id,
          fileAssetId: file.id,
          ...(current ? { replacesDocumentId: current.id } : {}),
        }),
        method: 'POST',
      });
      if ((asset.mimeType ?? '').startsWith('image/') || camera) {
        setPreviews((current) => ({ ...current, [definition.id]: asset.uri }));
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    }
  };
  return (
    <Section title="Verification documents">
      <Text style={styles.body}>
        Files remain sensitive and are only available through expiring authorized access.
      </Text>
      {definitions.data?.map((definition) => {
        const present = documents.some(
          (document) => document.definitionId === definition.id && !document.replacedAt,
        );
        return (
          <View key={definition.id} style={styles.card}>
            <Text style={styles.cardTitle}>
              {present ? '✓' : '+'} {definition.name}
            </Text>
            <Text style={styles.body}>
              {definition.required ? 'Required' : 'If applicable'} ·{' '}
              {present
                ? 'Attached · replace or retake before submission'
                : 'Capture or choose a file'}
            </Text>
            {previews[definition.id] && (
              <Image source={{ uri: previews[definition.id] }} style={styles.documentPreview} />
            )}
            <View style={styles.wrap}>
              <Choice
                label={present ? 'Retake' : 'Take photo'}
                selected={false}
                onPress={() => void upload(definition, true)}
              />
              <Choice
                label={present ? 'Replace file' : 'Choose file'}
                selected={false}
                onPress={() => void upload(definition, false)}
              />
            </View>
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

function LocationStep({
  id,
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const initialLocation: CarShareLocation | undefined = vehicle.location
    ? {
        displayName:
          vehicle.location.pickupAreaLabel ??
          vehicle.location.addressLine1 ??
          `${vehicle.location.city}, ${vehicle.location.province}`,
        ...(vehicle.location.addressLine1 ? { addressLine1: vehicle.location.addressLine1 } : {}),
        ...(vehicle.location.barangay ? { barangay: vehicle.location.barangay } : {}),
        city: vehicle.location.city,
        country: 'PH',
        latitude: Number(vehicle.location.latitude),
        longitude: Number(vehicle.location.longitude),
        province: vehicle.location.province,
      }
    : undefined;
  const [location, setLocation] = useState<CarShareLocation | undefined>(initialLocation);
  const [pickerOpen, setPickerOpen] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      await apiClient.request(`/owner/vehicles/${id}/location`, {
        body: JSON.stringify({
          ...(location?.addressLine1 ? { addressLine1: location.addressLine1 } : {}),
          ...(location?.barangay ? { barangay: location.barangay } : {}),
          city: location?.city,
          country: location?.country,
          latitude: location ? String(location.latitude) : undefined,
          longitude: location ? String(location.longitude) : undefined,
          ...(vehicle.location?.landmark ? { landmark: vehicle.location.landmark } : {}),
          pickupAreaLabel: location?.displayName,
          province: location?.province,
          timezone: 'Asia/Manila',
        }),
        method: 'PUT',
      });
      return markSectionComplete(id, 'Location');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Private pickup location">
      <Text style={styles.body}>
        Choose the exact pickup and return point for this vehicle. This can be your preferred
        meeting point and does not need to be your home.
      </Text>
      <Text style={styles.body}>
        Your exact location is kept private from public browsing and is shared only where permitted
        for an authorized booking.
      </Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {location ? 'Location confirmed' : 'Location required'}
        </Text>
        <Text style={styles.body}>
          {location ? locationLabel(location) : 'Choose a private pickup and return point.'}
        </Text>
        <Button
          label={location ? 'Change location' : 'Choose location'}
          onPress={() => setPickerOpen(true)}
          variant="secondary"
        />
      </View>
      {pickerOpen && (
        <LocationPicker
          visible
          kind="pickup"
          initial={location}
          title="Private pickup location"
          description="Choose the exact pickup and return point for this vehicle."
          confirmLabel="Confirm location"
          mapAccessibilityLabel="Google map for choosing the private vehicle pickup point"
          mapGuidance="Move the map to adjust the exact pickup and return point."
          onCancel={() => setPickerOpen(false)}
          onConfirm={(value) => {
            setLocation(value);
            setPickerOpen(false);
          }}
        />
      )}
      <Save mutation={save} label="Save and continue" />
    </Section>
  );
}

function PolicyStep({
  id,
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const [dailyRate, setDailyRate] = useState(
    current ? String(current.dailyRateMinor / 100) : '2500',
  );
  const [limited, setLimited] = useState(current?.mileagePolicy !== 'UNLIMITED');
  const [included, setIncluded] = useState(String(current?.includedKilometersPerDay ?? 150));
  const [excess, setExcess] = useState(String((current?.excessKilometerRateMinor ?? 1500) / 100));
  const [turnaround, setTurnaround] = useState(current?.turnaroundMinutes ?? 120);
  const [shortDiscount, setShortDiscount] = useState(
    current?.shortDurationDiscountBps == null ? '' : String(current.shortDurationDiscountBps / 100),
  );
  const [weeklyDiscount, setWeeklyDiscount] = useState(
    current?.weeklyDiscountBps == null ? '' : String(current.weeklyDiscountBps / 100),
  );
  const [extendedDiscount, setExtendedDiscount] = useState(
    current?.extendedTripDiscountBps == null ? '' : String(current.extendedTripDiscountBps / 100),
  );
  const [monthlyDiscount, setMonthlyDiscount] = useState(
    current?.monthlyDiscountBps == null ? '' : String(current.monthlyDiscountBps / 100),
  );
  const [renterPickup, setRenterPickup] = useState(current?.supportsRenterPickup ?? true);
  const [ownerDelivery, setOwnerDelivery] = useState(current?.supportsOwnerDelivery ?? false);
  const [renterReturn, setRenterReturn] = useState(current?.supportsRenterReturn ?? true);
  const [ownerCollection, setOwnerCollection] = useState(current?.supportsOwnerCollection ?? false);
  const [serviceRadiusKm, setServiceRadiusKm] = useState(
    String((current?.fulfillmentServiceRadiusMeters ?? 25_000) / 1000),
  );
  const [deliveryFee, setDeliveryFee] = useState(String((current?.deliveryFeeMinor ?? 0) / 100));
  const [collectionFee, setCollectionFee] = useState(
    String((current?.collectionFeeMinor ?? 0) / 100),
  );
  const [minimumNotice, setMinimumNotice] = useState(current?.fulfillmentMinimumNoticeMinutes ?? 0);
  const [fulfillmentError, setFulfillmentError] = useState('');
  const depositCatalog = useQuery({
    queryKey: ['security-deposit-policy'],
    queryFn: () => apiClient.request<SecurityDepositPolicyCatalog>('/security-deposit/policy'),
    staleTime: 5 * 60_000,
  });
  const [securityDepositRequired, setSecurityDepositRequired] = useState(
    current?.securityDeposit.required ?? current?.securityDepositRequired ?? false,
  );
  const [securityDepositCurrency] = useState(
    current?.securityDeposit.currency ??
      current?.securityDepositCurrency ??
      current?.currency ??
      'PHP',
  );
  const [securityDepositAmountMinor, setSecurityDepositAmountMinor] = useState<number | null>(
    current?.securityDeposit.amountMinor ?? current?.securityDepositAmountMinor ?? null,
  );
  const [securityDepositError, setSecurityDepositError] = useState('');
  const selectedDepositCurrency = depositCatalog.data?.supportedCurrencies.includes(
    securityDepositCurrency,
  )
    ? securityDepositCurrency
    : (depositCatalog.data?.supportedCurrencies[0] ?? securityDepositCurrency);
  const allowedDepositTiers =
    depositCatalog.data?.allowedTiersByCurrency[selectedDepositCurrency] ?? [];
  const selectedDepositAmountMinor = allowedDepositTiers.includes(securityDepositAmountMinor ?? -1)
    ? securityDepositAmountMinor
    : (allowedDepositTiers[0] ?? null);
  const electric = vehicle.powertrain === 'BATTERY_ELECTRIC';
  const ownerService = ownerDelivery || ownerCollection;
  const save = useMutation({
    mutationFn: async () => {
      setFulfillmentError('');
      setSecurityDepositError('');
      if (!depositCatalog.data?.enabledForConfiguration) {
        setSecurityDepositError('Security deposit options are unavailable. Retry before saving.');
        throw new Error('Security deposit options are unavailable.');
      }
      if (
        securityDepositRequired &&
        (!selectedDepositAmountMinor || !allowedDepositTiers.includes(selectedDepositAmountMinor))
      ) {
        setSecurityDepositError('Choose an available security deposit amount.');
        throw new Error('Choose an available security deposit amount.');
      }
      if (!renterPickup && !ownerDelivery) {
        setFulfillmentError('Choose at least one way for renters to receive the car.');
        throw new Error('Choose at least one way for renters to receive the car.');
      }
      if (!renterReturn && !ownerCollection) {
        setFulfillmentError('Choose at least one way for the car to be returned.');
        throw new Error('Choose at least one way for the car to be returned.');
      }
      const radiusMeters = Math.round(Number(serviceRadiusKm) * 1000);
      const deliveryFeeMinor = Math.round(Number(deliveryFee) * 100);
      const collectionFeeMinor = Math.round(Number(collectionFee) * 100);
      if (
        ownerService &&
        (!Number.isInteger(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50_000)
      ) {
        setFulfillmentError('Choose a service area from 1 to 50 km.');
        throw new Error('Choose a service area from 1 to 50 km.');
      }
      if (ownerDelivery && (!Number.isSafeInteger(deliveryFeeMinor) || deliveryFeeMinor < 0)) {
        setFulfillmentError('Enter a valid Delivery fee. Zero means free delivery.');
        throw new Error('Enter a valid Delivery fee.');
      }
      if (
        ownerCollection &&
        (!Number.isSafeInteger(collectionFeeMinor) || collectionFeeMinor < 0)
      ) {
        setFulfillmentError('Enter a valid Collection fee. Zero means free collection.');
        throw new Error('Enter a valid Collection fee.');
      }
      await apiClient.request(`/owner/vehicles/${id}/policy-versions`, {
        body: JSON.stringify({
          dailyRateMinor: Math.round(Number(dailyRate) * 100),
          currency: current?.currency ?? 'PHP',
          securityDepositRequired,
          ...(securityDepositRequired
            ? {
                securityDepositAmountMinor: selectedDepositAmountMinor,
                securityDepositCurrency: selectedDepositCurrency,
              }
            : {}),
          ...(shortDiscount.trim()
            ? { shortDurationDiscountBps: Math.round(Number(shortDiscount) * 100) }
            : {}),
          ...(weeklyDiscount.trim()
            ? { weeklyDiscountBps: Math.round(Number(weeklyDiscount) * 100) }
            : {}),
          ...(extendedDiscount.trim()
            ? { extendedTripDiscountBps: Math.round(Number(extendedDiscount) * 100) }
            : {}),
          ...(monthlyDiscount.trim()
            ? { monthlyDiscountBps: Math.round(Number(monthlyDiscount) * 100) }
            : {}),
          minimumRentalDays: current?.minimumRentalDays ?? 1,
          maximumRentalDays: current?.maximumRentalDays ?? 30,
          mileagePolicy: limited ? 'LIMITED' : 'UNLIMITED',
          ...(limited
            ? {
                includedKilometersPerDay: Number(included),
                excessKilometerRateMinor: Math.round(Number(excess) * 100),
              }
            : {}),
          ...(electric
            ? {
                evReturnPolicy: current?.evReturnPolicy ?? 'SAME_TO_SAME',
                ...(current?.evRequiredPercentage == null
                  ? {}
                  : { evRequiredPercentage: current.evRequiredPercentage }),
                evTolerancePercent: current?.evTolerancePercent ?? 5,
              }
            : {
                fuelReturnPolicy: current?.fuelReturnPolicy ?? 'SAME_TO_SAME',
                fuelTolerancePercent: current?.fuelTolerancePercent ?? 5,
              }),
          turnaroundMinutes: turnaround,
          availabilityPolicy: current?.availabilityPolicy ?? 'EVERY_DAY',
          monday: current?.monday ?? true,
          tuesday: current?.tuesday ?? true,
          wednesday: current?.wednesday ?? true,
          thursday: current?.thursday ?? true,
          friday: current?.friday ?? true,
          saturday: current?.saturday ?? true,
          sunday: current?.sunday ?? true,
          supportsRenterPickup: renterPickup,
          supportsOwnerDelivery: ownerDelivery,
          supportsRenterReturn: renterReturn,
          supportsOwnerCollection: ownerCollection,
          ...(ownerService ? { fulfillmentServiceRadiusMeters: radiusMeters } : {}),
          ...(ownerDelivery ? { deliveryFeeMinor } : {}),
          ...(ownerCollection ? { collectionFeeMinor } : {}),
          fulfillmentMinimumNoticeMinutes: ownerService ? minimumNotice : 0,
        }),
        method: 'POST',
      });
      return markSectionComplete(id, 'Policies');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <Section title="Pricing and usage policies">
      <Field
        label="Daily rate (PHP)"
        value={dailyRate}
        onChange={setDailyRate}
        keyboard="numeric"
      />
      <Text style={styles.label}>Long-booking discounts (optional)</Text>
      <Text style={styles.body}>
        Enter a percentage from 0 to 40. Longer enabled tiers cannot be lower than shorter tiers.
        The best eligible tier is applied once to the rental subtotal.
      </Text>
      <Field
        label="3+ days (%)"
        value={shortDiscount}
        onChange={setShortDiscount}
        keyboard="decimal-pad"
      />
      <Field
        label="7+ days (%)"
        value={weeklyDiscount}
        onChange={setWeeklyDiscount}
        keyboard="decimal-pad"
      />
      <Field
        label="14+ days (%)"
        value={extendedDiscount}
        onChange={setExtendedDiscount}
        keyboard="decimal-pad"
      />
      <Field
        label="30+ days (%)"
        value={monthlyDiscount}
        onChange={setMonthlyDiscount}
        keyboard="decimal-pad"
      />
      {Number(dailyRate) > 0 && weeklyDiscount.trim() && (
        <Text style={styles.body}>
          Example: 7 days is{' '}
          {money(Math.round(Number(dailyRate) * 100 * 7 * (1 - Number(weeklyDiscount) / 100)))}{' '}
          after the weekly discount.
        </Text>
      )}
      <Text style={styles.label}>Security deposit</Text>
      {depositCatalog.isPending && <StateView loading title="Loading deposit options…" />}
      {depositCatalog.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Deposit options unavailable"
          message="Retry to load the current amounts before saving this policy."
          actionLabel="Retry"
          onAction={() => void depositCatalog.refetch()}
        />
      )}
      {depositCatalog.data?.enabledForConfiguration && (
        <View style={styles.depositSection}>
          <DepositRequirementSelector
            required={securityDepositRequired}
            onChange={setSecurityDepositRequired}
          />
          {securityDepositRequired && (
            <DepositTierSelector
              options={allowedDepositTiers.map((amountMinor) => ({
                label: money(amountMinor, selectedDepositCurrency),
                value: amountMinor,
              }))}
              value={selectedDepositAmountMinor}
              onChange={setSecurityDepositAmountMinor}
            />
          )}
          <Text style={styles.depositHelper}>Changes apply to new booking requests only.</Text>
          {!depositCatalog.data.executionAvailable && (
            <Text style={styles.depositInfoNote}>
              Deposit processing isn’t active yet. No hold will be placed and pickup won’t be
              blocked.
            </Text>
          )}
        </View>
      )}
      {securityDepositError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {securityDepositError}
        </Text>
      )}
      <Text style={styles.label}>Handover options</Text>
      <Text style={styles.label}>START OF RENTAL</Text>
      <View style={styles.wrap}>
        <Choice
          label="Renter pickup"
          selected={renterPickup}
          onPress={() => setRenterPickup((value) => !value)}
        />
        <Choice
          label="I can deliver the car"
          selected={ownerDelivery}
          onPress={() => setOwnerDelivery((value) => !value)}
        />
      </View>
      <Text style={styles.label}>END OF RENTAL</Text>
      <View style={styles.wrap}>
        <Choice
          label="Renter returns the car"
          selected={renterReturn}
          onPress={() => setRenterReturn((value) => !value)}
        />
        <Choice
          label="I can collect the car"
          selected={ownerCollection}
          onPress={() => setOwnerCollection((value) => !value)}
        />
      </View>
      {ownerService && (
        <>
          <Text style={styles.label}>Service area</Text>
          <Text style={styles.body}>
            How far are you willing to{' '}
            {ownerDelivery && ownerCollection
              ? 'deliver or collect'
              : ownerDelivery
                ? 'deliver'
                : 'collect'}{' '}
            the vehicle?
          </Text>
          <View accessibilityLabel="Owner service radius" style={styles.wrap}>
            {[5, 10, 15, 25, 50].map((kilometers) => (
              <Choice
                key={kilometers}
                label={`${kilometers} km`}
                selected={serviceRadiusKm === String(kilometers)}
                onPress={() => setServiceRadiusKm(String(kilometers))}
              />
            ))}
          </View>
          {ownerDelivery && (
            <>
              <Field
                label="Delivery fee (PHP)"
                value={deliveryFee}
                onChange={setDeliveryFee}
                keyboard="decimal-pad"
              />
              <Text style={styles.body}>
                Amount shown when you offer delivery. Zero means free delivery.
              </Text>
            </>
          )}
          {ownerCollection && (
            <>
              <Field
                label="Collection fee (PHP)"
                value={collectionFee}
                onChange={setCollectionFee}
                keyboard="decimal-pad"
              />
              <Text style={styles.body}>
                Amount shown when you offer collection. Zero means free collection.
              </Text>
            </>
          )}
          <Text style={styles.label}>Delivery & collection notice</Text>
          <Text style={styles.body}>
            How much advance notice do you need to deliver or collect the vehicle?
          </Text>
          <Text style={styles.body}>
            This only applies when you deliver or collect the vehicle. Renter pickup and return are
            not affected.
          </Text>
          <View accessibilityLabel="Delivery and collection notice" style={styles.wrap}>
            {[
              [0, 'No minimum'],
              [180, '3 hours'],
              [360, '6 hours'],
              [720, '12 hours'],
              [1440, '24 hours'],
              [2880, '48 hours'],
              [10080, '7 days'],
            ].map(([minutes, label]) => (
              <Choice
                key={minutes}
                label={String(label)}
                selected={minimumNotice === minutes}
                onPress={() => setMinimumNotice(Number(minutes))}
              />
            ))}
          </View>
        </>
      )}
      {fulfillmentError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {fulfillmentError}
        </Text>
      )}
      <Text style={styles.label}>Mileage</Text>
      <View style={styles.wrap}>
        <Choice label="150 km/day" selected={limited} onPress={() => setLimited(true)} />
        <Choice label="Unlimited" selected={!limited} onPress={() => setLimited(false)} />
      </View>
      {limited && (
        <>
          <Field
            label="Included mileage per rental day (km)"
            value={included}
            onChange={setIncluded}
            keyboard="numeric"
          />
          <Text style={styles.body}>
            How many kilometers are included per rental day before excess mileage charges apply.
          </Text>
          <Field
            label="Excess mileage fee (PHP per whole km)"
            value={excess}
            onChange={setExcess}
            keyboard="numeric"
          />
          <Text style={styles.body}>
            Amount charged for each whole kilometer driven beyond the included mileage allowance.
          </Text>
        </>
      )}
      <Text style={styles.label}>Turnaround buffer</Text>
      <Text style={styles.body}>
        Time reserved after each rental before this vehicle can be booked again.
      </Text>
      <View style={styles.wrap}>
        {[120, 240, 360, 720, 1440].map((minutes) => (
          <Choice
            key={minutes}
            selected={turnaround === minutes}
            label={`${minutes / 60}h`}
            onPress={() => setTurnaround(minutes)}
          />
        ))}
      </View>
      <Text style={styles.body}>
        If you select {turnaround / 60} hours, another renter cannot book the vehicle until that
        time has passed after the previous return. Availability remains server-authoritative.
      </Text>
      <Text style={styles.body}>
        {electric ? 'EV same-to-same, 5% tolerance' : 'Fuel same-to-same, 5% tolerance'} ·
        deficiency charges require platform review. Current rate:{' '}
        {money(Math.round(Number(dailyRate || 0) * 100))} per day.
      </Text>
      <Save mutation={save} label="Save and continue" />
    </Section>
  );
}

function AvailabilityStep({
  id,
  vehicle,
  onSaved,
}: {
  readonly id: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const client = useQueryClient();
  const blocks = useQuery({
    queryKey: ['vehicle-blocks', id],
    queryFn: () => apiClient.request<VehicleBlock[]>(`/owner/vehicles/${id}/blocked-periods`),
  });
  const [reason, setReason] = useState('PERSONAL_USE');
  const [startsAt, setStartsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    value.setHours(9, 0, 0, 0);
    return value;
  });
  const [endsAt, setEndsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 2);
    value.setHours(9, 0, 0, 0);
    return value;
  });
  const add = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/vehicles/${id}/blocked-periods`, {
        body: JSON.stringify({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          reason,
        }),
        method: 'POST',
      }),
    onSuccess: () => {
      onSaved();
      void Promise.all([
        client.invalidateQueries({ queryKey: ['vehicle-blocks', id] }),
        client.invalidateQueries({ queryKey: ['vehicle', id] }),
        client.invalidateQueries({ queryKey: ['vehicles'] }),
        client.invalidateQueries({ queryKey: ['owner-vehicle-dashboard-summary'] }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.request(`/owner/vehicles/${id}/blocked-periods/${blockId}`, { method: 'DELETE' }),
    onSuccess: () => {
      Alert.alert('Unavailable period removed.');
      void Promise.all([
        client.invalidateQueries({ queryKey: ['vehicle-blocks', id] }),
        client.invalidateQueries({ queryKey: ['vehicle', id] }),
        client.invalidateQueries({ queryKey: ['vehicles'] }),
        client.invalidateQueries({ queryKey: ['owner-vehicle-dashboard-summary'] }),
      ]);
      onSaved();
    },
  });
  return (
    <Section title="Availability">
      <Text style={styles.body}>
        Available by default whenever there is no booking, active rental, turnaround, maintenance,
        or owner-created block.
      </Text>
      <Text style={styles.body}>
        Current preparation buffer: {(current?.turnaroundMinutes ?? 120) / 60} hours between
        rentals.
      </Text>
      <Text style={styles.label}>Add an unavailable period</Text>
      <SearchableReferenceSelector
        label="Reason"
        options={[
          { id: 'PERSONAL_USE', code: 'PERSONAL_USE', name: 'Personal use' },
          { id: 'MAINTENANCE', code: 'MAINTENANCE', name: 'Maintenance' },
          { id: 'UNAVAILABLE', code: 'UNAVAILABLE', name: 'Unavailable' },
          { id: 'OTHER', code: 'OTHER', name: 'Other' },
        ]}
        value={reason}
        onChange={setReason}
      />
      <DateTimeField
        label="Starts"
        value={startsAt}
        minimumDate={new Date()}
        onChange={setStartsAt}
      />
      <DateTimeField label="Ends" value={endsAt} minimumDate={startsAt} onChange={setEndsAt} />
      {endsAt <= startsAt && <Text style={styles.error}>End must be after start.</Text>}
      <Save mutation={add} label="Add blocked period" />
      {blocks.data?.map((block) => (
        <View key={block.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {domainLabel(block.reason)} · {blockPeriodState(block)}
          </Text>
          <Text style={styles.body}>
            {formatManilaDateTime(block.startsAt)} → {formatManilaDateTime(block.endsAt)}
          </Text>
          {new Date(block.endsAt) > new Date() ? (
            <Pressable
              accessibilityRole="button"
              disabled={remove.isPending}
              onPress={() =>
                Alert.alert(
                  'Remove unavailable period?',
                  'The vehicle may become available for bookings during these dates if there are no other bookings or unavailable periods.',
                  [
                    { style: 'cancel', text: 'Keep block' },
                    {
                      onPress: () => remove.mutate(block.id),
                      style: 'destructive',
                      text: 'Remove block',
                    },
                  ],
                )
              }
            >
              <Text style={styles.error}>Remove block</Text>
            </Pressable>
          ) : (
            <Text style={styles.body}>Past period · read-only</Text>
          )}
        </View>
      ))}
      {blocks.data?.length === 0 && <Text style={styles.body}>No unavailable periods.</Text>}
      {remove.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {remove.error.message || 'This unavailable period could not be removed.'}
        </Text>
      )}
    </Section>
  );
}

function formatManilaDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

function blockPeriodState(block: VehicleBlock): string {
  const now = new Date();
  if (new Date(block.endsAt) <= now) return 'Past';
  if (new Date(block.startsAt) <= now) return 'Active now';
  return 'Upcoming';
}

function availabilityTodayLabel(value?: AvailabilityToday): string {
  if (!value) return 'Availability being checked';
  if (value.state === 'AVAILABLE') return 'Available today';
  if (value.state === 'BOOKED') return 'Booked today';
  if (value.state === 'OWNER_BLOCKED') {
    return value.blockReason
      ? `Owner-blocked today · ${domainLabel(value.blockReason)}`
      : 'Owner-blocked today';
  }
  return 'Not currently marketplace-available';
}

function availabilityTodayDetail(value?: AvailabilityToday): string {
  if (!value) return 'Refresh to check current availability.';
  if (value.state === 'OWNER_BLOCKED' && value.blockedUntil) {
    return `${value.blockReason ? domainLabel(value.blockReason) : 'Unavailable'} until ${formatManilaDateTime(value.blockedUntil)}.`;
  }
  if (value.state === 'BOOKED') return 'A booking or active rental occupies this vehicle today.';
  if (value.state === 'AVAILABLE') {
    return 'No booking or Owner-created block currently covers today.';
  }
  return 'Marketplace lifecycle or operational controls currently prevent availability.';
}

function ownerPrivateLocationLabel(location: NonNullable<Vehicle['location']>): string {
  return [location.addressLine1, location.barangay, location.city, location.province]
    .filter(Boolean)
    .join(', ');
}

function ReviewStep({
  vehicle,
  action,
}: {
  readonly vehicle: Vehicle;
  readonly action: (value: { path: string; body?: object; method?: string }) => void;
}) {
  const editable = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(vehicle.status);
  return (
    <Section title="Review and submit">
      <Text style={styles.status}>Status: {vehicleStatusLabel(vehicle.status)}</Text>
      {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
      <View style={styles.reviewSummary}>
        <Text style={styles.cardTitle}>
          {vehicle.modelYear} {vehicle.make} {vehicle.model}
        </Text>
        <Text style={styles.body}>
          {domainLabel(vehicle.transmission)} · {domainLabel(vehicle.powertrain)} ·{' '}
          {vehicle.seatCount ?? '—'} seats
        </Text>
        <Text style={styles.body}>
          {vehicle.location
            ? `${vehicle.location.city}, ${vehicle.location.province}`
            : 'Location not complete'}
        </Text>
        {vehicle.policyVersions[0] && (
          <Text style={styles.body}>
            {money(vehicle.policyVersions[0].dailyRateMinor)} per day ·{' '}
            {vehicle.policyVersions[0].turnaroundMinutes / 60}-hour preparation buffer
          </Text>
        )}
      </View>
      <Readiness
        label="Basic details"
        done={Boolean(vehicle.make && vehicle.model && vehicle.modelYear && vehicle.categoryId)}
      />
      <Readiness label="Five required photos" done={vehicle.photos.length >= 5} />
      <Readiness
        label="Required documents"
        done={vehicle.documents.filter((item) => !item.replacedAt).length >= 3}
      />
      <Readiness label="Private location" done={Boolean(vehicle.location)} />
      <Readiness label="Pricing and policies" done={vehicle.policyVersions.length > 0} />
      {editable && (
        <Pressable style={styles.primaryButton} onPress={() => action({ path: '/submission' })}>
          <Text style={styles.primaryText}>Submit for approval</Text>
        </Pressable>
      )}
      {vehicle.status === 'APPROVED' && (
        <>
          <Pressable
            style={styles.secondaryButton}
            onPress={() =>
              action({
                path: '/operational-status',
                body: {
                  status:
                    vehicle.operationalStatus === 'AVAILABLE'
                      ? 'TEMPORARILY_UNAVAILABLE'
                      : 'AVAILABLE',
                },
                method: 'PATCH',
              })
            }
          >
            <Text>
              {vehicle.operationalStatus === 'AVAILABLE'
                ? 'Mark temporarily unavailable'
                : 'Mark available'}
            </Text>
          </Pressable>
          <Pressable style={styles.dangerButton} onPress={() => action({ path: '/archive' })}>
            <Text style={styles.primaryText}>Archive vehicle</Text>
          </Pressable>
        </>
      )}
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  keyboard,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly keyboard?: 'numeric' | 'decimal-pad';
  readonly placeholder?: string;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        keyboardType={keyboard}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        value={value}
      />
    </View>
  );
}
function Choice({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceActive]}
    >
      <Text style={selected ? styles.primaryText : styles.body}>{label}</Text>
    </Pressable>
  );
}

function DepositRequirementSelector({
  required,
  onChange,
}: {
  readonly required: boolean;
  readonly onChange: (required: boolean) => void;
}) {
  return (
    <View accessibilityLabel="Security deposit requirement" style={styles.depositSegmentedControl}>
      <DepositRequirementOption
        label="No deposit"
        selected={!required}
        onPress={() => onChange(false)}
      />
      <DepositRequirementOption
        label="Require deposit"
        selected={required}
        onPress={() => onChange(true)}
      />
    </View>
  );
}

function DepositRequirementOption({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.depositSegment, selected && styles.depositSegmentSelected]}
    >
      {selected && <Icon color={colors.onPrimary} name="checkmark" size={16} />}
      <Text style={[styles.depositSegmentText, selected && styles.depositSegmentTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}
function Save({
  mutation,
  label = 'Save draft',
  disabled = false,
}: {
  readonly mutation: {
    readonly mutate: () => void;
    readonly isPending: boolean;
    readonly error: Error | null;
  };
  readonly label?: string;
  readonly disabled?: boolean;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || mutation.isPending }}
        disabled={disabled || mutation.isPending}
        style={[styles.primaryButton, (disabled || mutation.isPending) && styles.disabledButton]}
        onPress={() => mutation.mutate()}
      >
        <Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : label}</Text>
      </Pressable>
      {mutation.error && <Text style={styles.error}>{mutation.error.message}</Text>}
    </>
  );
}
function Readiness({ label, done }: { readonly label: string; readonly done: boolean }) {
  return (
    <View style={styles.readiness}>
      <Text style={done ? styles.status : styles.body}>
        {done ? '✓' : '○'} {label}
      </Text>
    </View>
  );
}

function markSectionComplete(vehicleId: string, section: string) {
  return apiClient.request(`/owner/vehicles/${vehicleId}`, {
    body: JSON.stringify({ lastCompletedSection: section.toUpperCase() }),
    method: 'PATCH',
  });
}

function vehicleTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'APPROVED') return 'success';
  if (['CHANGES_REQUIRED', 'PENDING_APPROVAL'].includes(status)) return 'warning';
  if (['REJECTED', 'SUSPENDED'].includes(status)) return 'danger';
  return 'neutral';
}

function ownerHandoverSummary(policy?: Policy) {
  if (!policy) return 'Configure pricing and handover policies to continue.';
  const start = [
    policy.supportsRenterPickup ? 'Pickup' : null,
    policy.supportsOwnerDelivery ? 'Delivery' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  const end = [
    policy.supportsRenterReturn ? 'Renter return' : null,
    policy.supportsOwnerCollection ? 'Owner collection' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  return `Start: ${start || 'Not configured'} · End: ${end || 'Not configured'}`;
}

function ownerMarketplaceStatus(vehicle: Vehicle) {
  if (vehicle.status === 'DRAFT') return 'Draft';
  if (vehicle.status === 'PENDING_APPROVAL') return 'Under review';
  if (vehicle.status === 'CHANGES_REQUIRED') return 'Changes required';
  if (vehicle.status === 'REJECTED') return 'Rejected';
  if (vehicle.status === 'SUSPENDED') return 'Suspended';
  if (vehicle.status === 'ARCHIVED') return 'Archived';
  if (vehicle.status === 'APPROVED' && vehicle.operationalStatus === 'AVAILABLE')
    return 'Approved · marked available';
  if (vehicle.status === 'APPROVED') return 'Approved · temporarily unavailable';
  return vehicleStatusLabel(vehicle.status);
}

function ownerMarketplaceExplanation(vehicle: Vehicle) {
  if (vehicle.status === 'DRAFT')
    return 'Complete the vehicle, pricing, location, photos, and documents, then submit it for CarShare review.';
  if (vehicle.status === 'PENDING_APPROVAL')
    return 'CarShare Operations must approve this vehicle before it can appear in Search.';
  if (vehicle.status === 'CHANGES_REQUIRED')
    return vehicle.reviewReason ?? 'Complete the requested changes and submit the vehicle again.';
  if (vehicle.status === 'REJECTED')
    return vehicle.reviewReason ?? 'This vehicle is not approved for the marketplace.';
  if (vehicle.status === 'SUSPENDED')
    return 'This listing is suspended and cannot appear in Search.';
  if (vehicle.status === 'ARCHIVED') return 'This vehicle is archived and cannot appear in Search.';
  if (vehicle.status === 'APPROVED' && vehicle.operationalStatus !== 'AVAILABLE')
    return 'Use Mark available in the Review step when you are ready. Availability does not bypass marketplace eligibility checks.';
  return 'Public Search still verifies the Owner, required documents, location, policy, and public-ready cover photo.';
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  disabledButton: { opacity: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  coverBadge: {
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: 'absolute',
    top: 6,
  },
  coverPreview: { borderRadius: radius.lg, height: 220, marginTop: spacing.sm, width: '100%' },
  documentPreview: { borderRadius: radius.md, height: 180, marginTop: spacing.sm, width: '100%' },
  choice: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  depositHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  depositInfoNote: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    color: colors.subtleText,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.sm,
  },
  depositSection: { gap: spacing.xs, marginTop: spacing.xs },
  depositSegment: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  depositSegmentedControl: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    padding: spacing.xxs,
  },
  depositSegmentSelected: { backgroundColor: colors.primary },
  depositSegmentText: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  depositSegmentTextSelected: { color: colors.onPrimary },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#A12626',
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  editorActionButton: { flex: 1, marginTop: 0 },
  editorActions: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  editorBody: { padding: spacing.xl },
  editorHeader: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.md,
  },
  editorStateHeader: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  empty: { color: colors.subtleText, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: '#A12626', marginTop: spacing.sm },
  availabilityText: { color: colors.primary, fontWeight: '700', marginTop: spacing.xxs },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  flex: { backgroundColor: colors.background, flex: 1 },
  fleetCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  fleetContent: { flex: 1, minWidth: 0, paddingVertical: spacing.xxs },
  fleetImage: { borderRadius: radius.md, height: 142, width: 116 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  galleryImage: { height: 104, width: '100%' },
  galleryTile: { borderRadius: radius.md, overflow: 'hidden', position: 'relative', width: '31%' },
  hero: { borderRadius: radius.lg, height: 240, marginTop: spacing.md, width: '100%' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  classificationHelper: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    color: colors.ink,
    lineHeight: 20,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  knownIssueCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  knownIssueActions: { gap: spacing.sm, marginTop: spacing.lg },
  knownIssueAddAction: { marginTop: spacing.xl },
  knownIssueCardActions: { gap: spacing.sm, marginTop: spacing.md },
  knownIssueFields: { gap: spacing.lg, marginTop: spacing.lg },
  knownIssueForm: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  knownIssuePhotos: { gap: spacing.md, marginTop: spacing.sm },
  knownIssuePrompt: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
    marginTop: spacing.lg,
  },
  knownIssuesHelper: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  knownIssuesPage: {
    backgroundColor: colors.background,
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  knownIssuesSectionTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
  },
  knownIssuesTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  photoPreview: { borderRadius: radius.sm, height: 82, width: 108 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  photoPreviewRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  primaryText: { color: colors.onPrimary, fontWeight: '700' },
  progressCopy: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progressFill: { backgroundColor: colors.primary, borderRadius: radius.pill, height: '100%' },
  progressPanel: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  progressStep: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  progressTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  progressTrack: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    height: 6,
    overflow: 'hidden',
  },
  rate: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: spacing.xs },
  readiness: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.sm,
  },
  resolvedIssuesSection: { marginTop: spacing.xxl },
  reviewSummary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  step: {
    borderRadius: 999,
    marginRight: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stepActive: { backgroundColor: colors.primary },
  stepBar: { backgroundColor: colors.surface, flexGrow: 0 },
  stepContent: { padding: spacing.sm },
  stepTextActive: { color: colors.onPrimary, fontWeight: '700' },
  title: { color: colors.ink, fontSize: 27, fontWeight: '800', marginTop: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
});
