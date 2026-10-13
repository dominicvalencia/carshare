import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  classifyVehicleChangedFields,
  diffVehicleChangeProposalSnapshots,
  type CreateVehicleChangeProposalResponse,
  type GetVehicleChangeProposalResponse,
  type OwnerVehicleChangeProposalListResponse,
  type OwnerVehicleChangeProposalReviewModel,
  type SubmitVehicleChangeProposalResponse,
  type UpdateVehicleChangeProposalResponse,
  type VehicleChangeProposalSnapshotV1,
  VEHICLE_REMOVAL_OTHER_REASON_MAX_LENGTH,
  VehicleRemovalReason,
  type SecurityDepositPolicyCatalog,
  type VehicleRemovalReason as VehicleRemovalReasonCode,
} from '@carrental/api-contracts';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ApiError, apiClient } from '../../auth/api-client';
import type { OwnerWorkspace } from '../../auth/auth.types';
import type { RootStackParamList } from '../../navigation/routes';
import { hasOwnerPermission } from '../../navigation/owner-workspace';
import { colors, radius, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { ensureCameraPermission } from '../../ui/camera-permission';
import { dateTimeLabel, domainLabel, money, vehicleStatusLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { SearchableReferenceSelector } from '../../ui/SearchableReferenceSelector';
import { LocationPicker } from '../../location/LocationPicker';
import {
  locationDisplayLabel,
  type CarShareLocation,
} from '../../location/booking-location-provider';
import { SecureCameraPhotoSlot, securePhotoPreviewStyle } from '../../ui/SecureCameraPhotoSlot';
import { DepositTierSelector } from './DepositTierSelector';
import {
  BackControl,
  Button,
  formKeyboardDismissMode,
  Icon,
  SegmentedControl,
  StateView,
  StatusBadge,
  useKeyboardAwareBottomPadding,
} from '../../ui/primitives';

interface Reference {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly required?: boolean;
}

const vehicleRemovalReasonOptions: readonly {
  readonly label: string;
  readonly value: VehicleRemovalReasonCode;
}[] = [
  { label: 'I sold the vehicle', value: VehicleRemovalReason.SOLD_VEHICLE },
  { label: 'I no longer want to rent it out', value: VehicleRemovalReason.NO_LONGER_RENTING },
  { label: 'The vehicle is no longer available', value: VehicleRemovalReason.VEHICLE_UNAVAILABLE },
  { label: 'Maintenance or repairs', value: VehicleRemovalReason.MAINTENANCE_OR_REPAIRS },
  { label: "I'm replacing it with another vehicle", value: VehicleRemovalReason.REPLACING_VEHICLE },
  { label: 'I had problems using CarShare', value: VehicleRemovalReason.CARSHARE_EXPERIENCE },
  { label: 'Other', value: VehicleRemovalReason.OTHER },
];
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
  readonly revision: number;
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
  readonly rentalRequirements: string | null;
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
  readonly ownerApproval: {
    readonly id: string;
    readonly status: 'PENDING' | 'CHANGES_REQUIRED' | 'APPROVED' | 'WITHDRAWN';
    readonly reviewReason: string | null;
    readonly submittedAt: string;
    readonly submittedByDisplayName: string;
    readonly submittedRevision: number;
  } | null;
  readonly activeChangeProposal?: {
    readonly id: string;
    readonly isCreator: boolean;
    readonly ownerApprovalBypassed: boolean;
    readonly platformReviewRequired: boolean;
    readonly status:
      | 'DRAFT'
      | 'PENDING_OWNER_APPROVAL'
      | 'OWNER_CHANGES_REQUIRED'
      | 'PENDING_PLATFORM_REVIEW'
      | 'PLATFORM_CHANGES_REQUIRED';
  } | null;
  readonly capabilities?: {
    readonly canArchiveVehicle: false;
    readonly canEditOperationalFields: boolean;
    readonly canManageKnownIssues: false;
    readonly canStartVehicleProposal: boolean;
    readonly ownerApprovalBypassEnabled: boolean;
  } | null;
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
  'Pricing',
  'Handover & usage',
  'Review',
] as const;
const stepCompletionIds = [
  'Details',
  'Features',
  'Photos',
  'Documents',
  'Location',
  null,
  'Policies',
  null,
] as const;
const vehicleFeatureGroups = [
  {
    codes: [
      'AIR_CONDITIONING',
      'REAR_AIR_CONDITIONING',
      'LEATHER_SEATS',
      'PUSH_BUTTON_START',
      'KEYLESS_ENTRY',
      'CRUISE_CONTROL',
      'ADAPTIVE_CRUISE_CONTROL',
      'SUNROOF_MOONROOF',
    ],
    title: 'Comfort',
  },
  {
    codes: [
      'BLUETOOTH',
      'APPLE_CARPLAY',
      'ANDROID_AUTO',
      'WIRELESS_PHONE_CHARGING',
      'USB_CHARGING',
      'GPS_NAVIGATION',
    ],
    title: 'Connectivity',
  },
  {
    codes: [
      'BACKUP_CAMERA',
      'CAMERA_360',
      'PARKING_SENSORS',
      'BLIND_SPOT_MONITORING',
      'LANE_KEEPING_ASSIST',
      'AUTOMATIC_EMERGENCY_BRAKING',
      'DASHCAM',
      'CHILD_SEAT_COMPATIBLE',
    ],
    title: 'Parking & safety',
  },
  {
    codes: [
      'FAST_CHARGING_SUPPORT',
      'PORTABLE_CHARGING_CABLE',
      'CHARGING_ADAPTER',
      'REGENERATIVE_BRAKING',
      'V2L_SUPPORT',
      'ONE_PEDAL_DRIVING',
      'BATTERY_PRECONDITIONING',
    ],
    title: 'EV & charging',
  },
  {
    codes: ['TOLL_RFID', 'AUTOSWEEP_RFID', 'EASYTRIP_RFID'],
    title: 'Other',
  },
] as const;
const evFeaturePowertrains = new Set(['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID']);
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
const photoPerspectiveGuidance: Record<(typeof perspectives)[number], string> = {
  ADDITIONAL: 'Add another useful angle or detail.',
  CARGO: 'Show the usable trunk or cargo space.',
  DASHBOARD: 'Show the dashboard and controls clearly.',
  DRIVER_SIDE: 'Capture the full driver side in good light.',
  FRONT: 'Capture the full front of the vehicle.',
  INTERIOR: 'Show the cabin, seating, and overall condition.',
  INTERIOR_DASHBOARD: 'Show the front cabin and dashboard together.',
  PASSENGER_SIDE: 'Capture the full passenger side in good light.',
  REAR: 'Capture the full rear of the vehicle.',
};
const documentGuidance: Record<string, string> = {
  CERTIFICATE_OF_REGISTRATION: 'Vehicle registration document.',
  CURRENT_REGISTRATION_EVIDENCE: 'Latest registration evidence.',
  INSURANCE_EVIDENCE: 'Current insurance document.',
  OWNERSHIP_AUTHORIZATION: 'Add this if ownership or permission needs supporting evidence.',
};

export function VehiclesScreen({
  initialVehicleId,
  ownerWorkspace,
}: {
  readonly initialVehicleId?: string;
  readonly ownerWorkspace?: OwnerWorkspace;
}) {
  return ownerWorkspace && ownerWorkspace.capacity !== 'OWNER' ? (
    <DelegatedVehiclesScreen
      {...(initialVehicleId ? { initialVehicleId } : {})}
      ownerWorkspace={ownerWorkspace}
    />
  ) : (
    <ActualOwnerVehiclesScreen {...(initialVehicleId ? { initialVehicleId } : {})} />
  );
}

function ActualOwnerVehiclesScreen({ initialVehicleId }: { readonly initialVehicleId?: string }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialVehicleId ?? null);
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
  const changeProposals = useQuery({
    queryKey: ['owner-vehicle-change-proposals'],
    queryFn: () =>
      apiClient.request<OwnerVehicleChangeProposalListResponse>('/owner/vehicle-change-proposals'),
    retry: false,
  });
  const proposalByVehicle = new Map(
    changeProposals.data?.proposals.map((proposal) => [proposal.vehicleId, proposal]) ?? [],
  );
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
        onRemoved={() => {
          setSelectedId(null);
          void client.invalidateQueries({ queryKey: ['vehicles'] });
          Alert.alert('Vehicle removed', 'The vehicle has been removed from your fleet.');
        }}
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
        <View style={styles.fleetHeader}>
          <Text style={styles.eyebrow}>OWNER FLEET</Text>
          <Text style={styles.fleetTitle}>My vehicles</Text>
          <Text style={styles.fleetHelper}>
            Drafts are saved automatically, so you can leave and resume anytime.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={[styles.primaryButton, styles.fleetAddAction]}
          onPress={() => create.mutate()}
        >
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
          <FleetVehicleCard
            key={vehicle.id}
            {...(proposalByVehicle.get(vehicle.id)
              ? { changeProposal: proposalByVehicle.get(vehicle.id)! }
              : {})}
            vehicle={vehicle}
            onPress={() => {
              const proposal = proposalByVehicle.get(vehicle.id);
              if (proposal?.status === 'PENDING_OWNER_APPROVAL') {
                navigation.navigate('OwnerVehicleChangeProposal', {
                  proposalId: proposal.id,
                  vehicleId: vehicle.id,
                });
                return;
              }
              setSelectedId(vehicle.id);
            }}
          />
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

function DelegatedVehiclesScreen({
  initialVehicleId,
  ownerWorkspace,
}: {
  readonly initialVehicleId?: string;
  readonly ownerWorkspace: OwnerWorkspace;
}) {
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(initialVehicleId ?? null);
  const [editing, setEditing] = useState(false);
  const [proposalEditing, setProposalEditing] = useState(false);
  const [managingAvailability, setManagingAvailability] = useState(false);
  const canCreate =
    ownerWorkspace.capacity === 'MANAGER' &&
    ownerWorkspace.membershipStatus === 'ACTIVE' &&
    hasOwnerPermission(ownerWorkspace, 'vehicles.create');
  const canEditOperational =
    ownerWorkspace.capacity === 'MANAGER' &&
    ownerWorkspace.membershipStatus === 'ACTIVE' &&
    hasOwnerPermission(ownerWorkspace, 'vehicles.update_operational_fields');
  const workspaceBase = `/owner/workspaces/${ownerWorkspace.ownerProfileId}/vehicles`;
  const vehicles = useQuery({
    queryKey: ['owner-workspace', ownerWorkspace.ownerProfileId, 'vehicles'],
    queryFn: () =>
      apiClient.request<Vehicle[]>(`/owner/workspaces/${ownerWorkspace.ownerProfileId}/vehicles`),
    refetchInterval: (query) =>
      query.state.data?.some(
        (vehicle) =>
          vehicle.ownerApproval?.status === 'PENDING' || vehicle.status === 'PENDING_APPROVAL',
      )
        ? 5_000
        : false,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const selected = vehicles.data?.find(({ id }) => id === selectedId) ?? null;
  const create = useMutation({
    mutationFn: () => apiClient.request<Vehicle>(workspaceBase, { body: '{}', method: 'POST' }),
    onSuccess: (vehicle) => {
      setSelectedId(vehicle.id);
      setEditing(true);
      void vehicles.refetch();
    },
  });
  const withdraw = useMutation({
    mutationFn: (vehicleId: string) =>
      apiClient.request(`${workspaceBase}/${vehicleId}/owner-approval-submission`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await vehicles.refetch();
      setEditing(true);
    },
  });
  if (selectedId && editing)
    return (
      <VehicleEditor
        delegated
        endpointBase={`${workspaceBase}/${selectedId}`}
        id={selectedId}
        referenceBase={`${workspaceBase}/reference-data`}
        onClose={() => {
          setEditing(false);
          void client.invalidateQueries({
            queryKey: ['owner-workspace', ownerWorkspace.ownerProfileId, 'vehicles'],
          });
        }}
      />
    );
  if (selected && proposalEditing)
    return (
      <ManagerVehicleProposalEditor
        workspaceBase={workspaceBase}
        vehicle={selected}
        onClose={() => {
          setProposalEditing(false);
          void vehicles.refetch();
        }}
      />
    );
  if (selected)
    return (
      <DelegatedVehicleDetail
        canCreate={canCreate}
        canEdit={canEditOperational}
        managingAvailability={managingAvailability}
        ownerWorkspace={ownerWorkspace}
        vehicleId={selected.id}
        workspaceBase={workspaceBase}
        onBack={() => setSelectedId(null)}
        onContinueSetup={() => setEditing(true)}
        onEditProposal={() => setProposalEditing(true)}
        onManageAvailability={setManagingAvailability}
        onWithdraw={() => withdraw.mutate(selected.id)}
      />
    );
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.fleetHeader}>
          <Text style={styles.eyebrow}>OWNER FLEET</Text>
          <Text style={styles.fleetTitle}>Vehicles</Text>
          <Text style={styles.fleetHelper}>
            {canCreate
              ? 'Create and manage vehicle drafts for this Owner workspace.'
              : 'You can view vehicles in this workspace.'}
          </Text>
        </View>
        {canCreate ? (
          <Pressable
            accessibilityRole="button"
            disabled={create.isPending}
            onPress={() => create.mutate()}
            style={[styles.primaryButton, styles.fleetAddAction]}
          >
            <Text style={styles.primaryText}>{create.isPending ? 'Creating…' : 'Add vehicle'}</Text>
          </Pressable>
        ) : null}
        {create.error ? <Text style={styles.error}>{create.error.message}</Text> : null}
        {vehicles.isPending ? <StateView loading title="Loading assigned vehicles…" /> : null}
        {vehicles.isError ? (
          <StateView
            actionLabel="Retry"
            icon="cloud-offline-outline"
            message="You may no longer have access to these vehicles."
            onAction={() => void vehicles.refetch()}
            title="Vehicles unavailable"
          />
        ) : null}
        {vehicles.data?.map((vehicle) => (
          <FleetVehicleCard
            delegated
            key={vehicle.id}
            vehicle={vehicle}
            onPress={() => setSelectedId(vehicle.id)}
          />
        ))}
        {!vehicles.isPending && !vehicles.isError && vehicles.data?.length === 0 ? (
          <StateView
            icon="car-sport-outline"
            message="You do not currently have any vehicles assigned in this workspace."
            title="No assigned vehicles"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DelegatedVehicleDetail({
  canCreate,
  canEdit,
  managingAvailability,
  ownerWorkspace,
  vehicleId,
  workspaceBase,
  onBack,
  onContinueSetup,
  onEditProposal,
  onManageAvailability,
  onWithdraw,
}: {
  readonly canCreate: boolean;
  readonly canEdit: boolean;
  readonly managingAvailability: boolean;
  readonly ownerWorkspace: OwnerWorkspace;
  readonly vehicleId: string;
  readonly workspaceBase: string;
  readonly onBack: () => void;
  readonly onContinueSetup: () => void;
  readonly onEditProposal: () => void;
  readonly onManageAvailability: (value: boolean) => void;
  readonly onWithdraw: () => void;
}) {
  const vehicle = useQuery({
    queryKey: ['owner-workspace', ownerWorkspace.ownerProfileId, 'vehicle', vehicleId],
    queryFn: () => apiClient.request<Vehicle>(`${workspaceBase}/${vehicleId}`),
    refetchOnWindowFocus: true,
  });
  if (vehicle.isPending) return <StateView loading title="Loading vehicle…" />;
  if (vehicle.isError || !vehicle.data)
    return <StateView title="Vehicle unavailable" message={vehicle.error?.message} />;
  const value = vehicle.data;
  if (managingAvailability)
    return (
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.page}>
          <BackControl label="Vehicle detail" onPress={() => onManageAvailability(false)} />
          <AvailabilityStep
            canUpdate={hasOwnerPermission(ownerWorkspace, 'availability.update')}
            endpointBase={`${workspaceBase}/${vehicleId}`}
            id={vehicleId}
            ownerProfileId={ownerWorkspace.ownerProfileId}
            vehicle={value}
            onSaved={() => void vehicle.refetch()}
          />
        </ScrollView>
      </SafeAreaView>
    );
  const cover = value.photos.find(({ isCover }) => isCover) ?? value.photos[0];
  const policy = value.policyVersions[0];
  const activeDocuments = value.documents.filter(({ replacedAt }) => !replacedAt);
  const activeIssues = value.knownIssues.filter(({ status }) => status === 'ACTIVE');
  const proposal = value.activeChangeProposal;
  const proposalEditable =
    proposal?.isCreator &&
    ['DRAFT', 'OWNER_CHANGES_REQUIRED', 'PLATFORM_CHANGES_REQUIRED'].includes(proposal.status);
  const canStartProposal =
    value.status === 'APPROVED' &&
    canEdit &&
    value.capabilities?.canStartVehicleProposal === true &&
    (!proposal || proposalEditable);
  const proposalLabel = delegatedProposalStatusLabel(proposal?.status);
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={styles.vehicleDetailHeader}>
        <BackControl label="Back" onPress={onBack} />
      </View>
      <ScrollView contentContainerStyle={[styles.page, styles.vehicleDetailPage]}>
        <VehicleImage
          accessibilityLabel={`${value.make ?? ''} ${value.model ?? 'vehicle'} cover photo`}
          contentPath={cover?.fileAsset.contentGrant?.contentPath}
          style={styles.hero}
        />
        <Text style={styles.title}>{[value.make, value.model].filter(Boolean).join(' ')}</Text>
        <View style={styles.vehicleMetaRow}>
          <Text style={[styles.body, styles.vehicleMetaText]}>
            {value.modelYear ?? '—'} · {value.category?.name ?? 'Vehicle'} ·{' '}
            {domainLabel(value.fuelType)}
          </Text>
          <StatusBadge label={vehicleStatusLabel(value.status)} tone={vehicleTone(value.status)} />
        </View>
        {proposalLabel ? (
          <VehicleDetailSection
            emphasized
            title={
              proposal?.status === 'DRAFT' && !proposal.isCreator
                ? 'Vehicle changes are already being prepared'
                : proposalLabel
            }
          >
            <Text style={styles.vehicleDetailHelper}>
              The live vehicle details below remain unchanged while these changes are reviewed.
            </Text>
          </VehicleDetailSection>
        ) : null}
        {value.status === 'DRAFT' && value.ownerApproval?.status === 'PENDING' ? (
          <VehicleDetailSection title="Waiting for Owner review">
            <Text style={styles.vehicleDetailHelper}>
              The Owner needs to approve this vehicle before it can be submitted to CarShare.
            </Text>
            <DetailAction label="Withdraw submission" onPress={onWithdraw} />
          </VehicleDetailSection>
        ) : value.status === 'DRAFT' && canCreate ? (
          <View style={styles.vehicleEditAction}>
            <DetailAction label="Continue setup" onPress={onContinueSetup} />
          </View>
        ) : null}
        {canStartProposal ? (
          <View style={styles.vehicleEditAction}>
            <DetailAction
              label={proposalEditable ? 'Continue editing changes' : 'Edit vehicle'}
              onPress={onEditProposal}
            />
            <Text style={styles.vehicleDetailHelper}>
              Vehicle changes use the workspace approval and CarShare review flow.
            </Text>
          </View>
        ) : null}
        <VehicleDetailSection title="Vehicle overview">
          <View style={styles.vehicleOverviewGrid}>
            <VehicleDetailValue label="Transmission" value={domainLabel(value.transmission)} />
            <VehicleDetailValue label="Powertrain" value={domainLabel(value.powertrain)} />
            <VehicleDetailValue label="Color" value={value.color ?? 'Not set'} />
            <VehicleDetailValue label="Seats" value={String(value.seatCount ?? '—')} />
          </View>
        </VehicleDetailSection>
        <VehicleDetailSection title="Description & rental requirements">
          <VehicleDetailSummary label="Description" value={value.description ?? 'Not configured'} />
          <VehicleDetailSummary
            label="Rental requirements"
            value={value.rentalRequirements ?? 'Not configured'}
          />
        </VehicleDetailSection>
        <VehicleDetailSection title="Registration & verification">
          <VehicleDetailRow label="Documents" value={`${activeDocuments.length} attached`} />
          <VehicleDetailRow label="Photos" value={`${value.photos.length} attached`} />
          <VehicleDetailRow label="Plate number" value={value.plateNumber ?? 'Not set'} />
        </VehicleDetailSection>
        <VehicleDetailSection title="Private pickup location">
          <VehicleDetailRow
            label="Location"
            value={
              value.location
                ? `${value.location.city}, ${value.location.province}`
                : 'Not configured'
            }
          />
          {value.location ? (
            <Text style={styles.vehicleDetailHelper}>
              {ownerPrivateLocationLabel(value.location)}
            </Text>
          ) : null}
        </VehicleDetailSection>
        <VehicleDetailSection title="Pricing">
          <VehicleDetailRow
            label="Daily rate"
            value={policy ? money(policy.dailyRateMinor) : 'Not configured'}
          />
          <VehicleDetailRow
            label="Security deposit"
            value={
              policy?.securityDepositRequired
                ? money(policy.securityDepositAmountMinor ?? 0)
                : 'Not required'
            }
          />
          <VehicleDetailRow
            label="Rental duration"
            value={
              policy
                ? `${policy.minimumRentalDays}–${policy.maximumRentalDays} days`
                : 'Not configured'
            }
          />
          <VehicleDetailRow
            label="Delivery fee"
            value={policy?.deliveryFeeMinor ? money(policy.deliveryFeeMinor) : 'Not configured'}
          />
          <VehicleDetailRow
            label="Collection fee"
            value={policy?.collectionFeeMinor ? money(policy.collectionFeeMinor) : 'Not configured'}
          />
          <VehicleDetailRow
            label="Excess-distance fee"
            value={
              policy?.excessKilometerRateMinor
                ? `${money(policy.excessKilometerRateMinor)} / km`
                : 'Not configured'
            }
          />
          <VehicleDetailRow
            label="Long-booking discounts"
            value={
              policy &&
              [
                policy.shortDurationDiscountBps,
                policy.weeklyDiscountBps,
                policy.extendedTripDiscountBps,
                policy.monthlyDiscountBps,
              ].some((value) => (value ?? 0) > 0)
                ? 'Enabled'
                : 'Not enabled'
            }
          />
        </VehicleDetailSection>
        <VehicleDetailSection title="Features">
          <VehicleDetailRow label="Selected features" value={String(value.features.length)} />
        </VehicleDetailSection>
        <VehicleDetailSection title="Handover & usage">
          <VehicleDetailSummary
            label="Mileage"
            value={
              policy?.mileagePolicy === 'UNLIMITED'
                ? 'Unlimited'
                : policy
                  ? `${policy.includedKilometersPerDay ?? 0} km/day included`
                  : 'Not configured'
            }
          />
          <VehicleDetailSummary
            label="Turnaround"
            value={policy ? `${policy.turnaroundMinutes / 60} hours` : 'Not configured'}
          />
          <VehicleDetailSummary
            label="Minimum notice"
            value={policy ? `${policy.fulfillmentMinimumNoticeMinutes} minutes` : 'Not configured'}
          />
          <VehicleDetailSummary
            label="Fuel return"
            value={
              policy?.fuelReturnPolicy ? domainLabel(policy.fuelReturnPolicy) : 'Not applicable'
            }
          />
          <VehicleDetailSummary
            label="EV return"
            value={policy?.evReturnPolicy ? domainLabel(policy.evReturnPolicy) : 'Not applicable'}
          />
          <VehicleDetailSummary
            label="Availability policy"
            value={policy ? domainLabel(policy.availabilityPolicy) : 'Not configured'}
          />
          <VehicleDetailSummary
            label="Fulfillment"
            value={policy ? fulfillmentSummary(policy) : 'Not configured'}
          />
        </VehicleDetailSection>
        <VehicleDetailSection title="Known vehicle issues">
          <Text style={styles.vehicleOperationalValue}>{activeIssues.length} active</Text>
          {activeIssues.slice(0, 3).map((issue) => (
            <Text key={issue.id} style={styles.vehicleDetailHelper}>
              {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
            </Text>
          ))}
        </VehicleDetailSection>
        <VehicleDetailSection
          action={
            hasOwnerPermission(ownerWorkspace, 'availability.view') ? (
              <DetailAction
                label="Manage availability"
                onPress={() => onManageAvailability(true)}
              />
            ) : null
          }
          emphasized
          title="Marketplace & availability"
        >
          <VehicleDetailRow label="Review status" value={ownerMarketplaceStatus(value)} />
          <VehicleDetailRow
            label="Availability"
            value={availabilityTodayLabel(value.availabilityToday)}
          />
        </VehicleDetailSection>
      </ScrollView>
    </SafeAreaView>
  );
}

function _DelegatedVehicleCard({
  vehicle,
  onPress,
}: {
  readonly vehicle: Vehicle;
  readonly onPress: () => void;
}) {
  const cover = vehicle.photos.find(({ isCover }) => isCover) ?? vehicle.photos[0];
  const title = [vehicle.modelYear, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const metadata = [vehicle.category?.name, vehicle.location?.city].filter(Boolean).join(' · ');
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.fleetCard}>
      <VehicleImage
        accessibilityLabel={`${title || 'Vehicle'} cover photo`}
        contentPath={cover?.fileAsset.contentGrant?.contentPath}
        style={styles.fleetImage}
      />
      <View style={styles.fleetContent}>
        <Text numberOfLines={2} style={styles.fleetVehicleTitle}>
          {title || 'Vehicle'}
        </Text>
        <StatusBadge
          label={delegatedApprovalLabel(vehicle)}
          tone={delegatedApprovalTone(vehicle)}
        />
        {metadata ? <Text style={styles.fleetMetadata}>{metadata}</Text> : null}
        <Text style={styles.fleetMarketplaceState}>
          {vehicle.ownerApproval?.status === 'PENDING'
            ? 'Waiting for Owner review'
            : vehicle.ownerApproval?.status === 'CHANGES_REQUIRED' && vehicle.status === 'DRAFT'
              ? 'Owner feedback available'
              : vehicle.status === 'DRAFT'
                ? 'Setup in progress'
                : 'Read only'}
        </Text>
      </View>
    </Pressable>
  );
}

function ManagerVehicleProposalEditor({
  workspaceBase,
  vehicle,
  onClose,
}: {
  readonly workspaceBase: string;
  readonly vehicle: Vehicle;
  readonly onClose: () => void;
}) {
  const proposalBase = `${workspaceBase}/${vehicle.id}/change-proposals`;
  const active = vehicle.activeChangeProposal;
  const proposal = useQuery({
    queryKey: ['manager-vehicle-change-proposal', vehicle.id, active?.id ?? 'new'],
    queryFn: () =>
      active?.id
        ? apiClient.request<GetVehicleChangeProposalResponse>(`${proposalBase}/${active.id}`)
        : apiClient.request<CreateVehicleChangeProposalResponse>(proposalBase, {
            body: '{}',
            method: 'POST',
          }),
    retry: false,
  });
  const [snapshotOverride, setSnapshot] = useState<VehicleChangeProposalSnapshotV1 | null>(null);
  const snapshot = snapshotOverride ?? proposal.data?.proposedSnapshot ?? null;
  const submit = useMutation({
    mutationFn: async () => {
      if (!proposal.data || !snapshot) throw new Error('Proposal is not ready.');
      await apiClient.request<UpdateVehicleChangeProposalResponse>(
        `${proposalBase}/${proposal.data.id}`,
        { body: JSON.stringify({ proposedSnapshot: snapshot }), method: 'PATCH' },
      );
      return apiClient.request<SubmitVehicleChangeProposalResponse>(
        `${proposalBase}/${proposal.data.id}/submission`,
        { method: 'POST' },
      );
    },
    onSuccess: onClose,
  });
  if (proposal.isPending || !snapshot) return <StateView loading title="Preparing changes…" />;
  if (proposal.isError)
    return <StateView title="Changes unavailable" message={proposal.error.message} />;
  const updateVehicle = (
    key: keyof VehicleChangeProposalSnapshotV1['vehicle'],
    value: string | number | null,
  ) => setSnapshot({ ...snapshot, vehicle: { ...snapshot.vehicle, [key]: value } });
  const updatePolicy = (
    key: keyof VehicleChangeProposalSnapshotV1['policy'],
    value: string | number | boolean | null,
  ) => setSnapshot({ ...snapshot, policy: { ...snapshot.policy, [key]: value } });
  const trusted = vehicle.capabilities?.ownerApprovalBypassEnabled === true;
  const sensitive =
    proposal.data?.classification === 'PLATFORM_REVIEW_REQUIRED' ||
    (proposal.data && snapshot
      ? classifyVehicleChangedFields(
          diffVehicleChangeProposalSnapshots(proposal.data.proposedSnapshot, snapshot),
        ) === 'PLATFORM_REVIEW_REQUIRED'
      : false);
  const resubmission =
    active?.status === 'OWNER_CHANGES_REQUIRED' || active?.status === 'PLATFORM_CHANGES_REQUIRED';
  const actionLabel = submit.isPending
    ? 'Submitting…'
    : resubmission
      ? 'Resubmit changes'
      : trusted
        ? sensitive
          ? 'Submit changes for review'
          : 'Save changes'
        : 'Submit changes for Owner approval';
  const proposalAssets = new Map(
    (proposal.data?.assets ?? []).map((asset) => [asset.fileAssetId, asset]),
  );
  const proposedPhotos: VehiclePhoto[] = snapshot.photos.map((photo) => {
    const live = vehicle.photos.find(({ fileAsset }) => fileAsset.id === photo.fileAssetId);
    const asset = proposalAssets.get(photo.fileAssetId);
    return {
      displayOrder: photo.displayOrder,
      fileAsset: live?.fileAsset ?? {
        id: photo.fileAssetId,
        originalName: asset?.originalName ?? 'Proposed photo',
        ...(asset?.contentGrant ? { contentGrant: asset.contentGrant } : {}),
      },
      id: photo.fileAssetId,
      isCover: photo.isCover,
      perspective: photo.perspective,
    };
  });
  const proposedDocuments: VehicleDocument[] = snapshot.documents.map((document) => {
    const live = vehicle.documents.find(({ fileAsset }) => fileAsset.id === document.fileAssetId);
    const asset = proposalAssets.get(document.fileAssetId);
    return {
      definition: live?.definition ?? {
        code: document.documentType,
        id: document.definitionId,
        name: domainLabel(document.documentType),
      },
      definitionId: document.definitionId,
      fileAsset: live?.fileAsset ?? {
        id: document.fileAssetId,
        originalName: asset?.originalName ?? domainLabel(document.documentType),
        ...(asset?.contentGrant ? { contentGrant: asset.contentGrant } : {}),
      },
      id: document.fileAssetId,
      replacedAt: null,
    };
  });
  const refreshProposalAssets = async () => {
    setSnapshot(null);
    await proposal.refetch();
  };
  const persistProposalDraft = () =>
    apiClient.request<UpdateVehicleChangeProposalResponse>(`${proposalBase}/${proposal.data.id}`, {
      body: JSON.stringify({ proposedSnapshot: snapshot }),
      method: 'PATCH',
    });
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardDismissMode={formKeyboardDismissMode}
          keyboardShouldPersistTaps="handled"
        >
          <BackControl label="Vehicle detail" onPress={onClose} />
          <Text style={styles.eyebrow}>VEHICLE CHANGES</Text>
          <Text style={styles.title}>Edit vehicle</Text>
          <Text style={styles.body}>
            Current marketplace details stay live until this proposal completes the required review.
          </Text>
          <Section title="Vehicle details">
            <Field
              label="Make"
              value={snapshot.vehicle.make ?? ''}
              onChange={(value) => updateVehicle('make', value)}
            />
            <Field
              label="Model"
              value={snapshot.vehicle.model ?? ''}
              onChange={(value) => updateVehicle('model', value)}
            />
            <Field
              keyboard="numeric"
              label="Model year"
              value={String(snapshot.vehicle.modelYear ?? '')}
              onChange={(value) => updateVehicle('modelYear', value ? Number(value) : null)}
            />
            <Field
              label="Variant"
              value={snapshot.vehicle.variant ?? ''}
              onChange={(value) => updateVehicle('variant', value)}
            />
            <Field
              label="Color"
              value={snapshot.vehicle.color ?? ''}
              onChange={(value) => updateVehicle('color', value)}
            />
            <Field
              label="Description"
              multiline
              value={snapshot.vehicle.description ?? ''}
              onChange={(value) => updateVehicle('description', value)}
            />
            <Field
              label="Rental requirements"
              multiline
              value={snapshot.vehicle.rentalRequirements ?? ''}
              onChange={(value) => updateVehicle('rentalRequirements', value)}
            />
          </Section>
          <Section title="Pricing & rental policy">
            <Field
              keyboard="numeric"
              label="Daily rate"
              prefix="₱"
              value={String(snapshot.policy.dailyRateMinor / 100)}
              onChange={(value) =>
                updatePolicy('dailyRateMinor', Math.round(Number(value || 0) * 100))
              }
            />
            <Field
              keyboard="numeric"
              label="Minimum rental days"
              value={String(snapshot.policy.minimumRentalDays)}
              onChange={(value) => updatePolicy('minimumRentalDays', Number(value || 0))}
            />
            <Field
              keyboard="numeric"
              label="Maximum rental days"
              value={String(snapshot.policy.maximumRentalDays)}
              onChange={(value) => updatePolicy('maximumRentalDays', Number(value || 0))}
            />
            <Field
              keyboard="numeric"
              label="Included kilometers per day"
              value={String(snapshot.policy.includedKilometersPerDay ?? '')}
              onChange={(value) =>
                updatePolicy('includedKilometersPerDay', value ? Number(value) : null)
              }
            />
            <Field
              keyboard="numeric"
              label="Turnaround minutes"
              value={String(snapshot.policy.turnaroundMinutes)}
              onChange={(value) => updatePolicy('turnaroundMinutes', Number(value || 0))}
            />
            <Field
              keyboard="numeric"
              label="Minimum notice minutes"
              value={String(snapshot.policy.fulfillmentMinimumNoticeMinutes)}
              onChange={(value) =>
                updatePolicy('fulfillmentMinimumNoticeMinutes', Number(value || 0))
              }
            />
            <DepositRequirementSelector
              required={snapshot.policy.securityDepositRequired}
              onChange={(required) =>
                setSnapshot({
                  ...snapshot,
                  policy: {
                    ...snapshot.policy,
                    securityDepositAmountMinor: required
                      ? snapshot.policy.securityDepositAmountMinor
                      : null,
                    securityDepositRequired: required,
                  },
                })
              }
            />
            {snapshot.policy.securityDepositRequired ? (
              <Field
                keyboard="numeric"
                label="Security deposit"
                prefix="₱"
                value={String((snapshot.policy.securityDepositAmountMinor ?? 0) / 100)}
                onChange={(value) =>
                  updatePolicy('securityDepositAmountMinor', Math.round(Number(value || 0) * 100))
                }
              />
            ) : null}
          </Section>
          <Section title="Location">
            {snapshot.location ? (
              <>
                <Field
                  label="City"
                  value={snapshot.location.city}
                  onChange={(city) =>
                    setSnapshot({ ...snapshot, location: { ...snapshot.location!, city } })
                  }
                />
                <Field
                  label="Province"
                  value={snapshot.location.province}
                  onChange={(province) =>
                    setSnapshot({ ...snapshot, location: { ...snapshot.location!, province } })
                  }
                />
                <Field
                  label="Pickup area"
                  value={snapshot.location.pickupAreaLabel ?? ''}
                  onChange={(pickupAreaLabel) =>
                    setSnapshot({
                      ...snapshot,
                      location: { ...snapshot.location!, pickupAreaLabel },
                    })
                  }
                />
              </>
            ) : (
              <Text style={styles.vehicleDetailHelper}>No pickup location configured</Text>
            )}
            <VehicleDetailRow label="Features" value={`${snapshot.featureIds.length} selected`} />
          </Section>
          <PhotosStep
            endpointBase={`${proposalBase}/${proposal.data.id}`}
            photos={proposedPhotos}
            proposalMode
            beforeMutation={persistProposalDraft}
            onSaved={() => void refreshProposalAssets()}
          />
          <DocumentsStep
            documents={proposedDocuments}
            endpointBase={`${proposalBase}/${proposal.data.id}`}
            proposalMode
            referenceBase={`${workspaceBase}/reference-data`}
            beforeMutation={persistProposalDraft}
            onSaved={() => void refreshProposalAssets()}
          />
          <Button disabled={submit.isPending} label={actionLabel} onPress={() => submit.mutate()} />
          {submit.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {submit.error.message}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Retained temporarily for compatibility with the narrow legacy operational endpoints.
// New Manager editing enters ManagerVehicleProposalEditor above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ManagerOperationalVehicleEditor({
  endpointBase,
  ownerProfileId,
  vehicle,
  onClose,
}: {
  readonly endpointBase: string;
  readonly ownerProfileId: string;
  readonly vehicle: Vehicle;
  readonly onClose: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const [description, setDescription] = useState(vehicle.description ?? '');
  const [rentalRequirements, setRentalRequirements] = useState(vehicle.rentalRequirements ?? '');
  const [selectedFeatures, setSelectedFeatures] = useState(
    vehicle.features.map(({ featureId }) => featureId),
  );
  const [minimumRentalDays, setMinimumRentalDays] = useState(
    String(current?.minimumRentalDays ?? 1),
  );
  const [maximumRentalDays, setMaximumRentalDays] = useState(
    String(current?.maximumRentalDays ?? 30),
  );
  const [includedKilometers, setIncludedKilometers] = useState(
    String(current?.includedKilometersPerDay ?? 150),
  );
  const [limitedMileage, setLimitedMileage] = useState(current?.mileagePolicy !== 'UNLIMITED');
  const [turnaround, setTurnaround] = useState(current?.turnaroundMinutes ?? 120);
  const [availabilityPolicy, setAvailabilityPolicy] = useState(
    current?.availabilityPolicy ?? 'EVERY_DAY',
  );
  const [availableDays, setAvailableDays] = useState({
    friday: current?.friday ?? true,
    monday: current?.monday ?? true,
    saturday: current?.saturday ?? true,
    sunday: current?.sunday ?? true,
    thursday: current?.thursday ?? true,
    tuesday: current?.tuesday ?? true,
    wednesday: current?.wednesday ?? true,
  });
  const [fuelReturnPolicy, setFuelReturnPolicy] = useState(
    current?.fuelReturnPolicy ?? 'SAME_TO_SAME',
  );
  const [fuelTolerance, setFuelTolerance] = useState(String(current?.fuelTolerancePercent ?? 5));
  const [evReturnPolicy, setEvReturnPolicy] = useState(current?.evReturnPolicy ?? 'SAME_TO_SAME');
  const [evRequiredPercentage, setEvRequiredPercentage] = useState(
    String(current?.evRequiredPercentage ?? 80),
  );
  const [evTolerance, setEvTolerance] = useState(String(current?.evTolerancePercent ?? 5));
  const [renterPickup, setRenterPickup] = useState(current?.supportsRenterPickup ?? true);
  const [ownerDelivery, setOwnerDelivery] = useState(current?.supportsOwnerDelivery ?? false);
  const [renterReturn, setRenterReturn] = useState(current?.supportsRenterReturn ?? true);
  const [ownerCollection, setOwnerCollection] = useState(current?.supportsOwnerCollection ?? false);
  const [serviceRadiusKm, setServiceRadiusKm] = useState(
    String((current?.fulfillmentServiceRadiusMeters ?? 25_000) / 1000),
  );
  const [minimumNotice, setMinimumNotice] = useState(
    String(current?.fulfillmentMinimumNoticeMinutes ?? 0),
  );
  const [operationalStatus, setOperationalStatus] = useState(vehicle.operationalStatus);
  const [error, setError] = useState('');
  const features = useQuery({
    queryKey: ['owner-workspace', ownerProfileId, 'operational-features'],
    queryFn: () =>
      apiClient.request<Reference[]>(
        `/owner/workspaces/${ownerProfileId}/vehicles/operational-reference-data/features`,
      ),
  });
  const saveDetails = useMutation({
    mutationFn: () =>
      apiClient.request<Vehicle>(`${endpointBase}/operational-details`, {
        body: JSON.stringify({
          description,
          expectedRevision: vehicle.revision,
          rentalRequirements,
        }),
        method: 'PATCH',
      }),
    onError: (caught) => setError(managerOperationalEditError(caught)),
    onSuccess: onClose,
  });
  const saveFeatures = useMutation({
    mutationFn: () =>
      apiClient.request<Vehicle>(`${endpointBase}/operational-features`, {
        body: JSON.stringify({ expectedRevision: vehicle.revision, featureIds: selectedFeatures }),
        method: 'PUT',
      }),
    onError: (caught) => setError(managerOperationalEditError(caught)),
    onSuccess: onClose,
  });
  const savePolicy = useMutation({
    mutationFn: () =>
      apiClient.request<Vehicle>(`${endpointBase}/operational-policy`, {
        body: JSON.stringify({
          availabilityPolicy,
          expectedRevision: vehicle.revision,
          friday: availableDays.friday,
          ...(vehicle.powertrain === 'BATTERY_ELECTRIC'
            ? {
                ...(evReturnPolicy === 'MINIMUM_PERCENTAGE'
                  ? { evRequiredPercentage: Number(evRequiredPercentage) }
                  : {}),
                evReturnPolicy,
                evTolerancePercent: Number(evTolerance),
              }
            : {
                fuelReturnPolicy,
                fuelTolerancePercent: Number(fuelTolerance),
              }),
          fulfillmentMinimumNoticeMinutes: Number(minimumNotice),
          ...(ownerDelivery || ownerCollection
            ? { fulfillmentServiceRadiusMeters: Math.round(Number(serviceRadiusKm) * 1000) }
            : {}),
          ...(limitedMileage ? { includedKilometersPerDay: Number(includedKilometers) } : {}),
          maximumRentalDays: Number(maximumRentalDays),
          mileagePolicy: limitedMileage ? 'LIMITED' : 'UNLIMITED',
          minimumRentalDays: Number(minimumRentalDays),
          monday: availableDays.monday,
          saturday: availableDays.saturday,
          sunday: availableDays.sunday,
          supportsOwnerCollection: ownerCollection,
          supportsOwnerDelivery: ownerDelivery,
          supportsRenterPickup: renterPickup,
          supportsRenterReturn: renterReturn,
          thursday: availableDays.thursday,
          turnaroundMinutes: turnaround,
          tuesday: availableDays.tuesday,
          wednesday: availableDays.wednesday,
        }),
        method: 'POST',
      }),
    onError: (caught) => setError(managerOperationalEditError(caught)),
    onSuccess: onClose,
  });
  const saveStatus = useMutation({
    mutationFn: () =>
      apiClient.request<Vehicle>(`${endpointBase}/operational-status`, {
        body: JSON.stringify({ expectedRevision: vehicle.revision, status: operationalStatus }),
        method: 'PATCH',
      }),
    onError: (caught) => setError(managerOperationalEditError(caught)),
    onSuccess: onClose,
  });
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={styles.page}
        keyboardDismissMode={formKeyboardDismissMode}
        keyboardShouldPersistTaps="handled"
      >
        <BackControl label="Vehicle detail" onPress={onClose} />
        <Text style={styles.title}>Edit vehicle settings</Text>
        <Text style={styles.body}>Update day-to-day settings for this vehicle.</Text>
        <Section title="Description & requirements">
          <Field label="Description" multiline value={description} onChange={setDescription} />
          <Field
            label="Rental requirements"
            multiline
            value={rentalRequirements}
            onChange={setRentalRequirements}
          />
          <Button
            disabled={saveDetails.isPending}
            label={saveDetails.isPending ? 'Saving…' : 'Save description'}
            onPress={() => {
              setError('');
              saveDetails.mutate();
            }}
          />
          <PolicyOptionGroup
            exclusive
            label="Weekly availability"
            options={[
              {
                label: 'Every day',
                onPress: () => setAvailabilityPolicy('EVERY_DAY'),
                selected: availabilityPolicy === 'EVERY_DAY',
              },
              {
                label: 'Choose days',
                onPress: () => setAvailabilityPolicy('WEEKLY'),
                selected: availabilityPolicy === 'WEEKLY',
              },
            ]}
          />
          {availabilityPolicy === 'WEEKLY' ? (
            <View style={styles.policyOptionGrid}>
              {(
                [
                  ['monday', 'Mon'],
                  ['tuesday', 'Tue'],
                  ['wednesday', 'Wed'],
                  ['thursday', 'Thu'],
                  ['friday', 'Fri'],
                  ['saturday', 'Sat'],
                  ['sunday', 'Sun'],
                ] as const
              ).map(([day, label]) => (
                <CompactPolicyChoice
                  key={day}
                  label={label}
                  selected={availableDays[day]}
                  onPress={() => setAvailableDays({ ...availableDays, [day]: !availableDays[day] })}
                />
              ))}
            </View>
          ) : null}
        </Section>
        <Section title="Features">
          {features.isPending ? <StateView loading title="Loading features…" /> : null}
          <View style={styles.featureChips}>
            {features.data?.map((feature) => {
              const selected = selectedFeatures.includes(feature.id);
              return (
                <FeatureChip
                  key={feature.id}
                  label={feature.name}
                  selected={selected}
                  onPress={() =>
                    setSelectedFeatures(
                      selected
                        ? selectedFeatures.filter((id) => id !== feature.id)
                        : [...selectedFeatures, feature.id],
                    )
                  }
                />
              );
            })}
          </View>
          <Button
            disabled={saveFeatures.isPending || features.isPending}
            label={saveFeatures.isPending ? 'Saving…' : 'Save features'}
            onPress={() => {
              setError('');
              saveFeatures.mutate();
            }}
          />
        </Section>
        <Section title="Rental settings">
          <PolicyOptionGroup
            exclusive
            label="Operational availability"
            options={[
              {
                label: 'Available',
                onPress: () => setOperationalStatus('AVAILABLE'),
                selected: operationalStatus === 'AVAILABLE',
              },
              {
                label: 'Unavailable',
                onPress: () => setOperationalStatus('TEMPORARILY_UNAVAILABLE'),
                selected: operationalStatus === 'TEMPORARILY_UNAVAILABLE',
              },
            ]}
          />
          <Button
            disabled={saveStatus.isPending}
            label={saveStatus.isPending ? 'Saving…' : 'Save availability status'}
            onPress={() => {
              setError('');
              saveStatus.mutate();
            }}
          />
          <View style={styles.compactFieldGrid}>
            <PolicyNumberField
              accessibilityLabel="Minimum rental days"
              label="Minimum days"
              value={minimumRentalDays}
              onChange={setMinimumRentalDays}
            />
            <PolicyNumberField
              accessibilityLabel="Maximum rental days"
              label="Maximum days"
              value={maximumRentalDays}
              onChange={setMaximumRentalDays}
            />
          </View>
          <PolicyOptionGroup
            exclusive
            label="Mileage allowance"
            options={[
              {
                label: 'Limited',
                onPress: () => setLimitedMileage(true),
                selected: limitedMileage,
              },
              {
                label: 'Unlimited',
                onPress: () => setLimitedMileage(false),
                selected: !limitedMileage,
              },
            ]}
          />
          {limitedMileage ? (
            <PolicyNumberField
              accessibilityLabel="Included kilometers per day"
              label="Included km/day"
              value={includedKilometers}
              onChange={setIncludedKilometers}
            />
          ) : null}
          <PolicyOptionGroup
            label="Start of rental"
            options={[
              {
                label: 'Renter pickup',
                onPress: () => setRenterPickup(!renterPickup),
                selected: renterPickup,
              },
              {
                label: 'Owner delivery',
                onPress: () => setOwnerDelivery(!ownerDelivery),
                selected: ownerDelivery,
              },
            ]}
          />
          <PolicyOptionGroup
            label="End of rental"
            options={[
              {
                label: 'Renter return',
                onPress: () => setRenterReturn(!renterReturn),
                selected: renterReturn,
              },
              {
                label: 'Owner collection',
                onPress: () => setOwnerCollection(!ownerCollection),
                selected: ownerCollection,
              },
            ]}
          />
          {ownerDelivery || ownerCollection ? (
            <View style={styles.compactFieldGrid}>
              <PolicyNumberField
                accessibilityLabel="Service radius in kilometers"
                label="Service radius (km)"
                value={serviceRadiusKm}
                onChange={setServiceRadiusKm}
              />
              <PolicyNumberField
                accessibilityLabel="Minimum booking notice in minutes"
                label="Minimum notice (minutes)"
                value={minimumNotice}
                onChange={setMinimumNotice}
              />
            </View>
          ) : null}
          <Text style={styles.compactFieldLabel}>Turnaround</Text>
          <View style={styles.policyOptionGrid}>
            {[120, 240, 360, 720, 1440].map((minutes) => (
              <CompactPolicyChoice
                key={minutes}
                label={`${minutes / 60} hr`}
                selected={turnaround === minutes}
                onPress={() => setTurnaround(minutes)}
              />
            ))}
          </View>
          <PolicyOptionGroup
            exclusive
            label={
              vehicle.powertrain === 'BATTERY_ELECTRIC' ? 'EV return level' : 'Fuel return level'
            }
            options={
              vehicle.powertrain === 'BATTERY_ELECTRIC'
                ? [
                    {
                      label: 'Same as pickup',
                      onPress: () => setEvReturnPolicy('SAME_TO_SAME'),
                      selected: evReturnPolicy === 'SAME_TO_SAME',
                    },
                    {
                      label: 'Minimum level',
                      onPress: () => setEvReturnPolicy('MINIMUM_PERCENTAGE'),
                      selected: evReturnPolicy === 'MINIMUM_PERCENTAGE',
                    },
                  ]
                : [
                    {
                      label: 'Same as pickup',
                      onPress: () => setFuelReturnPolicy('SAME_TO_SAME'),
                      selected: fuelReturnPolicy === 'SAME_TO_SAME',
                    },
                    {
                      label: 'Full tank',
                      onPress: () => setFuelReturnPolicy('FULL_TO_FULL'),
                      selected: fuelReturnPolicy === 'FULL_TO_FULL',
                    },
                  ]
            }
          />
          {vehicle.powertrain === 'BATTERY_ELECTRIC' ? (
            <View style={styles.compactFieldGrid}>
              {evReturnPolicy === 'MINIMUM_PERCENTAGE' ? (
                <PolicyNumberField
                  accessibilityLabel="Required EV return percentage"
                  label="Required charge %"
                  value={evRequiredPercentage}
                  onChange={setEvRequiredPercentage}
                />
              ) : null}
              <PolicyNumberField
                accessibilityLabel="EV return tolerance percentage"
                label="Tolerance %"
                value={evTolerance}
                onChange={setEvTolerance}
              />
            </View>
          ) : (
            <PolicyNumberField
              accessibilityLabel="Fuel return tolerance percentage"
              label="Tolerance %"
              value={fuelTolerance}
              onChange={setFuelTolerance}
            />
          )}
          <Button
            disabled={savePolicy.isPending || !current}
            label={savePolicy.isPending ? 'Saving…' : 'Save rental settings'}
            onPress={() => {
              setError('');
              savePolicy.mutate();
            }}
          />
        </Section>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function managerOperationalEditError(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'This vehicle changed since you opened it. Review the latest details before saving again.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'You no longer have permission to update this vehicle.';
  }
  return 'We couldn’t save these changes. Check your connection and try again.';
}

function FleetVehicleCard({
  changeProposal,
  delegated = false,
  vehicle,
  onPress,
}: {
  readonly changeProposal?: OwnerVehicleChangeProposalReviewModel;
  readonly delegated?: boolean;
  readonly vehicle: Vehicle;
  readonly onPress: () => void;
}) {
  const draft = vehicle.status === 'DRAFT';
  const cover = vehicle.photos.find(({ isCover }) => isCover) ?? vehicle.photos[0];
  const title =
    vehicle.make && vehicle.model
      ? `${vehicle.modelYear ?? ''} ${vehicle.make} ${vehicle.model}`.trim()
      : 'Untitled vehicle draft';
  const policy = vehicle.policyVersions[0];
  const metadata = [vehicle.category?.name, vehicle.location?.city].filter(Boolean).join(' · ');
  const awaitingOwnerApproval = vehicle.ownerApproval?.status === 'PENDING' && draft;
  const changeAwaitingOwner = changeProposal?.status === 'PENDING_OWNER_APPROVAL';
  const changeUnderReview = changeProposal?.status === 'PENDING_PLATFORM_REVIEW';
  const delegatedProposal = vehicle.activeChangeProposal;
  const actionLabel = awaitingOwnerApproval
    ? 'Review vehicle'
    : changeAwaitingOwner
      ? 'Review changes'
      : draft
        ? 'Continue setup'
        : 'Manage vehicle';
  const distinctAvailability = fleetDistinctAvailabilityLabel(vehicle.availabilityToday);
  const accessibilityDetails = draft
    ? awaitingOwnerApproval
      ? `${title}. Awaiting your approval. Review vehicle.`
      : `${title}. Draft. Setup in progress. Continue setup.`
    : `${title}. Status: ${vehicleStatusLabel(vehicle.status)}. ${policy ? `${money(policy.dailyRateMinor)} per day. ` : ''}${metadata ? `${metadata}. ` : ''}Marketplace: ${ownerMarketplaceStatus(vehicle)}. Vehicle availability: ${availabilityTodayLabel(vehicle.availabilityToday)}. Manage vehicle.`;

  return (
    <Pressable
      accessibilityLabel={accessibilityDetails}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.fleetCard, draft && styles.fleetDraftCard]}
    >
      <VehicleImage
        accessibilityLabel={`${title} cover photo`}
        contentPath={cover?.fileAsset.contentGrant?.contentPath}
        style={styles.fleetImage}
      />
      <View style={styles.fleetContent}>
        <Text numberOfLines={2} style={styles.fleetVehicleTitle}>
          {title}
        </Text>
        <StatusBadge
          label={
            delegatedProposal
              ? (delegatedProposalStatusLabel(delegatedProposal.status) ??
                vehicleStatusLabel(vehicle.status))
              : changeAwaitingOwner
                ? 'Changes awaiting your approval'
                : changeUnderReview
                  ? 'Changes under CarShare review'
                  : awaitingOwnerApproval
                    ? 'Awaiting your approval'
                    : vehicleStatusLabel(vehicle.status)
          }
          tone={
            changeAwaitingOwner || awaitingOwnerApproval ? 'warning' : vehicleTone(vehicle.status)
          }
        />
        {draft ? (
          <Text style={styles.fleetDraftState}>
            {awaitingOwnerApproval
              ? 'Review the Manager submission'
              : vehicle.ownerApproval?.status === 'CHANGES_REQUIRED'
                ? 'Returned to Manager'
                : 'Setup in progress'}
          </Text>
        ) : (
          <>
            {policy && <Text style={styles.fleetRate}>{money(policy.dailyRateMinor)} / day</Text>}
            {metadata ? (
              <Text numberOfLines={1} style={styles.fleetMetadata}>
                {metadata}
              </Text>
            ) : null}
            <Text numberOfLines={1} style={styles.fleetMarketplaceState}>
              {fleetMarketplaceStatus(vehicle)}
            </Text>
            {distinctAvailability ? (
              <Text numberOfLines={1} style={styles.fleetAvailabilityState}>
                {distinctAvailability}
              </Text>
            ) : null}
            {vehicle.reviewReason && (
              <Text numberOfLines={2} style={styles.fleetReviewReason}>
                {vehicle.reviewReason}
              </Text>
            )}
          </>
        )}
        <Text style={styles.fleetAction}>{delegated ? 'View vehicle' : actionLabel} →</Text>
      </View>
    </Pressable>
  );
}

function VehicleDetail({
  id,
  onClose,
  onEdit,
  onRemoved,
}: {
  readonly id: string;
  readonly onClose: () => void;
  readonly onEdit: (step?: number) => void;
  readonly onRemoved: () => void;
}) {
  const client = useQueryClient();
  const [managingAvailability, setManagingAvailability] = useState(false);
  const [managingKnownIssues, setManagingKnownIssues] = useState(false);
  const [removalReasonOpen, setRemovalReasonOpen] = useState(false);
  const [returnForChangesOpen, setReturnForChangesOpen] = useState(false);
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
  const deleteEligibility = useQuery({
    queryKey: ['vehicle-delete-eligibility', id],
    queryFn: () =>
      apiClient.request<{
        allowed: boolean;
        blockers: readonly { code: string; bookingReference?: string }[];
        retentionMode: 'ARCHIVE';
      }>(`/owner/vehicles/${id}/delete-eligibility`),
  });
  const removeVehicle = useMutation({
    mutationFn: (input: { reason: VehicleRemovalReasonCode; otherReason?: string }) =>
      apiClient.request(`/owner/vehicles/${id}`, {
        body: JSON.stringify(input),
        method: 'DELETE',
      }),
    onSuccess: onRemoved,
  });
  const approveOwnerSubmission = useMutation({
    mutationFn: (requestId: string) =>
      apiClient.request(`/owner/vehicles/${id}/owner-approval/${requestId}/approve`, {
        method: 'POST',
      }),
    onSuccess: async () => {
      await vehicle.refetch();
      await client.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: async () => {
      await vehicle.refetch();
    },
  });
  const returnOwnerSubmission = useMutation({
    mutationFn: ({ reason, requestId }: { reason: string; requestId: string }) =>
      apiClient.request(`/owner/vehicles/${id}/owner-approval/${requestId}/return-for-changes`, {
        body: JSON.stringify({ reason }),
        method: 'POST',
      }),
    onSuccess: async () => {
      setReturnForChangesOpen(false);
      await vehicle.refetch();
      await client.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: async () => {
      await vehicle.refetch();
    },
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
  const policy = value.policyVersions[0];
  const activeDocuments = value.documents.filter(({ replacedAt }) => !replacedAt);
  const activeIssues = value.knownIssues.filter(({ status }) => status === 'ACTIVE');
  const pendingOwnerApproval =
    value.status === 'DRAFT' && value.ownerApproval?.status === 'PENDING'
      ? value.ownerApproval
      : null;
  const editable = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(value.status);
  const discountsEnabled = Boolean(
    policy &&
    [
      policy.shortDurationDiscountBps,
      policy.weeklyDiscountBps,
      policy.extendedTripDiscountBps,
      policy.monthlyDiscountBps,
    ].some((discount) => (discount ?? 0) > 0),
  );
  return (
    <SafeAreaView edges={['top']} style={styles.flex}>
      <View style={styles.vehicleDetailHeader}>
        <BackControl label="Back" onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={[styles.page, styles.vehicleDetailPage]}>
        <VehicleImage
          accessibilityLabel={`${value.make ?? ''} ${value.model ?? 'vehicle'} cover photo`}
          contentPath={cover?.fileAsset.contentGrant?.contentPath}
          style={styles.hero}
        />
        <Text style={styles.title}>
          {value.make} {value.model}
        </Text>
        <View style={styles.vehicleMetaRow}>
          <Text style={[styles.body, styles.vehicleMetaText]}>
            {value.modelYear ?? '—'} · {value.category?.name ?? 'Vehicle'} ·{' '}
            {domainLabel(value.fuelType)}
          </Text>
          <StatusBadge
            label={
              pendingOwnerApproval ? 'Awaiting your approval' : vehicleStatusLabel(value.status)
            }
            tone={pendingOwnerApproval ? 'warning' : vehicleTone(value.status)}
          />
        </View>
        {pendingOwnerApproval ? (
          <VehicleDetailSection emphasized title="Awaiting your approval">
            <VehicleDetailRow
              label="Submitted by"
              value={pendingOwnerApproval.submittedByDisplayName}
            />
            <VehicleDetailRow
              label="Submitted"
              value={dateTimeLabel(pendingOwnerApproval.submittedAt)}
            />
            <Text style={styles.vehicleDetailHelper}>
              Review the complete vehicle setup before submitting it to CarShare.
            </Text>
          </VehicleDetailSection>
        ) : null}
        <View style={styles.vehicleEditAction}>
          <DetailAction label="Edit vehicle" onPress={() => onEdit()} />
          {pendingOwnerApproval ? (
            <Text style={styles.vehicleDetailHelper}>
              Editing this vehicle will require you to review the updated version before approving.
            </Text>
          ) : null}
        </View>
        <VehicleDetailSection title="Vehicle overview">
          <View style={styles.vehicleOverviewGrid}>
            <VehicleDetailValue label="Transmission" value={domainLabel(value.transmission)} />
            <VehicleDetailValue label="Powertrain" value={domainLabel(value.powertrain)} />
            <VehicleDetailValue label="Color" value={value.color ?? 'Not set'} />
            <VehicleDetailValue label="Seats" value={String(value.seatCount ?? '—')} />
          </View>
        </VehicleDetailSection>
        <VehicleDetailSection title="Registration & verification">
          <VehicleDetailRow label="Documents" value={`${activeDocuments.length} attached`} />
          <VehicleDetailRow label="Plate number" value={value.plateNumber ?? 'Not set'} />
        </VehicleDetailSection>
        <VehicleDetailSection
          action={
            editable ? <DetailAction label="Change location" onPress={() => onEdit(4)} /> : null
          }
          title="Private pickup location"
        >
          <View style={styles.privateLocationRow}>
            <View style={styles.vehicleDetailRowCopy}>
              <Text style={styles.vehicleDetailValue}>
                {value.location
                  ? `${value.location.city}, ${value.location.province}`
                  : 'Not configured'}
              </Text>
              {value.location && (
                <>
                  <Text style={styles.vehicleDetailHelper}>
                    {ownerPrivateLocationLabel(value.location)}
                  </Text>
                  <View accessibilityLabel="Private pickup location" style={styles.privateLabelRow}>
                    <Icon color={colors.primary} name="lock-closed-outline" size={15} />
                    <Text style={styles.privateLabelText}>Private</Text>
                  </View>
                </>
              )}
            </View>
          </View>
        </VehicleDetailSection>
        <VehicleDetailSection
          action={editable ? <DetailAction label="Edit pricing" onPress={() => onEdit(5)} /> : null}
          title="Pricing"
        >
          <VehicleDetailRow
            label="Daily rate"
            value={policy ? money(policy.dailyRateMinor) : 'Not configured'}
          />
          <VehicleDetailRow
            label="Long-booking discounts"
            value={policy ? (discountsEnabled ? 'Enabled' : 'Not enabled') : 'Not configured'}
          />
          <VehicleDetailRow
            label="Security deposit"
            value={
              policy
                ? policy.securityDeposit.required || policy.securityDepositRequired
                  ? 'Required'
                  : 'Not required'
                : 'Not configured'
            }
          />
        </VehicleDetailSection>
        <VehicleDetailSection
          action={<DetailAction label="Edit handover & usage" onPress={() => onEdit(6)} />}
          title="Handover & usage"
        >
          {policy ? (
            <>
              <VehicleDetailSummary
                label="Start of rental"
                value={[
                  policy.supportsRenterPickup ? 'Renter pickup' : null,
                  policy.supportsOwnerDelivery ? 'Owner delivery' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <VehicleDetailSummary
                label="End of rental"
                value={[
                  policy.supportsRenterReturn ? 'Renter return' : null,
                  policy.supportsOwnerCollection ? 'Owner collection' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <VehicleDetailSummary
                label="Mileage"
                value={
                  policy.mileagePolicy === 'UNLIMITED'
                    ? 'Unlimited'
                    : `Limited${policy.includedKilometersPerDay ? ` · ${policy.includedKilometersPerDay} km/day` : ''}`
                }
              />
              <VehicleDetailSummary
                label="Turnaround"
                value={`${policy.turnaroundMinutes / 60} hours`}
              />
            </>
          ) : (
            <Text style={styles.vehicleDetailHelper}>Not configured</Text>
          )}
        </VehicleDetailSection>
        <VehicleDetailSection
          action={
            <DetailAction label="Manage issues" onPress={() => setManagingKnownIssues(true)} />
          }
          title="Known vehicle issues"
        >
          <Text style={styles.vehicleOperationalValue}>{activeIssues.length} active</Text>
          {activeIssues.slice(0, 3).map((issue) => (
            <Text key={issue.id} style={styles.vehicleDetailHelper}>
              {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
            </Text>
          ))}
        </VehicleDetailSection>
        <VehicleDetailSection
          action={
            <DetailAction
              label="Manage availability"
              onPress={() => setManagingAvailability(true)}
            />
          }
          emphasized
          title="Marketplace & availability"
        >
          <VehicleDetailRow label="Review status" value={ownerMarketplaceStatus(value)} />
          <Text style={styles.vehicleDetailHelper}>{ownerMarketplaceExplanation(value)}</Text>
          <VehicleDetailRow
            label="Availability"
            value={availabilityTodayLabel(value.availabilityToday)}
          />
          <Text style={styles.vehicleDetailHelper}>
            {availabilityTodayDetail(value.availabilityToday)}
          </Text>
          {value.status === 'APPROVED' && (
            <DetailAction
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
            />
          )}
          {operationalStatus.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {operationalStatus.error.message}
            </Text>
          )}
        </VehicleDetailSection>
        <View style={styles.vehicleDangerZone}>
          <Text accessibilityRole="header" style={styles.vehicleDangerTitle}>
            Danger zone
          </Text>
          <Text style={styles.vehicleDetailHelper}>
            Remove this vehicle from your active fleet. Historical booking and financial records are
            retained.
          </Text>
          {deleteEligibility.data && !deleteEligibility.data.allowed ? (
            <Text accessibilityRole="alert" style={styles.vehicleDeleteBlocked}>
              {vehicleDeleteBlockerMessage(deleteEligibility.data.blockers[0]?.code)}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled:
                deleteEligibility.isPending ||
                removeVehicle.isPending ||
                deleteEligibility.data?.allowed !== true,
            }}
            disabled={
              deleteEligibility.isPending ||
              removeVehicle.isPending ||
              deleteEligibility.data?.allowed !== true
            }
            onPress={() => setRemovalReasonOpen(true)}
            style={[
              styles.vehicleDeleteAction,
              (deleteEligibility.isPending ||
                removeVehicle.isPending ||
                deleteEligibility.data?.allowed !== true) &&
                styles.disabledButton,
            ]}
          >
            <Text style={styles.vehicleDeleteActionText}>
              {removeVehicle.isPending ? 'Removing…' : 'Remove vehicle'}
            </Text>
          </Pressable>
          {removeVehicle.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {removeVehicle.error.message}
            </Text>
          ) : null}
        </View>
      </ScrollView>
      {pendingOwnerApproval ? (
        <View style={styles.ownerApprovalFooter}>
          <Button
            disabled={approveOwnerSubmission.isPending || returnOwnerSubmission.isPending}
            label={
              approveOwnerSubmission.isPending ? 'Approving…' : 'Approve and submit for review'
            }
            onPress={() =>
              Alert.alert(
                'Approve this vehicle?',
                'This will submit the vehicle to CarShare for review.',
                [
                  { style: 'cancel', text: 'Cancel' },
                  {
                    text: 'Approve and submit',
                    onPress: () => approveOwnerSubmission.mutate(pendingOwnerApproval.id),
                  },
                ],
              )
            }
          />
          <Button
            disabled={approveOwnerSubmission.isPending || returnOwnerSubmission.isPending}
            label="Return for changes"
            onPress={() => setReturnForChangesOpen(true)}
            variant="secondary"
          />
          {approveOwnerSubmission.error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {ownerApprovalErrorMessage(approveOwnerSubmission.error)}
            </Text>
          ) : null}
        </View>
      ) : null}
      <VehicleOwnerReturnSheet
        error={returnOwnerSubmission.error}
        loading={returnOwnerSubmission.isPending}
        onCancel={() => setReturnForChangesOpen(false)}
        onSubmit={(reason) =>
          pendingOwnerApproval
            ? returnOwnerSubmission.mutate({ reason, requestId: pendingOwnerApproval.id })
            : undefined
        }
        visible={returnForChangesOpen && Boolean(pendingOwnerApproval)}
      />
      <VehicleRemovalReasonSheet
        onCancel={() => setRemovalReasonOpen(false)}
        onContinue={(reason, otherReason) => {
          setRemovalReasonOpen(false);
          Alert.alert(
            'Remove vehicle?',
            'This will remove the vehicle from your active fleet. Existing historical records are kept for completed rentals and account history.',
            [
              { style: 'cancel', text: 'Cancel' },
              {
                onPress: () =>
                  removeVehicle.mutate({ reason, ...(otherReason ? { otherReason } : {}) }),
                style: 'destructive',
                text: 'Remove vehicle',
              },
            ],
          );
        }}
        visible={removalReasonOpen}
      />
    </SafeAreaView>
  );
}

function VehicleRemovalReasonSheet({
  onCancel,
  onContinue,
  visible,
}: {
  readonly onCancel: () => void;
  readonly onContinue: (reason: VehicleRemovalReasonCode, otherReason?: string) => void;
  readonly visible: boolean;
}) {
  const [reason, setReason] = useState<VehicleRemovalReasonCode | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bottomAllowance = Math.max(safeArea.bottom, spacing.lg);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: measuredContentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        // The measured content includes the sheet's safe-area allowance.
        safeAreaAllowance: 0,
      }),
    [maximumHeight, measuredContentHeight],
  );
  const sheetHeight = useSharedValue(Math.min(560, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!visible || measuredContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [measuredContentHeight, measuredLayout.height, reason, sheetHeight, viewportHeight, visible]);

  const close = () => {
    Keyboard.dismiss();
    setReason(null);
    setOtherReason('');
    onCancel();
  };
  const continueRemoval = () => {
    if (!reason) return;
    const selectedReason = reason;
    const detail = otherReason.trim() || undefined;
    Keyboard.dismiss();
    setReason(null);
    setOtherReason('');
    onContinue(selectedReason, detail);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.removalReasonModalRoot}
      >
        <View style={styles.removalReasonBackdrop} />
        <Reanimated.View
          accessibilityViewIsModal
          style={[styles.removalReasonSheet, animatedSheetStyle]}
        >
          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={[
              styles.removalReasonContent,
              { paddingBottom: bottomAllowance },
            ]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_width, height) => setMeasuredContentHeight(height)}
            scrollEnabled={measuredLayout.scrollEnabled}
            showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
          >
            <BackControl label="Back" onPress={close} />
            <Text accessibilityRole="header" style={styles.removalReasonTitle}>
              Remove vehicle
            </Text>
            <Text style={styles.removalReasonPrompt}>Why are you removing this vehicle?</Text>
            <View accessibilityRole="radiogroup" style={styles.removalReasonOptions}>
              {vehicleRemovalReasonOptions.map((option) => {
                const selected = reason === option.value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={option.value}
                    onPress={() => setReason(option.value)}
                    style={styles.removalReasonOption}
                  >
                    <Text style={styles.removalReasonOptionText}>{option.label}</Text>
                    <Icon
                      color={selected ? colors.primary : colors.subtleText}
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                    />
                  </Pressable>
                );
              })}
            </View>
            {reason === VehicleRemovalReason.OTHER ? (
              <View style={styles.removalOtherField}>
                <Text style={styles.label}>Tell us more</Text>
                <TextInput
                  accessibilityLabel="Tell us more"
                  maxLength={VEHICLE_REMOVAL_OTHER_REASON_MAX_LENGTH}
                  multiline
                  onChangeText={setOtherReason}
                  placeholder="Optional"
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, styles.removalOtherInput]}
                  value={otherReason}
                />
              </View>
            ) : null}
            <View style={styles.removalReasonContinue}>
              <Button disabled={!reason} label="Continue" onPress={continueRemoval} />
            </View>
          </ScrollView>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function VehicleOwnerReturnSheet({
  error,
  loading,
  onCancel,
  onSubmit,
  visible,
}: {
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (reason: string) => void;
  readonly visible: boolean;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const meaningful = reason.trim().length >= 10;
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: measuredContentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: 0,
      }),
    [maximumHeight, measuredContentHeight],
  );
  const sheetHeight = useSharedValue(Math.min(420, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!visible || measuredContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [measuredContentHeight, measuredLayout.height, sheetHeight, visible]);

  const close = () => {
    Keyboard.dismiss();
    setReason('');
    setTouched(false);
    onCancel();
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.removalReasonModalRoot}
      >
        <View style={styles.removalReasonBackdrop} />
        <Reanimated.View style={[styles.removalReasonSheet, animatedSheetStyle]}>
          <ScrollView
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentContainerStyle={[
              styles.removalReasonContent,
              { paddingBottom: Math.max(safeArea.bottom, spacing.lg) },
            ]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={(_width, height) => setMeasuredContentHeight(height)}
            scrollEnabled={measuredLayout.scrollEnabled}
          >
            <BackControl label="Cancel" onPress={close} />
            <Text accessibilityRole="header" style={styles.removalReasonTitle}>
              Return for changes
            </Text>
            <Text style={styles.vehicleDetailHelper}>
              Tell the Manager what needs to be updated before you review it again.
            </Text>
            <Field
              label="Feedback"
              multiline
              onChange={setReason}
              placeholder="Describe the changes needed"
              value={reason}
            />
            {touched && !meaningful ? (
              <Text accessibilityRole="alert" style={styles.error}>
                Enter at least 10 meaningful characters.
              </Text>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {ownerApprovalErrorMessage(error)}
              </Text>
            ) : null}
            <Button
              disabled={loading || !meaningful}
              label={loading ? 'Returning…' : 'Return for changes'}
              onPress={() => {
                setTouched(true);
                if (meaningful) onSubmit(reason.trim());
              }}
            />
          </ScrollView>
        </Reanimated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function vehicleDeleteBlockerMessage(code?: string): string {
  if (code === 'ONGOING_RENTAL')
    return "This vehicle can't be removed while a rental is in progress.";
  if (code === 'FUTURE_BOOKING')
    return "This vehicle can't be removed because it has an upcoming booking.";
  if (code === 'RETURN_PENDING')
    return "This vehicle can't be removed until the return workflow is complete.";
  if (code === 'OPEN_CLAIM') return "This vehicle can't be removed while a claim is open.";
  if (code === 'OPEN_DISPUTE') return "This vehicle can't be removed while a dispute is open.";
  if (code === 'FINANCIAL_SETTLEMENT_PENDING')
    return "This vehicle can't be removed while a security deposit settlement is pending.";
  return 'This vehicle cannot be removed right now.';
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

function VehicleDetailSection({
  action,
  title,
  children,
  emphasized = false,
}: {
  readonly action?: React.ReactNode;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly emphasized?: boolean;
}) {
  return (
    <View
      style={[styles.vehicleDetailSection, emphasized && styles.vehicleDetailSectionEmphasized]}
    >
      <View style={styles.vehicleDetailSectionHeader}>
        <Text accessibilityRole="header" style={styles.vehicleDetailSectionTitle}>
          {title}
        </Text>
      </View>
      <View style={styles.vehicleDetailSectionContent}>{children}</View>
      {action}
    </View>
  );
}

function VehicleDetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.vehicleDetailRow}>
      <Text style={styles.vehicleDetailRowLabel}>{label}</Text>
      <Text style={styles.vehicleDetailRowValue}>{value}</Text>
    </View>
  );
}

function VehicleDetailValue({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.vehicleOverviewValue}>
      <Text style={styles.vehicleOverviewLabel}>{label}</Text>
      <Text style={styles.vehicleDetailValue}>{value}</Text>
    </View>
  );
}

function VehicleDetailSummary({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.vehicleDetailSummary}>
      <Text style={styles.vehicleOverviewLabel}>{label}</Text>
      <Text style={styles.vehicleDetailValue}>{value || 'Not configured'}</Text>
    </View>
  );
}

function DetailAction({
  disabled = false,
  label,
  onPress,
}: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.vehicleDetailAction, disabled && styles.disabledButton]}
    >
      <Text style={styles.vehicleDetailActionText}>{label}</Text>
    </Pressable>
  );
}

function VehicleEditor({
  delegated = false,
  endpointBase,
  id,
  initialStep,
  referenceBase = '/owner/vehicle-reference-data',
  onClose,
}: {
  readonly delegated?: boolean;
  readonly endpointBase?: string;
  readonly id: string;
  readonly initialStep?: number;
  readonly referenceBase?: string;
  readonly onClose: () => void;
}) {
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding(spacing.xl);
  const client = useQueryClient();
  const vehicle = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => apiClient.request<Vehicle>(endpointBase ?? `/owner/vehicles/${id}`),
  });
  const [selectedStep, setSelectedStep] = useState<number | null>(initialStep ?? null);
  const [wizardError, setWizardError] = useState('');
  const completedSection = vehicle.data?.lastCompletedSection;
  const completedIndex = stepCompletionIds.findIndex(
    (section) => section?.toUpperCase() === completedSection,
  );
  const restoredStep =
    completedSection === 'AVAILABILITY'
      ? steps.length - 1
      : Math.min(completedIndex + 1, steps.length - 1);
  const step = selectedStep ?? Math.max(0, restoredStep);
  const advance = () => {
    setWizardError('');
    setSelectedStep(Math.min(step + 1, steps.length - 1));
  };
  const goPrevious = () => {
    setWizardError('');
    setSelectedStep(Math.max(0, step - 1));
  };
  const refresh = () => client.invalidateQueries({ queryKey: ['vehicle', id] });
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
      apiClient.request(`${endpointBase ?? `/owner/vehicles/${id}`}${path}`, {
        ...(body ? { body: JSON.stringify(body) } : {}),
        method,
      }),
    onSuccess: async (_result, variables) => {
      await refresh();
      if (delegated && variables.path === '/owner-approval-submission') onClose();
    },
    onError: async (error) => {
      if (!delegated) return;
      await vehicle.refetch();
      if (error instanceof ApiError && error.status === 403) onClose();
    },
  });
  const continueDraft = useMutation({
    mutationFn: () => {
      const completionSection = stepCompletionIds[step];
      return completionSection
        ? markSectionComplete(endpointBase ?? `/owner/vehicles/${id}`, completionSection)
        : Promise.resolve();
    },
    onSuccess: advance,
    onError: async (error) => {
      if (!delegated) return;
      await vehicle.refetch();
      if (error instanceof ApiError && error.status === 403) onClose();
    },
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
          <Text style={[styles.cardTitle, step <= 1 && styles.editorStepTitle]}>
            {step <= 1 && value.status === 'DRAFT'
              ? 'Add vehicle'
              : `${value.make ?? 'Vehicle'} ${value.model ?? 'draft'}`}
          </Text>
          <Text style={[styles.body, step <= 1 && styles.editorStepSubtitle]}>
            {step <= 1 && value.status === 'DRAFT'
              ? 'Vehicle draft'
              : vehicleStatusLabel(value.status)}
          </Text>
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
          <Text style={styles.progressTitle}>{step === 0 ? 'Vehicle details' : steps[step]}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((step + 1) / steps.length) * 100}%` }]} />
        </View>
      </View>
      <KeyboardAvoidingView style={styles.flex}>
        {step === 0 ? (
          <DetailsStep
            contentBottomPadding={keyboardAwareBottomPadding}
            endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
            referenceBase={referenceBase}
            vehicle={value}
            onSaved={refresh}
            onContinue={advance}
          />
        ) : step === 1 ? (
          <FeaturesStep
            contentBottomPadding={keyboardAwareBottomPadding}
            endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
            powertrain={value.powertrain}
            referenceBase={referenceBase}
            selectedFeatureIds={value.features.map((item) => item.featureId)}
            onPrevious={goPrevious}
            onSaved={refresh}
            onContinue={advance}
          />
        ) : step === 4 ? (
          <LocationStep
            endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
            vehicle={value}
            onPrevious={goPrevious}
            onSaved={refresh}
            onContinue={advance}
          />
        ) : step === 5 ? (
          <PolicyStep
            contentBottomPadding={keyboardAwareBottomPadding}
            endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
            mode="pricing"
            vehicle={value}
            onPrevious={goPrevious}
            onSaved={refresh}
            onContinue={advance}
          />
        ) : step === 6 ? (
          <PolicyStep
            contentBottomPadding={keyboardAwareBottomPadding}
            endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
            mode="usage"
            vehicle={value}
            onPrevious={goPrevious}
            onSaved={refresh}
            onContinue={advance}
          />
        ) : (
          <>
            <ScrollView
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={[
                styles.editorBody,
                { paddingBottom: keyboardAwareBottomPadding },
              ]}
              keyboardDismissMode={formKeyboardDismissMode}
              keyboardShouldPersistTaps="handled"
            >
              {step === 2 && (
                <PhotosStep
                  endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
                  photos={value.photos}
                  onSaved={refresh}
                />
              )}
              {step === 3 && (
                <DocumentsStep
                  documents={value.documents}
                  endpointBase={endpointBase ?? `/owner/vehicles/${id}`}
                  referenceBase={referenceBase}
                  onSaved={refresh}
                />
              )}
              {step === 7 && (
                <ReviewStep vehicle={value} action={action.mutate} onEdit={setSelectedStep} />
              )}
              {action.error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {vehicleMutationErrorMessage(action.error)}
                </Text>
              )}
              {wizardError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {wizardError}
                </Text>
              )}
            </ScrollView>
            {step > 0 && (
              <View style={[styles.editorActions, step === 3 && styles.documentEditorActions]}>
                <Pressable
                  accessibilityRole="button"
                  style={[styles.secondaryButton, styles.editorActionButton]}
                  onPress={goPrevious}
                >
                  <Text>Previous</Text>
                </Pressable>
                {step < steps.length - 1 && ![0, 1, 5, 6].includes(step) && (
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
                {step === 7 && ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(value.status) && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={action.isPending}
                    style={[styles.primaryButton, styles.editorActionButton]}
                    onPress={() =>
                      action.mutate({
                        path: delegated ? '/owner-approval-submission' : '/submission',
                      })
                    }
                  >
                    <Text style={styles.primaryText}>
                      {action.isPending
                        ? 'Submitting…'
                        : delegated
                          ? 'Submit for Owner approval'
                          : 'Submit for approval'}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DetailsStep({
  contentBottomPadding,
  endpointBase,
  referenceBase,
  vehicle,
  onSaved,
  onContinue,
}: {
  readonly contentBottomPadding: number;
  readonly endpointBase: string;
  readonly referenceBase: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const categories = useQuery({
    queryKey: ['vehicle-categories'],
    queryFn: () => apiClient.request<Reference[]>(`${referenceBase}/categories`),
  });
  const makes = useQuery({
    queryKey: ['vehicle-makes'],
    queryFn: () => apiClient.request<Reference[]>(`${referenceBase}/makes`),
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
      apiClient.request<Reference[]>(`${referenceBase}/models?makeId=${selectedMake?.id ?? ''}`),
  });
  const listedModel = models.data?.some(({ name }) => name === form.model) ?? false;
  const [customModel, setCustomModel] = useState(Boolean(vehicle.model) && !listedModel);
  const save = useMutation({
    mutationFn: () =>
      apiClient.request(endpointBase, {
        body: JSON.stringify({
          ...form,
          categoryId: form.categoryId || undefined,
          lastCompletedSection: 'DETAILS',
          modelYear: form.modelYear.trim() ? Number(form.modelYear) : undefined,
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
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[
          styles.editorBody,
          styles.detailsStep,
          { paddingBottom: contentBottomPadding },
        ]}
        keyboardDismissMode={formKeyboardDismissMode}
        keyboardShouldPersistTaps="handled"
      >
        <DetailsFormSection title="Vehicle identity">
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
              grouped
              label="Enter model"
              value={form.model}
              onChange={(model) => setForm({ ...form, model })}
              placeholder="Manufacturer model name"
            />
          )}
          <Field
            grouped
            label="Model year"
            value={form.modelYear}
            onChange={(modelYear) => setForm({ ...form, modelYear })}
            keyboard="numeric"
            placeholder="Enter model year"
          />
          <SearchableReferenceSelector
            label="Vehicle type"
            options={categories.data ?? []}
            value={form.categoryId}
            onChange={(categoryId) => setForm({ ...form, categoryId })}
          />
        </DetailsFormSection>

        <DetailsFormSection title="Powertrain">
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
        </DetailsFormSection>

        <DetailsFormSection title="Vehicle details">
          <Field
            grouped
            label="Color"
            value={form.color}
            onChange={(color) => setForm({ ...form, color })}
            placeholder="Enter vehicle color"
          />
          <Field
            grouped
            helper="Kept private and not shown on your public listing."
            label="Plate number"
            value={form.plateNumber}
            onChange={(plateNumber) => setForm({ ...form, plateNumber })}
            placeholder="ABC 1234"
          />
        </DetailsFormSection>

        <DetailsFormSection optional title="About your vehicle">
          <Field
            grouped
            label="Description"
            multiline
            value={form.description}
            onChange={(description) => setForm({ ...form, description })}
            placeholder="Tell renters anything useful about your vehicle"
          />
        </DetailsFormSection>

        {save.error && <Text style={styles.error}>{save.error.message}</Text>}
      </ScrollView>
      <WizardSaveFooter mutation={save} />
    </>
  );
}

function FeaturesStep({
  contentBottomPadding,
  endpointBase,
  powertrain,
  referenceBase,
  selectedFeatureIds,
  onPrevious,
  onSaved,
  onContinue,
}: {
  readonly contentBottomPadding: number;
  readonly endpointBase: string;
  readonly powertrain: string | null;
  readonly referenceBase: string;
  readonly selectedFeatureIds: string[];
  readonly onPrevious: () => void;
  readonly onSaved: () => void;
  readonly onContinue: () => void;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-features'],
    queryFn: () => apiClient.request<Reference[]>(`${referenceBase}/features`),
  });
  const [selected, setSelected] = useState<string[]>(selectedFeatureIds);
  const groupedFeatures = useMemo(() => {
    const features = definitions.data ?? [];
    const knownCodes = new Set<string>(vehicleFeatureGroups.flatMap(({ codes }) => codes));
    return vehicleFeatureGroups
      .filter(
        ({ title }) => title !== 'EV & charging' || evFeaturePowertrains.has(powertrain ?? ''),
      )
      .map((group) => ({
        features: features.filter(
          ({ code }) =>
            (group.codes as readonly string[]).includes(code) ||
            (group.title === 'Other' && !knownCodes.has(code)),
        ),
        title: group.title,
      }))
      .filter(({ features: values }) => values.length > 0);
  }, [definitions.data, powertrain]);
  const save = useMutation({
    mutationFn: async () => {
      await apiClient.request(`${endpointBase}/features`, {
        body: JSON.stringify({ featureIds: selected }),
        method: 'PUT',
      });
      return markSectionComplete(endpointBase, 'Features');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.editorBody,
          styles.featuresStep,
          { paddingBottom: contentBottomPadding },
        ]}
      >
        <View style={styles.featuresIntro}>
          <Text style={styles.featuresHelper}>
            Choose the features renters can use to find the right vehicle.
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.featuresCount}>
            {selected.length} selected
          </Text>
        </View>
        {groupedFeatures.map((group) => (
          <View key={group.title} style={styles.featureGroup}>
            <Text accessibilityRole="header" style={styles.detailsSectionTitle}>
              {group.title}
            </Text>
            <View style={styles.featureChips}>
              {group.features.map((feature) => {
                const checked = selected.includes(feature.id);
                return (
                  <FeatureChip
                    key={feature.id}
                    label={feature.name}
                    selected={checked}
                    onPress={() =>
                      setSelected(
                        checked
                          ? selected.filter((item) => item !== feature.id)
                          : [...selected, feature.id],
                      )
                    }
                  />
                );
              })}
            </View>
          </View>
        ))}
        {save.error && <Text style={styles.error}>{save.error.message}</Text>}
      </ScrollView>
      <WizardSaveFooter mutation={save} onPrevious={onPrevious} />
    </>
  );
}

async function discardUnattachedProposalFile(fileAssetId: string) {
  await apiClient.request(`/files/${fileAssetId}`, { method: 'DELETE' }).catch(() => {});
}

function PhotosStep({
  beforeMutation,
  endpointBase,
  photos,
  onSaved,
  proposalMode = false,
}: {
  readonly beforeMutation?: () => Promise<unknown>;
  readonly endpointBase: string;
  readonly photos: VehiclePhoto[];
  readonly onSaved: () => void;
  readonly proposalMode?: boolean;
}) {
  const [error, setError] = useState('');
  const [uploadingPerspective, setUploadingPerspective] = useState<string | null>(null);
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
    setUploadingPerspective(perspective);
    let uploadedFileId: string | null = null;
    try {
      await beforeMutation?.();
      const file = await apiClient.upload<SafeFile>('/files', 'PRIVATE', {
        uri: asset.uri,
        name: asset.fileName ?? `${perspective}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      uploadedFileId = file.id;
      const displayOrder = Math.max(-1, ...photos.map((photo) => photo.displayOrder)) + 1;
      await apiClient.request(`${endpointBase}/photos`, {
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
      if (proposalMode && uploadedFileId) await discardUnattachedProposalFile(uploadedFileId);
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setUploadingPerspective(null);
    }
  };
  const choosePhotoSource = (perspective: string) => {
    Alert.alert(`Add ${domainLabel(perspective).toLowerCase()} photo`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => void upload(perspective, true) },
      { text: 'Choose from library', onPress: () => void upload(perspective, false) },
    ]);
  };
  const reorder = async (
    next: VehiclePhoto[],
    coverId = next.find(({ isCover }) => isCover)?.id,
  ) => {
    if (!coverId) return;
    try {
      await beforeMutation?.();
      await apiClient.request(`${endpointBase}/photos/order`, {
        body: JSON.stringify({
          photos: next.map((photo, displayOrder) => ({
            [proposalMode ? 'fileAssetId' : 'photoId']: proposalMode
              ? photo.fileAsset.id
              : photo.id,
            displayOrder,
            isCover: (proposalMode ? photo.fileAsset.id : photo.id) === coverId,
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
    const selected = photos.find((photo) =>
      proposalMode ? photo.fileAsset.id === photoId : photo.id === photoId,
    );
    if (!selected) return;
    void reorder(
      [
        selected,
        ...photos.filter((photo) =>
          proposalMode ? photo.fileAsset.id !== photoId : photo.id !== photoId,
        ),
      ],
      photoId,
    );
  };
  const remove = async (photoId: string) => {
    try {
      await beforeMutation?.();
      await apiClient.request(`${endpointBase}/photos/${photoId}`, { method: 'DELETE' });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Removal failed.');
    }
  };
  const confirmRemove = (photo: VehiclePhoto) => {
    Alert.alert(
      'Remove photo?',
      photo.isCover
        ? 'This is your current cover photo. Choose another cover after removing it.'
        : 'This photo will be removed from the vehicle draft.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove photo',
          style: 'destructive',
          onPress: () => void remove(proposalMode ? photo.fileAsset.id : photo.id),
        },
      ],
    );
  };
  const showPhotoActions = (photo: VehiclePhoto) => {
    Alert.alert('Photo options', undefined, [
      ...(!photo.isCover
        ? [
            {
              text: 'Set as cover',
              onPress: () => setCover(proposalMode ? photo.fileAsset.id : photo.id),
            },
          ]
        : []),
      { text: 'Remove photo', style: 'destructive' as const, onPress: () => confirmRemove(photo) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  return (
    <Section title="Vehicle photos">
      <View style={styles.photosIntro}>
        <Text style={styles.photosHelper}>
          {proposalMode
            ? 'Edit the proposed photo set. Current marketplace photos stay live until approval.'
            : 'Add clear exterior and interior photos. Your cover appears first in search, and all photos stay private until the listing is approved.'}
        </Text>
        <Text accessibilityLiveRegion="polite" style={styles.photosCount}>
          {photos.length} added
        </Text>
      </View>
      {perspectives.map((perspective) => {
        const present = displayedPhotos.filter((photo) => photo.perspective === perspective);
        const uploading = uploadingPerspective === perspective;
        return (
          <View key={perspective} style={styles.photoCategoryCard}>
            <View style={styles.photoCategoryHeader}>
              <Text accessibilityRole="header" style={styles.cardTitle}>
                {domainLabel(perspective)}
              </Text>
              <Text style={styles.photoCategoryCount}>
                {present.length} {present.length === 1 ? 'photo' : 'photos'}
              </Text>
            </View>
            <Text style={styles.photoGuidance}>{photoPerspectiveGuidance[perspective]}</Text>
            {present.length === 0 ? (
              <Pressable
                accessibilityHint="Choose the camera or photo library"
                accessibilityLabel={`Add ${domainLabel(perspective).toLowerCase()} photo`}
                accessibilityRole="button"
                disabled={uploading}
                onPress={() => choosePhotoSource(perspective)}
                style={styles.photoEmptyState}
              >
                <Icon color={colors.primary} name="images-outline" size={26} />
                <Text style={styles.photoEmptyTitle}>{uploading ? 'Uploading…' : 'Add photo'}</Text>
                <Text style={styles.photoEmptyCopy}>
                  Take a new photo or choose one from your library.
                </Text>
              </Pressable>
            ) : (
              <View style={styles.photoGrid}>
                {present.map((photo) => (
                  <View
                    key={photo.id}
                    style={[styles.photoTile, present.length === 1 && styles.photoTileSingle]}
                  >
                    <VehicleImage
                      contentPath={photo.fileAsset.contentGrant?.contentPath}
                      style={styles.photoTileImage}
                    />
                    {photo.isCover && (
                      <View style={styles.photoCoverBadge}>
                        <Icon color={colors.onPrimary} name="star" size={12} />
                        <Text style={styles.photoCoverBadgeText}>Cover</Text>
                      </View>
                    )}
                    <Pressable
                      accessibilityHint="Set as cover or remove this photo"
                      accessibilityLabel={`${domainLabel(perspective)} photo options${photo.isCover ? ', current cover' : ''}`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => showPhotoActions(photo)}
                      style={styles.photoOverflowAction}
                    >
                      <Icon color={colors.ink} name="ellipsis-horizontal" size={22} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {present.length > 0 && (
              <Pressable
                accessibilityHint="Choose the camera or photo library"
                accessibilityRole="button"
                disabled={uploading}
                onPress={() => choosePhotoSource(perspective)}
                style={styles.photoAddAction}
              >
                <Icon color={colors.primary} name="add-circle-outline" size={20} />
                <Text style={styles.photoAddActionText}>
                  {uploading ? 'Uploading…' : 'Add photo'}
                </Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

async function removeProposalDocument(
  endpointBase: string,
  definitionId: string,
  beforeMutation?: () => Promise<unknown>,
) {
  await beforeMutation?.();
  await apiClient.request(`${endpointBase}/documents/${definitionId}`, { method: 'DELETE' });
}

function proposalDocumentRemovalAction(definition: Reference, onRemove: (id: string) => void) {
  return {
    text: 'Remove document',
    style: 'destructive' as const,
    onPress: () => onRemove(definition.id),
  };
}

function DocumentsStep({
  beforeMutation,
  endpointBase,
  referenceBase,
  documents,
  onSaved,
  proposalMode = false,
}: {
  readonly beforeMutation?: () => Promise<unknown>;
  readonly endpointBase: string;
  readonly referenceBase: string;
  readonly documents: VehicleDocument[];
  readonly onSaved: () => void;
  readonly proposalMode?: boolean;
}) {
  const definitions = useQuery({
    queryKey: ['vehicle-documents'],
    queryFn: () => apiClient.request<Reference[]>(`${referenceBase}/document-definitions`),
  });
  const [error, setError] = useState('');
  const [uploadingDefinitionId, setUploadingDefinitionId] = useState<string | null>(null);
  const upload = async (definition: Reference, camera: boolean) => {
    setError('');
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
    setUploadingDefinitionId(definition.id);
    let uploadedFileId: string | null = null;
    try {
      await beforeMutation?.();
      const file = await apiClient.upload<SafeFile>('/files', 'SENSITIVE', {
        uri: asset.uri,
        name: 'name' in asset ? asset.name : (asset.fileName ?? `${definition.code}.jpg`),
        mimeType: asset.mimeType ?? (camera ? 'image/jpeg' : 'application/octet-stream'),
      });
      uploadedFileId = file.id;
      const current = documents.find(
        (document) => document.definitionId === definition.id && !document.replacedAt,
      );
      await apiClient.request(`${endpointBase}/documents`, {
        body: JSON.stringify({
          definitionId: definition.id,
          fileAssetId: file.id,
          ...(current && !proposalMode ? { replacesDocumentId: current.id } : {}),
        }),
        method: 'POST',
      });
      onSaved();
    } catch (caught) {
      if (proposalMode && uploadedFileId) await discardUnattachedProposalFile(uploadedFileId);
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setUploadingDefinitionId(null);
    }
  };
  const remove = async (definitionId: string) => {
    setError('');
    try {
      await removeProposalDocument(endpointBase, definitionId, beforeMutation);
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Removal failed.');
    }
  };
  const chooseDocumentSource = (definition: Reference, replacing = false) => {
    Alert.alert(`${replacing ? 'Replace' : 'Add'} ${definition.name}`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take photo', onPress: () => void upload(definition, true) },
      { text: 'Choose file', onPress: () => void upload(definition, false) },
    ]);
  };
  const showDocumentActions = (definition: Reference) => {
    Alert.alert('Document options', undefined, [
      { text: 'Replace document', onPress: () => chooseDocumentSource(definition, true) },
      ...(proposalMode ? [proposalDocumentRemovalAction(definition, (id) => void remove(id))] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const activeDocuments = documents.filter(({ replacedAt }) => !replacedAt);
  const activeDefinitionIds = new Set(activeDocuments.map(({ definitionId }) => definitionId));
  const requiredDefinitions = definitions.data?.filter(({ required }) => required) ?? [];
  const addedRequiredCount = requiredDefinitions.filter(({ id: definitionId }) =>
    activeDefinitionIds.has(definitionId),
  ).length;
  return (
    <Section title="Verification documents">
      <View style={styles.documentsIntro}>
        <Text style={styles.documentsHelper}>
          {proposalMode
            ? 'Edit the proposed document set. Current verified documents stay unchanged until approval.'
            : 'Upload the documents needed to verify your vehicle. Files remain sensitive and available only through authorized access.'}
        </Text>
        {requiredDefinitions.length > 0 && (
          <Text accessibilityLiveRegion="polite" style={styles.documentsProgress}>
            {addedRequiredCount} of {requiredDefinitions.length} required added
          </Text>
        )}
      </View>
      {definitions.isPending && <Text style={styles.body}>Loading document checklist…</Text>}
      {definitions.isError && (
        <View style={styles.documentDefinitionsError}>
          <Text accessibilityRole="alert" style={styles.error}>
            {definitions.error.message}
          </Text>
          <Button label="Retry" onPress={() => void definitions.refetch()} variant="secondary" />
        </View>
      )}
      {definitions.data?.map((definition) => {
        const document = activeDocuments.find(
          (document) => document.definitionId === definition.id && !document.replacedAt,
        );
        const uploading = uploadingDefinitionId === definition.id;
        return (
          <View
            accessibilityLabel={`${definition.name}, ${definition.required ? 'Required' : 'Optional'}, ${uploading ? 'Uploading' : document ? 'Added' : 'Not added'}`}
            key={definition.id}
            style={[styles.documentCard, !definition.required && styles.documentCardOptional]}
          >
            <View style={styles.documentCardHeader}>
              <Text accessibilityRole="header" style={styles.documentTitle}>
                {definition.name}
              </Text>
              <Text
                style={[
                  styles.documentRequirementBadge,
                  !definition.required && styles.documentRequirementBadgeOptional,
                ]}
              >
                {definition.required ? 'Required' : 'Optional'}
              </Text>
            </View>
            <Text style={styles.documentGuidance}>
              {definition.description ??
                documentGuidance[definition.code] ??
                'Upload a clear, current copy.'}
            </Text>
            {document ? (
              <View style={styles.documentAddedRow}>
                <View style={styles.documentIdentity}>
                  <View style={styles.documentAddedIcon}>
                    <Icon
                      color={colors.onPrimary}
                      name={uploading ? 'cloud-upload-outline' : 'checkmark'}
                      size={18}
                    />
                  </View>
                  <View style={styles.documentFileCopy}>
                    <Text style={styles.documentAddedLabel}>
                      {uploading ? 'Replacing…' : 'Added'}
                    </Text>
                    <Text numberOfLines={2} style={styles.documentFileName}>
                      {document.fileAsset.originalName.split(/[\\/]/).pop() ??
                        document.fileAsset.originalName}
                    </Text>
                  </View>
                </View>
                <Pressable
                  accessibilityHint="Replace this document"
                  accessibilityLabel={`${definition.name} document options`}
                  accessibilityRole="button"
                  disabled={uploading}
                  hitSlop={8}
                  onPress={() => showDocumentActions(definition)}
                  style={styles.documentOverflowAction}
                >
                  <Icon color={colors.ink} name="ellipsis-horizontal" size={22} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.documentEmptyRow}>
                <View style={styles.documentEmptyStatus}>
                  <Icon color={colors.subtleText} name="document-outline" size={20} />
                  <Text style={styles.documentEmptyText}>
                    {uploading ? 'Uploading…' : 'Not added'}
                  </Text>
                </View>
                <Pressable
                  accessibilityHint="Choose the camera or a PDF or image file"
                  accessibilityLabel={`Add ${definition.name}`}
                  accessibilityRole="button"
                  disabled={uploading}
                  onPress={() => chooseDocumentSource(definition)}
                  style={styles.documentAddAction}
                >
                  <Icon color={colors.primary} name="add-circle-outline" size={20} />
                  <Text style={styles.documentAddActionText}>Add document</Text>
                </Pressable>
              </View>
            )}
          </View>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </Section>
  );
}

function LocationStep({
  endpointBase,
  vehicle,
  onPrevious,
  onSaved,
  onContinue,
}: {
  readonly endpointBase: string;
  readonly vehicle: Vehicle;
  readonly onPrevious: () => void;
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
      await apiClient.request(`${endpointBase}/location`, {
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
      return markSectionComplete(endpointBase, 'Location');
    },
    onSuccess: () => {
      onSaved();
      onContinue();
    },
  });
  return (
    <>
      <ScrollView contentContainerStyle={styles.editorBody}>
        <Section title="Private pickup location">
          <Text style={styles.body}>
            Choose the exact pickup and return point for this vehicle.
          </Text>
          <View style={styles.locationPrivacyNote}>
            <Icon color={colors.subtleText} name="lock-closed-outline" size={16} />
            <Text style={styles.locationPrivacyText}>
              Kept private from public browsing and shared only for an authorized booking.
            </Text>
          </View>
          <View style={styles.locationSetupCard}>
            {location ? (
              <View style={styles.locationSummaryRow}>
                <View style={styles.locationSummaryIcon}>
                  <Icon color={colors.primary} name="location-outline" size={22} />
                </View>
                <View style={styles.locationSummaryContent}>
                  <Text style={styles.cardTitle}>Selected pickup location</Text>
                  <Text style={styles.locationAddress}>{locationDisplayLabel(location)}</Text>
                  <View style={styles.locationPrivateRow}>
                    <Icon color={colors.subtleText} name="lock-closed-outline" size={14} />
                    <Text style={styles.locationPrivateText}>Private location</Text>
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.locationSummaryRow}>
                <View style={styles.locationSummaryIcon}>
                  <Icon color={colors.primary} name="location-outline" size={22} />
                </View>
                <View style={styles.locationSummaryContent}>
                  <Text style={styles.cardTitle}>Location</Text>
                  <Text style={styles.locationAddress}>No pickup point selected yet</Text>
                </View>
              </View>
            )}
            <Button
              compact
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
              dismissLabel="Back"
              description="Choose the exact pickup and return point for this vehicle."
              confirmLabel="Confirm location"
              mapAccessibilityLabel="Google map for choosing the private vehicle pickup point"
              mapGuidance="Move the map to adjust the exact pickup and return point."
              presentation="vehicleSetup"
              onCancel={() => setPickerOpen(false)}
              onConfirm={(value) => {
                setLocation(value);
                setPickerOpen(false);
              }}
            />
          )}
          {save.error && <Text style={styles.error}>{save.error.message}</Text>}
        </Section>
      </ScrollView>
      <WizardSaveFooter disabled={!location} mutation={save} onPrevious={onPrevious} />
    </>
  );
}

function PolicyStep({
  contentBottomPadding,
  endpointBase,
  mode,
  vehicle,
  onPrevious,
  onSaved,
  onContinue,
}: {
  readonly contentBottomPadding: number;
  readonly endpointBase: string;
  readonly mode: 'pricing' | 'usage';
  readonly vehicle: Vehicle;
  readonly onPrevious: () => void;
  readonly onSaved: () => void | Promise<void>;
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
  const [discountsEnabled, setDiscountsEnabled] = useState(
    [
      current?.shortDurationDiscountBps,
      current?.weeklyDiscountBps,
      current?.extendedTripDiscountBps,
      current?.monthlyDiscountBps,
    ].some((value) => (value ?? 0) > 0),
  );
  const [discountError, setDiscountError] = useState('');
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
    enabled: mode === 'pricing',
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
  const depositRequiredForPayload =
    mode === 'pricing'
      ? securityDepositRequired
      : (current?.securityDeposit.required ?? current?.securityDepositRequired ?? false);
  const depositAmountForPayload =
    mode === 'pricing'
      ? selectedDepositAmountMinor
      : (current?.securityDeposit.amountMinor ?? current?.securityDepositAmountMinor ?? null);
  const depositCurrencyForPayload =
    mode === 'pricing'
      ? selectedDepositCurrency
      : (current?.securityDeposit.currency ??
        current?.securityDepositCurrency ??
        current?.currency ??
        'PHP');
  const electric = vehicle.powertrain === 'BATTERY_ELECTRIC';
  const ownerService = ownerDelivery || ownerCollection;
  const save = useMutation({
    mutationFn: async () => {
      setFulfillmentError('');
      setSecurityDepositError('');
      setDiscountError('');
      if (mode === 'pricing' && discountsEnabled) {
        let previousDiscount = 0;
        for (const [label, rawValue] of [
          ['3-day', shortDiscount],
          ['7-day', weeklyDiscount],
          ['14-day', extendedDiscount],
          ['30-day', monthlyDiscount],
        ] as const) {
          if (!rawValue.trim()) continue;
          const discount = Number(rawValue);
          if (!Number.isFinite(discount) || discount < 0 || discount > 40) {
            const message = `${label} discount must be between 0% and 40%.`;
            setDiscountError(message);
            throw new Error(message);
          }
          if (discount < previousDiscount) {
            const message = 'Longer-stay discounts can’t be lower than shorter-stay discounts.';
            setDiscountError(message);
            throw new Error(message);
          }
          previousDiscount = discount;
        }
      }
      if (mode === 'pricing' && !depositCatalog.data?.enabledForConfiguration) {
        setSecurityDepositError('Security deposit options are unavailable. Retry before saving.');
        throw new Error('Security deposit options are unavailable.');
      }
      if (
        mode === 'pricing' &&
        securityDepositRequired &&
        (!selectedDepositAmountMinor || !allowedDepositTiers.includes(selectedDepositAmountMinor))
      ) {
        setSecurityDepositError('Choose an available security deposit amount.');
        throw new Error('Choose an available security deposit amount.');
      }
      if (mode === 'usage' && !renterPickup && !ownerDelivery) {
        setFulfillmentError('Choose at least one way for renters to receive the car.');
        throw new Error('Choose at least one way for renters to receive the car.');
      }
      if (mode === 'usage' && !renterReturn && !ownerCollection) {
        setFulfillmentError('Choose at least one way for the car to be returned.');
        throw new Error('Choose at least one way for the car to be returned.');
      }
      const radiusMeters = Math.round(Number(serviceRadiusKm) * 1000);
      const deliveryFeeMinor = Math.round(Number(deliveryFee) * 100);
      const collectionFeeMinor = Math.round(Number(collectionFee) * 100);
      if (
        mode === 'usage' &&
        ownerService &&
        (!Number.isInteger(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50_000)
      ) {
        setFulfillmentError('Choose a service area from 1 to 50 km.');
        throw new Error('Choose a service area from 1 to 50 km.');
      }
      if (
        mode === 'usage' &&
        ownerDelivery &&
        (!Number.isSafeInteger(deliveryFeeMinor) || deliveryFeeMinor < 0)
      ) {
        setFulfillmentError('Enter a valid Delivery fee. Zero means free delivery.');
        throw new Error('Enter a valid Delivery fee.');
      }
      if (
        mode === 'usage' &&
        ownerCollection &&
        (!Number.isSafeInteger(collectionFeeMinor) || collectionFeeMinor < 0)
      ) {
        setFulfillmentError('Enter a valid Collection fee. Zero means free collection.');
        throw new Error('Enter a valid Collection fee.');
      }
      await apiClient.request(`${endpointBase}/policy-versions`, {
        body: JSON.stringify({
          dailyRateMinor: Math.round(Number(dailyRate) * 100),
          currency: current?.currency ?? 'PHP',
          securityDepositRequired: depositRequiredForPayload,
          ...(depositRequiredForPayload
            ? {
                securityDepositAmountMinor: depositAmountForPayload,
                securityDepositCurrency: depositCurrencyForPayload,
              }
            : {}),
          ...(discountsEnabled && shortDiscount.trim()
            ? { shortDurationDiscountBps: Math.round(Number(shortDiscount) * 100) }
            : {}),
          ...(discountsEnabled && weeklyDiscount.trim()
            ? { weeklyDiscountBps: Math.round(Number(weeklyDiscount) * 100) }
            : {}),
          ...(discountsEnabled && extendedDiscount.trim()
            ? { extendedTripDiscountBps: Math.round(Number(extendedDiscount) * 100) }
            : {}),
          ...(discountsEnabled && monthlyDiscount.trim()
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
      if (mode === 'usage') await markSectionComplete(endpointBase, 'Policies');
    },
    onSuccess: async () => {
      await onSaved();
      onContinue();
    },
  });
  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentContainerStyle={[styles.editorBody, { paddingBottom: contentBottomPadding }]}
        keyboardDismissMode={formKeyboardDismissMode}
        keyboardShouldPersistTaps="handled"
      >
        <Section title={mode === 'pricing' ? 'Pricing' : 'Handover & usage policies'}>
          {mode === 'pricing' ? (
            <>
              <View style={styles.policySection}>
                <Text style={styles.policySectionTitle}>Base pricing</Text>
                <Field
                  grouped
                  label="Daily rate"
                  value={dailyRate}
                  onChange={setDailyRate}
                  keyboard="numeric"
                  placeholder="2,500"
                  prefix="₱"
                />
              </View>
              <View style={[styles.policySection, styles.policySectionSeparated]}>
                <Text style={styles.policySectionTitle}>Long-booking discounts</Text>
                <Text style={styles.policyHelper}>Optional discounts for longer rentals.</Text>
                <Pressable
                  accessibilityLabel="Offer long-booking discounts"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: discountsEnabled }}
                  onPress={() => {
                    const enabled = !discountsEnabled;
                    setDiscountsEnabled(enabled);
                    if (!enabled) setDiscountError('');
                  }}
                  style={styles.discountToggleRow}
                >
                  <Text style={styles.discountToggleLabel}>Offer long-booking discounts</Text>
                  <View
                    accessibilityElementsHidden
                    style={[
                      styles.discountSwitchTrack,
                      discountsEnabled && styles.discountSwitchTrackEnabled,
                    ]}
                  >
                    <View
                      style={[
                        styles.discountSwitchThumb,
                        discountsEnabled && styles.discountSwitchThumbEnabled,
                      ]}
                    />
                  </View>
                </Pressable>
                {discountsEnabled && (
                  <>
                    <Text style={styles.policyHelper}>
                      Enter 0–40%. Longer stays can’t have a lower discount than shorter stays.
                    </Text>
                    <View style={styles.discountRows}>
                      <DiscountRow
                        divider
                        label="3+ days"
                        value={shortDiscount}
                        onChange={setShortDiscount}
                      />
                      <DiscountRow
                        divider
                        label="7+ days"
                        value={weeklyDiscount}
                        onChange={setWeeklyDiscount}
                      />
                      <DiscountRow
                        divider
                        label="14+ days"
                        value={extendedDiscount}
                        onChange={setExtendedDiscount}
                      />
                      <DiscountRow
                        label="30+ days"
                        value={monthlyDiscount}
                        onChange={setMonthlyDiscount}
                      />
                    </View>
                    {discountError && (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {discountError}
                      </Text>
                    )}
                    {Number(dailyRate) > 0 && weeklyDiscount.trim() && (
                      <Text style={styles.body}>
                        Example: 7 days is{' '}
                        {money(
                          Math.round(
                            Number(dailyRate) * 100 * 7 * (1 - Number(weeklyDiscount) / 100),
                          ),
                        )}{' '}
                        after the weekly discount.
                      </Text>
                    )}
                  </>
                )}
              </View>
              <View style={[styles.policySection, styles.policySectionSeparated]}>
                <Text style={styles.policySectionTitle}>Security deposit</Text>
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
                    <Text style={styles.depositHelper}>
                      Changes apply to new booking requests only.
                    </Text>
                    {!depositCatalog.data.executionAvailable && (
                      <Text style={styles.depositInfoNote}>
                        Deposit processing isn’t active yet. No hold will be placed and pickup won’t
                        be blocked.
                      </Text>
                    )}
                  </View>
                )}
                {securityDepositError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {securityDepositError}
                  </Text>
                )}
              </View>
            </>
          ) : (
            <View style={styles.usageStep}>
              <View style={styles.usageSection}>
                <Text accessibilityRole="header" style={styles.policySectionTitle}>
                  Handover
                </Text>
                <Text style={styles.policyHelper}>Choose how each rental starts and ends.</Text>
                <PolicyOptionGroup
                  label="Start of rental"
                  options={[
                    {
                      label: 'Renter pickup',
                      onPress: () => setRenterPickup((value) => !value),
                      selected: renterPickup,
                    },
                    {
                      label: 'Owner delivery',
                      onPress: () => setOwnerDelivery((value) => !value),
                      selected: ownerDelivery,
                    },
                  ]}
                />
                <PolicyOptionGroup
                  label="End of rental"
                  options={[
                    {
                      label: 'Renter return',
                      onPress: () => setRenterReturn((value) => !value),
                      selected: renterReturn,
                    },
                    {
                      label: 'Owner collection',
                      onPress: () => setOwnerCollection((value) => !value),
                      selected: ownerCollection,
                    },
                  ]}
                />
                {fulfillmentError && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {fulfillmentError}
                  </Text>
                )}
              </View>

              {ownerService && (
                <View style={[styles.usageSection, styles.policySectionSeparated]}>
                  <Text accessibilityRole="header" style={styles.policySectionTitle}>
                    Delivery & collection
                  </Text>
                  <Text style={styles.policyHelper}>
                    Set the service area, fees, and notice for owner-provided handover.
                  </Text>
                  <Text style={styles.compactFieldLabel}>Service radius</Text>
                  <Text style={styles.policyHelper}>
                    How far you’re willing to{' '}
                    {ownerDelivery && ownerCollection
                      ? 'deliver or collect'
                      : ownerDelivery
                        ? 'deliver'
                        : 'collect'}{' '}
                    the vehicle.
                  </Text>
                  <View accessibilityLabel="Owner service radius" style={styles.policyOptionGrid}>
                    {[5, 10, 15, 25, 50].map((kilometers) => (
                      <CompactPolicyChoice
                        key={kilometers}
                        label={`${kilometers} km`}
                        selected={serviceRadiusKm === String(kilometers)}
                        onPress={() => setServiceRadiusKm(String(kilometers))}
                      />
                    ))}
                  </View>
                  <View style={styles.compactFieldGrid}>
                    {ownerDelivery && (
                      <PolicyNumberField
                        accessibilityLabel="Delivery fee in Philippine pesos"
                        label="Delivery fee"
                        prefix="₱"
                        value={deliveryFee}
                        onChange={setDeliveryFee}
                      />
                    )}
                    {ownerCollection && (
                      <PolicyNumberField
                        accessibilityLabel="Collection fee in Philippine pesos"
                        label="Collection fee"
                        prefix="₱"
                        value={collectionFee}
                        onChange={setCollectionFee}
                      />
                    )}
                  </View>
                  <Text style={styles.compactFieldLabel}>Minimum notice</Text>
                  <Text style={styles.policyHelper}>
                    How far in advance renters must book owner delivery or collection. Renter pickup
                    and return aren’t affected.
                  </Text>
                  <View
                    accessibilityLabel="Delivery and collection notice"
                    style={styles.policyOptionGrid}
                  >
                    {[
                      [0, 'None'],
                      [180, '3 hr'],
                      [360, '6 hr'],
                      [720, '12 hr'],
                      [1440, '24 hr'],
                      [2880, '48 hr'],
                      [10080, '7 days'],
                    ].map(([minutes, label]) => (
                      <CompactPolicyChoice
                        key={minutes}
                        label={String(label)}
                        selected={minimumNotice === minutes}
                        onPress={() => setMinimumNotice(Number(minutes))}
                      />
                    ))}
                  </View>
                </View>
              )}

              <View style={[styles.usageSection, styles.policySectionSeparated]}>
                <Text accessibilityRole="header" style={styles.policySectionTitle}>
                  Mileage
                </Text>
                <Text style={styles.policyHelper}>
                  Set how much driving is included with each rental.
                </Text>
                <PolicyOptionGroup
                  exclusive
                  label="Mileage allowance"
                  options={[
                    { label: 'Limited', onPress: () => setLimited(true), selected: limited },
                    { label: 'Unlimited', onPress: () => setLimited(false), selected: !limited },
                  ]}
                />
                {limited && (
                  <>
                    <View style={styles.compactFieldGrid}>
                      <PolicyNumberField
                        accessibilityLabel="Included distance in kilometers per day"
                        label="Included distance"
                        suffix="km/day"
                        value={included}
                        onChange={setIncluded}
                      />
                      <PolicyNumberField
                        accessibilityLabel="Excess distance fee in Philippine pesos per kilometer"
                        label="Excess distance fee"
                        prefix="₱"
                        suffix="/ km"
                        value={excess}
                        onChange={setExcess}
                      />
                    </View>
                    <Text style={styles.policyHelper}>
                      Extra whole kilometers are charged at the rate above.
                    </Text>
                  </>
                )}
              </View>

              <View style={[styles.usageSection, styles.policySectionSeparated]}>
                <Text accessibilityRole="header" style={styles.policySectionTitle}>
                  Turnaround
                </Text>
                <Text style={styles.policyHelper}>
                  Time reserved between bookings for cleaning and preparation.
                </Text>
                <View accessibilityLabel="Turnaround buffer" style={styles.policyOptionGrid}>
                  {[120, 240, 360, 720, 1440].map((minutes) => (
                    <CompactPolicyChoice
                      key={minutes}
                      selected={turnaround === minutes}
                      label={`${minutes / 60} hr`}
                      onPress={() => setTurnaround(minutes)}
                    />
                  ))}
                </View>
              </View>

              <View style={[styles.usageSection, styles.policySectionSeparated]}>
                <Text accessibilityRole="header" style={styles.policySectionTitle}>
                  Return conditions
                </Text>
                <View style={styles.returnConditionCard}>
                  <View style={styles.returnConditionIcon}>
                    <Icon
                      color={colors.primary}
                      name={electric ? 'flash-outline' : 'water-outline'}
                      size={20}
                    />
                  </View>
                  <View style={styles.returnConditionCopy}>
                    <Text style={styles.returnConditionLabel}>
                      {electric ? 'EV charge' : 'Fuel'}
                    </Text>
                    <Text style={styles.returnConditionValue}>
                      Same level as pickup · 5% tolerance
                    </Text>
                    <Text style={styles.returnConditionHelper}>
                      Deficiency charges require platform review.
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          )}
          {save.error && !discountError && !fulfillmentError && !securityDepositError && (
            <Text accessibilityRole="alert" style={styles.error}>
              We couldn’t save these changes. Check your connection and try again.
            </Text>
          )}
        </Section>
      </ScrollView>
      <WizardSaveFooter label="Continue" mutation={save} onPrevious={onPrevious} />
    </>
  );
}

function AvailabilityStep({
  canUpdate = true,
  endpointBase,
  id,
  ownerProfileId,
  vehicle,
  onSaved,
}: {
  readonly id: string;
  readonly canUpdate?: boolean;
  readonly endpointBase?: string;
  readonly ownerProfileId?: string;
  readonly vehicle: Vehicle;
  readonly onSaved: () => void;
}) {
  const current = vehicle.policyVersions[0];
  const client = useQueryClient();
  const blockQueryKey = ownerProfileId
    ? ['owner-workspace', ownerProfileId, 'vehicle-blocks', id]
    : ['vehicle-blocks', id];
  const blocks = useQuery({
    queryKey: blockQueryKey,
    queryFn: () =>
      apiClient.request<VehicleBlock[]>(
        `${endpointBase ?? `/owner/vehicles/${id}`}/blocked-periods`,
      ),
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
      apiClient.request(`${endpointBase ?? `/owner/vehicles/${id}`}/blocked-periods`, {
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
        client.invalidateQueries({ queryKey: blockQueryKey }),
        client.invalidateQueries({ queryKey: ['vehicle', id] }),
        client.invalidateQueries({ queryKey: ['vehicles'] }),
        client.invalidateQueries({ queryKey: ['owner-vehicle-dashboard-summary'] }),
      ]);
    },
  });
  const remove = useMutation({
    mutationFn: (blockId: string) =>
      apiClient.request(`${endpointBase ?? `/owner/vehicles/${id}`}/blocked-periods/${blockId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      Alert.alert('Unavailable period removed.');
      void Promise.all([
        client.invalidateQueries({ queryKey: blockQueryKey }),
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
      {!canUpdate ? <Text style={styles.body}>You have view-only availability access.</Text> : null}
      {canUpdate ? (
        <>
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
        </>
      ) : null}
      {blocks.data?.map((block) => (
        <View key={block.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {domainLabel(block.reason)} · {blockPeriodState(block)}
          </Text>
          <Text style={styles.body}>
            {formatManilaDateTime(block.startsAt)} → {formatManilaDateTime(block.endsAt)}
          </Text>
          {canUpdate && new Date(block.endsAt) > new Date() ? (
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

function fleetDistinctAvailabilityLabel(value?: AvailabilityToday): string | null {
  if (!value || value.state === 'MARKETPLACE_UNAVAILABLE') return null;
  return availabilityTodayLabel(value);
}

function fleetMarketplaceStatus(vehicle: Vehicle): string {
  if (
    ['SUBMITTED', 'AWAITING_REVIEW', 'UNDER_REVIEW', 'PENDING_APPROVAL'].includes(vehicle.status)
  ) {
    return 'Awaiting marketplace approval';
  }
  if (vehicle.status === 'APPROVED') {
    return vehicle.operationalStatus === 'AVAILABLE'
      ? 'Marketplace available'
      : 'Marketplace unavailable';
  }
  return ownerMarketplaceStatus(vehicle);
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
  onEdit,
}: {
  readonly vehicle: Vehicle;
  readonly action: (value: { path: string; body?: object; method?: string }) => void;
  readonly onEdit: (step: number) => void;
}) {
  const editable = ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED'].includes(vehicle.status);
  const submitted = ['SUBMITTED', 'AWAITING_REVIEW', 'UNDER_REVIEW', 'PENDING_APPROVAL'].includes(
    vehicle.status,
  );
  const policy = vehicle.policyVersions[0];
  const cover = vehicle.photos.find(({ isCover }) => isCover) ?? vehicle.photos[0];
  const activeDocuments = vehicle.documents.filter((item) => !item.replacedAt);
  const requiredDocuments = activeDocuments.filter((item) => item.definition.required !== false);
  const optionalDocuments = activeDocuments.length - requiredDocuments.length;
  const discountsEnabled = Boolean(
    policy &&
    [
      policy.shortDurationDiscountBps,
      policy.weeklyDiscountBps,
      policy.extendedTripDiscountBps,
      policy.monthlyDiscountBps,
    ].some((value) => (value ?? 0) > 0),
  );
  const detailSummary = [
    domainLabel(vehicle.transmission),
    domainLabel(vehicle.powertrain),
    `${vehicle.seatCount ?? '—'} seats`,
  ].join(' · ');
  const photoSummary = `${vehicle.photos.length} photo${vehicle.photos.length === 1 ? '' : 's'} added · ${cover ? 'Cover selected' : 'No cover selected'}`;
  const documentSummary = `${requiredDocuments.length} of 3 required documents added${optionalDocuments ? ` · ${optionalDocuments} optional` : ''}`;
  const pricingSummary = policy
    ? [
        `${money(policy.dailyRateMinor)}/day`,
        discountsEnabled ? 'Long-stay discounts enabled' : 'No long-stay discounts',
        policy.securityDeposit.required || policy.securityDepositRequired
          ? `${money(policy.securityDeposit.amountMinor ?? policy.securityDepositAmountMinor ?? 0, policy.securityDeposit.currency ?? policy.securityDepositCurrency ?? policy.currency)} deposit required`
          : 'No security deposit',
      ].join(' · ')
    : 'Pricing not complete';
  const handoverSummary = policy
    ? [
        policy.supportsRenterPickup ? 'Renter pickup' : null,
        policy.supportsOwnerDelivery ? 'Owner delivery' : null,
        policy.supportsRenterReturn ? 'Renter return' : null,
        policy.supportsOwnerCollection ? 'Owner collection' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const usageSummary = policy
    ? `${policy.mileagePolicy === 'UNLIMITED' ? 'Unlimited mileage' : 'Limited mileage'} · ${policy.turnaroundMinutes / 60}-hour turnaround`
    : '';
  return (
    <Section title="Review and submit">
      <View
        accessibilityLabel={`Vehicle status: ${vehicleStatusLabel(vehicle.status)}`}
        style={styles.reviewStatusRow}
      >
        <StatusBadge
          label={vehicleStatusLabel(vehicle.status)}
          tone={vehicleTone(vehicle.status)}
        />
        {submitted && (
          <Text style={styles.reviewStatusHelper}>
            Your vehicle has been submitted and is waiting for review.
          </Text>
        )}
      </View>
      {vehicle.reviewReason && <Text style={styles.error}>{vehicle.reviewReason}</Text>}
      <View style={styles.reviewVehicleSummary}>
        {cover && (
          <VehicleImage
            accessible={false}
            contentPath={cover.fileAsset.contentGrant?.contentPath}
            style={styles.reviewVehicleImage}
          />
        )}
        <View style={styles.reviewVehicleCopy}>
          <Text style={styles.reviewVehicleTitle}>
            {vehicle.modelYear} {vehicle.make} {vehicle.model}
          </Text>
          <Text style={styles.reviewSummaryText}>{detailSummary}</Text>
          <Text style={styles.reviewSummaryText}>
            {vehicle.location
              ? `${vehicle.location.city}, ${vehicle.location.province}`
              : 'Location not complete'}
          </Text>
          {policy && (
            <Text style={styles.reviewSummaryText}>{money(policy.dailyRateMinor)}/day</Text>
          )}
        </View>
      </View>
      <View style={styles.reviewSections}>
        <ReviewSection
          complete={Boolean(
            vehicle.make && vehicle.model && vehicle.modelYear && vehicle.categoryId,
          )}
          editLabel="Edit basic details"
          editable={editable}
          onEdit={() => onEdit(0)}
          summary={`${detailSummary}${vehicle.features.length ? ` · ${vehicle.features.length} features selected` : ''}`}
          title="Basic details"
        />
        <ReviewSection
          complete={vehicle.photos.length >= 5 && Boolean(cover)}
          editLabel="Edit photos"
          editable={editable}
          onEdit={() => onEdit(2)}
          summary={photoSummary}
          title="Photos"
        />
        <ReviewSection
          complete={activeDocuments.length >= 3}
          editLabel="Edit documents"
          editable={editable}
          onEdit={() => onEdit(3)}
          summary={documentSummary}
          title="Documents"
        />
        <ReviewSection
          complete={Boolean(vehicle.location)}
          editLabel="Edit location"
          editable={editable}
          onEdit={() => onEdit(4)}
          summary={
            vehicle.location
              ? `${vehicle.location.city}, ${vehicle.location.province} · Private location`
              : 'Private pickup location not complete'
          }
          title="Location"
        />
        <ReviewSection
          complete={Boolean(policy)}
          editLabel="Edit pricing"
          editable={editable}
          onEdit={() => onEdit(5)}
          summary={pricingSummary}
          title="Pricing"
        />
        <ReviewSection
          complete={Boolean(policy)}
          editLabel="Edit handover and usage"
          editable={editable}
          onEdit={() => onEdit(6)}
          summary={
            policy ? (
              <View style={styles.reviewMiniSummaries}>
                <ReviewMiniSummary label="Handover" value={handoverSummary} />
                <ReviewMiniSummary label="Usage" value={usageSummary} />
              </View>
            ) : (
              'Handover and usage policies not complete'
            )
          }
          title="Handover & usage"
        />
      </View>
      {vehicle.status === 'APPROVED' && (
        <View style={styles.reviewApprovedActions}>
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
        </View>
      )}
    </Section>
  );
}

function ReviewSection({
  complete,
  editLabel,
  editable,
  onEdit,
  summary,
  title,
}: {
  readonly complete: boolean;
  readonly editLabel: string;
  readonly editable: boolean;
  readonly onEdit: () => void;
  readonly summary: React.ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.reviewSection}>
      <View style={styles.reviewSectionContent}>
        <View style={styles.reviewSectionHeading}>
          <Icon
            color={complete ? colors.primary : colors.subtleText}
            name={complete ? 'checkmark-circle' : 'ellipse-outline'}
            size={19}
          />
          <Text style={styles.reviewSectionTitle}>{title}</Text>
        </View>
        {typeof summary === 'string' ? (
          <Text style={styles.reviewSectionSummary}>{summary}</Text>
        ) : (
          summary
        )}
      </View>
      {editable && (
        <Pressable
          accessibilityLabel={editLabel}
          accessibilityRole="button"
          onPress={onEdit}
          style={styles.reviewEditHitArea}
        >
          <Text style={styles.reviewEditAction}>Edit</Text>
        </Pressable>
      )}
    </View>
  );
}

function ReviewMiniSummary({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.reviewMiniSummary}>
      <Text style={styles.reviewMiniSummaryLabel}>{label}</Text>
      <Text style={styles.reviewMiniSummaryValue}>{value}</Text>
    </View>
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

function DetailsFormSection({
  children,
  optional = false,
  title,
}: {
  readonly children: React.ReactNode;
  readonly optional?: boolean;
  readonly title: string;
}) {
  return (
    <View style={styles.detailsSection}>
      <View style={styles.detailsSectionHeading}>
        <Text accessibilityRole="header" style={styles.detailsSectionTitle}>
          {title}
        </Text>
        {optional && <Text style={styles.detailsOptional}>Optional</Text>}
      </View>
      <View style={styles.detailsFields}>{children}</View>
    </View>
  );
}

function Field({
  grouped = false,
  helper,
  label,
  multiline = false,
  value,
  onChange,
  keyboard,
  placeholder,
  prefix,
}: {
  readonly grouped?: boolean;
  readonly helper?: string;
  readonly label: string;
  readonly multiline?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly keyboard?: 'numeric' | 'decimal-pad';
  readonly placeholder?: string;
  readonly prefix?: string;
}) {
  const input = (
    <TextInput
      accessibilityLabel={label}
      keyboardType={keyboard}
      multiline={multiline}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.placeholder}
      style={[
        prefix ? styles.prefixedTextInput : styles.input,
        grouped && !prefix && styles.groupedInput,
        multiline && styles.multilineInput,
      ]}
      textAlignVertical={multiline ? 'top' : 'center'}
      value={value}
    />
  );
  return (
    <View style={grouped && styles.groupedField}>
      <Text style={[styles.label, grouped && styles.groupedFieldLabel]}>{label}</Text>
      {prefix ? (
        <View style={[styles.input, grouped && styles.groupedInput, styles.prefixedInput]}>
          <Text accessibilityElementsHidden style={styles.inputPrefix}>
            {prefix}
          </Text>
          {input}
        </View>
      ) : (
        input
      )}
      {helper && <Text style={styles.fieldHelper}>{helper}</Text>}
    </View>
  );
}
function FeatureChip({
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
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.featureChip, selected && styles.featureChipSelected]}
    >
      {selected && <Icon color={colors.onPrimary} name="checkmark" size={16} />}
      <Text style={[styles.featureChipText, selected && styles.featureChipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function DiscountRow({
  divider = false,
  label,
  value,
  onChange,
}: {
  readonly divider?: boolean;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <View style={[styles.discountRow, divider && styles.discountRowDivider]}>
      <Text style={styles.discountLabel}>{label}</Text>
      <View style={styles.discountInputGroup}>
        <TextInput
          accessibilityLabel={`${label} discount percentage`}
          hitSlop={{ bottom: 3, top: 3 }}
          keyboardType="decimal-pad"
          onChangeText={onChange}
          style={styles.discountInput}
          value={value}
        />
        <Text accessibilityElementsHidden style={styles.discountSuffix}>
          %
        </Text>
      </View>
    </View>
  );
}

function PolicyOptionGroup({
  exclusive = false,
  label,
  options,
}: {
  readonly exclusive?: boolean;
  readonly label: string;
  readonly options: readonly {
    readonly label: string;
    readonly onPress: () => void;
    readonly selected: boolean;
  }[];
}) {
  return (
    <View style={styles.policyOptionGroup}>
      <Text style={styles.compactFieldLabel}>{label}</Text>
      <View accessibilityLabel={label} style={styles.policySegmentedControl}>
        {options.map((option) => (
          <Pressable
            accessibilityRole={exclusive ? 'radio' : 'checkbox'}
            accessibilityState={{ checked: option.selected }}
            key={option.label}
            onPress={option.onPress}
            style={[styles.policySegment, option.selected && styles.policySegmentSelected]}
          >
            {option.selected && <Icon color={colors.onPrimary} name="checkmark" size={16} />}
            <Text
              style={[
                styles.policySegmentText,
                option.selected && styles.policySegmentTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CompactPolicyChoice({
  label,
  onPress,
  selected,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      style={styles.compactPolicyChoiceHitArea}
    >
      <View style={[styles.compactPolicyChoice, selected && styles.compactPolicyChoiceSelected]}>
        <Text
          style={[
            styles.compactPolicyChoiceText,
            selected && styles.compactPolicyChoiceTextSelected,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function PolicyNumberField({
  accessibilityLabel,
  label,
  onChange,
  prefix,
  suffix,
  value,
}: {
  readonly accessibilityLabel: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly value: string;
}) {
  return (
    <View style={styles.compactNumberField}>
      <Text style={styles.compactFieldLabel}>{label}</Text>
      <View style={styles.compactNumberInputGroup}>
        {prefix && (
          <Text accessibilityElementsHidden style={styles.compactNumberAffix}>
            {prefix}
          </Text>
        )}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          keyboardType="decimal-pad"
          onChangeText={onChange}
          style={styles.compactNumberInput}
          value={value}
        />
        {suffix && (
          <Text accessibilityElementsHidden style={styles.compactNumberAffix}>
            {suffix}
          </Text>
        )}
      </View>
    </View>
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
    <SegmentedControl
      accessibilityLabel="Security deposit requirement"
      options={[
        { label: 'No deposit', value: 'NO_DEPOSIT' },
        { label: 'Require deposit', value: 'REQUIRE_DEPOSIT' },
      ]}
      value={required ? 'REQUIRE_DEPOSIT' : 'NO_DEPOSIT'}
      onChange={(value) => onChange(value === 'REQUIRE_DEPOSIT')}
    />
  );
}
function Save({
  mutation,
  label = 'Save draft',
  disabled = false,
  flushTop = false,
}: {
  readonly mutation: {
    readonly mutate: () => void;
    readonly isPending: boolean;
    readonly error: Error | null;
  };
  readonly label?: string;
  readonly disabled?: boolean;
  readonly flushTop?: boolean;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || mutation.isPending }}
        disabled={disabled || mutation.isPending}
        style={[
          styles.primaryButton,
          flushTop && styles.flushTop,
          (disabled || mutation.isPending) && styles.disabledButton,
        ]}
        onPress={() => mutation.mutate()}
      >
        <Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : label}</Text>
      </Pressable>
      {mutation.error && <Text style={styles.error}>{mutation.error.message}</Text>}
    </>
  );
}

function WizardSaveFooter({
  mutation,
  disabled = false,
  label = 'Continue',
  onPrevious,
}: {
  readonly mutation: {
    readonly mutate: () => void;
    readonly isPending: boolean;
  };
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onPrevious?: () => void;
}) {
  const primaryDisabled = disabled || mutation.isPending;
  return (
    <View style={[styles.editorActions, styles.wizardSaveActions]}>
      {onPrevious ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPrevious}
          style={[styles.secondaryButton, styles.editorActionButton]}
        >
          <Text>Previous</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: primaryDisabled }}
        disabled={primaryDisabled}
        onPress={() => mutation.mutate()}
        style={[
          styles.primaryButton,
          styles.editorActionButton,
          onPrevious && styles.wizardPrimaryAction,
          primaryDisabled && styles.disabledButton,
        ]}
      >
        <Text style={styles.primaryText}>{mutation.isPending ? 'Saving…' : label}</Text>
      </Pressable>
    </View>
  );
}
function markSectionComplete(endpointBase: string, section: string) {
  return apiClient.request(endpointBase, {
    body: JSON.stringify({ lastCompletedSection: section.toUpperCase() }),
    method: 'PATCH',
  });
}

function vehicleMutationErrorMessage(error: Error) {
  if (
    error instanceof ApiError &&
    (error.status === 409 || error.code === 'VEHICLE_OWNER_APPROVAL_STALE')
  ) {
    return 'This vehicle changed since you opened it. Review the latest version before continuing.';
  }
  if (error instanceof ApiError && error.status === 403) {
    return 'You no longer have permission to change this vehicle.';
  }
  return error.message;
}

function ownerApprovalErrorMessage(error: Error) {
  if (error instanceof ApiError && error.code === 'VEHICLE_OWNER_APPROVAL_STALE') {
    return 'This vehicle changed after it was submitted. Review the latest version before approving.';
  }
  if (error instanceof ApiError && error.status === 409) {
    return 'This approval has already changed. Review the current vehicle status.';
  }
  return error.message;
}

function vehicleTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'APPROVED') return 'success';
  if (['CHANGES_REQUIRED', 'PENDING_APPROVAL'].includes(status)) return 'warning';
  if (['REJECTED', 'SUSPENDED'].includes(status)) return 'danger';
  return 'neutral';
}

function delegatedApprovalLabel(vehicle: Vehicle) {
  if (vehicle.ownerApproval?.status === 'PENDING') return 'Awaiting Owner approval';
  if (vehicle.ownerApproval?.status === 'CHANGES_REQUIRED' && vehicle.status === 'DRAFT')
    return 'Changes requested';
  if (vehicle.status === 'PENDING_APPROVAL') return 'Under review';
  return vehicleStatusLabel(vehicle.status);
}

function delegatedApprovalTone(vehicle: Vehicle): 'success' | 'warning' | 'neutral' | 'danger' {
  if (['PENDING', 'CHANGES_REQUIRED'].includes(vehicle.ownerApproval?.status ?? ''))
    return 'warning';
  return vehicleTone(vehicle.status);
}

function delegatedProposalStatusLabel(
  status?:
    | 'DRAFT'
    | 'PENDING_OWNER_APPROVAL'
    | 'OWNER_CHANGES_REQUIRED'
    | 'PENDING_PLATFORM_REVIEW'
    | 'PLATFORM_CHANGES_REQUIRED',
): string | null {
  if (status === 'DRAFT') return 'Changes in progress';
  if (status === 'PENDING_OWNER_APPROVAL') return 'Pending Owner approval';
  if (status === 'OWNER_CHANGES_REQUIRED') return 'Changes requested';
  if (status === 'PENDING_PLATFORM_REVIEW') return 'Changes under CarShare review';
  if (status === 'PLATFORM_CHANGES_REQUIRED') return 'CarShare requested changes';
  return null;
}

function fulfillmentSummary(policy: Policy): string {
  return [
    policy.supportsRenterPickup ? 'Renter pickup' : null,
    policy.supportsOwnerDelivery ? 'Owner delivery' : null,
    policy.supportsRenterReturn ? 'Renter return' : null,
    policy.supportsOwnerCollection ? 'Owner collection' : null,
  ]
    .filter(Boolean)
    .join(' · ');
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
  compactFieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  compactFieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  compactPolicyChoice: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  compactPolicyChoiceHitArea: { justifyContent: 'center', minHeight: 44 },
  compactPolicyChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  compactPolicyChoiceText: { color: colors.subtleText, fontSize: 13, fontWeight: '700' },
  compactPolicyChoiceTextSelected: { color: colors.onPrimary },
  compactNumberAffix: { color: colors.subtleText, fontSize: 14, fontWeight: '700' },
  compactNumberField: { flexBasis: 150, flexGrow: 1, gap: spacing.xs, minWidth: 0 },
  compactNumberInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    minWidth: 40,
    padding: 0,
  },
  compactNumberInputGroup: {
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
  disabledButton: { opacity: 0.5 },
  discountInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    height: 36,
    paddingHorizontal: spacing.xs,
    textAlign: 'right',
  },
  discountInputGroup: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: 'row',
    height: 38,
    paddingRight: spacing.xs,
    width: 92,
  },
  discountLabel: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '700' },
  discountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: 5,
  },
  discountRowDivider: { borderBottomColor: colors.border, borderBottomWidth: 1 },
  discountRows: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
  },
  discountSwitchThumb: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 22,
    width: 22,
  },
  discountSwitchThumbEnabled: { alignSelf: 'flex-end' },
  discountSwitchTrack: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 50,
  },
  discountSwitchTrackEnabled: { backgroundColor: colors.primary },
  discountSuffix: { color: colors.subtleText, fontSize: 14, fontWeight: '700' },
  discountToggleLabel: { color: colors.ink, flex: 1, fontSize: 14, fontWeight: '700' },
  discountToggleRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  coverPreview: { borderRadius: radius.lg, height: 220, marginTop: spacing.sm, width: '100%' },
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
  detailsFields: { gap: spacing.md },
  detailsOptional: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  detailsSection: { gap: spacing.sm },
  detailsSectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailsSectionTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  detailsStep: { gap: spacing.xxl },
  documentAddAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  documentAddActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  documentAddedIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  documentAddedLabel: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  documentAddedRow: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  documentCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  documentCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
  },
  documentCardOptional: { backgroundColor: colors.surface, borderColor: colors.border },
  documentDefinitionsError: { gap: spacing.sm },
  documentEmptyRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  documentEmptyStatus: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.xs },
  documentEmptyText: { color: colors.subtleText, flexShrink: 1, fontSize: 13, fontWeight: '700' },
  documentFileCopy: { flex: 1, minWidth: 0 },
  documentFileName: { color: colors.subtleText, fontSize: 12, lineHeight: 17, marginTop: 2 },
  documentGuidance: {
    color: colors.subtleText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xxs,
  },
  documentIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  documentOverflowAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  documentRequirementBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    color: colors.primaryDark,
    flexShrink: 0,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  documentRequirementBadgeOptional: { backgroundColor: colors.muted, color: colors.subtleText },
  documentsHelper: { color: colors.subtleText, fontSize: 14, lineHeight: 20 },
  documentsIntro: { gap: spacing.xxs },
  documentsProgress: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  documentTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 21,
  },
  documentEditorActions: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
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
  editorStepSubtitle: { fontSize: 13, marginTop: spacing.xxs },
  editorStepTitle: { fontSize: 20, fontWeight: '900' },
  empty: { color: colors.subtleText, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: '#A12626', marginTop: spacing.sm },
  fieldHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  featureChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    maxWidth: '100%',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  featureChipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  featureChipText: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  featureChipTextSelected: { color: colors.onPrimary },
  featureChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  featureGroup: { gap: spacing.sm },
  featuresCount: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  featuresHelper: { color: colors.subtleText, flex: 1, fontSize: 14, lineHeight: 20 },
  featuresIntro: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  featuresStep: { gap: spacing.xxl },
  availabilityText: { color: colors.primary, fontWeight: '700', marginTop: spacing.xxs },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  flex: { backgroundColor: colors.background, flex: 1 },
  flushTop: { marginTop: 0 },
  fleetCard: {
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    overflow: 'hidden',
    padding: spacing.sm,
  },
  fleetAction: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 'auto',
    paddingTop: spacing.xs,
  },
  fleetAddAction: { minHeight: 48, paddingVertical: spacing.sm },
  fleetAvailabilityState: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  fleetContent: { flex: 1, gap: spacing.xxs, minHeight: 120, minWidth: 0 },
  fleetDraftCard: { backgroundColor: colors.surface },
  fleetDraftState: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  fleetHeader: { gap: spacing.xxs },
  fleetHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  fleetImage: { alignSelf: 'stretch', borderRadius: radius.md, minHeight: 120, width: 108 },
  fleetMarketplaceState: { color: colors.ink, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  fleetMetadata: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  fleetRate: { color: colors.ink, fontSize: 14, fontWeight: '800', lineHeight: 19 },
  fleetReviewReason: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  fleetTitle: { color: colors.ink, fontSize: 27, fontWeight: '800', lineHeight: 32 },
  fleetVehicleTitle: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  galleryImage: { height: 104, width: '100%' },
  galleryTile: { borderRadius: radius.md, overflow: 'hidden', position: 'relative', width: '31%' },
  hero: { aspectRatio: 1.55, borderRadius: radius.lg, marginTop: spacing.md, width: '100%' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  inputPrefix: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  locationAddress: { color: colors.subtleText, lineHeight: 20, marginTop: spacing.xxs },
  locationPrivacyNote: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  locationPrivacyText: { color: colors.subtleText, flex: 1, fontSize: 13, lineHeight: 18 },
  locationPrivateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  locationPrivateText: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  locationSetupCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  locationSummaryContent: { flex: 1, minWidth: 0 },
  locationSummaryIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  locationSummaryRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  groupedField: { gap: spacing.xs },
  groupedFieldLabel: { marginTop: 0 },
  groupedInput: { borderRadius: radius.md, marginTop: 0, minHeight: 50 },
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
  multilineInput: { minHeight: 128, paddingTop: spacing.md },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  photoAddAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingTop: spacing.sm,
  },
  photoAddActionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  photoCategoryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  photoCategoryCount: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  photoCategoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  photoCoverBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xxs,
    left: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    position: 'absolute',
    top: spacing.xs,
  },
  photoCoverBadgeText: { color: colors.onPrimary, fontSize: 11, fontWeight: '800' },
  photoEmptyCopy: {
    color: colors.subtleText,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  photoEmptyState: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: 150,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  photoEmptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  photoGuidance: { color: colors.subtleText, fontSize: 13, lineHeight: 18, marginTop: spacing.xxs },
  photoOverflowAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
    width: 36,
  },
  photoTile: {
    aspectRatio: 1.35,
    borderRadius: radius.md,
    flexBasis: '48%',
    flexGrow: 1,
    maxWidth: '100%',
    minWidth: 130,
    overflow: 'hidden',
    position: 'relative',
  },
  photoTileImage: { height: '100%', width: '100%' },
  photoTileSingle: { flexBasis: '100%' },
  photosCount: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  photosHelper: { color: colors.subtleText, flex: 1, fontSize: 14, lineHeight: 20 },
  photosIntro: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  policyHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  policyOptionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs },
  policyOptionGroup: { gap: spacing.xs },
  policySegment: {
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
  policySegmentedControl: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    padding: spacing.xxs,
  },
  policySegmentSelected: { backgroundColor: colors.primary },
  policySegmentText: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  policySegmentTextSelected: { color: colors.onPrimary },
  policySection: { gap: spacing.sm },
  policySectionSeparated: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  policySectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  returnConditionCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  returnConditionCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  returnConditionHelper: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  returnConditionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  returnConditionLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  returnConditionValue: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  prefixedInput: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: 0,
  },
  prefixedTextInput: { color: colors.ink, flex: 1, fontSize: 16, minHeight: 48, padding: 0 },
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
  resolvedIssuesSection: { marginTop: spacing.xxl },
  reviewApprovedActions: { marginTop: spacing.sm },
  reviewEditAction: { color: colors.primary, fontSize: 13, fontWeight: '800', padding: spacing.xs },
  reviewEditHitArea: { justifyContent: 'center', minHeight: 44 },
  reviewMiniSummaries: { gap: spacing.xxs, paddingLeft: 27 },
  reviewMiniSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  reviewMiniSummaryLabel: { color: colors.ink, fontSize: 12, fontWeight: '800', lineHeight: 18 },
  reviewMiniSummaryValue: { color: colors.subtleText, flex: 1, fontSize: 13, lineHeight: 18 },
  reviewSection: {
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reviewSectionContent: { flex: 1, gap: 2, minWidth: 0 },
  reviewSectionHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  reviewSections: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  reviewSectionSummary: { color: colors.subtleText, fontSize: 13, lineHeight: 18, paddingLeft: 27 },
  reviewSectionTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  reviewStatusHelper: { color: colors.subtleText, flex: 1, fontSize: 13, lineHeight: 19 },
  reviewStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  reviewSummaryText: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  reviewVehicleCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  reviewVehicleImage: { borderRadius: radius.md, height: 88, width: 104 },
  reviewVehicleSummary: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  reviewVehicleTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', lineHeight: 21 },
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
  usageSection: { gap: spacing.sm },
  usageStep: { gap: 0 },
  wizardPrimaryAction: { flex: 1.2 },
  wizardSaveActions: { paddingVertical: spacing.sm },
  vehicleDetailHeader: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
  },
  vehicleDetailAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  vehicleDetailActionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  vehicleDetailHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  vehicleDetailPage: { paddingTop: spacing.sm },
  ownerApprovalFooter: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  vehicleDetailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 34,
  },
  vehicleDetailRowCopy: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  vehicleDetailRowLabel: { color: colors.subtleText, flex: 1, fontSize: 13, lineHeight: 19 },
  vehicleDetailRowValue: {
    color: colors.ink,
    flex: 1.2,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    textAlign: 'right',
  },
  vehicleDetailSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  vehicleDetailSectionContent: { gap: spacing.xs },
  vehicleDetailSectionEmphasized: { borderWidth: 1 },
  vehicleDetailSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  vehicleDetailSectionTitle: { color: colors.ink, flex: 1, fontSize: 18, fontWeight: '800' },
  vehicleDetailSummary: { gap: spacing.xxs, paddingVertical: spacing.xxs },
  vehicleDetailValue: { color: colors.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  vehicleDangerTitle: { color: colors.danger, fontSize: 18, fontWeight: '800' },
  vehicleDangerZone: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  vehicleDeleteAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  vehicleDeleteActionText: { color: colors.danger, fontSize: 13, fontWeight: '800' },
  vehicleDeleteBlocked: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  vehicleEditAction: { marginTop: spacing.sm },
  removalOtherField: { gap: spacing.xs, marginTop: spacing.md },
  removalOtherInput: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  removalReasonBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  removalReasonContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  removalReasonContinue: { marginTop: spacing.md },
  removalReasonModalRoot: { flex: 1, justifyContent: 'flex-end' },
  removalReasonOption: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  removalReasonOptionText: { color: colors.ink, flex: 1, fontSize: 15, lineHeight: 21 },
  removalReasonOptions: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  removalReasonPrompt: {
    color: colors.subtleText,
    fontSize: 15,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  removalReasonSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  removalReasonTitle: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  vehicleMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  vehicleMetaText: { flex: 1, minWidth: 0 },
  vehicleOperationalValue: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  vehicleOverviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  vehicleOverviewLabel: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  vehicleOverviewValue: {
    gap: spacing.xxs,
    minWidth: 0,
    width: '48%',
  },
  privateLabelRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xxs },
  privateLabelText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  privateLocationRow: { alignItems: 'flex-start', flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
});
