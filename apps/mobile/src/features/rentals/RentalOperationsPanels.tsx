import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  View,
  useWindowDimensions,
} from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { dateTimeLabel, domainLabel, money, timeLabel } from '../../ui/format';
import { invalidateBookingLifecycle } from '../../query/booking-invalidation';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { SecureCameraPhotoSlot, securePhotoPreviewStyle } from '../../ui/SecureCameraPhotoSlot';
import { ensureCameraPermission } from '../../ui/camera-permission';
import { SearchableReferenceSelector } from '../../ui/SearchableReferenceSelector';
import { DateOnlyField } from '../../ui/DateOnlyField';
import { DateTimeField } from '../../ui/DateTimeField';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { BackControl, Icon, StatusBadge } from '../../ui/primitives';
import { HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION } from '@carrental/api-contracts';
import { tripDateSummary } from '../discovery/trip-date-policy';

const perspectives = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR',
  'DASHBOARD',
  'ODOMETER',
  'FUEL_OR_BATTERY_DISPLAY',
] as const;
type InspectionPerspective = (typeof perspectives)[number];
const readingPerspectives = ['ODOMETER', 'FUEL_OR_BATTERY_DISPLAY'] as const;
const exteriorPerspectives = ['FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE'] as const;
const interiorPerspectives = ['INTERIOR', 'DASHBOARD'] as const;
const multiPerspectives = ['INTERIOR', 'DASHBOARD', 'ADDITIONAL'] as const;

const claimCategories = [
  'EXCESS_MILEAGE',
  'FUEL_DEFICIENCY',
  'EV_BATTERY_DEFICIENCY',
  'LATE_RETURN',
  'CLEANING',
  'DAMAGE',
  'OTHER',
] as const;

const conditionCategoryOptions = [
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

const conditionAreaOptions = [
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

const conditionClassificationOptions = ['COSMETIC', 'OPERATIONAL', 'SAFETY_CRITICAL'].map(
  (value) => ({ code: value, id: value, name: domainLabel(value) }),
);

function conditionClassificationExplanation(classification: string): string {
  if (classification === 'OPERATIONAL') {
    return 'A vehicle feature or system is not working correctly and requires review before the vehicle can be rented. Examples: air conditioning, window, sensor, or another functional issue.';
  }
  if (classification === 'SAFETY_CRITICAL') {
    return 'A condition that could make the vehicle unsafe to drive. The vehicle cannot be rented until this issue is resolved. Examples: brakes, unsafe tires, steering, serious overheating, or a critical safety warning.';
  }
  return 'Appearance-only damage that does not affect normal vehicle operation or safety. Examples: scratch, small dent, stain, or rim scuff.';
}

interface CapturedFile {
  readonly id: string;
  readonly uri?: string;
}

interface ConditionIssueDraft {
  readonly knownIssueId?: string;
  readonly knownIssueEvidenceFileAssetIds?: readonly string[];
  readonly persistAsKnownIssue?: boolean;
  readonly category: string;
  readonly vehicleArea: string;
  readonly classification: string;
  readonly description: string;
  readonly evidenceFileAssetIds: readonly string[];
}

interface InspectionDraft {
  readonly inspectionId: string | null;
  readonly knownIssues: readonly {
    readonly id: string;
    readonly category: string;
    readonly vehicleArea: string;
    readonly classification: string;
    readonly description: string;
    readonly evidence: readonly { readonly fileAssetId: string }[];
  }[];
  readonly media: readonly {
    readonly evidenceSequence: number;
    readonly fileAssetId: string;
    readonly perspective: string;
  }[];
}

interface RentalDetail {
  readonly workflowCompliance?: {
    readonly workflow: string;
    readonly start: {
      readonly overdue: boolean;
      readonly outstandingStep: string | null;
      readonly evidenceOutcome?: string;
    };
    readonly return: {
      readonly overdue: boolean;
      readonly outstandingStep: string | null;
      readonly evidenceOutcome?: string;
    };
    readonly payoutBlocker: string | null;
  };
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly actualPickupAt: string | null;
  readonly actualReturnAt: string | null;
  readonly cancellation: {
    readonly reasonCode: string | null;
    readonly reasonText: string | null;
  } | null;
  readonly cancellationSettlement: {
    readonly collectionRefundedMinor: string;
    readonly commissionRetainedMinor: string;
    readonly currency: string;
    readonly deliveryCompleted: boolean;
    readonly deliveryRefundedMinor: string;
    readonly deliveryRetainedMinor: string;
    readonly refundAmountMinor: string;
    readonly refund: { readonly status: string } | null;
  } | null;
  readonly pickupWindowStart: string | null;
  readonly pickupWindowEnd: string | null;
  readonly pickupHandoverReport: {
    readonly reportedPhysicalHandoverAt: string;
    readonly reportedAt: string;
    readonly response: {
      readonly decision: 'CONFIRMED' | 'DISPUTED' | 'NOT_RECEIVED';
      readonly proposedPhysicalHandoverAt: string | null;
      readonly respondedAt: string;
    } | null;
  } | null;
  readonly overdueHandoverRecovery: {
    readonly scope: 'START' | 'RETURN' | 'BOTH';
    readonly reportedPickupAt: string | null;
    readonly reportedReturnAt: string | null;
    readonly reportedAt: string;
    readonly responseDeadlineAt: string;
    readonly response: {
      readonly decision: 'CONFIRMED' | 'DISPUTED';
      readonly reason: string | null;
      readonly respondedAt: string;
    } | null;
    readonly acceptance: {
      readonly acceptedAt: string;
      readonly acceptanceSource: 'RENTER_CONFIRMED' | 'NO_RESPONSE_24H';
    } | null;
  } | null;
  readonly claimDeadlineAt: string | null;
  readonly inspections: readonly {
    id: string;
    type: string;
    version: number;
    submittedByUserId: string;
    finalizedAt: string | null;
    odometerMeters: string | null;
    fuelBasisPoints: number | null;
    batterySocBasisPoints: number | null;
    notes: string | null;
    media: readonly { id: string; perspective: string; fileAsset: { id: string } }[];
    amendments?: readonly {
      id: string;
      status: string;
      reason: string;
      reviewReason: string | null;
      proposedOdometerMeters: string | null;
      proposedFuelBasisPoints: number | null;
      proposedBatterySocBasisPoints: number | null;
      createdAt: string;
      reviewedAt: string | null;
    }[];
    conditionDisclosureState?: string | null;
    conditionIssues?: readonly {
      id: string;
      category: string;
      vehicleArea: string;
      classification: string;
      description: string;
      evidence?: readonly {
        inspectionMedia: { fileAsset: { id: string } };
      }[];
    }[];
    confirmations?: readonly {
      role: string;
      decision: string;
      reason: string | null;
      discrepancyResponse?: {
        id: string;
        responseType: string;
        responseText: string;
        acknowledgedConditionIssue?: {
          id: string;
          category: string;
          vehicleArea: string;
          classification: string;
          description: string;
        } | null;
        resolutionReview?: {
          decision: string;
          reason: string | null;
          operationsResolution?: { outcome: string; reason: string } | null;
        } | null;
      } | null;
      discrepancyResponses?: readonly {
        id: string;
        roundNumber: number;
        responseType: string;
        responseText: string;
        resolutionReview?: { decision: string; reason: string | null } | null;
      }[];
    }[];
  }[];
  readonly fulfillment: {
    readonly startMethod: 'RENTER_PICKUP' | 'OWNER_DELIVERY';
    readonly endMethod: 'RENTER_RETURN' | 'OWNER_COLLECTION';
    readonly legacyCompatibility: boolean;
    readonly startLocation: ContractLocation | null;
    readonly endLocation: ContractLocation | null;
  };
  readonly handoverTravel: {
    readonly startStatus: 'PREPARING' | 'ON_THE_WAY' | 'ARRIVED' | null;
    readonly returnStatus: 'ON_THE_WAY' | 'ARRIVED' | null;
    readonly events: readonly { phase: string; status: string; occurredAt: string }[];
  };
  readonly usageSummary: {
    distanceTravelledKm: number;
    includedDistanceKm: number | null;
    excessDistanceKm: number;
    fuelDeficiencyBasisPoints: number | null;
    socDeficiencyBasisPoints: number | null;
    lateDurationSeconds: number;
    returnDisputed: boolean;
  } | null;
  readonly ownerEarning: { status: string; netEarningAmountMinor: string } | null;
  readonly postReturnClaims: readonly { id: string; category: string; status: string }[];
  readonly pickupOperationsResolutions: readonly {
    outcome: string;
    reason: string;
    resolvedAt: string;
  }[];
  readonly rentalIncidents: readonly {
    id: string;
    category: string;
    severity: string;
    status: string;
  }[];
  readonly vehicle: {
    id: string;
    make: string | null;
    model: string | null;
    powertrain: string | null;
  };
  readonly operationalPolicy: { readonly returnConfirmationGraceMinutes: number };
}

interface ContractLocation {
  readonly addressLine1: string | null;
  readonly barangay: string | null;
  readonly city: string;
  readonly province: string;
  readonly postalCode: string | null;
  readonly country: string;
}

interface HandoverCancellationQuote {
  readonly capturedAmountMinor: string;
  readonly commissionRetainedMinor: string;
  readonly deliveryCompleted: boolean;
  readonly deliveryRefundedMinor: string;
  readonly deliveryRetainedMinor: string;
  readonly collectionRefundedMinor: string;
  readonly refundAmountMinor: string;
  readonly rentalComponentMinor: string;
  readonly currency: string;
}

const handoverCancellationReasons = [
  'VEHICLE_CONDITION_DIFFERS_FROM_INSPECTION',
  'UNDISCLOSED_DAMAGE',
  'SAFETY_CONCERN',
  'MECHANICAL_OR_WARNING_LIGHT',
  'VEHICLE_CLEANLINESS_OR_CONDITION',
  'VEHICLE_DOES_NOT_MATCH_BOOKING',
  'OWNER_RENTER_COULD_NOT_AGREE',
  'OTHER',
] as const;

function CancellationSummary({
  audience,
  detail,
}: {
  readonly audience: 'owner' | 'renter';
  readonly detail: RentalDetail;
}) {
  const settlement = detail.cancellationSettlement;
  if (!settlement) return null;
  return (
    <View style={styles.infoCard}>
      <Text style={styles.cardTitle}>
        {audience === 'owner' ? 'Booking cancelled before handover' : 'Booking cancelled'}
      </Text>
      <Text style={styles.body}>The rental did not start and custody was not transferred.</Text>
      {audience === 'owner' ? (
        <>
          <Text style={styles.body}>
            Reason: {domainLabel(detail.cancellation?.reasonCode ?? 'Not provided')}
            {detail.cancellation?.reasonText ? ` — ${detail.cancellation.reasonText}` : ''}
          </Text>
          <Text style={styles.body}>
            Completed delivery earning retained:{' '}
            {money(Number(settlement.deliveryRetainedMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>No collection earning applies.</Text>
        </>
      ) : (
        <>
          <Text style={styles.body}>
            Refund: {money(Number(settlement.refundAmountMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>
            CarShare commission retained:{' '}
            {money(Number(settlement.commissionRetainedMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>
            Delivery retained:{' '}
            {money(Number(settlement.deliveryRetainedMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>
            Delivery refunded:{' '}
            {money(Number(settlement.deliveryRefundedMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>
            Collection refunded:{' '}
            {money(Number(settlement.collectionRefundedMinor), settlement.currency)}
          </Text>
          <Text style={styles.body}>
            Refund status: {domainLabel(settlement.refund?.status ?? 'Processing')}
          </Text>
        </>
      )}
    </View>
  );
}

export function RenterRentalPanel({
  focusOverdueRecovery = false,
  upcomingSection,
  securityDepositPending = false,
  reference,
  onCancellationCompleted,
  onContinueResolving,
  scrollToCancellationForm,
  scrollToPickupCode,
  scrollToRecoveryResponse,
  scrollResolutionFormBy,
}: {
  readonly focusOverdueRecovery?: boolean;
  readonly upcomingSection?: 'travel' | 'next-step';
  readonly securityDepositPending?: boolean;
  readonly reference: string;
  readonly onCancellationCompleted?: () => void;
  readonly onContinueResolving?: () => void;
  readonly scrollToCancellationForm?: (y: number) => void;
  readonly scrollToPickupCode?: (y: number) => void;
  readonly scrollToRecoveryResponse?: (y: number) => void;
  readonly scrollResolutionFormBy?: (delta: number) => void;
}) {
  const client = useQueryClient();
  const panelOffsetY = useRef(0);
  const cancellationFormOffsetY = useRef(0);
  const workflowOffsets = useRef<Record<string, number>>({});
  const resolutionReasonRef = useRef<TextInput>(null);
  const scrollToCancellationFormAfterLayout = useRef(false);
  const scrollToCancellationSummaryAfterLayout = useRef(false);
  const scrollToPickupCodeAfterLayout = useRef(false);
  const recoveryFocusHandled = useRef(false);
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [pickupCodeExpiresAt, setPickupCodeExpiresAt] = useState<string | null>(null);
  const [returnInspectionStarted, setReturnInspectionStarted] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [soc, setSoc] = useState('');
  const [notes, setNotes] = useState('');
  const [pickupDiscrepancy, setPickupDiscrepancy] = useState('');
  const [resolutionReason, setResolutionReason] = useState('');
  const [showCancellation, setShowCancellation] = useState(false);
  const [cancellationReason, setCancellationReason] = useState<
    (typeof handoverCancellationReasons)[number]
  >('OWNER_RENTER_COULD_NOT_AGREE');
  const [cancellationExplanation, setCancellationExplanation] = useState('');
  const [postReturnClock, setPostReturnClock] = useState(0);
  const [cancellationQuote, setCancellationQuote] = useState<HandoverCancellationQuote | null>(
    null,
  );
  const [files, setFiles] = useState<Record<string, CapturedFile[]>>({});
  const rental = useQuery({
    queryKey: ['rental', reference],
    queryFn: () => apiClient.request<RentalDetail>(`/bookings/${reference}/rental`),
    refetchInterval: (query) =>
      query.state.data &&
      ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(query.state.data.status)
        ? 5_000
        : false,
  });
  useEffect(() => {
    const keyboardShown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      if (resolutionReasonRef.current?.isFocused()) {
        resolutionReasonRef.current.measureInWindow((_x, y, _width, height) => {
          const overlap = y + height + spacing.sm - endCoordinates.screenY;
          if (overlap > 0) scrollResolutionFormBy?.(overlap);
        });
      }
    });
    return () => keyboardShown.remove();
  }, [scrollResolutionFormBy]);
  useEffect(() => {
    const initialize = setTimeout(() => setPostReturnClock(Date.now()), 0);
    const timer = setInterval(() => setPostReturnClock(Date.now()), 30_000);
    return () => {
      clearTimeout(initialize);
      clearInterval(timer);
    };
  }, []);
  useRefreshOnFocusAndForeground(() => void rental.refetch());
  const capture = useMutation({
    mutationFn: async ({
      mode,
      perspective,
    }: {
      mode: 'append' | 'replace';
      perspective: string;
    }) => {
      if (!(await ensureCameraPermission())) return null;
      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.back,
        mediaTypes: ['images'],
        quality: 0.85,
      });
      const asset = result.assets?.[0];
      if (!asset) return null;
      const uploaded = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `${perspective.toLowerCase()}.jpg`,
        uri: asset.uri,
      });
      return { id: uploaded.id, mode, perspective, uri: asset.uri };
    },
    onSuccess: (result) => {
      if (result)
        setFiles((current) =>
          result.mode === 'replace'
            ? { ...current, [result.perspective]: [{ id: result.id, uri: result.uri }] }
            : addCapturedFile(current, result.perspective, { id: result.id, uri: result.uri }),
        );
    },
  });
  const action = useMutation({
    mutationFn: async (
      operation:
        | 'pickup'
        | 'pickup-agree'
        | 'pickup-disagree'
        | 'resolution-accept'
        | 'resolution-disagree'
        | 'discrepancy-support'
        | 'return'
        | 'inspection'
        | 'agree'
        | 'disagree'
        | 'incident'
        | 'pickup-overdue',
    ) => {
      if (operation === 'pickup') {
        return apiClient.request<{ code: string; expiresAt: string }>(
          `/bookings/${reference}/rental/pickup/confirm`,
          {
            method: 'POST',
          },
        );
      }
      if (operation === 'pickup-agree' || operation === 'pickup-disagree') {
        return apiClient.request(`/bookings/${reference}/rental/pickup/inspection/review`, {
          body: JSON.stringify({
            decision: operation === 'pickup-agree' ? 'AGREED' : 'DISAGREED',
            ...(operation === 'pickup-disagree' ? { reason: pickupDiscrepancy.trim() } : {}),
          }),
          method: 'POST',
        });
      }
      if (operation === 'resolution-accept' || operation === 'resolution-disagree') {
        return apiClient.request(`/bookings/${reference}/rental/pickup/discrepancy/review`, {
          body: JSON.stringify({
            decision: operation === 'resolution-accept' ? 'ACCEPTED' : 'STILL_DISAGREES',
            ...(operation === 'resolution-disagree' ? { reason: resolutionReason.trim() } : {}),
          }),
          method: 'POST',
        });
      }
      if (operation === 'discrepancy-support')
        return apiClient.request(`/bookings/${reference}/rental/pickup/discrepancy/support`, {
          method: 'POST',
        });
      if (operation === 'return') {
        return apiClient.request(`/bookings/${reference}/rental/return/start`, { method: 'POST' });
      }
      if (operation === 'incident') {
        return apiClient.request(`/bookings/${reference}/rental/incidents`, {
          body: JSON.stringify({
            category: 'VEHICLE_ISSUE',
            description: 'Renter requested operational support from the active-rental screen.',
            severity: 'MEDIUM',
          }),
          method: 'POST',
        });
      }
      if (operation === 'pickup-overdue') {
        return apiClient.request(`/bookings/${reference}/rental/incidents`, {
          body: JSON.stringify({
            category: 'OWNER_ISSUE',
            description:
              'Renter reports receiving the vehicle but the owner has not completed authoritative handover confirmation.',
            severity: 'HIGH',
          }),
          method: 'POST',
        });
      }
      if (operation === 'inspection') {
        return apiClient.request(`/bookings/${reference}/rental/return/inspection`, {
          body: JSON.stringify({
            odometerMeters: String(Math.round(Number(odometer) * 1000)),
            ...(fuel ? { fuelBasisPoints: Math.round(Number(fuel) * 100) } : {}),
            ...(soc ? { batterySocBasisPoints: Math.round(Number(soc) * 100) } : {}),
            media: inspectionMedia(files),
            notes:
              notes.trim() || 'Return inspection submitted by the renter during vehicle handover.',
          }),
          method: 'POST',
        });
      }
      return apiClient.request(`/bookings/${reference}/rental/return/confirm`, {
        body: JSON.stringify({
          decision: operation === 'agree' ? 'AGREED' : 'DISAGREED',
          ...(operation === 'disagree'
            ? { reason: 'Renter disagrees with the submitted return measurements or evidence.' }
            : {}),
        }),
        method: 'POST',
      });
    },
    onSuccess: (result, operation) => {
      if (operation === 'pickup' && result && typeof result === 'object' && 'code' in result) {
        scrollToPickupCodeAfterLayout.current = true;
        setPickupCode(String(result.code));
        if ('expiresAt' in result) setPickupCodeExpiresAt(String(result.expiresAt));
      }
      if (operation === 'pickup-disagree') setPickupDiscrepancy('');
      if (operation === 'resolution-accept' || operation === 'resolution-disagree')
        setResolutionReason('');
      if (operation === 'inspection') setFiles({});
      invalidateRentalQueries(client, reference);
    },
  });
  const cancellation = useMutation({
    mutationFn: async (operation: 'quote' | 'cancel') => {
      if (operation === 'quote')
        return apiClient.request<HandoverCancellationQuote>(
          `/bookings/${reference}/handover-cancellation/quote`,
        );
      return apiClient.request(`/bookings/${reference}/handover-cancellation`, {
        body: JSON.stringify({
          reasonCode: cancellationReason,
          ...(cancellationExplanation.trim() ? { reasonText: cancellationExplanation.trim() } : {}),
        }),
        headers: { 'Idempotency-Key': `handover-cancel-${reference}` },
        method: 'POST',
      });
    },
    onSuccess: (result, operation) => {
      if (operation === 'quote') setCancellationQuote(result as HandoverCancellationQuote);
      else {
        onCancellationCompleted?.();
        invalidateRentalQueries(client, reference);
      }
    },
  });
  const detail = rental.data;
  if (!detail)
    return upcomingSection ? null : <Text style={styles.body}>Loading rental operations…</Text>;
  const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
  const pickupReview = pickup?.confirmations?.find(({ role }) => role === 'RENTER');
  const approvedPickupCorrection = pickup?.amendments?.find(({ status }) => status === 'APPROVED');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  const startWaived = detail.workflowCompliance?.start.evidenceOutcome === 'WAIVED';
  const startWaiverSubmitted = startWaived || detail.pickupHandoverReport !== null;
  const returnWaived = detail.workflowCompliance?.return.evidenceOutcome === 'WAIVED';
  const pickupOverdue = detail.workflowCompliance?.start.overdue ?? false;
  const returnWorkflowOverdue = detail.workflowCompliance?.return.overdue ?? false;
  const returnRecoveryOverdue =
    !detail.actualReturnAt &&
    ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(detail.status) &&
    rental.dataUpdatedAt >
      new Date(detail.rentalEnd).getTime() +
        detail.operationalPolicy.returnConfirmationGraceMinutes * 60_000;
  const returnOverdue = returnWorkflowOverdue || returnRecoveryOverdue;
  const pickupRecoveryRequired = pickupOverdue && !pickup && !startWaiverSubmitted;
  const bothPhasesOverdue = pickupRecoveryRequired && returnOverdue;
  const returnHandoverReady =
    detail.fulfillment.endMethod !== 'OWNER_COLLECTION' ||
    detail.handoverTravel.returnStatus === 'ARRIVED';
  const returnRecoveryReady = returnHandoverReady || returnOverdue;
  const renterStatusLabel =
    detail.overdueHandoverRecovery && !detail.overdueHandoverRecovery.acceptance
      ? detail.overdueHandoverRecovery.response?.decision === 'DISPUTED'
        ? `${detail.overdueHandoverRecovery.scope === 'START' ? 'Pickup' : detail.overdueHandoverRecovery.scope === 'RETURN' ? 'Return' : 'Pickup and Return'} report under Operations review`
        : `${detail.overdueHandoverRecovery.scope === 'START' ? 'Pickup' : detail.overdueHandoverRecovery.scope === 'RETURN' ? 'Return' : 'Pickup and Return'} report awaiting your response`
      : bothPhasesOverdue
        ? 'Pickup and Return overdue'
        : pickupRecoveryRequired
          ? 'Pickup overdue'
          : returnOverdue
            ? 'Return overdue'
            : friendlyStatus(detail.status);
  const renterNextStep = renterNextStepMessage(detail.status, {
    hasPickupCode: Boolean(pickupCode),
    hasPickupInspection: Boolean(pickup),
    pickupHandoverConfirmed: detail.pickupHandoverReport?.response?.decision === 'CONFIRMED',
    hasReturnInspection: Boolean(returned),
    pickupReviewDecision: pickupReview?.decision,
    returnHandoverReady,
    returnInspectionStarted,
    startWaived,
  });
  if (upcomingSection === 'travel') {
    if (
      securityDepositPending ||
      detail.fulfillment.startMethod !== 'OWNER_DELIVERY' ||
      pickupOverdue ||
      !['CONFIRMED', 'READY_FOR_PICKUP'].includes(detail.status)
    )
      return null;
    return <UpcomingDeliveryStatus detail={detail} />;
  }
  if (upcomingSection === 'next-step') {
    return (
      <View accessibilityLiveRegion="polite" style={styles.nextStepCard}>
        <Text style={styles.actionEyebrow}>Next step</Text>
        <Text style={styles.nextStepText}>
          {securityDepositPending
            ? 'Place the security deposit to complete your pre-pickup requirements.'
            : upcomingNextStepMessage(detail)}
        </Text>
      </View>
    );
  }
  const returnInspectionReady = hasRequiredPhotos(files) && Boolean(odometer);
  const renderReturnPhoto = (perspective: InspectionPerspective | 'ADDITIONAL') => {
    const captured = files[perspective] ?? [];
    const latest = captured.at(-1);
    const multiple = (multiPerspectives as readonly string[]).includes(perspective);
    return (
      <View key={perspective}>
        <SecureCameraPhotoSlot
          busy={capture.isPending && capture.variables?.perspective === perspective}
          captureLabel="Capture"
          checklist
          guidance={inspectionPhotoGuidance(perspective)}
          name={domainLabel(perspective)}
          onCapture={() => capture.mutate({ mode: 'replace', perspective })}
          previewUri={latest?.uri}
          required={perspective !== 'ADDITIONAL'}
          uploaded={Boolean(latest)}
        />
        {multiple && latest ? (
          <View style={styles.additionalPhotoAction}>
            <SecondaryAction
              disabled={capture.isPending && capture.variables?.perspective === perspective}
              inline
              label={`Add another ${domainLabel(perspective).toLowerCase()} photo`}
              onPress={() => capture.mutate({ mode: 'append', perspective })}
            />
          </View>
        ) : null}
        {captured.length > 1 ? (
          <CapturedPreviews files={captured.slice(0, -1)} perspective={perspective} />
        ) : null}
      </View>
    );
  };
  return (
    <View
      onLayout={({ nativeEvent }) => {
        panelOffsetY.current = nativeEvent.layout.y;
      }}
      style={[styles.panel, styles.renterPanel]}
    >
      <View style={styles.rentalSummaryCard}>
        <View style={styles.rentalSummaryHeader}>
          <Text style={styles.summaryLabel}>Status</Text>
          <StatusBadge label={renterStatusLabel} />
        </View>
        <View style={styles.rentalScheduleRows}>
          <RentalScheduleRow
            label="Dates & time"
            value={rentalTripSummary(detail.rentalStart, detail.rentalEnd)}
          />
          {['ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'].includes(detail.status) &&
          detail.actualPickupAt ? (
            <RentalScheduleRow
              label="Actual handover"
              value={dateTimeLabel(detail.actualPickupAt)}
            />
          ) : null}
          {['RETURNED', 'COMPLETED'].includes(detail.status) && detail.actualReturnAt ? (
            <RentalScheduleRow
              label="Vehicle received"
              value={dateTimeLabel(detail.actualReturnAt)}
            />
          ) : null}
          {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && !pickupOverdue && (
            <RentalScheduleRow
              label="Handover available"
              value={dateTimeLabel(detail.pickupWindowStart)}
            />
          )}
        </View>
      </View>
      {!['RETURNED', 'COMPLETED'].includes(detail.status) ? (
        <View accessibilityLiveRegion="polite" style={styles.nextStepCard}>
          <Text style={styles.actionEyebrow}>Next step</Text>
          <Text style={styles.nextStepText}>
            {detail.status === 'ACTIVE'
              ? `Return the vehicle by ${dateTimeLabel(detail.rentalEnd)}.`
              : renterNextStep}
          </Text>
          {detail.status === 'ACTIVE' && !returnOverdue ? (
            <Action label="Start return" onPress={() => action.mutate('return')} />
          ) : null}
        </View>
      ) : null}
      {bothPhasesOverdue && !detail.overdueHandoverRecovery && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Pickup and Return are overdue</Text>
          <Text style={styles.body}>
            Waiting for the owner to report both handovers without inspections. You will be notified
            and have 24 hours to confirm or disagree with the reported pickup and return times.
          </Text>
          <Text accessibilityRole="alert" style={styles.body}>
            If the owner completes this recovery without inspections, CarShare will have limited
            evidence to help with condition, damage, mileage, fuel, or battery disputes.
          </Text>
        </View>
      )}
      {pickupRecoveryRequired && !returnOverdue && !detail.overdueHandoverRecovery && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Handover overdue</Text>
          <Text style={styles.cardTitle}>Protect your handover evidence</Text>
          <Text style={styles.body}>
            {domainLabel(
              detail.workflowCompliance?.start.outstandingStep ?? 'OWNER_INSPECTION_REQUIRED',
            )}
          </Text>
          <Text style={styles.body}>
            Complete the required vehicle handover in CarShare as soon as possible. Photos and
            condition details help protect both parties if a later condition or damage dispute
            occurs.
          </Text>
          <Text style={styles.body}>
            Complete the outstanding step below. If owner action is required, wait for the owner
            before continuing.
          </Text>
          {![
            'OWNER_DELIVERY_ARRIVAL_REQUIRED',
            'OWNER_INSPECTION_REQUIRED',
            'OPERATIONS_HOLD',
          ].includes(detail.workflowCompliance?.start.outstandingStep ?? '') &&
          (detail.workflowCompliance?.start.outstandingStep !== 'DISCREPANCY_RESOLUTION_REQUIRED' ||
            (pickupReview?.discrepancyResponse &&
              !pickupReview.discrepancyResponse.resolutionReview)) ? (
            <Action
              label="Complete handover"
              onPress={() =>
                scrollToCancellationForm?.(
                  panelOffsetY.current + (workflowOffsets.current.start ?? 0) - spacing.md,
                )
              }
            />
          ) : (
            <Text style={styles.body}>
              Waiting for the owner or Operations to complete the outstanding step.
            </Text>
          )}
        </View>
      )}
      {returnOverdue &&
        !pickupRecoveryRequired &&
        !returnWaived &&
        !detail.overdueHandoverRecovery && (
          <View style={styles.overdueCard}>
            <Text style={styles.cardTitle}>Return process overdue</Text>
            <Text style={styles.body}>
              Waiting for the owner to report the overdue Return without inspection. You will be
              notified and can confirm or disagree with the reported handover time.
            </Text>
          </View>
        )}
      {detail.status === 'CANCELLED' && detail.cancellationSettlement ? (
        <CancellationSummary detail={detail} audience="renter" />
      ) : null}
      {detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&
        !pickupOverdue &&
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(detail.status) && (
          <HandoverTravelSummary
            address={detail.fulfillment.startLocation}
            label="Your car is being delivered"
            status={detail.handoverTravel.startStatus}
          />
        )}
      {detail.fulfillment.endMethod === 'OWNER_COLLECTION' &&
        !returnOverdue &&
        ['ACTIVE', 'RETURN_PENDING'].includes(detail.status) && (
          <OwnerCollectionStatus detail={detail} />
        )}
      {detail.status === 'READY_FOR_PICKUP' && pickup && !pickupCode && (
        <View
          onLayout={({ nativeEvent }) => {
            workflowOffsets.current.start = nativeEvent.layout.y;
          }}
        >
          <View style={styles.submittedInspectionStatus}>
            <Text style={styles.sectionTitle}>Pickup inspection</Text>
            <StatusBadge label="Submitted" />
          </View>
          <PickupInspectionSummary inspection={pickup} />
          <View style={styles.pickupVerificationCard}>
            <Text style={styles.actionEyebrow}>Next step</Text>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Review pickup condition
            </Text>
            <Text style={styles.body}>
              Review the owner&apos;s inspection before requesting your single-use pickup code.
            </Text>
            {!pickupReview && (
              <>
                <Action label="Confirm condition" onPress={() => action.mutate('pickup-agree')} />
                <TextInput
                  multiline
                  onChangeText={setPickupDiscrepancy}
                  placeholder="Describe the condition discrepancy"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={pickupDiscrepancy}
                />
                <SecondaryAction
                  label="Report discrepancy"
                  onPress={() => action.mutate('pickup-disagree')}
                />
              </>
            )}
            {pickupReview?.decision === 'AGREED' && (
              <Action label="Get pickup code" onPress={() => action.mutate('pickup')} />
            )}
            {pickupReview?.decision === 'DISAGREED' && (
              <View style={styles.warningCard}>
                <Text style={styles.cardTitle}>Handover paused</Text>
                <Text style={styles.body}>
                  You reported a difference in the vehicle condition. The rental has not started and
                  you do not yet have custody of the vehicle.
                </Text>
                {pickupReview.reason ? (
                  <Text style={styles.body}>Your report: {pickupReview.reason}</Text>
                ) : null}
                {pickupReview.discrepancyResponse ? (
                  <>
                    {(pickupReview.discrepancyResponses?.length ?? 0) > 1 ? (
                      <View style={styles.infoCard}>
                        <Text style={styles.cardTitle}>Resolution history</Text>
                        {pickupReview.discrepancyResponses?.map((response) => (
                          <View key={response.id}>
                            <Text style={styles.body}>
                              Round {response.roundNumber}: {response.responseText}
                            </Text>
                            <Text style={styles.body}>
                              Renter response:{' '}
                              {domainLabel(
                                response.resolutionReview?.decision ?? 'Awaiting review',
                              )}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Text style={styles.cardTitle}>Owner responded to your discrepancy</Text>
                    <Text style={styles.body}>{pickupReview.discrepancyResponse.responseText}</Text>
                    {!pickupReview.discrepancyResponse.resolutionReview ? (
                      <>
                        <Action
                          label="Accept resolution"
                          onPress={() => action.mutate('resolution-accept')}
                        />
                        <TextInput
                          ref={resolutionReasonRef}
                          multiline
                          onChangeText={setResolutionReason}
                          placeholder="Why does this still need resolution?"
                          placeholderTextColor={colors.placeholder}
                          style={styles.input}
                          value={resolutionReason}
                        />
                        <SecondaryAction
                          label="Still disagree"
                          onPress={() => action.mutate('resolution-disagree')}
                        />
                      </>
                    ) : pickupReview.discrepancyResponse.resolutionReview.decision ===
                      'ACCEPTED' ? (
                      <>
                        <Text style={styles.success}>✓ You accepted the resolution</Text>
                        {!pickup.conditionIssues?.some(
                          ({ classification }) => classification === 'SAFETY_CRITICAL',
                        ) ? (
                          <Action label="Get pickup code" onPress={() => action.mutate('pickup')} />
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Text style={styles.body}>
                          You and the owner haven’t agreed on the vehicle condition. Your rental has
                          not started and you do not have custody of the vehicle.
                        </Text>
                        {onContinueResolving ? (
                          <SecondaryAction
                            label="Continue resolving"
                            onPress={onContinueResolving}
                          />
                        ) : (
                          <Text style={styles.body}>
                            Use CarShare support if you cannot continue with the owner in the
                            booking conversation.
                          </Text>
                        )}
                        <SecondaryAction
                          label="Contact CarShare support"
                          onPress={() => action.mutate('discrepancy-support')}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <Text style={styles.body}>Waiting for the owner to review your report.</Text>
                )}
                {pickupReview.discrepancyResponse?.resolutionReview?.decision !== 'ACCEPTED' ? (
                  <SecondaryAction
                    label="Cancel booking"
                    onPress={() => {
                      scrollToCancellationFormAfterLayout.current = true;
                      setShowCancellation(true);
                    }}
                  />
                ) : null}
              </View>
            )}
          </View>
          {showCancellation ? (
            <View
              onLayout={({ nativeEvent }) => {
                cancellationFormOffsetY.current = nativeEvent.layout.y;
                if (scrollToCancellationFormAfterLayout.current) {
                  scrollToCancellationFormAfterLayout.current = false;
                  scrollToCancellationForm?.(
                    Math.max(0, panelOffsetY.current + nativeEvent.layout.y - spacing.md),
                  );
                }
              }}
              style={styles.cancellationForm}
            >
              <Text style={styles.cardTitle}>Why are you cancelling?</Text>
              <SearchableReferenceSelector
                label="Cancellation reason"
                options={handoverCancellationReasons.map((value) => ({
                  id: value,
                  code: value,
                  name: domainLabel(value),
                }))}
                onChange={(value) =>
                  setCancellationReason(value as (typeof handoverCancellationReasons)[number])
                }
                value={cancellationReason}
              />
              {cancellationReason === 'OTHER' ? (
                <TextInput
                  multiline
                  onChangeText={setCancellationExplanation}
                  placeholder="Explain your reason"
                  placeholderTextColor={colors.placeholder}
                  style={styles.input}
                  value={cancellationExplanation}
                />
              ) : null}
              {!cancellationQuote ? (
                <Action
                  label="Review cancellation refund"
                  onPress={() => {
                    scrollToCancellationSummaryAfterLayout.current = true;
                    cancellation.mutate('quote');
                  }}
                />
              ) : (
                <View
                  onLayout={({ nativeEvent }) => {
                    if (scrollToCancellationSummaryAfterLayout.current) {
                      scrollToCancellationSummaryAfterLayout.current = false;
                      scrollToCancellationForm?.(
                        Math.max(
                          0,
                          panelOffsetY.current +
                            cancellationFormOffsetY.current +
                            nativeEvent.layout.y -
                            spacing.md,
                        ),
                      );
                    }
                  }}
                  style={styles.cancellationSummary}
                >
                  <Text style={styles.cardTitle}>Cancel this booking?</Text>
                  <Text style={styles.cancellationLine}>Your rental has not started.</Text>
                  <Text style={styles.cancellationLine}>
                    Amount paid:{' '}
                    {money(
                      Number(cancellationQuote.capturedAmountMinor),
                      cancellationQuote.currency,
                    )}
                  </Text>
                  <Text style={styles.cancellationLine}>
                    CarShare commission retained:{' '}
                    {money(
                      Number(cancellationQuote.commissionRetainedMinor),
                      cancellationQuote.currency,
                    )}
                  </Text>
                  <Text style={styles.cancellationLine}>
                    Delivery retained:{' '}
                    {money(
                      Number(cancellationQuote.deliveryRetainedMinor),
                      cancellationQuote.currency,
                    )}
                  </Text>
                  <Text style={styles.cancellationLine}>
                    Delivery refunded:{' '}
                    {money(
                      Number(cancellationQuote.deliveryRefundedMinor),
                      cancellationQuote.currency,
                    )}
                  </Text>
                  <Text style={styles.cancellationLine}>
                    Collection refunded:{' '}
                    {money(
                      Number(cancellationQuote.collectionRefundedMinor),
                      cancellationQuote.currency,
                    )}
                  </Text>
                  <Text style={styles.cancellationRefund}>
                    Refund to you:{' '}
                    {money(Number(cancellationQuote.refundAmountMinor), cancellationQuote.currency)}
                  </Text>
                  <Pressable
                    style={[styles.dangerButton, styles.cancellationDangerButton]}
                    onPress={() => cancellation.mutate('cancel')}
                  >
                    <Text style={styles.buttonText}>Cancel booking</Text>
                  </Pressable>
                </View>
              )}
              <SecondaryAction
                label="Keep booking"
                onPress={() => {
                  setShowCancellation(false);
                  setCancellationQuote(null);
                }}
              />
            </View>
          ) : null}
        </View>
      )}
      {detail.status === 'READY_FOR_PICKUP' && pickupCode && (
        <View
          onLayout={({ nativeEvent }) => {
            workflowOffsets.current.start = nativeEvent.layout.y;
            if (scrollToPickupCodeAfterLayout.current) {
              scrollToPickupCodeAfterLayout.current = false;
              scrollToPickupCode?.(
                Math.max(0, panelOffsetY.current + nativeEvent.layout.y - spacing.md),
              );
            }
          }}
          style={styles.codeCard}
        >
          <Text style={styles.cardTitle}>Pickup code</Text>
          <Text style={styles.body}>
            Show this code to the vehicle owner only when you are physically receiving the vehicle.
          </Text>
          <Text style={styles.code}>{pickupCode}</Text>
          {pickupCodeExpiresAt && <ExpiryCountdown expiresAt={pickupCodeExpiresAt} />}
          <Text style={styles.body}>Keep this single-use code private until handover.</Text>
        </View>
      )}
      <EvidenceWaiverWarnings detail={detail} />
      {detail.overdueHandoverRecovery && !detail.overdueHandoverRecovery.acceptance && (
        <View
          accessibilityLiveRegion="polite"
          onLayout={({ nativeEvent }) => {
            if (focusOverdueRecovery && !recoveryFocusHandled.current) {
              recoveryFocusHandled.current = true;
              scrollToRecoveryResponse?.(
                Math.max(0, panelOffsetY.current + nativeEvent.layout.y - spacing.md),
              );
            }
          }}
        >
          <OverdueRecoveryResponse detail={detail} reference={reference} />
        </View>
      )}
      {detail.status === 'READY_FOR_PICKUP' &&
        startWaived &&
        detail.pickupHandoverReport &&
        !detail.pickupHandoverReport.response && (
          <PickupHandoverReportResponse detail={detail} reference={reference} />
        )}
      {detail.status === 'READY_FOR_PICKUP' &&
        startWaived &&
        detail.pickupHandoverReport?.response?.decision === 'CONFIRMED' && (
          <View
            onLayout={({ nativeEvent }) => {
              workflowOffsets.current.start = nativeEvent.layout.y;
            }}
          >
            <Text style={styles.cardTitle}>Pickup verification required</Text>
            <Action
              label="Get pickup code"
              disabled={action.isPending}
              onPress={() => action.mutate('pickup')}
            />
          </View>
        )}
      {detail.status === 'READY_FOR_PICKUP' &&
        startWaived &&
        detail.pickupHandoverReport?.response &&
        detail.pickupHandoverReport.response.decision !== 'CONFIRMED' && (
          <View style={styles.warningCard}>
            <Text style={styles.cardTitle}>Handover time requires Operations review</Text>
            <Text style={styles.body}>
              Pickup activation is paused because the reported physical handover was not confirmed.
            </Text>
          </View>
        )}
      {approvedPickupCorrection && (
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>Pickup inspection corrected</Text>
          <Text style={styles.body}>
            A measurement was corrected after administrative review. The original inspection remains
            in the evidence history.
          </Text>
        </View>
      )}
      {detail.status === 'ACTIVE' && (
        <View
          onLayout={({ nativeEvent }) => {
            workflowOffsets.current.return = nativeEvent.layout.y;
          }}
        >
          {!startWaived && pickup ? <RentalVehicleReadings inspection={pickup} /> : null}
          <View style={styles.rentalActionsSection}>
            <Text style={styles.sectionTitle}>Trip actions</Text>
            <SecondaryAction
              compact
              label="Report operational issue"
              onPress={() => action.mutate('incident')}
            />
          </View>
        </View>
      )}
      {detail.status === 'RETURN_PENDING' && returnWaived && (
        <Text style={styles.body}>Waiting for the owner to confirm vehicle receipt.</Text>
      )}
      {detail.status === 'RETURN_PENDING' && !returned && !returnWaived && !returnRecoveryReady && (
        <View style={styles.actionCard}>
          <Text style={styles.actionEyebrow}>Owner collection</Text>
          <Text style={styles.cardTitle}>Waiting for the owner to arrive</Text>
          <Text style={styles.body}>
            You can document the return handover after the owner arrives at the collection location.
          </Text>
        </View>
      )}
      {detail.status === 'RETURN_PENDING' &&
        !returned &&
        !returnWaived &&
        returnRecoveryReady &&
        !returnOverdue &&
        !returnInspectionStarted && (
          <View
            onLayout={({ nativeEvent }) => {
              workflowOffsets.current.return = nativeEvent.layout.y;
            }}
            style={styles.actionCard}
          >
            <Text style={styles.actionEyebrow}>Action required</Text>
            <Text style={styles.cardTitle}>Complete return inspection</Text>
            <Text style={styles.body}>
              Document the vehicle and dashboard before completing the return handover.
            </Text>
            <Action
              label="Start return handover"
              onPress={() => setReturnInspectionStarted(true)}
            />
            {detail.workflowCompliance?.workflow === 'B4' && (
              <EvidenceWaiverAction detail={detail} reference={reference} phase="RETURN" />
            )}
          </View>
        )}
      {detail.status === 'RETURN_PENDING' &&
        !returned &&
        !returnWaived &&
        returnRecoveryReady &&
        !returnOverdue &&
        returnInspectionStarted && (
          <View
            onLayout={({ nativeEvent }) => {
              workflowOffsets.current.return = nativeEvent.layout.y;
            }}
          >
            <View style={styles.inspectionIntro}>
              <Text accessibilityRole="header" style={styles.inspectionTitle}>
                Return inspection
              </Text>
              <Text style={styles.body}>Document the vehicle condition before returning it.</Text>
              <Text accessibilityLiveRegion="polite" style={styles.progress}>
                {completedRequired(files)} of {perspectives.length} required photos added
              </Text>
            </View>
            <View style={styles.inspectionSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Vehicle readings
              </Text>
              <View style={styles.readingField}>
                <Text style={styles.readingLabel}>Odometer</Text>
                <View style={styles.readingInputRow}>
                  <TextInput
                    accessibilityLabel="Return odometer in kilometres"
                    keyboardType="number-pad"
                    onChangeText={setOdometer}
                    placeholder="Enter reading"
                    placeholderTextColor={colors.placeholder}
                    style={[styles.input, styles.readingInput]}
                    value={odometer}
                  />
                  <Text style={styles.readingUnit}>km</Text>
                </View>
              </View>
              {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' ? (
                <View style={styles.readingField}>
                  <Text style={styles.readingLabel}>Fuel level</Text>
                  <View style={styles.readingInputRow}>
                    <TextInput
                      accessibilityLabel="Return fuel percentage"
                      keyboardType="decimal-pad"
                      onChangeText={setFuel}
                      placeholder="Enter level"
                      placeholderTextColor={colors.placeholder}
                      style={[styles.input, styles.readingInput]}
                      value={fuel}
                    />
                    <Text style={styles.readingUnit}>%</Text>
                  </View>
                </View>
              ) : null}
              {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') ? (
                <View style={styles.readingField}>
                  <Text style={styles.readingLabel}>Battery level</Text>
                  <View style={styles.readingInputRow}>
                    <TextInput
                      accessibilityLabel="Return battery percentage"
                      keyboardType="decimal-pad"
                      onChangeText={setSoc}
                      placeholder="Enter level"
                      placeholderTextColor={colors.placeholder}
                      style={[styles.input, styles.readingInput]}
                      value={soc}
                    />
                    <Text style={styles.readingUnit}>%</Text>
                  </View>
                </View>
              ) : null}
              {readingPerspectives.map(renderReturnPhoto)}
            </View>
            <View style={styles.inspectionSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Exterior photos
              </Text>
              {exteriorPerspectives.map(renderReturnPhoto)}
            </View>
            <View style={styles.inspectionSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Interior and dashboard
              </Text>
              {interiorPerspectives.map(renderReturnPhoto)}
            </View>
            <View style={styles.inspectionSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Additional evidence
              </Text>
              <Text style={styles.body}>
                Add optional photos if another detail should be recorded.
              </Text>
              {renderReturnPhoto('ADDITIONAL')}
            </View>
            <View style={styles.inspectionSection}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Return notes · Optional
              </Text>
              <TextInput
                multiline
                onChangeText={setNotes}
                placeholder="Add anything the owner should know about the vehicle condition."
                placeholderTextColor={colors.placeholder}
                style={[styles.input, styles.notesInput]}
                value={notes}
              />
            </View>
            {returnInspectionReady ? (
              <View accessibilityLiveRegion="polite" style={styles.readyState}>
                <Text style={styles.cardTitle}>Ready to return</Text>
                <Text style={styles.body}>All required return evidence has been added.</Text>
              </View>
            ) : null}
            <Action
              disabled={!returnInspectionReady || action.isPending}
              label={action.isPending ? 'Confirming…' : 'Confirm vehicle return'}
              onPress={() => action.mutate('inspection')}
            />
          </View>
        )}
      {detail.status === 'RETURN_PENDING' && returned && (
        <>
          <RentalVehicleReadings inspection={returned} title="Return readings" />
          {returnOverdue && (
            <Text style={styles.warning}>
              Owner return confirmation overdue. Your return evidence is preserved for operations
              review.
            </Text>
          )}
          {returnOverdue && (
            <SecondaryAction
              label="Ask operations to confirm the return"
              onPress={() => action.mutate('incident')}
            />
          )}
        </>
      )}
      {(detail.status === 'RETURNED' || detail.status === 'COMPLETED') && (
        <>
          <UsageSummary audience="renter" detail={detail} />
          <RenterPostReturnStatus
            claimWindowOpen={
              Boolean(detail.claimDeadlineAt) &&
              new Date(detail.claimDeadlineAt ?? 0).getTime() >
                (postReturnClock || rental.dataUpdatedAt)
            }
            detail={detail}
          />
        </>
      )}
      {action.isError && <Text style={styles.error}>{action.error.message}</Text>}
      {capture.isError && <Text style={styles.error}>{capture.error.message}</Text>}
    </View>
  );
}

export function OwnerRentalPanel({
  onOpenConversation,
  reference,
  scrollConditionFormBy,
  scrollToConditionForm,
}: {
  readonly onOpenConversation?: () => void;
  readonly reference: string;
  readonly scrollConditionFormBy?: (delta: number) => void;
  readonly scrollToConditionForm?: (y: number) => void;
}) {
  const client = useQueryClient();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const panelOffsetY = useRef(0);
  const ownerWorkflowOffsets = useRef<Record<string, number>>({});
  const conditionDescriptionRef = useRef<TextInput>(null);
  const ownerDiscrepancyResponseRef = useRef<TextInput>(null);
  const [attachmentUploaded, setAttachmentUploaded] = useState(false);
  const pendingAttachment = useRef<{
    id: string;
    uri: string;
    mode: 'append' | 'replace';
    perspective: string;
  } | null>(null);
  const [handoverStarted, setHandoverStarted] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [soc, setSoc] = useState('');
  const [notes, setNotes] = useState('');
  const [conditionDisclosureState, setConditionDisclosureState] = useState<
    'NOT_REVIEWED' | 'NO_KNOWN_ISSUES' | 'ISSUES_REPORTED'
  >('NOT_REVIEWED');
  const [conditionDescription, setConditionDescription] = useState('');
  const [conditionCategory, setConditionCategory] = useState('SCRATCH');
  const [conditionArea, setConditionArea] = useState('OTHER');
  const [conditionClassification, setConditionClassification] = useState('COSMETIC');
  const [conditionIssues, setConditionIssues] = useState<ConditionIssueDraft[]>([]);
  const [conditionDescriptionError, setConditionDescriptionError] = useState('');
  const [editingConditionIssue, setEditingConditionIssue] = useState<number | null>(null);
  const [showConditionIssueForm, setShowConditionIssueForm] = useState(false);
  const [conditionSheetContentHeight, setConditionSheetContentHeight] = useState(0);
  const [conditionSheetFooterHeight, setConditionSheetFooterHeight] = useState(0);
  const [conditionGallery, setConditionGallery] = useState<readonly string[]>([]);
  const [conditionEvidenceIds, setConditionEvidenceIds] = useState<readonly string[]>([]);
  const [ownerDiscrepancyResponse, setOwnerDiscrepancyResponse] = useState('');
  const [ownerDiscrepancyResponseError, setOwnerDiscrepancyResponseError] = useState('');
  const [renterNoShowSubmitted, setRenterNoShowSubmitted] = useState(false);
  const [code, setCode] = useState('');
  const [claimCategory, setClaimCategory] =
    useState<(typeof claimCategories)[number]>('EXCESS_MILEAGE');
  const [claimDescription, setClaimDescription] = useState('');
  const [showClaimSheet, setShowClaimSheet] = useState(false);
  const [claimClock, setClaimClock] = useState(0);
  useEffect(() => {
    const initialize = setTimeout(() => setClaimClock(Date.now()), 0);
    const timer = setInterval(() => setClaimClock(Date.now()), 30_000);
    return () => {
      clearTimeout(initialize);
      clearInterval(timer);
    };
  }, []);
  const conditionSheetBottomAllowance = Math.max(safeArea.bottom, spacing.md);
  const conditionSheetMaximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const conditionSheetLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: conditionSheetContentHeight,
        headerHeight: conditionSheetFooterHeight,
        maxSafeViewportHeight: conditionSheetMaximumHeight,
        safeAreaAllowance: 0,
      }),
    [conditionSheetContentHeight, conditionSheetFooterHeight, conditionSheetMaximumHeight],
  );
  const conditionSheetHeight = useSharedValue(Math.min(720, conditionSheetMaximumHeight));
  const conditionSheetAnimatedStyle = useAnimatedStyle(() => ({
    height: conditionSheetHeight.value,
  }));
  useEffect(() => {
    if ((!showConditionIssueForm && !showClaimSheet) || conditionSheetContentHeight <= 0) return;
    // eslint-disable-next-line react-hooks/immutability
    conditionSheetHeight.value = withTiming(conditionSheetLayout.height, { duration: 220 });
  }, [
    conditionSheetContentHeight,
    conditionSheetHeight,
    conditionSheetLayout.height,
    showClaimSheet,
    showConditionIssueForm,
  ]);
  const [correctionOdometer, setCorrectionOdometer] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [files, setFiles] = useState<Record<string, CapturedFile[]>>({});
  const rental = useQuery({
    queryKey: ['owner-rental', reference],
    queryFn: () => apiClient.request<RentalDetail>(`/owner/bookings/${reference}/rental`),
    refetchInterval: (query) =>
      query.state.data &&
      ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(query.state.data.status)
        ? 5_000
        : false,
  });
  const pickupDraft = useQuery({
    queryKey: ['owner-pickup-inspection-draft', reference],
    queryFn: () =>
      apiClient.request<InspectionDraft>(
        `/owner/bookings/${reference}/rental/pickup/inspection/draft`,
      ),
  });
  const draftFiles = useMemo(
    () => capturedFilesFromDraft(pickupDraft.data?.media ?? []),
    [pickupDraft.data?.media],
  );
  const inspectionFiles = Object.keys(files).length ? files : draftFiles;
  const conditionEvidence = conditionEvidenceIds.flatMap((id) => {
    const file = inspectionFiles.ADDITIONAL?.find((item) => item.id === id);
    return file ? [file] : [];
  });
  useEffect(() => {
    const keyboardShown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      const focusedInput = ownerDiscrepancyResponseRef.current?.isFocused()
        ? ownerDiscrepancyResponseRef.current
        : null;
      if (focusedInput) {
        focusedInput.measureInWindow((_x, y, _width, height) => {
          const overlap = y + height + spacing.sm - endCoordinates.screenY;
          if (overlap > 0) scrollConditionFormBy?.(overlap);
        });
      }
    });
    return () => keyboardShown.remove();
  }, [scrollConditionFormBy]);
  useRefreshOnFocusAndForeground(() => void rental.refetch());
  const capture = useMutation({
    mutationFn: async ({
      mode,
      perspective,
      retry,
    }: {
      mode: 'append' | 'replace';
      perspective: string;
      retry?: boolean;
    }) => {
      if (retry && pendingAttachment.current) {
        const pending = pendingAttachment.current;
        await apiClient.request(
          `/owner/bookings/${reference}/rental/pickup/inspection/draft/media`,
          {
            body: JSON.stringify({
              fileAssetId: pending.id,
              perspective: pending.perspective,
              replace: pending.mode === 'replace',
            }),
            method: 'PUT',
          },
        );
        return pending;
      }
      pendingAttachment.current = null;
      setAttachmentUploaded(false);
      if (!(await ensureCameraPermission())) return null;
      const result = await ImagePicker.launchCameraAsync({
        cameraType: ImagePicker.CameraType.back,
        mediaTypes: ['images'],
        quality: 0.85,
      });
      const asset = result.assets?.[0];
      if (!asset) return null;
      const uploaded = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `${perspective.toLowerCase()}.jpg`,
        uri: asset.uri,
      });
      pendingAttachment.current = { id: uploaded.id, mode, perspective, uri: asset.uri };
      setAttachmentUploaded(true);
      await apiClient.request(`/owner/bookings/${reference}/rental/pickup/inspection/draft/media`, {
        body: JSON.stringify({
          fileAssetId: uploaded.id,
          perspective,
          replace: mode === 'replace',
        }),
        method: 'PUT',
      });
      return pendingAttachment.current;
    },
    onSuccess: (result) => {
      if (result) {
        pendingAttachment.current = null;
        setAttachmentUploaded(false);
        if (result.perspective === 'ADDITIONAL') {
          setConditionEvidenceIds((current) => [...current, result.id]);
        }
        setFiles((current) => {
          const captured = Object.keys(current).length ? current : draftFiles;
          return result.mode === 'append'
            ? appendCapturedFile(captured, result.perspective, {
                id: result.id,
                uri: result.uri,
              })
            : replaceCapturedFile(captured, result.perspective, {
                id: result.id,
                uri: result.uri,
              });
        });
      }
    },
  });
  const action = useMutation({
    mutationFn: async (
      operation:
        | 'inspection'
        | 'verify'
        | 'return'
        | 'agree'
        | 'disagree'
        | 'claim'
        | 'incident'
        | 'return-inspection'
        | 'correction'
        | 'renter-no-show'
        | 'start-preparing'
        | 'start-on-way'
        | 'start-arrived'
        | 'return-on-way'
        | 'return-arrived'
        | 'discrepancy-acknowledge'
        | 'discrepancy-clarify'
        | 'discrepancy-support',
    ) => {
      const detail = rental.data;
      if (!detail) throw new Error('Rental is unavailable.');
      if (operation.startsWith('discrepancy-')) {
        const responseType =
          operation === 'discrepancy-acknowledge'
            ? 'ACKNOWLEDGE_CONDITION'
            : operation === 'discrepancy-clarify'
              ? 'CLARIFY_EXISTING_EVIDENCE'
              : 'REQUEST_SUPPORT';
        return apiClient.request(`/owner/bookings/${reference}/rental/pickup/discrepancy/respond`, {
          body: JSON.stringify({
            responseType,
            responseText: ownerDiscrepancyResponse.trim(),
            ...(responseType === 'ACKNOWLEDGE_CONDITION'
              ? {
                  acknowledgedCondition: {
                    category: conditionCategory,
                    vehicleArea: conditionArea,
                    classification: conditionClassification,
                    description: ownerDiscrepancyResponse.trim(),
                  },
                }
              : {}),
            ...(responseType === 'CLARIFY_EXISTING_EVIDENCE' &&
            detail.inspections.find(({ type }) => type === 'PICKUP')?.media[0]?.id
              ? {
                  referencedInspectionMediaId: detail.inspections.find(
                    ({ type }) => type === 'PICKUP',
                  )!.media[0]!.id,
                }
              : {}),
          }),
          method: 'POST',
        });
      }
      if (operation === 'verify') {
        return apiClient.request(`/owner/bookings/${reference}/rental/pickup/verify`, {
          body: JSON.stringify({ code }),
          method: 'POST',
        });
      }
      if (operation.startsWith('start-') || operation.startsWith('return-')) {
        const [phase, status] = operation.split('-');
        return apiClient.request(`/owner/bookings/${reference}/rental/handover/travel`, {
          body: JSON.stringify({
            phase: phase === 'start' ? 'START' : 'RETURN',
            status:
              status === 'preparing' ? 'PREPARING' : status === 'on' ? 'ON_THE_WAY' : 'ARRIVED',
          }),
          method: 'POST',
        });
      }
      if (operation === 'correction') {
        const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
        if (!pickup) throw new Error('Pickup inspection is unavailable.');
        return apiClient.request(
          `/owner/bookings/${reference}/rental/inspections/${pickup.id}/corrections`,
          {
            body: JSON.stringify({
              reason: correctionReason.trim(),
              proposedOdometerMeters: String(Math.round(Number(correctionOdometer) * 1000)),
            }),
            method: 'POST',
          },
        );
      }
      if (operation === 'return') {
        return apiClient.request(`/owner/bookings/${reference}/rental/return/start`, {
          method: 'POST',
        });
      }
      if (operation === 'claim') {
        const returned = detail.inspections.find(({ type }) => type === 'RETURN');
        return apiClient.request(`/owner/bookings/${reference}/claims`, {
          body: JSON.stringify({
            category: claimCategory,
            description: claimDescription,
            ...(['CLEANING', 'DAMAGE'].includes(claimCategory)
              ? {
                  evidence: (returned?.media ?? []).map(({ fileAsset }) => ({
                    evidenceType: 'PHOTO',
                    fileAssetId: fileAsset.id,
                  })),
                }
              : {}),
          }),
          method: 'POST',
        });
      }
      if (operation === 'incident') {
        return apiClient.request(`/owner/bookings/${reference}/rental/incidents`, {
          body: JSON.stringify({
            category: 'VEHICLE_ISSUE',
            description: 'Owner requested operational support.',
            severity: 'MEDIUM',
          }),
          method: 'POST',
        });
      }
      if (operation === 'renter-no-show') {
        return apiClient.request(`/owner/bookings/${reference}/rental/incidents`, {
          body: JSON.stringify({
            category: 'RENTER_NO_SHOW',
            description: 'Renter did not arrive and pickup handover could not be completed.',
            severity: 'HIGH',
          }),
          method: 'POST',
        });
      }
      if (operation === 'agree' || operation === 'disagree') {
        return apiClient.request(`/owner/bookings/${reference}/rental/return/confirm`, {
          body: JSON.stringify({
            decision: operation === 'agree' ? 'AGREED' : 'DISAGREED',
            ...(operation === 'disagree'
              ? { reason: 'Owner reported a discrepancy in the renter-submitted return evidence.' }
              : {}),
          }),
          method: 'POST',
        });
      }
      return apiClient.request(`/owner/bookings/${reference}/rental/pickup/inspection`, {
        body: JSON.stringify({
          odometerMeters: String(Math.round(Number(odometer) * 1000)),
          ...(fuel ? { fuelBasisPoints: Math.round(Number(fuel) * 100) } : {}),
          ...(soc ? { batterySocBasisPoints: Math.round(Number(soc) * 100) } : {}),
          media: inspectionMedia(inspectionFiles),
          notes: notes.trim() || 'Pickup inspection submitted from owner mobile mode.',
          conditionDisclosureState,
          conditionIssues:
            conditionDisclosureState === 'ISSUES_REPORTED'
              ? conditionIssues.map(conditionIssuePayload)
              : [],
        }),
        method: 'POST',
      });
    },
    onSuccess: (_result, operation) => {
      setFiles({});
      if (operation === 'renter-no-show') setRenterNoShowSubmitted(true);
      if (operation.startsWith('discrepancy-')) {
        setOwnerDiscrepancyResponse('');
        setOwnerDiscrepancyResponseError('');
      }
      if (operation === 'inspection')
        void client.invalidateQueries({ queryKey: ['owner-pickup-inspection-draft', reference] });
      if (operation === 'verify') setCode('');
      if (operation === 'correction') {
        setCorrectionOdometer('');
        setCorrectionReason('');
      }
      if (operation === 'claim') {
        setClaimDescription('');
        setShowClaimSheet(false);
      }
      invalidateRentalQueries(client, reference);
    },
    onError: (error, operation) => {
      if (operation.startsWith('discrepancy-') && /responseText|3 characters/i.test(error.message))
        setOwnerDiscrepancyResponseError(
          'Enter at least 3 characters before submitting this response.',
        );
    },
  });
  const submitDiscrepancySupport = () => {
    if (ownerDiscrepancyResponse.trim().length < 3) {
      setOwnerDiscrepancyResponseError(
        'Enter at least 3 characters before contacting CarShare support.',
      );
      return;
    }
    setOwnerDiscrepancyResponseError('');
    action.mutate('discrepancy-support');
  };
  const detail = rental.data;
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const needsInspection =
    detail.status === 'READY_FOR_PICKUP' &&
    detail.workflowCompliance?.start.evidenceOutcome !== 'WAIVED' &&
    !detail.inspections.some(({ type }) => type === 'PICKUP');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
  const renterPickupReview = pickup?.confirmations?.find(({ role }) => role === 'RENTER');
  const operationsOutcome =
    renterPickupReview?.discrepancyResponse?.resolutionReview?.operationsResolution?.outcome ??
    detail.pickupOperationsResolutions.at(-1)?.outcome;
  const pickupDiscrepancyUnresolved =
    renterPickupReview?.decision === 'DISAGREED' &&
    renterPickupReview.discrepancyResponse?.resolutionReview?.decision !== 'ACCEPTED' &&
    operationsOutcome !== 'HANDOVER_MAY_RESUME';
  const latestCorrection = pickup?.amendments?.[0];
  const pickupOverdue = detail.workflowCompliance?.start.overdue ?? false;
  const startWaived = detail.workflowCompliance?.start.evidenceOutcome === 'WAIVED';
  const returnWaived = detail.workflowCompliance?.return.evidenceOutcome === 'WAIVED';
  const returnRecoveryOverdue =
    !detail.actualReturnAt &&
    ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(detail.status) &&
    rental.dataUpdatedAt >
      new Date(detail.rentalEnd).getTime() +
        detail.operationalPolicy.returnConfirmationGraceMinutes * 60_000;
  const overdueRecoveryScope: 'START' | 'RETURN' | 'BOTH' | null =
    pickupOverdue && !pickup && !startWaived && returnRecoveryOverdue
      ? 'BOTH'
      : pickupOverdue && !pickup && !startWaived
        ? 'START'
        : returnRecoveryOverdue
          ? 'RETURN'
          : null;
  const renterNoShowIncident = detail.rentalIncidents.find(
    ({ category }) => category === 'RENTER_NO_SHOW',
  );
  const pickupHandoverReady =
    detail.fulfillment.startMethod !== 'OWNER_DELIVERY' ||
    detail.handoverTravel.startStatus === 'ARRIVED';
  const statusLabel =
    overdueRecoveryScope === 'BOTH'
      ? 'Pickup and Return overdue'
      : overdueRecoveryScope === 'START'
        ? 'Pickup overdue'
        : overdueRecoveryScope === 'RETURN'
          ? 'Return overdue'
          : friendlyStatus(detail.status);
  const showCompactRentalActions =
    !handoverStarted && ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(detail.status);
  const claimWindowOpen = Boolean(
    detail.claimDeadlineAt &&
    new Date(detail.claimDeadlineAt).getTime() > (claimClock || rental.dataUpdatedAt),
  );
  const eligibleClaimCategories = claimCategories.filter((category) => {
    if (category === 'EXCESS_MILEAGE') return (detail.usageSummary?.excessDistanceKm ?? 0) > 0;
    if (category === 'FUEL_DEFICIENCY')
      return (detail.usageSummary?.fuelDeficiencyBasisPoints ?? 0) > 0;
    if (category === 'EV_BATTERY_DEFICIENCY')
      return (detail.usageSummary?.socDeficiencyBasisPoints ?? 0) > 0;
    if (category === 'LATE_RETURN') return (detail.usageSummary?.lateDurationSeconds ?? 0) > 0;
    return true;
  });
  const closeClaimSheet = () => {
    Keyboard.dismiss();
    setClaimDescription('');
    setShowClaimSheet(false);
  };
  const openClaimSheet = () => {
    const firstCategory = eligibleClaimCategories[0];
    if (firstCategory) setClaimCategory(firstCategory);
    setConditionSheetContentHeight(0);
    setShowClaimSheet(true);
  };
  const inspectionReady =
    hasRequiredPhotos(inspectionFiles) &&
    Boolean(odometer) &&
    conditionDisclosureState !== 'NOT_REVIEWED' &&
    !(conditionDisclosureState === 'ISSUES_REPORTED' && conditionIssues.length === 0);
  const resetConditionIssueDraft = () => {
    Keyboard.dismiss();
    setConditionDescription('');
    setConditionEvidenceIds([]);
    setConditionDescriptionError('');
    setEditingConditionIssue(null);
  };
  const openNewConditionIssue = () => {
    resetConditionIssueDraft();
    setConditionSheetContentHeight(0);
    setShowConditionIssueForm(true);
  };
  const closeConditionIssueSheet = () => {
    resetConditionIssueDraft();
    setShowConditionIssueForm(false);
  };
  const saveConditionIssue = () => {
    const issue: ConditionIssueDraft = {
      category: conditionCategory,
      vehicleArea: conditionArea,
      classification: conditionClassification,
      description: conditionDescription.trim(),
      evidenceFileAssetIds: conditionEvidenceIds,
      persistAsKnownIssue: editingConditionIssue === null,
    };
    Keyboard.dismiss();
    if (issue.description.length < 3) {
      setConditionDescriptionError('Please enter at least 3 characters.');
      return;
    }
    setConditionIssues((current) =>
      editingConditionIssue === null
        ? [...current, issue]
        : current.map((value, index) => (index === editingConditionIssue ? issue : value)),
    );
    closeConditionIssueSheet();
  };
  const renderInspectionPhoto = (perspective: InspectionPerspective) => {
    const captured = inspectionFiles[perspective] ?? [];
    const latest = captured.at(-1);
    const multiple = (multiPerspectives as readonly string[]).includes(perspective);
    return (
      <View key={perspective}>
        <SecureCameraPhotoSlot
          busy={capture.isPending && capture.variables?.perspective === perspective}
          captureLabel="Capture"
          checklist
          guidance={inspectionPhotoGuidance(perspective)}
          name={domainLabel(perspective)}
          onCapture={() => capture.mutate({ mode: 'replace', perspective })}
          persistedPreview={
            latest && !latest.uri ? (
              <AuthorizedInspectionImage
                fileAssetId={latest.id}
                label={`${domainLabel(perspective)} secure draft preview`}
              />
            ) : undefined
          }
          previewUri={latest?.uri}
          required
          uploaded={Boolean(latest)}
        />
        {capture.isError && capture.variables?.perspective === perspective ? (
          <View>
            <Text accessibilityRole="alert" style={styles.error}>
              {attachmentUploaded
                ? `Photo uploaded, but could not be attached. ${capture.error.message} Retry without taking another photo.`
                : capture.error.message}
            </Text>
            <SecondaryAction
              label="Retry"
              onPress={() =>
                capture.mutate({
                  mode: capture.variables?.mode ?? 'replace',
                  perspective,
                  retry: Boolean(pendingAttachment.current),
                })
              }
            />
          </View>
        ) : null}
        {multiple && latest ? (
          <View style={styles.additionalPhotoAction}>
            <SecondaryAction
              disabled={capture.isPending && capture.variables?.perspective === perspective}
              inline
              label={`Add another ${domainLabel(perspective).toLowerCase()} photo`}
              onPress={() => capture.mutate({ mode: 'append', perspective })}
            />
          </View>
        ) : null}
        {captured.length > 1 ? (
          <CapturedPreviews files={captured.slice(0, -1)} perspective={perspective} />
        ) : null}
      </View>
    );
  };
  return (
    <View
      onLayout={({ nativeEvent }) => {
        panelOffsetY.current = nativeEvent.layout.y;
      }}
      style={[styles.panel, styles.ownerPanel]}
    >
      <View style={styles.rentalSummaryCard}>
        <View style={styles.rentalSummaryHeader}>
          <Text style={[styles.heading, styles.rentalSummaryTitle]}>
            {detail.vehicle.make} {detail.vehicle.model}
          </Text>
          <StatusBadge label={statusLabel} />
        </View>
        <View style={styles.rentalScheduleRows}>
          <RentalScheduleRow
            label="Dates & time"
            value={rentalTripSummary(detail.rentalStart, detail.rentalEnd)}
          />
          {['ACTIVE', 'RETURN_PENDING'].includes(detail.status) && detail.actualPickupAt ? (
            <RentalScheduleRow
              label="Actual handover"
              value={dateTimeLabel(detail.actualPickupAt)}
            />
          ) : null}
          {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && !pickupOverdue && (
            <RentalScheduleRow
              label="Handover available"
              value={dateTimeLabel(detail.pickupWindowStart)}
            />
          )}
        </View>
      </View>
      {detail.status === 'ACTIVE' && !returnRecoveryOverdue ? (
        <View accessibilityLiveRegion="polite" style={styles.nextStepCard}>
          <Text style={styles.actionEyebrow}>Next step</Text>
          <Text style={styles.nextStepText}>Waiting for the renter to begin return.</Text>
        </View>
      ) : null}
      {overdueRecoveryScope && !detail.overdueHandoverRecovery && (
        <OwnerOverdueRecoveryAction
          detail={detail}
          reference={reference}
          scope={overdueRecoveryScope}
        />
      )}
      {detail.overdueHandoverRecovery && !detail.overdueHandoverRecovery.acceptance && (
        <OwnerOverdueRecoverySubmittedStatus recovery={detail.overdueHandoverRecovery} />
      )}
      {pickupOverdue && !pickup && !startWaived && !overdueRecoveryScope && (
        <View accessibilityRole="alert" style={[styles.overdueCard, styles.compactOverdueCard]}>
          <Text style={styles.cardTitle}>Handover overdue</Text>
          {detail.workflowCompliance?.workflow === 'B4' && (
            <Text style={styles.overdueStatus}>Payout remains pending</Text>
          )}
          <Text style={styles.body}>
            Complete the outstanding handover step. If custody already transferred, record the
            actual transfer time.
          </Text>
          {[
            'OWNER_DELIVERY_ARRIVAL_REQUIRED',
            'OWNER_INSPECTION_REQUIRED',
            'PICKUP_VERIFICATION_REQUIRED',
          ].includes(detail.workflowCompliance?.start.outstandingStep ?? '') ||
          (detail.workflowCompliance?.start.outstandingStep === 'DISCREPANCY_RESOLUTION_REQUIRED' &&
            (!renterPickupReview?.discrepancyResponse ||
              renterPickupReview.discrepancyResponse.resolutionReview?.decision ===
                'STILL_DISAGREES')) ? (
            <Action
              label="Continue handover"
              onPress={() =>
                scrollToConditionForm?.(
                  panelOffsetY.current + (ownerWorkflowOffsets.current.start ?? 0) - spacing.md,
                )
              }
            />
          ) : (
            <Text style={styles.body}>Waiting for the outstanding handover step to complete.</Text>
          )}
          {needsInspection &&
            pickupHandoverReady &&
            detail.workflowCompliance?.workflow === 'B4' &&
            detail.workflowCompliance.start.outstandingStep === 'OWNER_INSPECTION_REQUIRED' && (
              <EvidenceWaiverAction detail={detail} reference={reference} phase="START" />
            )}
          {renterNoShowIncident || renterNoShowSubmitted ? (
            <Text style={styles.success}>
              ✓ Renter no-show reported
              {renterNoShowIncident ? ` · ${domainLabel(renterNoShowIncident.status)}` : ''}
            </Text>
          ) : (
            <SecondaryAction
              disabled={action.isPending && action.variables === 'renter-no-show'}
              label={
                action.isPending && action.variables === 'renter-no-show'
                  ? 'Reporting…'
                  : 'Renter did not arrive'
              }
              onPress={() => action.mutate('renter-no-show')}
            />
          )}
        </View>
      )}
      {detail.status === 'CANCELLED' && detail.cancellationSettlement ? (
        <CancellationSummary detail={detail} audience="owner" />
      ) : null}
      {detail.workflowCompliance?.return.overdue && !returnWaived && !overdueRecoveryScope && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Return process overdue</Text>
          {detail.workflowCompliance.workflow === 'B4' && (
            <Text style={styles.cardTitle}>Your payout remains pending</Text>
          )}
          <Text style={styles.body}>
            {domainLabel(
              detail.workflowCompliance.return.outstandingStep ?? 'RETURN_COMPLETION_REQUIRED',
            )}
          </Text>
          <Text style={styles.body}>
            Complete the required return process so CarShare can verify the end of the rental and
            continue payout processing.
          </Text>
          {[
            'OWNER_COLLECTION_ARRIVAL_REQUIRED',
            'OWNER_RETURN_REVIEW_REQUIRED',
            'OWNER_RETURN_RECEIPT_REQUIRED',
          ].includes(detail.workflowCompliance.return.outstandingStep ?? '') ? (
            <Action
              label="Complete return"
              onPress={() =>
                scrollToConditionForm?.(
                  panelOffsetY.current + (ownerWorkflowOffsets.current.return ?? 0) - spacing.md,
                )
              }
            />
          ) : (
            <Text style={styles.body}>
              Waiting for the renter or Operations to complete the outstanding step.
            </Text>
          )}
        </View>
      )}
      {detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&
        !pickupOverdue &&
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(detail.status) && (
          <View
            onLayout={({ nativeEvent }) => {
              if (!pickupHandoverReady) ownerWorkflowOffsets.current.start = nativeEvent.layout.y;
            }}
          >
            <OwnerTravelActions
              address={detail.fulfillment.startLocation}
              phase="start"
              status={detail.handoverTravel.startStatus}
              mutate={(operation) => action.mutate(operation)}
            />
          </View>
        )}
      {detail.fulfillment.endMethod === 'OWNER_COLLECTION' &&
        !detail.workflowCompliance?.return.overdue &&
        ['ACTIVE', 'RETURN_PENDING'].includes(detail.status) && (
          <View
            onLayout={({ nativeEvent }) => {
              if (detail.handoverTravel.returnStatus !== 'ARRIVED')
                ownerWorkflowOffsets.current.return = nativeEvent.layout.y;
            }}
          >
            <OwnerTravelActions
              actionsEnabled={detail.status === 'RETURN_PENDING'}
              address={detail.fulfillment.endLocation}
              phase="return"
              status={detail.handoverTravel.returnStatus}
              mutate={(operation) => action.mutate(operation)}
            />
          </View>
        )}
      {needsInspection && !handoverStarted && !pickupHandoverReady && !pickupOverdue && (
        <View style={styles.actionCard}>
          <Text style={styles.actionEyebrow}>Delivery</Text>
          <Text style={styles.cardTitle}>Complete delivery travel first</Text>
          <Text style={styles.body}>
            The pickup handover becomes available after you mark arrival at the delivery location.
          </Text>
        </View>
      )}
      {needsInspection && !handoverStarted && pickupHandoverReady && (
        <View
          style={styles.actionCard}
          onLayout={({ nativeEvent }) => {
            ownerWorkflowOffsets.current.start = nativeEvent.layout.y;
          }}
        >
          <Text style={styles.actionEyebrow}>Action required</Text>
          <Text style={styles.cardTitle}>Complete pickup inspection</Text>
          <Text style={styles.body}>Document the vehicle before handing it to the renter.</Text>
          {detail.workflowCompliance?.workflow === 'B4' && (
            <Text style={styles.actionNote}>
              Complete the recorded handover to keep payout eligibility on track.
            </Text>
          )}
          <Action
            label="Start handover"
            onPress={() => {
              const knownIssues = (pickupDraft.data?.knownIssues ?? []).map((issue) => ({
                category: issue.category,
                classification: issue.classification,
                description: issue.description,
                evidenceFileAssetIds: [] as readonly string[],
                knownIssueId: issue.id,
                knownIssueEvidenceFileAssetIds: issue.evidence.map(
                  ({ fileAssetId }) => fileAssetId,
                ),
                vehicleArea: issue.vehicleArea,
              }));
              setConditionIssues(knownIssues);
              setShowConditionIssueForm(false);
              if (knownIssues.length) setConditionDisclosureState('ISSUES_REPORTED');
              setHandoverStarted(true);
            }}
          />
        </View>
      )}
      {detail.status === 'READY_FOR_PICKUP' && showCompactRentalActions && !pickup && (
        <View style={styles.rentalActionsSection}>
          <Text style={styles.sectionTitle}>Rental actions</Text>
          <View style={styles.rentalActionRow}>
            <SecondaryAction
              compact
              label="Report incident"
              onPress={() => action.mutate('incident')}
            />
            {onOpenConversation ? (
              <SecondaryAction compact label="Message" onPress={onOpenConversation} />
            ) : null}
          </View>
        </View>
      )}
      {needsInspection && handoverStarted && (
        <>
          <View
            style={styles.inspectionIntro}
            onLayout={({ nativeEvent }) => {
              ownerWorkflowOffsets.current.start = nativeEvent.layout.y;
            }}
          >
            <Text accessibilityRole="header" style={styles.inspectionTitle}>
              Pickup inspection
            </Text>
            <Text style={styles.body}>
              Document the vehicle condition before handing it to the renter.
            </Text>
            <Text accessibilityLiveRegion="polite" style={styles.progress}>
              {completedRequired(inspectionFiles)} of {perspectives.length} required photos added
            </Text>
          </View>
          <View style={styles.inspectionSection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Vehicle readings
            </Text>
            <View style={styles.readingField}>
              <Text style={styles.readingLabel}>Odometer</Text>
              <View style={styles.readingInputRow}>
                <TextInput
                  accessibilityLabel="Odometer reading in kilometers"
                  style={[styles.input, styles.readingInput]}
                  value={odometer}
                  onChangeText={setOdometer}
                  keyboardType="number-pad"
                  placeholder="24,320"
                  placeholderTextColor={colors.placeholder}
                />
                <Text style={styles.readingUnit}>km</Text>
              </View>
            </View>
            {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' ? (
              <View style={styles.readingField}>
                <Text style={styles.readingLabel}>Fuel level</Text>
                <View style={styles.readingInputRow}>
                  <TextInput
                    accessibilityLabel="Fuel level percentage"
                    style={[styles.input, styles.readingInput]}
                    value={fuel}
                    onChangeText={setFuel}
                    keyboardType="decimal-pad"
                    placeholder="Enter fuel level"
                    placeholderTextColor={colors.placeholder}
                  />
                  <Text style={styles.readingUnit}>%</Text>
                </View>
              </View>
            ) : null}
            {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') ? (
              <View style={styles.readingField}>
                <Text style={styles.readingLabel}>Battery level</Text>
                <View style={styles.readingInputRow}>
                  <TextInput
                    accessibilityLabel="Battery state of charge percentage"
                    style={[styles.input, styles.readingInput]}
                    value={soc}
                    onChangeText={setSoc}
                    keyboardType="decimal-pad"
                    placeholder="Enter battery level"
                    placeholderTextColor={colors.placeholder}
                  />
                  <Text style={styles.readingUnit}>%</Text>
                </View>
              </View>
            ) : null}
            <View style={styles.inspectionChecklist}>
              {readingPerspectives.map(renderInspectionPhoto)}
            </View>
          </View>
          <View style={styles.inspectionSection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Exterior photos
            </Text>
            <View style={styles.inspectionChecklist}>
              {exteriorPerspectives.map(renderInspectionPhoto)}
            </View>
          </View>
          <View style={styles.inspectionSection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Interior photos
            </Text>
            <View style={styles.inspectionChecklist}>
              {interiorPerspectives.map(renderInspectionPhoto)}
            </View>
          </View>
          <View style={styles.inspectionSection}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Pickup notes · Optional
            </Text>
            <TextInput
              multiline
              onChangeText={setNotes}
              placeholder="Add anything the renter should know about the vehicle condition."
              placeholderTextColor={colors.placeholder}
              style={[styles.input, styles.notesInput]}
              value={notes}
            />
          </View>
          <View style={styles.inspectionSection}>
            <View style={styles.conditionHeader}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Existing vehicle condition
              </Text>
              <Text style={styles.conditionStatus}>
                {conditionDisclosureState === 'NO_KNOWN_ISSUES'
                  ? 'No known issues'
                  : conditionDisclosureState === 'ISSUES_REPORTED'
                    ? `${conditionIssues.length} ${conditionIssues.length === 1 ? 'issue' : 'issues'}`
                    : 'Review required'}
              </Text>
            </View>
            <Text style={styles.body}>
              Confirm the existing condition before handing over the vehicle.
            </Text>
            <View
              accessibilityLabel="Existing vehicle condition"
              accessibilityRole="radiogroup"
              style={styles.conditionChoiceGroup}
            >
              <ConditionDisclosureOption
                label="No known issues"
                onPress={() => {
                  if (conditionIssues.some(({ knownIssueId }) => knownIssueId)) {
                    Alert.alert(
                      'Active known issues must be addressed',
                      'Include each active issue or mark it resolved before declaring no known existing issues.',
                    );
                    return;
                  }
                  const selectNoIssues = () => {
                    setConditionIssues([]);
                    closeConditionIssueSheet();
                    setConditionDisclosureState('NO_KNOWN_ISSUES');
                  };
                  if (conditionIssues.length) {
                    Alert.alert(
                      'Remove existing issue drafts?',
                      'Choosing no known issues will remove the issues you added to this inspection.',
                      [
                        { text: 'Keep issues', style: 'cancel' },
                        { text: 'Remove drafts', style: 'destructive', onPress: selectNoIssues },
                      ],
                    );
                  } else selectNoIssues();
                }}
                selected={conditionDisclosureState === 'NO_KNOWN_ISSUES'}
              />
              <ConditionDisclosureOption
                label="Report issues"
                onPress={() => {
                  setConditionDisclosureState('ISSUES_REPORTED');
                  openNewConditionIssue();
                }}
                selected={conditionDisclosureState === 'ISSUES_REPORTED'}
              />
            </View>
            {conditionDisclosureState === 'ISSUES_REPORTED' ? (
              <>
                <View style={styles.conditionIssueSummary}>
                  <View>
                    <Text style={styles.sectionTitle}>Existing issues</Text>
                    <Text accessibilityLiveRegion="polite" style={styles.conditionIssueCount}>
                      {conditionIssues.length} recorded
                    </Text>
                  </View>
                  <SecondaryAction inline label="Add another" onPress={openNewConditionIssue} />
                </View>
                {conditionIssues.some(({ knownIssueId }) => knownIssueId) ? (
                  <>
                    <View style={styles.conditionSubsectionHeader}>
                      <Text style={styles.cardTitle}>Known vehicle issues</Text>
                      <Text style={styles.conditionIssueCount}>
                        {conditionIssues.filter(({ knownIssueId }) => knownIssueId).length} recorded
                      </Text>
                    </View>
                    {conditionIssues.map((issue, index) =>
                      issue.knownIssueId ? (
                        <View
                          key={`${issue.category}-${issue.vehicleArea}-${index}`}
                          style={styles.issueCard}
                        >
                          <Text style={styles.cardTitle}>
                            {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
                          </Text>
                          <Text style={styles.body}>{domainLabel(issue.classification)}</Text>
                          <Text style={styles.body}>{issue.description}</Text>
                          {issue.knownIssueEvidenceFileAssetIds?.length ? (
                            <SecondaryAction
                              label={`View supporting photos (${issue.knownIssueEvidenceFileAssetIds.length})`}
                              onPress={() =>
                                setConditionGallery(issue.knownIssueEvidenceFileAssetIds ?? [])
                              }
                            />
                          ) : null}
                        </View>
                      ) : null,
                    )}
                  </>
                ) : null}
                {conditionIssues.some(({ knownIssueId }) => !knownIssueId) ? (
                  <>
                    <View style={styles.conditionSubsectionHeader}>
                      <Text style={styles.cardTitle}>New issues</Text>
                      <Text style={styles.conditionIssueCount}>
                        {conditionIssues.filter(({ knownIssueId }) => !knownIssueId).length}{' '}
                        recorded
                      </Text>
                    </View>
                    {conditionIssues.map((issue, index) =>
                      !issue.knownIssueId ? (
                        <View
                          key={`${issue.category}-${issue.vehicleArea}-${index}`}
                          style={styles.issueCard}
                        >
                          <Text style={styles.cardTitle}>
                            {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
                          </Text>
                          <Text style={styles.body}>{domainLabel(issue.classification)}</Text>
                          <Text style={styles.body}>{issue.description}</Text>
                          <View style={styles.inlineActions}>
                            <SecondaryAction
                              compact
                              label={`Edit ${domainLabel(issue.category)} issue`}
                              onPress={() => {
                                setConditionCategory(issue.category);
                                setConditionArea(issue.vehicleArea);
                                setConditionClassification(issue.classification);
                                setConditionDescription(issue.description);
                                setConditionEvidenceIds(issue.evidenceFileAssetIds);
                                setEditingConditionIssue(index);
                                setConditionSheetContentHeight(0);
                                setShowConditionIssueForm(true);
                              }}
                            />
                            <Pressable
                              accessibilityLabel={`Remove ${domainLabel(issue.category)} issue`}
                              accessibilityRole="button"
                              onPress={() =>
                                Alert.alert(
                                  'Remove issue?',
                                  'This removes the issue from the draft.',
                                  [
                                    { text: 'Cancel', style: 'cancel' },
                                    {
                                      text: 'Remove',
                                      style: 'destructive',
                                      onPress: () => {
                                        setFiles((current) => {
                                          const captured = Object.keys(current).length
                                            ? current
                                            : draftFiles;
                                          return {
                                            ...captured,
                                            ADDITIONAL: (captured.ADDITIONAL ?? []).filter(
                                              ({ id }) => !issue.evidenceFileAssetIds.includes(id),
                                            ),
                                          };
                                        });
                                        setConditionIssues((current) =>
                                          current.filter((_, issueIndex) => issueIndex !== index),
                                        );
                                      },
                                    },
                                  ],
                                )
                              }
                              style={styles.destructiveSecondary}
                            >
                              <Text style={styles.destructiveSecondaryText}>Remove</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null,
                    )}
                  </>
                ) : null}
                <Modal
                  animationType="slide"
                  onRequestClose={closeConditionIssueSheet}
                  presentationStyle="overFullScreen"
                  statusBarTranslucent
                  transparent
                  visible={showConditionIssueForm}
                >
                  <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    style={styles.conditionSheetRoot}
                  >
                    <View style={styles.exceptionBackdrop} />
                    <Reanimated.View
                      accessibilityViewIsModal
                      style={[styles.conditionSheet, conditionSheetAnimatedStyle]}
                    >
                      <ScrollView
                        automaticallyAdjustKeyboardInsets
                        contentContainerStyle={[
                          styles.conditionSheetContent,
                          { paddingBottom: spacing.md },
                        ]}
                        keyboardShouldPersistTaps="handled"
                        onContentSizeChange={(_width, height) =>
                          setConditionSheetContentHeight(height)
                        }
                        scrollEnabled={conditionSheetLayout.scrollEnabled}
                        showsVerticalScrollIndicator={conditionSheetLayout.scrollEnabled}
                      >
                        <BackControl label="Back" onPress={closeConditionIssueSheet} />
                        <Text accessibilityRole="header" style={styles.exceptionTitle}>
                          {editingConditionIssue === null
                            ? 'Report existing issue'
                            : 'Edit existing issue'}
                        </Text>
                        <Text style={styles.conditionSheetHelper}>
                          Record any damage or condition already present before handover.
                        </Text>
                        <View style={styles.issueForm}>
                          <SearchableReferenceSelector
                            label="Issue type"
                            onChange={setConditionCategory}
                            options={conditionCategoryOptions}
                            sheetDismissLabel="Back"
                            value={conditionCategory}
                          />
                          <SearchableReferenceSelector
                            label="Location"
                            onChange={setConditionArea}
                            options={conditionAreaOptions}
                            sheetDismissLabel="Back"
                            value={conditionArea}
                          />
                          <SearchableReferenceSelector
                            label="Severity"
                            onChange={setConditionClassification}
                            options={conditionClassificationOptions}
                            sheetDismissLabel="Back"
                            value={conditionClassification}
                          />
                          <Text
                            accessibilityLiveRegion="polite"
                            style={styles.classificationHelper}
                          >
                            {conditionClassificationExplanation(conditionClassification)}
                          </Text>
                          <Text style={styles.cardTitle}>Description</Text>
                          <TextInput
                            accessibilityLabel="Description"
                            multiline
                            ref={conditionDescriptionRef}
                            onChangeText={(value) => {
                              setConditionDescription(value);
                              if (value.trim().length >= 3) setConditionDescriptionError('');
                            }}
                            placeholder="Describe the existing issue"
                            placeholderTextColor={colors.placeholder}
                            style={[styles.input, styles.issueDescriptionInput]}
                            value={conditionDescription}
                          />
                          {conditionDescriptionError ? (
                            <Text accessibilityRole="alert" style={styles.error}>
                              {conditionDescriptionError}
                            </Text>
                          ) : null}
                          <Text style={styles.cardTitle}>Supporting photos</Text>
                          <Text style={styles.body}>
                            Photos are private and visible only to authorized reviewers.
                          </Text>
                          <View style={styles.conditionIssuePhotos}>
                            {conditionEvidence.map((file, index) => (
                              <SecureCameraPhotoSlot
                                busy={capture.isPending}
                                compactRemoveOverlay
                                guidance="Capture the affected area clearly."
                                key={file.id}
                                name={`Photo ${index + 1}`}
                                onCapture={() =>
                                  capture.mutate({ mode: 'append', perspective: 'ADDITIONAL' })
                                }
                                onRemove={() =>
                                  setFiles((current) => {
                                    setConditionEvidenceIds((ids) =>
                                      ids.filter((id) => id !== file.id),
                                    );
                                    const captured = Object.keys(current).length
                                      ? current
                                      : draftFiles;
                                    return {
                                      ...captured,
                                      ADDITIONAL: (captured.ADDITIONAL ?? []).filter(
                                        ({ id }) => id !== file.id,
                                      ),
                                    };
                                  })
                                }
                                persistedPreview={
                                  !file.uri ? (
                                    <AuthorizedInspectionImage
                                      fileAssetId={file.id}
                                      label={`Supporting photo ${index + 1} secure draft preview`}
                                      large
                                    />
                                  ) : undefined
                                }
                                previewUri={file.uri}
                                required={false}
                                uploaded
                              />
                            ))}
                            {conditionEvidence.length < 10 ? (
                              <SecureCameraPhotoSlot
                                busy={
                                  capture.isPending &&
                                  capture.variables?.perspective === 'ADDITIONAL'
                                }
                                captureLabel="Add photo"
                                guidance="Use the rear camera to add supporting condition evidence."
                                hideHeader
                                name="Add photo"
                                onCapture={() =>
                                  capture.mutate({ mode: 'append', perspective: 'ADDITIONAL' })
                                }
                                required={false}
                                uploaded={false}
                              />
                            ) : null}
                          </View>
                          {capture.isError && capture.variables?.perspective === 'ADDITIONAL' && (
                            <View>
                              <Text accessibilityRole="alert" style={styles.error}>
                                {attachmentUploaded
                                  ? `Photo uploaded, but could not be attached. ${capture.error.message}`
                                  : capture.error.message}
                              </Text>
                              <SecondaryAction
                                label="Retry"
                                onPress={() =>
                                  capture.mutate({
                                    mode: 'append',
                                    perspective: 'ADDITIONAL',
                                    retry: Boolean(pendingAttachment.current),
                                  })
                                }
                              />
                            </View>
                          )}
                        </View>
                      </ScrollView>
                      <View
                        onLayout={({ nativeEvent }) =>
                          setConditionSheetFooterHeight(nativeEvent.layout.height)
                        }
                        style={[
                          styles.conditionSheetFooter,
                          { paddingBottom: conditionSheetBottomAllowance },
                        ]}
                      >
                        <Action
                          label={editingConditionIssue === null ? 'Save issue' : 'Save changes'}
                          onPress={saveConditionIssue}
                        />
                      </View>
                    </Reanimated.View>
                  </KeyboardAvoidingView>
                </Modal>
                <Modal
                  animationType="fade"
                  onRequestClose={() => setConditionGallery([])}
                  visible={conditionGallery.length > 0}
                >
                  <View style={styles.conditionGallery}>
                    <Pressable
                      accessibilityLabel="Close supporting photos"
                      accessibilityRole="button"
                      hitSlop={spacing.md}
                      onPress={() => setConditionGallery([])}
                      style={styles.conditionGalleryClose}
                    >
                      <Text style={styles.conditionGalleryCloseText}>Close</Text>
                    </Pressable>
                    <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                      {conditionGallery.map((fileAssetId, index) => (
                        <Pressable
                          accessibilityLabel="Close photo gallery"
                          accessibilityRole="button"
                          key={fileAssetId}
                          onPress={() => setConditionGallery([])}
                          style={[styles.conditionGalleryPage, { width: viewportWidth }]}
                        >
                          <Text style={styles.conditionGalleryCount}>
                            {index + 1} / {conditionGallery.length}
                          </Text>
                          <Pressable accessible={false} onPress={() => undefined}>
                            <AuthorizedInspectionImage
                              fileAssetId={fileAssetId}
                              label={`Known issue supporting photo ${index + 1}`}
                              large
                            />
                          </Pressable>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </Modal>
              </>
            ) : null}
          </View>
          {inspectionReady ? (
            <View accessibilityLiveRegion="polite" style={styles.readyState}>
              <Text style={styles.cardTitle}>Ready to submit</Text>
              <Text style={styles.body}>All required pickup evidence has been added.</Text>
            </View>
          ) : null}
          <Action
            label={
              action.isPending && action.variables === 'inspection'
                ? 'Submitting…'
                : 'Submit inspection'
            }
            disabled={!inspectionReady || (action.isPending && action.variables === 'inspection')}
            onPress={() => action.mutate('inspection')}
          />
        </>
      )}
      {detail.status === 'READY_FOR_PICKUP' &&
        (detail.inspections.some(({ type }) => type === 'PICKUP') ||
          detail.workflowCompliance?.start.evidenceOutcome === 'WAIVED') &&
        !pickupDiscrepancyUnresolved && (
          <View
            onLayout={({ nativeEvent }) => {
              ownerWorkflowOffsets.current.start = nativeEvent.layout.y;
            }}
          >
            {pickup ? (
              <>
                <View style={styles.submittedInspectionStatus}>
                  <Text style={styles.sectionTitle}>Pickup inspection</Text>
                  <StatusBadge label="Submitted" />
                </View>
                <PickupInspectionSummary inspection={pickup} />
              </>
            ) : null}
            <View style={styles.pickupVerificationCard}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Pickup verification
              </Text>
              <Text style={styles.body}>
                Enter the renter&apos;s 6-digit pickup code to confirm the handover.
              </Text>
              <TextInput
                accessibilityLabel="6-digit pickup code"
                style={styles.input}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="6-digit pickup code"
                placeholderTextColor={colors.placeholder}
              />
              <Action
                label={action.isPending ? 'Verifying…' : 'Verify pickup code'}
                disabled={code.length !== 6 || action.isPending}
                onPress={() => {
                  Keyboard.dismiss();
                  action.mutate('verify');
                }}
              />
            </View>
            {showCompactRentalActions ? (
              <View style={styles.rentalActionsSection}>
                <Text style={styles.sectionTitle}>Rental actions</Text>
                <View style={styles.rentalActionRow}>
                  <SecondaryAction
                    compact
                    label="Report incident"
                    onPress={() => action.mutate('incident')}
                  />
                  {onOpenConversation ? (
                    <SecondaryAction compact label="Message" onPress={onOpenConversation} />
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        )}
      {detail.status === 'READY_FOR_PICKUP' && pickupDiscrepancyUnresolved && pickup ? (
        <View
          style={styles.warningCard}
          onLayout={({ nativeEvent }) => {
            ownerWorkflowOffsets.current.start = nativeEvent.layout.y;
          }}
        >
          <Text style={styles.cardTitle}>Handover paused</Text>
          <Text style={styles.body}>
            The renter reported a difference in the vehicle condition.
          </Text>
          {renterPickupReview?.reason ? (
            <Text style={styles.body}>Renter report: {renterPickupReview.reason}</Text>
          ) : null}
          <InspectionEvidence title="Relevant Start inspection" inspection={pickup} />
          {!renterPickupReview?.discrepancyResponse ? (
            <>
              <TextInput
                ref={ownerDiscrepancyResponseRef}
                multiline
                onChangeText={(value) => {
                  setOwnerDiscrepancyResponse(value);
                  if (ownerDiscrepancyResponseError) {
                    setOwnerDiscrepancyResponseError('');
                    action.reset();
                  }
                }}
                placeholder="Explain how this condition will be resolved"
                placeholderTextColor={colors.placeholder}
                style={styles.input}
                value={ownerDiscrepancyResponse}
              />
              <Action
                disabled={ownerDiscrepancyResponse.trim().length < 3}
                label="Acknowledge condition"
                onPress={() => action.mutate('discrepancy-acknowledge')}
              />
              <SecondaryAction
                label="Clarify existing evidence"
                onPress={() => action.mutate('discrepancy-clarify')}
              />
              <SecondaryAction label="Request support" onPress={submitDiscrepancySupport} />
              {ownerDiscrepancyResponseError ? (
                <Text style={styles.inlineError}>{ownerDiscrepancyResponseError}</Text>
              ) : null}
            </>
          ) : renterPickupReview.discrepancyResponse.resolutionReview?.decision ===
            'STILL_DISAGREES' ? (
            <>
              {(renterPickupReview.discrepancyResponses?.length ?? 0) > 0 ? (
                <View style={styles.infoCard}>
                  <Text style={styles.cardTitle}>Resolution history</Text>
                  {renterPickupReview.discrepancyResponses?.map((response) => (
                    <View key={response.id}>
                      <Text style={styles.body}>
                        Round {response.roundNumber}: {response.responseText}
                      </Text>
                      <Text style={styles.body}>
                        Renter response:{' '}
                        {domainLabel(response.resolutionReview?.decision ?? 'Awaiting review')}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.body}>
                The renter still disagrees with the vehicle condition. Work with the renter to
                resolve the issue before handover.
              </Text>
              <TextInput
                ref={ownerDiscrepancyResponseRef}
                multiline
                onChangeText={(value) => {
                  setOwnerDiscrepancyResponse(value);
                  if (ownerDiscrepancyResponseError) {
                    setOwnerDiscrepancyResponseError('');
                    action.reset();
                  }
                }}
                placeholder="Describe what materially changed"
                placeholderTextColor={colors.placeholder}
                style={styles.input}
                value={ownerDiscrepancyResponse}
              />
              <Action
                disabled={ownerDiscrepancyResponse.trim().length < 3}
                label="Update resolution"
                onPress={() => action.mutate('discrepancy-acknowledge')}
              />
              <SecondaryAction
                label="Contact CarShare support"
                onPress={submitDiscrepancySupport}
              />
              {ownerDiscrepancyResponseError ? (
                <Text style={styles.inlineError}>{ownerDiscrepancyResponseError}</Text>
              ) : null}
              {operationsOutcome ? (
                <OperationsResolutionStatus outcome={operationsOutcome} />
              ) : null}
            </>
          ) : (
            <Text style={styles.body}>Waiting for the renter to review your response.</Text>
          )}
        </View>
      ) : null}
      {latestCorrection && (
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>
            {latestCorrection.status === 'PENDING_REVIEW'
              ? 'Correction requested · Pending admin review'
              : latestCorrection.status === 'APPROVED'
                ? '✓ Correction approved'
                : 'Correction rejected'}
          </Text>
          {latestCorrection.proposedOdometerMeters && (
            <Text style={styles.body}>
              Original: {odometerLabel(pickup?.odometerMeters)}
              {`\n`}Corrected: {odometerLabel(latestCorrection.proposedOdometerMeters)}
            </Text>
          )}
          {latestCorrection.proposedFuelBasisPoints !== null && (
            <Text style={styles.body}>
              Fuel correction: {latestCorrection.proposedFuelBasisPoints / 100}%
            </Text>
          )}
          {latestCorrection.proposedBatterySocBasisPoints !== null && (
            <Text style={styles.body}>
              EV SOC correction: {latestCorrection.proposedBatterySocBasisPoints / 100}%
            </Text>
          )}
          {latestCorrection.status === 'REJECTED' && latestCorrection.reviewReason && (
            <Text style={styles.body}>{latestCorrection.reviewReason}</Text>
          )}
        </View>
      )}
      {detail.status === 'ACTIVE' && pickup ? <RentalVehicleReadings inspection={pickup} /> : null}
      {detail.status === 'ACTIVE' ? (
        <View style={styles.rentalActionsSection}>
          <Text style={styles.sectionTitle}>Rental actions</Text>
          <View style={styles.rentalActionRow}>
            <SecondaryAction
              compact
              label="Report incident"
              onPress={() => action.mutate('incident')}
            />
            {onOpenConversation ? (
              <SecondaryAction compact label="Message" onPress={onOpenConversation} />
            ) : null}
          </View>
        </View>
      ) : null}
      <EvidenceWaiverWarnings detail={detail} />
      {detail.status === 'RETURN_PENDING' &&
        detail.fulfillment.endMethod === 'OWNER_COLLECTION' &&
        detail.workflowCompliance?.return.overdue &&
        !overdueRecoveryScope &&
        detail.workflowCompliance.return.evidenceOutcome !== 'WAIVED' &&
        !returned && (
          <View style={styles.overdueCard}>
            <Text style={styles.cardTitle}>Vehicle already received?</Text>
            <Text style={styles.body}>
              If the Collection happened outside CarShare, report when you received the vehicle and
              complete the Return without inspection. The renter will be notified and can report a
              disagreement in the app.
            </Text>
            <Text accessibilityRole="alert" style={styles.body}>
              Without the normal Return inspection, CarShare will have limited evidence available to
              help with later disputes, damage, condition, mileage, fuel, or battery issues.
            </Text>
            <EvidenceWaiverAction
              detail={detail}
              ownerInitiatedReturn
              reference={reference}
              phase="RETURN"
            />
          </View>
        )}
      {detail.status === 'RETURN_PENDING' &&
        detail.workflowCompliance?.return.evidenceOutcome === 'WAIVED' && (
          <View
            onLayout={({ nativeEvent }) => {
              ownerWorkflowOffsets.current.return = nativeEvent.layout.y;
            }}
          >
            <Text style={styles.cardTitle}>Confirm vehicle receipt</Text>
            <WaivedReturnReceiptAction reference={reference} />
          </View>
        )}
      {detail.status === 'RETURN_PENDING' &&
        !returned &&
        detail.workflowCompliance?.return.evidenceOutcome !== 'WAIVED' &&
        !overdueRecoveryScope && (
          <View accessibilityLiveRegion="polite" style={styles.nextStepCard}>
            <Text style={styles.actionEyebrow}>Next step</Text>
            <Text style={styles.nextStepText}>
              Waiting for the renter to complete the return inspection.
            </Text>
            <Text style={styles.body}>
              Return photos and vehicle readings will appear here once submitted.
            </Text>
          </View>
        )}
      {detail.status === 'RETURN_PENDING' && returned && (
        <View
          onLayout={({ nativeEvent }) => {
            ownerWorkflowOffsets.current.return = nativeEvent.layout.y;
          }}
        >
          <RentalVehicleReadings inspection={returned} title="Return readings" />
          <ReturnInspectionEvidence inspection={returned} />
          {latestCorrection?.status === 'PENDING_REVIEW' ? (
            <View style={styles.infoCard}>
              <Text style={styles.cardTitle}>Waiting for administrator review</Text>
              <Text style={styles.body}>
                Your pickup odometer correction has been submitted. Vehicle receipt cannot be
                confirmed until an administrator reviews the corrected reading. We’ll refresh this
                rental when a decision is recorded.
              </Text>
            </View>
          ) : (
            <View accessibilityLiveRegion="polite" style={styles.nextStepCard}>
              <Text style={styles.actionEyebrow}>Next step</Text>
              <Text style={styles.nextStepText}>
                Review the renter&apos;s return evidence and confirm the vehicle was received.
              </Text>
              <Action label="Confirm vehicle received" onPress={() => action.mutate('agree')} />
              <SecondaryAction
                label="Report return discrepancy"
                onPress={() => action.mutate('disagree')}
              />
            </View>
          )}
        </View>
      )}
      {detail.status === 'RETURNED' && (
        <>
          <UsageSummary audience="owner" detail={detail} />
          <View style={styles.postInspectionCard}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Claims
            </Text>
            {detail.postReturnClaims.length ? (
              <>
                <Text style={styles.body}>
                  {detail.postReturnClaims.length}{' '}
                  {detail.postReturnClaims.length === 1 ? 'claim submitted' : 'claims submitted'}
                </Text>
                {detail.postReturnClaims.map((claim) => (
                  <View key={claim.id} style={styles.claimSummaryRow}>
                    <Text style={styles.rentalScheduleValue}>{domainLabel(claim.category)}</Text>
                    <StatusBadge label={domainLabel(claim.status)} />
                  </View>
                ))}
              </>
            ) : (
              <>
                <Text style={styles.rentalScheduleValue}>No claim submitted yet.</Text>
                <Text style={styles.body}>
                  Approved claims are reviewed before any additional charge is applied.
                </Text>
              </>
            )}
            {claimWindowOpen ? (
              <SecondaryAction
                inline
                label={detail.postReturnClaims.length ? 'Add another claim' : 'Start a claim'}
                onPress={openClaimSheet}
              />
            ) : (
              <Text accessibilityLiveRegion="polite" style={styles.status}>
                Claim window closed
              </Text>
            )}
          </View>
          <Modal
            animationType="slide"
            onRequestClose={closeClaimSheet}
            presentationStyle="overFullScreen"
            statusBarTranslucent
            transparent
            visible={showClaimSheet}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.conditionSheetRoot}
            >
              <View style={styles.exceptionBackdrop} />
              <Reanimated.View
                accessibilityViewIsModal
                style={[styles.conditionSheet, conditionSheetAnimatedStyle]}
              >
                <ScrollView
                  automaticallyAdjustKeyboardInsets
                  contentContainerStyle={styles.conditionSheetContent}
                  keyboardShouldPersistTaps="handled"
                  onContentSizeChange={(_width, height) => setConditionSheetContentHeight(height)}
                  scrollEnabled={conditionSheetLayout.scrollEnabled}
                  showsVerticalScrollIndicator={conditionSheetLayout.scrollEnabled}
                >
                  <BackControl label="Back" onPress={closeClaimSheet} />
                  <Text accessibilityRole="header" style={styles.exceptionTitle}>
                    Start a claim
                  </Text>
                  <Text style={styles.conditionSheetHelper}>
                    Select the return issue you want to report.
                  </Text>
                  <View style={styles.issueForm}>
                    <SearchableReferenceSelector
                      label="Claim type"
                      onChange={(value) =>
                        setClaimCategory(value as (typeof claimCategories)[number])
                      }
                      options={eligibleClaimCategories.map((value) => ({
                        code: value,
                        id: value,
                        name: domainLabel(value),
                      }))}
                      sheetDismissLabel="Back"
                      value={claimCategory}
                    />
                    <ClaimMeasuredValue category={claimCategory} detail={detail} />
                    <Text style={styles.cardTitle}>Description</Text>
                    <TextInput
                      accessibilityLabel="Claim description"
                      multiline
                      onChangeText={setClaimDescription}
                      placeholder="Describe the specific return issue"
                      placeholderTextColor={colors.placeholder}
                      style={[styles.input, styles.issueDescriptionInput]}
                      value={claimDescription}
                    />
                    <Text style={styles.conditionSheetHelper}>
                      Claim amounts are calculated from booking records and reviewed before any
                      additional charge is applied.
                    </Text>
                    {action.isError ? (
                      <Text accessibilityRole="alert" style={styles.error}>
                        {action.error.message}
                      </Text>
                    ) : null}
                  </View>
                </ScrollView>
                <View
                  onLayout={({ nativeEvent }) =>
                    setConditionSheetFooterHeight(nativeEvent.layout.height)
                  }
                  style={[
                    styles.conditionSheetFooter,
                    { paddingBottom: conditionSheetBottomAllowance },
                  ]}
                >
                  <Action
                    disabled={claimDescription.trim().length < 3 || action.isPending}
                    label={action.isPending ? 'Submitting…' : 'Submit claim'}
                    onPress={() => action.mutate('claim')}
                  />
                </View>
              </Reanimated.View>
            </KeyboardAvoidingView>
          </Modal>
        </>
      )}
      {['RETURN_PENDING', 'RETURNED'].includes(detail.status) ? (
        <View style={styles.rentalActionsSection}>
          <Text style={styles.sectionTitle}>Rental actions</Text>
          <View style={styles.rentalActionRow}>
            <SecondaryAction
              compact
              label="Report incident"
              onPress={() => action.mutate('incident')}
            />
            {onOpenConversation ? (
              <SecondaryAction compact label="Message" onPress={onOpenConversation} />
            ) : null}
          </View>
        </View>
      ) : null}
      {['READY_FOR_PICKUP', 'RETURN_PENDING'].includes(detail.status) &&
        !showCompactRentalActions && (
          <SecondaryAction label="Report incident" onPress={() => action.mutate('incident')} />
        )}
      {action.isError && !ownerDiscrepancyResponseError && (
        <Text style={styles.error}>{action.error.message}</Text>
      )}
      {action.isError &&
        latestCorrection?.status !== 'PENDING_REVIEW' &&
        /odometer.*lower|lower.*odometer/i.test(action.error.message) && (
          <View style={styles.actionCard}>
            <Text style={styles.cardTitle}>Pickup reading entered incorrectly?</Text>
            <Text style={styles.body}>
              The original evidence stays immutable. Submit a corrected reading and reason for
              administrator review.
            </Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setCorrectionOdometer}
              placeholder="Correct pickup odometer (km)"
              placeholderTextColor={colors.placeholder}
              style={styles.input}
              value={correctionOdometer}
            />
            <TextInput
              multiline
              onChangeText={setCorrectionReason}
              placeholder="Explain the data-entry mistake"
              placeholderTextColor={colors.placeholder}
              style={styles.input}
              value={correctionReason}
            />
            <Action
              disabled={!correctionOdometer || correctionReason.trim().length < 10}
              label="Request correction"
              onPress={() => action.mutate('correction')}
            />
          </View>
        )}
      {capture.isError && <Text style={styles.error}>{capture.error.message}</Text>}
    </View>
  );
}

function CapturedPreviews({
  files,
  perspective,
}: {
  readonly files: readonly CapturedFile[];
  readonly perspective: string;
}) {
  if (!files.length) return null;
  return (
    <View style={styles.evidenceGallery}>
      {files.map((file, index) => (
        <View key={file.id}>
          {file.uri ? (
            <Image
              accessibilityLabel={`${domainLabel(perspective)} captured preview ${index + 1}`}
              contentFit="cover"
              source={{ uri: file.uri }}
              style={styles.evidenceImage}
            />
          ) : (
            <AuthorizedInspectionImage
              fileAssetId={file.id}
              label={`${domainLabel(perspective)} secure draft preview ${index + 1}`}
            />
          )}
        </View>
      ))}
    </View>
  );
}

function PickupInspectionSummary({
  inspection,
}: {
  readonly inspection: RentalDetail['inspections'][number];
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const [gallery, setGallery] = useState<
    readonly { readonly fileAssetId: string; readonly title: string }[]
  >([]);
  const issues = inspection.conditionIssues ?? [];
  const ownerNotes =
    inspection.notes === 'Pickup inspection submitted from owner mobile mode.'
      ? null
      : inspection.notes;
  return (
    <>
      <View style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Vehicle condition
        </Text>
        <Text style={[styles.body, styles.compactPostInspectionText]}>
          {issues.length
            ? `${issues.length} existing ${issues.length === 1 ? 'issue' : 'issues'} recorded`
            : 'No existing issues recorded'}
        </Text>
        {issues.map((issue) => {
          const evidenceItems =
            issue.evidence?.map(({ inspectionMedia }) => ({
              fileAssetId: inspectionMedia.fileAsset.id,
              title: `${domainLabel(issue.category)} · ${domainLabel(issue.vehicleArea)}`,
            })) ?? [];
          return (
            <View key={issue.id} style={styles.compactSubmittedIssue}>
              <Text style={styles.cardTitle}>
                {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
              </Text>
              <Text style={[styles.body, styles.compactPostInspectionText]}>
                {domainLabel(issue.classification)} · {issue.description}
              </Text>
              {evidenceItems.length ? (
                <SecondaryAction
                  inline
                  label={`View supporting photos (${evidenceItems.length})`}
                  onPress={() => setGallery(evidenceItems)}
                />
              ) : null}
            </View>
          );
        })}
        {ownerNotes ? (
          <View style={styles.compactSummaryRow}>
            <Text style={styles.summaryLabel}>Notes</Text>
            <Text style={styles.rentalScheduleValue}>{ownerNotes}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Vehicle readings
        </Text>
        <View style={styles.compactSummaryRow}>
          <Text style={styles.summaryLabel}>Odometer</Text>
          <Text style={styles.rentalScheduleValue}>{odometerLabel(inspection.odometerMeters)}</Text>
        </View>
        {inspection.fuelBasisPoints !== null ? (
          <View style={styles.compactSummaryRow}>
            <Text style={styles.summaryLabel}>Fuel</Text>
            <Text style={styles.rentalScheduleValue}>{inspection.fuelBasisPoints / 100}%</Text>
          </View>
        ) : null}
        {inspection.batterySocBasisPoints !== null ? (
          <View style={styles.compactSummaryRow}>
            <Text style={styles.summaryLabel}>Battery</Text>
            <Text style={styles.rentalScheduleValue}>
              {inspection.batterySocBasisPoints / 100}%
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Evidence
        </Text>
        <Text style={[styles.body, styles.compactPostInspectionText]}>
          {inspection.media.length} inspection {inspection.media.length === 1 ? 'photo' : 'photos'}
        </Text>
        {inspection.media.length ? (
          <SecondaryAction
            inline
            label="View photos"
            onPress={() =>
              setGallery(
                inspection.media.map(({ fileAsset, perspective }) => ({
                  fileAssetId: fileAsset.id,
                  title: domainLabel(perspective),
                })),
              )
            }
          />
        ) : null}
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setGallery([])}
        visible={gallery.length > 0}
      >
        <View style={styles.conditionGallery}>
          <Pressable
            accessibilityLabel="Close inspection photos"
            accessibilityRole="button"
            hitSlop={spacing.md}
            onPress={() => setGallery([])}
            style={styles.conditionGalleryClose}
          >
            <Text style={styles.conditionGalleryCloseText}>Close</Text>
          </Pressable>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {gallery.map((item, index) => (
              <Pressable
                accessibilityLabel="Close inspection photos"
                accessibilityRole="button"
                key={`${item.fileAssetId}-${index}`}
                onPress={() => setGallery([])}
                style={[styles.conditionGalleryPage, { width: viewportWidth }]}
              >
                <Text style={styles.conditionGalleryCount}>
                  {item.title} · {index + 1} / {gallery.length}
                </Text>
                <Pressable accessible={false} onPress={() => undefined}>
                  <AuthorizedInspectionImage
                    fileAssetId={item.fileAssetId}
                    label={`${item.title} secure evidence preview`}
                    large
                  />
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function ReturnInspectionEvidence({
  inspection,
}: {
  readonly inspection: RentalDetail['inspections'][number];
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const [gallery, setGallery] = useState<
    readonly { readonly fileAssetId: string; readonly title: string }[]
  >([]);
  const conditionNotes =
    inspection.notes === 'Return inspection submitted by the renter during vehicle handover.'
      ? null
      : inspection.notes;

  return (
    <>
      <View style={styles.postInspectionCard}>
        <View style={styles.compactSummaryRow}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Return evidence
          </Text>
          <Text style={styles.summaryLabel}>Submitted by renter</Text>
        </View>
        {conditionNotes ? (
          <View style={styles.compactSummaryRow}>
            <Text style={styles.summaryLabel}>Condition notes</Text>
            <Text style={styles.rentalScheduleValue}>{conditionNotes}</Text>
          </View>
        ) : null}
        <View style={styles.compactSummaryRow}>
          <Text style={styles.summaryLabel}>Evidence</Text>
          <Text style={styles.rentalScheduleValue}>
            {inspection.media.length} {inspection.media.length === 1 ? 'photo' : 'photos'}
          </Text>
        </View>
        {inspection.media.length ? (
          <SecondaryAction
            inline
            label="View photos"
            onPress={() =>
              setGallery(
                inspection.media.map(({ fileAsset, perspective }) => ({
                  fileAssetId: fileAsset.id,
                  title: domainLabel(perspective),
                })),
              )
            }
          />
        ) : null}
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setGallery([])}
        visible={gallery.length > 0}
      >
        <View style={styles.conditionGallery}>
          <Pressable
            accessibilityLabel="Back from return photos"
            accessibilityRole="button"
            hitSlop={spacing.md}
            onPress={() => setGallery([])}
            style={styles.conditionGalleryClose}
          >
            <Text style={styles.conditionGalleryCloseText}>Back</Text>
          </Pressable>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {gallery.map((item, index) => (
              <Pressable
                accessibilityLabel="Back from return photos"
                accessibilityRole="button"
                key={`${item.fileAssetId}-${index}`}
                onPress={() => setGallery([])}
                style={[styles.conditionGalleryPage, { width: viewportWidth }]}
              >
                <Text style={styles.conditionGalleryCount}>
                  {item.title} · {index + 1} of {gallery.length}
                </Text>
                <Pressable accessible={false} onPress={() => undefined}>
                  <AuthorizedInspectionImage
                    fileAssetId={item.fileAssetId}
                    label={`${item.title} return evidence photo`}
                    large
                  />
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function InspectionEvidence({
  inspection,
  title,
}: {
  readonly inspection: RentalDetail['inspections'][number];
  readonly title: string;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const [issueGallery, setIssueGallery] = useState<
    readonly { readonly fileAssetId: string; readonly title: string }[]
  >([]);
  return (
    <>
      <View style={styles.evidenceCard}>
        <Text style={styles.cardTitle}>{title}</Text>
        {inspection.conditionDisclosureState === 'NO_KNOWN_ISSUES' ? (
          <Text style={styles.body}>No known existing issues reported by the owner.</Text>
        ) : inspection.conditionDisclosureState === 'ISSUES_REPORTED' ? (
          <View>
            <Text style={styles.cardTitle}>Vehicle condition before your rental</Text>
            <Text style={styles.body}>
              {inspection.conditionIssues?.length ?? 0} existing issues reported.
            </Text>
            {inspection.conditionIssues?.map((issue) => {
              const evidenceItems =
                issue.evidence?.map(({ inspectionMedia }) => ({
                  fileAssetId: inspectionMedia.fileAsset.id,
                  title: `${domainLabel(issue.category)} · ${domainLabel(issue.vehicleArea)}`,
                })) ?? [];
              return (
                <View
                  key={issue.id}
                  style={
                    issue.classification === 'SAFETY_CRITICAL'
                      ? styles.warningCard
                      : styles.infoCard
                  }
                >
                  <Text style={styles.cardTitle}>
                    {domainLabel(issue.category)} · {domainLabel(issue.vehicleArea)}
                  </Text>
                  <Text style={styles.body}>
                    {domainLabel(issue.classification)} · {issue.description}
                  </Text>
                  {evidenceItems.length ? (
                    <SecondaryAction
                      label={`View supporting photos (${evidenceItems.length})`}
                      onPress={() => setIssueGallery(evidenceItems)}
                    />
                  ) : null}
                  {issue.classification === 'SAFETY_CRITICAL' ? (
                    <Text style={styles.warning}>
                      Handover blocked. This condition requires maintenance or Operations review.
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : inspection.type === 'PICKUP' ? (
          <Text style={styles.body}>
            Legacy inspection — structured condition disclosure was not recorded.
          </Text>
        ) : null}
        <Text style={styles.body}>Odometer: {odometerLabel(inspection.odometerMeters)}</Text>
        {inspection.fuelBasisPoints !== null && (
          <Text style={styles.body}>Fuel: {inspection.fuelBasisPoints / 100}%</Text>
        )}
        {inspection.batterySocBasisPoints !== null && (
          <Text style={styles.body}>Battery SOC: {inspection.batterySocBasisPoints / 100}%</Text>
        )}
        {inspection.notes && <Text style={styles.body}>Condition notes: {inspection.notes}</Text>}
        {inspection.media.length ? (
          <SecondaryAction
            label={`View inspection photos (${inspection.media.length})`}
            onPress={() =>
              setIssueGallery(
                inspection.media.map(({ fileAsset, perspective }) => ({
                  fileAssetId: fileAsset.id,
                  title: domainLabel(perspective),
                })),
              )
            }
          />
        ) : null}
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setIssueGallery([])}
        visible={issueGallery.length > 0}
      >
        <View style={styles.conditionGallery}>
          <Pressable
            accessibilityLabel="Close supporting photos"
            accessibilityRole="button"
            hitSlop={spacing.md}
            onPress={() => setIssueGallery([])}
            style={styles.conditionGalleryClose}
          >
            <Text style={styles.conditionGalleryCloseText}>Close</Text>
          </Pressable>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {issueGallery.map((item, index) => (
              <Pressable
                accessibilityLabel="Close photo gallery"
                accessibilityRole="button"
                key={`${item.fileAssetId}-${index}`}
                onPress={() => setIssueGallery([])}
                style={[styles.conditionGalleryPage, { width: viewportWidth }]}
              >
                <Text style={styles.conditionGalleryCount}>{item.title}</Text>
                <Pressable accessible={false} onPress={() => undefined}>
                  <AuthorizedInspectionImage
                    fileAssetId={item.fileAssetId}
                    label={`${item.title} photo`}
                    large
                  />
                </Pressable>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function AuthorizedInspectionImage({
  fileAssetId,
  label,
  large = false,
}: {
  readonly fileAssetId: string;
  readonly label: string;
  readonly large?: boolean;
}) {
  const grant = useQuery({
    queryKey: ['inspection-media-preview', fileAssetId],
    queryFn: () =>
      apiClient.request<{ readonly contentPath: string }>(`/files/${fileAssetId}/access-grants`, {
        method: 'POST',
      }),
    staleTime: 3 * 60 * 1000,
  });
  if (!grant.data)
    return (
      <View
        style={[large ? securePhotoPreviewStyle : styles.evidenceImage, styles.evidencePlaceholder]}
      >
        <Text style={styles.progress}>{grant.isError ? 'Unavailable' : 'Loading…'}</Text>
      </View>
    );
  return (
    <Image
      accessibilityLabel={label}
      contentFit="cover"
      onError={() => void grant.refetch()}
      source={{ uri: apiClient.assetUrl(grant.data.contentPath) }}
      style={large ? securePhotoPreviewStyle : styles.evidenceImage}
    />
  );
}

function ClaimMeasuredValue({
  category,
  detail,
}: {
  readonly category: string;
  readonly detail: RentalDetail;
}) {
  const usage = detail.usageSummary;
  if (!usage) return null;
  const measured =
    category === 'EXCESS_MILEAGE'
      ? { label: 'Measured excess mileage', value: `${usage.excessDistanceKm} km` }
      : category === 'FUEL_DEFICIENCY' && usage.fuelDeficiencyBasisPoints
        ? { label: 'Measured fuel deficiency', value: `${usage.fuelDeficiencyBasisPoints / 100}%` }
        : category === 'EV_BATTERY_DEFICIENCY' && usage.socDeficiencyBasisPoints
          ? {
              label: 'Measured battery deficiency',
              value: `${usage.socDeficiencyBasisPoints / 100}%`,
            }
          : category === 'LATE_RETURN'
            ? {
                label: 'Measured late return',
                value: `${Math.ceil(usage.lateDurationSeconds / 60)} min`,
              }
            : null;
  if (!measured) return null;
  return (
    <View accessibilityLabel={`${measured.label}: ${measured.value}`} style={styles.measuredClaim}>
      <Text style={styles.summaryLabel}>{measured.label}</Text>
      <Text style={styles.rentalScheduleValue}>{measured.value}</Text>
    </View>
  );
}

function UsageSummary({
  audience,
  detail,
}: {
  readonly audience: 'owner' | 'renter';
  readonly detail: RentalDetail;
}) {
  const usage = detail.usageSummary;
  if (!usage) return <Text style={styles.body}>Return evidence is under review.</Text>;
  return (
    <>
      <View style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Measured usage
        </Text>
        <RentalScheduleRow label="Distance travelled" value={`${usage.distanceTravelledKm} km`} />
        <RentalScheduleRow
          label="Included mileage"
          value={usage.includedDistanceKm === null ? 'Unlimited' : `${usage.includedDistanceKm} km`}
        />
        <RentalScheduleRow label="Excess mileage" value={`${usage.excessDistanceKm} km`} />
        <RentalScheduleRow
          label="Late return"
          value={`${Math.ceil(usage.lateDurationSeconds / 60)} min`}
        />
      </View>
      <View style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Claim window
        </Text>
        <RentalScheduleRow
          label="Ends"
          value={detail.claimDeadlineAt ? dateTimeLabel(detail.claimDeadlineAt) : '—'}
        />
        <Text style={styles.body}>
          {audience === 'owner'
            ? 'Submit any eligible return claims before this deadline.'
            : 'The owner may submit eligible return claims before this deadline.'}
        </Text>
      </View>
    </>
  );
}

function RenterPostReturnStatus({
  claimWindowOpen,
  detail,
}: {
  readonly claimWindowOpen: boolean;
  readonly detail: RentalDetail;
}) {
  if (detail.postReturnClaims.length) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.postInspectionCard}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Return claim
        </Text>
        {detail.postReturnClaims.map((claim) => (
          <View key={claim.id} style={styles.renterClaimSummary}>
            <View style={styles.renterClaimCopy}>
              <Text style={styles.rentalScheduleValue}>{domainLabel(claim.category)}</Text>
              <ClaimMeasuredValue category={claim.category} detail={detail} />
            </View>
            <StatusBadge label={renterClaimStatusLabel(claim.status)} />
          </View>
        ))}
        <Text style={styles.body}>We’ll notify you when the claim review is complete.</Text>
      </View>
    );
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.postInspectionCard}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {claimWindowOpen ? 'Next step' : 'Return complete'}
      </Text>
      <Text style={styles.rentalScheduleValue}>
        {claimWindowOpen
          ? 'No additional charges have been submitted.'
          : 'The claim window has closed and no return claim was submitted.'}
      </Text>
      {claimWindowOpen ? (
        <Text style={styles.body}>
          Your return is complete. We’ll notify you if the owner submits a claim before the
          deadline.
        </Text>
      ) : null}
    </View>
  );
}

function renterClaimStatusLabel(status: string) {
  const labels: Record<string, string> = {
    DRAFT: 'Being prepared',
    PAYMENT_PENDING: 'Payment pending',
    RENTER_REVIEW: 'Needs your review',
    RESOLVED: 'Resolved',
    SUBMITTED: 'Submitted',
    UNDER_ADMIN_REVIEW: 'Under review',
    WITHDRAWN: 'Withdrawn',
  };
  return labels[status] ?? 'Under review';
}

function OperationsResolutionStatus({ outcome }: { readonly outcome: string | undefined }) {
  if (outcome === 'HANDOVER_MAY_RESUME')
    return (
      <Text style={styles.success}>
        CarShare reviewed the issue. Handover may continue through the normal pickup-code flow.
      </Text>
    );
  if (outcome === 'BOOKING_CANCELLATION_REQUIRED')
    return (
      <Text style={styles.warning}>
        CarShare reviewed the issue. This handover cannot continue. Follow the booking support
        guidance.
      </Text>
    );
  if (outcome === 'MAINTENANCE_REQUIRED')
    return (
      <Text style={styles.warning}>
        Handover blocked. The vehicle requires maintenance before it can be rented.
      </Text>
    );
  return (
    <Text style={styles.warning}>
      {outcome === 'SUPPORT_FOLLOW_UP_REQUIRED'
        ? 'Further support review is required. Handover stays paused.'
        : 'Waiting for CarShare review. Handover stays paused.'}
    </Text>
  );
}

function HandoverTravelSummary({
  address,
  label,
  status,
}: {
  readonly address: ContractLocation | null;
  readonly label: string;
  readonly status: string | null;
}) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Text style={styles.body}>Progress: {travelLabel(status)}</Text>
      {address && <Text style={styles.body}>Contractual address: {locationLabel(address)}</Text>}
    </View>
  );
}

type OwnerTravelOperation =
  'start-preparing' | 'start-on-way' | 'start-arrived' | 'return-on-way' | 'return-arrived';

function OwnerTravelActions({
  actionsEnabled = true,
  address,
  mutate,
  phase,
  status,
}: {
  readonly actionsEnabled?: boolean;
  readonly address: ContractLocation | null;
  readonly mutate: (operation: OwnerTravelOperation) => void;
  readonly phase: 'start' | 'return';
  readonly status: string | null;
}) {
  const next: OwnerTravelOperation | null =
    phase === 'start'
      ? status === null
        ? 'start-preparing'
        : status === 'PREPARING'
          ? 'start-on-way'
          : status === 'ON_THE_WAY'
            ? 'start-arrived'
            : null
      : status === null
        ? 'return-on-way'
        : status === 'ON_THE_WAY'
          ? 'return-arrived'
          : null;
  return (
    <View style={styles.actionCard}>
      <Text style={styles.actionEyebrow}>{phase === 'start' ? 'Delivery' : 'Collection'}</Text>
      <Text style={styles.cardTitle}>Progress: {travelLabel(status)}</Text>
      {address && <Text style={styles.body}>Contractual address: {locationLabel(address)}</Text>}
      {actionsEnabled && next && (
        <Action
          label={
            next.endsWith('preparing')
              ? 'Start preparing'
              : next.endsWith('on-way')
                ? 'Mark on the way'
                : 'Mark arrived'
          }
          onPress={() => mutate(next)}
        />
      )}
      {actionsEnabled && !next && (
        <Text style={styles.success}>Arrived · continue the existing handover steps.</Text>
      )}
    </View>
  );
}

function travelLabel(status: string | null) {
  if (!status) return 'Scheduled';
  return status === 'ON_THE_WAY' ? 'On the way' : domainLabel(status);
}

function rentalTripSummary(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startTime = timeLabel(startDate);
  const endTime = timeLabel(endDate);
  const time = startTime === endTime ? startTime : `${startTime}–${endTime}`;
  return `${tripDateSummary(startDate, endDate, { alwaysShowYear: true })} · ${time}`;
}

function collectionLocationLabel(location: ContractLocation) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const addressParts = (location.addressLine1 ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const cityIndex = addressParts.findIndex((part) => normalize(part) === normalize(location.city));
  const localityParts =
    cityIndex >= 0 && addressParts[cityIndex + 1]
      ? addressParts.slice(cityIndex, cityIndex + 2)
      : [location.city, location.province];

  return localityParts
    .filter(
      (part, index, parts) =>
        parts.findIndex((candidate) => normalize(candidate) === normalize(part)) === index,
    )
    .join(', ');
}

function OwnerCollectionStatus({ detail }: { readonly detail: RentalDetail }) {
  const status = detail.handoverTravel.returnStatus;
  return (
    <View style={[styles.rentalSummaryCard, styles.ownerCollectionCard]}>
      <View style={styles.rentalSummaryHeader}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Owner collection
        </Text>
        <StatusBadge label={travelLabel(status)} />
      </View>
      <View style={styles.rentalScheduleRows}>
        {detail.fulfillment.endLocation ? (
          <RentalScheduleRow
            label="Collection location"
            value={collectionLocationLabel(detail.fulfillment.endLocation)}
          />
        ) : null}
        <RentalScheduleRow label="Scheduled collection" value={dateTimeLabel(detail.rentalEnd)} />
      </View>
    </View>
  );
}

function UpcomingDeliveryStatus({ detail }: { readonly detail: RentalDetail }) {
  const status = detail.handoverTravel.startStatus;
  return (
    <View style={styles.rentalSummaryCard}>
      <View style={styles.rentalSummaryHeader}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          Delivery
        </Text>
        <StatusBadge label={travelLabel(status)} />
      </View>
      <View style={styles.rentalScheduleRows}>
        {detail.fulfillment.startLocation ? (
          <RentalScheduleRow
            label="Delivery address"
            value={locationLabel(detail.fulfillment.startLocation)}
          />
        ) : null}
        <RentalScheduleRow label="Scheduled handover" value={dateTimeLabel(detail.rentalStart)} />
      </View>
    </View>
  );
}

function upcomingNextStepMessage(detail: RentalDetail) {
  if (detail.fulfillment.startMethod !== 'OWNER_DELIVERY') {
    return `Your booking is confirmed. Be ready at the pickup location by ${dateTimeLabel(detail.rentalStart)}.`;
  }
  if (detail.handoverTravel.startStatus === 'ON_THE_WAY') {
    return 'Your vehicle is on the way.';
  }
  if (detail.handoverTravel.startStatus === 'ARRIVED') {
    return 'The owner has arrived. Continue with the pickup handover.';
  }
  if (detail.handoverTravel.startStatus === 'PREPARING') {
    return 'The owner is preparing your vehicle for delivery.';
  }
  return `Be ready at the delivery location by ${timeLabel(detail.rentalStart)}.`;
}

function locationLabel(location: ContractLocation) {
  return [
    location.addressLine1,
    location.barangay,
    location.city,
    location.province,
    location.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
}

function PickupHandoverReportResponse({
  detail,
  reference,
}: {
  readonly detail: RentalDetail;
  readonly reference: string;
}) {
  const client = useQueryClient();
  const report = detail.pickupHandoverReport!;
  const action = useMutation({
    mutationFn: (input: { decision: 'CONFIRMED' | 'NOT_RECEIVED' }) =>
      apiClient.request(`/bookings/${reference}/rental/pickup/handover-report/respond`, {
        body: JSON.stringify(input),
        method: 'POST',
      }),
    onSuccess: () => invalidateRentalQueries(client, reference),
  });
  return (
    <View style={styles.actionCard}>
      <Text style={styles.actionEyebrow}>Confirmation required</Text>
      <Text style={styles.cardTitle}>Did you receive the vehicle at this time?</Text>
      <Text style={styles.body}>{dateTimeLabel(report.reportedPhysicalHandoverAt)}</Text>
      <Text style={styles.body}>
        The owner reported this physical handover after it took place. Confirm only if the date and
        time are correct.
      </Text>
      <Action
        disabled={action.isPending}
        label={action.isPending ? 'Submitting…' : 'Confirm date and time'}
        onPress={() => action.mutate({ decision: 'CONFIRMED' })}
      />
      <SecondaryAction
        disabled={action.isPending}
        label="I did not receive the vehicle"
        onPress={() =>
          Alert.alert(
            'Report vehicle not received?',
            'Pickup activation will be paused for Operations review.',
            [
              { text: 'Go back', style: 'cancel' },
              {
                text: 'Submit report',
                style: 'destructive',
                onPress: () => action.mutate({ decision: 'NOT_RECEIVED' }),
              },
            ],
          )
        }
      />
      {action.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error.message}
        </Text>
      )}
    </View>
  );
}

type OverdueRecoveryScope = 'START' | 'RETURN' | 'BOTH';

function overdueRecoveryPresentation(scope: OverdueRecoveryScope) {
  if (scope === 'RETURN') {
    return {
      alertTitle: 'Complete return without inspection?',
      completedAction: 'Complete return',
      completingAction: 'Completing…',
      confirmedTitle: 'Return report confirmed',
      errorMessage: 'We couldn’t complete the return. Review the time and try again.',
      helper:
        'Use this only if the vehicle was already returned without completing the inspection.',
      preSubmitAction: 'Complete return without inspection',
      recordedTitle: 'Return recorded',
      renterConfirmAction: 'Confirm return report',
      renterEyebrow: 'Return exception',
      renterExplanation: 'The return was recorded without completing the normal inspection.',
      renterTitle: 'Return reported without inspection',
      sheetTitle: 'Complete return without inspection',
      warningTitle: 'Return overdue',
    } as const;
  }
  if (scope === 'BOTH') {
    return {
      alertTitle: 'Complete handover recovery without inspections?',
      completedAction: 'Complete handover recovery',
      completingAction: 'Completing…',
      confirmedTitle: 'Handover report confirmed',
      errorMessage: 'We couldn’t complete the recovery. Review the times and try again.',
      helper:
        'Use this only if pickup and return both happened without completing the normal inspections.',
      preSubmitAction: 'Complete handover recovery without inspections',
      recordedTitle: 'Handover recorded',
      renterConfirmAction: 'Confirm handover report',
      renterEyebrow: 'Handover exception',
      renterExplanation:
        'Pickup and return were recorded without completing the normal inspections.',
      renterTitle: 'Handover reported without inspections',
      sheetTitle: 'Complete handover recovery without inspections',
      warningTitle: 'Handover overdue',
    } as const;
  }
  return {
    alertTitle: 'Complete handover without inspection?',
    completedAction: 'Complete handover',
    completingAction: 'Completing…',
    confirmedTitle: 'Handover report confirmed',
    errorMessage: 'We couldn’t complete the handover. Review the time and try again.',
    helper:
      'Use this only if the vehicle was already handed over without completing the inspection.',
    preSubmitAction: 'Complete handover without inspection',
    recordedTitle: 'Handover recorded',
    renterConfirmAction: 'Confirm handover report',
    renterEyebrow: 'Handover exception',
    renterExplanation: 'The handover was recorded without completing the normal pickup inspection.',
    renterTitle: 'Handover reported without inspection',
    sheetTitle: 'Complete handover without inspection',
    warningTitle: 'Handover overdue',
  } as const;
}

function OwnerOverdueRecoverySubmittedStatus({
  recovery,
}: {
  readonly recovery: NonNullable<RentalDetail['overdueHandoverRecovery']>;
}) {
  const disputed = recovery.response?.decision === 'DISPUTED';
  const presentation = overdueRecoveryPresentation(recovery.scope);
  return (
    <View accessibilityLiveRegion="polite" style={styles.recoverySubmittedCard}>
      <View style={styles.rentalSummaryHeader}>
        <Text accessibilityRole="header" style={styles.cardTitle}>
          {presentation.recordedTitle}
        </Text>
        <StatusBadge label={disputed ? 'Operations review' : 'Awaiting renter'} />
      </View>
      <View style={styles.rentalScheduleRows}>
        {recovery.reportedPickupAt ? (
          <RentalScheduleRow
            label="Actual handover"
            value={dateTimeLabel(recovery.reportedPickupAt)}
          />
        ) : null}
        {recovery.reportedReturnAt ? (
          <RentalScheduleRow
            label="Actual return"
            value={dateTimeLabel(recovery.reportedReturnAt)}
          />
        ) : null}
        {!disputed ? (
          <RentalScheduleRow
            label="Renter response due"
            value={dateTimeLabel(recovery.responseDeadlineAt)}
          />
        ) : null}
      </View>
      <Text style={styles.recoverySubmittedHelper}>
        {disputed
          ? 'The renter disputed the reported time. CarShare Operations will review it.'
          : 'The renter can confirm or dispute the reported time. No response accepts the report automatically.'}
      </Text>
    </View>
  );
}

function OwnerOverdueRecoveryAction({
  detail,
  reference,
  scope,
}: {
  readonly detail: RentalDetail;
  readonly reference: string;
  readonly scope: OverdueRecoveryScope;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const initialNow = new Date();
  const [pickupAt, setPickupAt] = useState(
    new Date(Math.min(initialNow.getTime(), new Date(detail.rentalEnd).getTime() - 1)),
  );
  const [returnAt, setReturnAt] = useState(initialNow);
  const [maximumDate, setMaximumDate] = useState(initialNow);
  const [contentHeight, setContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bottomAllowance = Math.max(safeArea.bottom, spacing.md);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: 0,
      }),
    [contentHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(520, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  useEffect(() => {
    if (!open || contentHeight <= 0) return;
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [contentHeight, measuredLayout.height, open, sheetHeight]);
  const openSheet = () => {
    const now = new Date();
    setMaximumDate(now);
    setPickupAt(new Date(Math.min(now.getTime(), new Date(detail.rentalEnd).getTime() - 1)));
    setReturnAt(now);
    setContentHeight(0);
    setOpen(true);
  };
  const timestampError = overdueTimestampError({
    maximumDate,
    minimumPickupDate: new Date(detail.rentalStart),
    minimumReturnDate:
      scope === 'BOTH' ? pickupAt : new Date(detail.actualPickupAt ?? detail.rentalStart),
    pickupAt,
    returnAt,
    scope,
  });
  const action = useMutation({
    mutationFn: () =>
      apiClient.request<RentalDetail>(
        `/owner/bookings/${reference}/rental/overdue-handover-recovery`,
        {
          method: 'POST',
          body: JSON.stringify({
            acknowledged: true,
            acknowledgementVersion: 'OVERDUE_HANDOVER_RECOVERY_V1',
            scope,
            ...(scope !== 'RETURN' ? { reportedPickupAt: pickupAt.toISOString() } : {}),
            ...(scope !== 'START' ? { reportedReturnAt: returnAt.toISOString() } : {}),
          }),
        },
      ),
    onSuccess: (result) => {
      client.setQueryData(['owner-rental', reference], result);
      setOpen(false);
      invalidateRentalQueries(client, reference);
    },
  });
  const presentation = overdueRecoveryPresentation(scope);
  return (
    <View accessibilityRole="alert" style={[styles.overdueCard, styles.compactOverdueCard]}>
      <Text style={styles.cardTitle}>{presentation.warningTitle}</Text>
      {scope !== 'START' ? <Text style={styles.overdueStatus}>Payout remains pending</Text> : null}
      <Text style={styles.body}>
        {scope === 'RETURN'
          ? 'Complete the return and record the actual transfer time.'
          : 'Complete the handover and record the actual transfer time.'}
      </Text>
      <Text style={styles.overdueDetail}>
        The renter is notified and has 24 hours to disagree with the reported time.
      </Text>
      <SecondaryAction inline label={presentation.preSubmitAction} onPress={openSheet} />
      <Modal
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.exceptionModalRoot}>
          <View style={styles.exceptionBackdrop} />
          <Reanimated.View style={[styles.exceptionSheet, animatedSheetStyle]}>
            <ScrollView
              contentContainerStyle={[
                styles.exceptionSheetContent,
                { paddingBottom: bottomAllowance },
              ]}
              onContentSizeChange={(_width, height) => setContentHeight(height)}
              scrollEnabled={measuredLayout.scrollEnabled}
              showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
            >
              <BackControl label="Cancel" onPress={() => setOpen(false)} />
              <Text accessibilityRole="header" style={styles.exceptionTitle}>
                {presentation.sheetTitle}
              </Text>
              <Text style={styles.exceptionHelper}>{presentation.helper}</Text>
              <View style={styles.recoveryFormSurface}>
                {scope !== 'RETURN' && (
                  <HandoverDateTimeControl
                    dateLabel="Date of handover"
                    maximumDate={scope === 'BOTH' ? returnAt : maximumDate}
                    minimumDate={new Date(detail.rentalStart)}
                    onChange={setPickupAt}
                    timeLabel="Time of handover"
                    value={pickupAt}
                  />
                )}
                {scope !== 'START' && (
                  <HandoverDateTimeControl
                    dateLabel="Date of return"
                    maximumDate={maximumDate}
                    minimumDate={scope === 'BOTH' ? pickupAt : new Date(detail.actualPickupAt!)}
                    onChange={setReturnAt}
                    timeLabel="Time of return"
                    value={returnAt}
                  />
                )}
              </View>
              {timestampError ? (
                <Text accessibilityRole="alert" style={styles.inlineError}>
                  {timestampError}
                </Text>
              ) : null}
              <Text style={styles.exceptionConsequence}>
                The renter will be notified and has 24 hours to confirm or dispute the reported
                time.
              </Text>
              <Action
                disabled={action.isPending || Boolean(timestampError)}
                label={
                  action.isPending ? presentation.completingAction : presentation.completedAction
                }
                onPress={() =>
                  Alert.alert(
                    presentation.alertTitle,
                    'No inspection measurements or condition baseline will be created.',
                    [
                      { text: 'Go back', style: 'cancel' },
                      {
                        text: presentation.completedAction,
                        style: 'destructive',
                        onPress: () => action.mutate(),
                      },
                    ],
                  )
                }
              />
              {action.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {presentation.errorMessage}
                </Text>
              )}
            </ScrollView>
          </Reanimated.View>
        </View>
      </Modal>
    </View>
  );
}

function HandoverDateTimeControl({
  dateLabel,
  maximumDate,
  minimumDate,
  onChange,
  timeLabel,
  value,
}: {
  readonly dateLabel: string;
  readonly maximumDate: Date;
  readonly minimumDate: Date;
  readonly onChange: (value: Date) => void;
  readonly timeLabel: string;
  readonly value: Date;
}) {
  const selectedDate = localDateKey(value);
  const timeMinimum = sameLocalDate(value, minimumDate) ? minimumDate : undefined;
  const timeMaximum = sameLocalDate(value, maximumDate) ? maximumDate : undefined;

  return (
    <View style={styles.handoverDateTimeControl}>
      <DateOnlyField
        label={dateLabel}
        maximumDate={maximumDate}
        minimumDate={minimumDate}
        onChange={(date) =>
          onChange(clampDateTime(mergeLocalDate(value, date), minimumDate, maximumDate))
        }
        value={selectedDate}
      />
      <DateTimeField
        compact
        label={timeLabel}
        {...(timeMaximum ? { maximumDate: timeMaximum } : {})}
        {...(timeMinimum ? { minimumDate: timeMinimum } : {})}
        mode="time"
        onChange={(time) =>
          onChange(clampDateTime(mergeLocalTime(value, time), minimumDate, maximumDate))
        }
        value={value}
      />
    </View>
  );
}

function ConditionDisclosureOption({
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
      style={[styles.conditionChoice, selected && styles.conditionChoiceSelected]}
    >
      {selected ? <Icon color={colors.onPrimary} name="checkmark" size={16} /> : null}
      <Text style={[styles.conditionChoiceText, selected && styles.conditionChoiceTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

function overdueTimestampError({
  maximumDate,
  minimumPickupDate,
  minimumReturnDate,
  pickupAt,
  returnAt,
  scope,
}: {
  readonly maximumDate: Date;
  readonly minimumPickupDate: Date;
  readonly minimumReturnDate: Date;
  readonly pickupAt: Date;
  readonly returnAt: Date;
  readonly scope: 'START' | 'RETURN' | 'BOTH';
}) {
  if (scope !== 'RETURN' && (pickupAt < minimumPickupDate || pickupAt > maximumDate)) {
    return 'Choose a handover time within the allowed period.';
  }
  if (scope !== 'START' && (returnAt < minimumReturnDate || returnAt > maximumDate)) {
    return 'Return time must be after handover and cannot be in the future.';
  }
  return null;
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}

function sameLocalDate(left: Date, right: Date) {
  return localDateKey(left) === localDateKey(right);
}

function mergeLocalDate(current: Date, date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(current);
  next.setFullYear(year!, month! - 1, day!);
  return next;
}

function mergeLocalTime(current: Date, time: Date) {
  const next = new Date(current);
  next.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return next;
}

function clampDateTime(value: Date, minimumDate: Date, maximumDate: Date) {
  if (value < minimumDate) return new Date(minimumDate);
  if (value > maximumDate) return new Date(maximumDate);
  return value;
}

function OverdueRecoveryResponse({
  detail,
  reference,
}: {
  readonly detail: RentalDetail;
  readonly reference: string;
}) {
  const client = useQueryClient();
  const recovery = detail.overdueHandoverRecovery!;
  const [reason, setReason] = useState('');
  const [disagreeing, setDisagreeing] = useState(false);
  const action = useMutation({
    mutationFn: (decision: 'CONFIRMED' | 'DISPUTED') =>
      apiClient.request<RentalDetail>(
        `/bookings/${reference}/rental/overdue-handover-recovery/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, ...(decision === 'DISPUTED' ? { reason } : {}) }),
        },
      ),
    onSuccess: (result) => {
      client.setQueryData(['rental', reference], result);
      invalidateRentalQueries(client, reference);
    },
  });
  const presentation = overdueRecoveryPresentation(recovery.scope);
  if (recovery.response)
    return (
      <View style={styles.warningCard}>
        <Text style={styles.cardTitle}>
          {recovery.response.decision === 'DISPUTED'
            ? 'Disagreement sent to Operations'
            : presentation.confirmedTitle}
        </Text>
        {recovery.response.reason && <Text style={styles.body}>{recovery.response.reason}</Text>}
      </View>
    );
  return (
    <View accessibilityLiveRegion="polite" style={styles.recoveryResponseCard}>
      <Text style={styles.actionEyebrow}>{presentation.renterEyebrow}</Text>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {presentation.renterTitle}
      </Text>
      <View style={styles.rentalScheduleRows}>
        {recovery.reportedPickupAt ? (
          <RentalScheduleRow
            label="Reported handover"
            value={dateTimeLabel(recovery.reportedPickupAt)}
          />
        ) : null}
        {recovery.reportedReturnAt ? (
          <RentalScheduleRow
            label="Reported return"
            value={dateTimeLabel(recovery.reportedReturnAt)}
          />
        ) : null}
        <RentalScheduleRow label="Respond by" value={dateTimeLabel(recovery.responseDeadlineAt)} />
      </View>
      <View style={styles.recoveryResponseExplanation}>
        <Text style={styles.body}>{presentation.renterExplanation}</Text>
        <Text style={styles.recoverySubmittedHelper}>
          Limited evidence is available because the normal inspection was skipped.
        </Text>
      </View>
      <View style={styles.recoveryResponseActions}>
        <Action
          disabled={action.isPending}
          label={presentation.renterConfirmAction}
          onPress={() => action.mutate('CONFIRMED')}
        />
        {!disagreeing ? (
          <SecondaryAction label="Dispute report" onPress={() => setDisagreeing(true)} />
        ) : (
          <View>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Explain what is incorrect"
              placeholderTextColor={colors.placeholder}
              multiline
            />
            <SecondaryAction
              disabled={action.isPending || reason.trim().length < 3}
              label="Send disagreement to Operations"
              onPress={() => action.mutate('DISPUTED')}
            />
          </View>
        )}
      </View>
      <Text style={styles.recoveryResponseFootnote}>
        If you do not respond by the deadline, the report is accepted automatically.
      </Text>
      {action.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error.message}
        </Text>
      )}
    </View>
  );
}

function EvidenceWaiverAction({
  detail,
  ownerInitiatedReturn = false,
  reference,
  phase,
}: {
  readonly detail?: RentalDetail;
  readonly ownerInitiatedReturn?: boolean;
  readonly reference: string;
  readonly phase: 'START' | 'RETURN';
}) {
  const client = useQueryClient();
  const scheduledStart = detail ? new Date(detail.pickupWindowStart ?? detail.rentalStart) : null;
  const deliveryArrival = detail?.handoverTravel.events.find(
    ({ phase: eventPhase, status }) => eventPhase === 'START' && status === 'ARRIVED',
  )?.occurredAt;
  const collectionArrival = detail?.handoverTravel.events.find(
    ({ phase: eventPhase, status }) => eventPhase === 'RETURN' && status === 'ARRIVED',
  )?.occurredAt;
  const returnMinimum = detail?.actualPickupAt
    ? new Date(
        Math.max(
          new Date(detail.actualPickupAt).getTime(),
          collectionArrival
            ? new Date(collectionArrival).getTime()
            : new Date(detail.actualPickupAt).getTime(),
        ),
      )
    : null;
  const minimumReportedAt =
    phase === 'RETURN' && returnMinimum
      ? returnMinimum
      : scheduledStart
        ? new Date(
            Math.max(
              scheduledStart.getTime(),
              deliveryArrival ? new Date(deliveryArrival).getTime() : scheduledStart.getTime(),
            ),
          )
        : new Date();
  const [maximumReportedAt, setMaximumReportedAt] = useState(() =>
    phase === 'START' && detail
      ? new Date(Math.min(Date.now(), new Date(detail.rentalEnd).getTime() - 1))
      : new Date(),
  );
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportedAt, setReportedAt] = useState(() =>
    maximumReportedAt >= minimumReportedAt ? maximumReportedAt : minimumReportedAt,
  );
  const action = useMutation({
    mutationFn: () =>
      apiClient.request(
        `/${phase === 'START' || ownerInitiatedReturn ? 'owner/' : ''}bookings/${reference}/rental/${phase === 'START' ? 'pickup' : 'return'}/evidence-waiver`,
        {
          method: 'POST',
          body: JSON.stringify({
            acknowledged: true,
            acknowledgementVersion: HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION,
            reportedPhysicalHandoverAt: reportedAt.toISOString(),
          }),
        },
      ),
    onSuccess: () => {
      setShowReportForm(false);
      invalidateRentalQueries(client, reference);
    },
  });
  return (
    <View>
      {showReportForm && (
        <View style={styles.actionCard}>
          <Text style={styles.cardTitle}>
            {phase === 'START'
              ? 'When was the vehicle handed to the renter?'
              : 'When was the vehicle returned to the owner?'}
          </Text>
          <Text style={styles.body}>
            This records a participant-reported time. It does not create inspection evidence or
            change the booking dates or price.
            {phase === 'START'
              ? ' The renter must confirm it.'
              : ' The owner must still confirm physical receipt.'}
          </Text>
          <DateTimeField
            label="Physical handover date and time"
            maximumDate={maximumReportedAt}
            minimumDate={minimumReportedAt}
            onChange={setReportedAt}
            value={reportedAt}
          />
          <Action
            disabled={
              action.isPending || reportedAt < minimumReportedAt || reportedAt > maximumReportedAt
            }
            label={action.isPending ? 'Submitting…' : 'Continue without inspection'}
            onPress={() =>
              Alert.alert(
                'Confirm reported handover time?',
                `${dateTimeLabel(reportedAt.toISOString())}\n\n${
                  phase === 'START'
                    ? 'The renter must confirm this time before a pickup code can be issued.'
                    : 'The owner must still confirm physical receipt before the Return is completed.'
                }`,
                [
                  { text: 'Go back', style: 'cancel' },
                  { text: 'Submit report', onPress: () => action.mutate() },
                ],
              )
            }
          />
          <SecondaryAction label="Cancel" onPress={() => setShowReportForm(false)} />
        </View>
      )}
      <SecondaryAction
        disabled={action.isPending || showReportForm}
        label="Complete without inspection"
        onPress={() => {
          Keyboard.dismiss();
          if (phase === 'START') {
            Alert.alert(
              'Complete without inspection?',
              'CarShare strongly recommends documenting the vehicle before handing it to the renter.' +
                '\n\nIf you continue without this evidence, CarShare may have limited ability to verify the vehicle’s condition or evaluate later damage or condition disputes.' +
                '\n\nYou must report when the physical handover took place, and the renter must confirm that time before a pickup code can be issued.',
              [
                { text: 'Go back and complete inspection', style: 'cancel' },
                {
                  text: 'Continue without inspection',
                  style: 'destructive',
                  onPress: () => {
                    const maximum = detail
                      ? new Date(Math.min(Date.now(), new Date(detail.rentalEnd).getTime() - 1))
                      : new Date();
                    setMaximumReportedAt(maximum);
                    setReportedAt(maximum >= minimumReportedAt ? maximum : minimumReportedAt);
                    setShowReportForm(true);
                  },
                },
              ],
            );
            return;
          }
          Alert.alert(
            'Complete without inspection?',
            'CarShare strongly recommends documenting the vehicle before custody returns to the owner.' +
              '\n\nIf you continue without this evidence, CarShare may have limited ability to verify the vehicle’s condition or evaluate later damage or condition disputes.' +
              (ownerInitiatedReturn
                ? '\n\nThe renter will be notified and can report a disagreement in the app.'
                : '\n\nThe owner must still confirm that the vehicle was received.'),
            [
              { text: 'Go back and complete inspection', style: 'cancel' },
              {
                text: 'Continue without inspection',
                style: 'destructive',
                onPress: () => {
                  const maximum = new Date();
                  setMaximumReportedAt(maximum);
                  setReportedAt(maximum >= minimumReportedAt ? maximum : minimumReportedAt);
                  setShowReportForm(true);
                },
              },
            ],
          );
        }}
      />
      {action.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error.message}
        </Text>
      )}
    </View>
  );
}

function WaivedReturnReceiptAction({ reference }: { readonly reference: string }) {
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/bookings/${reference}/rental/return/receipt`, {
        method: 'POST',
        body: JSON.stringify({ vehicleReceived: true }),
      }),
    onSuccess: () => invalidateRentalQueries(client, reference),
  });
  return (
    <View>
      <Action
        disabled={action.isPending}
        label="Confirm vehicle received"
        onPress={() =>
          Alert.alert(
            'Confirm vehicle receipt?',
            'Confirm only if you have physically received the vehicle. Inspection evidence was waived.',
            [
              { text: 'Go back', style: 'cancel' },
              { text: 'Confirm receipt', onPress: () => action.mutate() },
            ],
          )
        }
      />
      {action.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {action.error.message}
        </Text>
      )}
    </View>
  );
}

function EvidenceWaiverWarnings({ detail }: { readonly detail: RentalDetail }) {
  return (
    <>
      {(['start', 'return'] as const).map((phase) =>
        detail.workflowCompliance?.[phase].evidenceOutcome === 'WAIVED' ? (
          <View key={phase} style={styles.warningCard}>
            <Text style={styles.cardTitle}>
              {phase === 'start'
                ? detail.actualPickupAt
                  ? 'Handover completed without inspection evidence'
                  : 'Inspection evidence waived by owner'
                : detail.actualReturnAt
                  ? 'Return completed without inspection evidence'
                  : 'Return inspection evidence waived by renter'}
            </Text>
            <Text style={styles.body}>
              No complete CarShare condition record was created for this{' '}
              {phase === 'start' ? 'handover' : 'return'}. This may limit evidence available for
              later condition or damage disputes.
            </Text>
          </View>
        ) : null,
      )}
    </>
  );
}

function RentalScheduleRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.rentalScheduleRow}>
      <Text style={styles.rentalScheduleLabel}>{label}</Text>
      <Text style={styles.rentalScheduleValue}>{value}</Text>
    </View>
  );
}

function RentalVehicleReadings({
  inspection,
  title = 'Vehicle readings',
}: {
  readonly inspection: RentalDetail['inspections'][number];
  readonly title?: string;
}) {
  return (
    <View style={styles.postInspectionCard}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      <RentalScheduleRow label="Odometer" value={odometerLabel(inspection.odometerMeters)} />
      {inspection.fuelBasisPoints !== null ? (
        <RentalScheduleRow label="Fuel" value={`${inspection.fuelBasisPoints / 100}%`} />
      ) : null}
      {inspection.batterySocBasisPoints !== null ? (
        <RentalScheduleRow label="Battery" value={`${inspection.batterySocBasisPoints / 100}%`} />
      ) : null}
    </View>
  );
}

function renterNextStepMessage(
  status: string,
  state: {
    readonly hasPickupCode: boolean;
    readonly hasPickupInspection: boolean;
    readonly pickupHandoverConfirmed: boolean;
    readonly hasReturnInspection: boolean;
    readonly pickupReviewDecision: string | undefined;
    readonly returnHandoverReady: boolean;
    readonly returnInspectionStarted: boolean;
    readonly startWaived: boolean;
  },
) {
  if (status === 'READY_FOR_PICKUP') {
    if (state.hasPickupCode) return 'Show the pickup code to the owner during handover.';
    if (state.pickupHandoverConfirmed)
      return 'Get your pickup code when you are ready to receive the vehicle.';
    if (state.startWaived) return 'Waiting for the owner to report the pickup handover.';
    if (!state.hasPickupInspection) return 'Waiting for the owner to complete pickup inspection.';
    if (state.pickupReviewDecision === 'DISAGREED')
      return 'Resolve the reported condition difference before pickup.';
    if (state.pickupReviewDecision === 'AGREED' && !state.hasPickupCode)
      return 'Get your pickup code when you are ready to receive the vehicle.';
    return 'Review the vehicle condition recorded by the owner.';
  }
  if (status === 'ACTIVE') return 'Your rental is in progress. Start the return when ready.';
  if (status === 'RETURN_PENDING') {
    if (state.hasReturnInspection) return 'Waiting for the owner to confirm vehicle receipt.';
    if (!state.returnHandoverReady) return 'Waiting for the owner to arrive for collection.';
    if (state.returnInspectionStarted) return 'Complete the return inspection and handover.';
    return 'Complete the return inspection when you hand back the vehicle.';
  }
  if (status === 'RETURNED') return 'Your return is being finalized.';
  if (status === 'COMPLETED') return 'Your trip is complete.';
  return `Your booking is ${friendlyStatus(status).toLowerCase()}.`;
}

function Action({
  label,
  onPress,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
function SecondaryAction({
  compact = false,
  inline = false,
  disabled = false,
  label,
  onPress,
}: {
  readonly compact?: boolean;
  readonly inline?: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[
        styles.secondary,
        compact && styles.secondaryCompact,
        inline && styles.secondaryInline,
        disabled && styles.disabled,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      onPress={onPress}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}
function friendlyStatus(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Rental in progress',
    COMPLETED: 'Completed',
    CONFIRMED: 'Upcoming',
    READY_FOR_PICKUP: 'Ready for pickup',
    RETURNED: 'Returned · claim window',
    RETURN_PENDING: 'Return pending',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function odometerLabel(meters: string | null | undefined) {
  if (!meters) return '—';
  return `${(Number(meters) / 1000).toLocaleString('en-PH', { maximumFractionDigits: 1 })} km`;
}

function addCapturedFile(
  current: Record<string, CapturedFile[]>,
  perspective: string,
  file: CapturedFile,
) {
  const multiple = (multiPerspectives as readonly string[]).includes(perspective);
  return {
    ...current,
    [perspective]: multiple ? [...(current[perspective] ?? []), file] : [file],
  };
}

function capturedFilesFromDraft(media: InspectionDraft['media']) {
  return media.reduce<Record<string, CapturedFile[]>>((grouped, item) => {
    grouped[item.perspective] = [...(grouped[item.perspective] ?? []), { id: item.fileAssetId }];
    return grouped;
  }, {});
}

function replaceCapturedFile(
  current: Record<string, CapturedFile[]>,
  perspective: string,
  file: CapturedFile,
) {
  return { ...current, [perspective]: [file] };
}

function appendCapturedFile(
  current: Record<string, CapturedFile[]>,
  perspective: string,
  file: CapturedFile,
) {
  return { ...current, [perspective]: [...(current[perspective] ?? []), file] };
}

function inspectionPhotoGuidance(perspective: string): string {
  const guidance: Record<string, string> = {
    FRONT: 'Take a clear photo showing the front exterior condition.',
    REAR: 'Take a clear photo showing the rear exterior condition.',
    DRIVER_SIDE: 'Capture the full driver side with visible body condition.',
    PASSENGER_SIDE: 'Capture the full passenger side with visible body condition.',
    INTERIOR: 'Take a clear photo showing the vehicle interior condition.',
    DASHBOARD: 'Capture the dashboard with warning lights and displays clearly visible.',
    ODOMETER: 'Capture the dashboard with the odometer reading clearly visible.',
    FUEL_OR_BATTERY_DISPLAY: 'Capture the current fuel level or EV battery state of charge.',
    ADDITIONAL: 'Capture any additional condition evidence that should be recorded.',
  };
  return guidance[perspective] ?? 'Capture a clear inspection evidence photo.';
}

function inspectionMedia(files: Record<string, CapturedFile[]>) {
  return Object.entries(files).flatMap(([perspective, items]) =>
    items.map((file, index) => ({
      evidenceSequence: index + 1,
      fileAssetId: file.id,
      perspective,
    })),
  );
}

function conditionIssuePayload(issue: ConditionIssueDraft) {
  return {
    category: issue.category,
    classification: issue.classification,
    description: issue.description,
    evidenceFileAssetIds: issue.evidenceFileAssetIds,
    ...(issue.knownIssueId ? { knownIssueId: issue.knownIssueId } : {}),
    ...(issue.persistAsKnownIssue === undefined
      ? {}
      : { persistAsKnownIssue: issue.persistAsKnownIssue }),
    vehicleArea: issue.vehicleArea,
  };
}

function completedRequired(files: Record<string, CapturedFile[]>) {
  return perspectives.filter((perspective) => Boolean(files[perspective]?.length)).length;
}

function hasRequiredPhotos(files: Record<string, CapturedFile[]>) {
  return completedRequired(files) === perspectives.length;
}

function ExpiryCountdown({ expiresAt }: { readonly expiresAt: string }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initialize = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearTimeout(initialize);
      clearInterval(timer);
    };
  }, []);
  const seconds = now ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000)) : 0;
  return (
    <Text style={styles.countdown}>
      Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </Text>
  );
}

function invalidateRentalQueries(
  client: ReturnType<typeof useQueryClient>,
  reference: string,
): void {
  invalidateBookingLifecycle(client, reference);
}

const styles = StyleSheet.create({
  additionalPhotoAction: { alignItems: 'flex-end' },
  actionNote: { color: colors.subtleText, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  actionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  actionEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  cancellationDangerButton: { marginTop: spacing.sm },
  cancellationForm: { gap: spacing.md, marginTop: spacing.lg },
  cancellationLine: { color: colors.subtleText, lineHeight: 21 },
  cancellationRefund: {
    color: colors.ink,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  cancellationSummary: {
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  code: { color: colors.ink, fontSize: 32, fontWeight: '900', letterSpacing: 8 },
  codeCard: {
    alignItems: 'center',
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  choice: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  choiceSelected: {
    backgroundColor: colors.muted,
    borderColor: colors.primary,
    borderWidth: 2,
  },
  claimSummaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  renterClaimCopy: { flex: 1, gap: spacing.xxs },
  renterClaimSummary: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  compactOverdueCard: { gap: spacing.xs, padding: spacing.md },
  compactSubmittedIssue: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 0,
    paddingTop: spacing.xs,
  },
  compactPostInspectionText: { marginTop: 0 },
  compactSummaryRow: { gap: spacing.xxs },
  classificationHelper: {
    color: colors.subtleText,
    fontSize: 13,
    lineHeight: 18,
  },
  conditionGallery: { backgroundColor: colors.ink, flex: 1, justifyContent: 'center' },
  conditionGalleryClose: {
    alignSelf: 'flex-end',
    marginRight: spacing.lg,
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  conditionGalleryCloseText: { color: colors.onPrimary, fontWeight: '800' },
  conditionGalleryCount: {
    color: colors.onPrimary,
    fontWeight: '800',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  conditionGalleryPage: { justifyContent: 'center', padding: spacing.lg },
  conditionChoice: {
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
  conditionChoiceGroup: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    padding: spacing.xxs,
  },
  conditionChoiceSelected: { backgroundColor: colors.primary },
  conditionChoiceText: {
    color: colors.ink,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  conditionChoiceTextSelected: { color: colors.onPrimary },
  conditionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  conditionIssuePhotos: { gap: spacing.md },
  conditionIssueSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  conditionIssueCount: { color: colors.subtleText, fontSize: 13, marginTop: spacing.xxs },
  conditionSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  conditionSheetContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  conditionSheetFooter: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
  },
  conditionSheetHelper: { color: colors.subtleText, fontSize: 15, lineHeight: 21 },
  conditionSheetRoot: { flex: 1, justifyContent: 'flex-end' },
  conditionStatus: {
    backgroundColor: colors.muted,
    borderRadius: 999,
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  conditionSubsectionHeader: { gap: spacing.xxs, marginTop: spacing.sm },
  countdown: { color: colors.primary, fontWeight: '800', marginTop: spacing.sm },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 12,
    padding: spacing.md,
  },
  disabled: { opacity: 0.45 },
  destructiveSecondary: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 0,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  destructiveSecondaryText: { color: colors.danger, fontWeight: '800', textAlign: 'center' },
  error: { color: '#A12626', marginTop: spacing.md },
  evidenceCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  evidenceGallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  evidenceImage: { borderRadius: 10, height: 88, width: 88 },
  evidencePlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    justifyContent: 'center',
  },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  inlineError: { color: '#A12626', marginTop: spacing.xs },
  inlineActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  issueCard: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  issueDescriptionInput: { minHeight: 76, textAlignVertical: 'top' },
  issueForm: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  measuredClaim: {
    backgroundColor: colors.muted,
    borderRadius: radius.sm,
    gap: spacing.xxs,
    padding: spacing.sm,
  },
  nextStepCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  nextStepText: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  inspectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  inspectionChecklist: { gap: 0 },
  inspectionIntro: { gap: spacing.xs, marginTop: spacing.md },
  inspectionSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  inspectionTitle: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  exceptionBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  exceptionConsequence: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  exceptionHelper: { color: colors.subtleText, fontSize: 15, lineHeight: 21 },
  exceptionModalRoot: { flex: 1, justifyContent: 'flex-end' },
  exceptionSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  exceptionSheetContent: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  exceptionTitle: { color: colors.ink, fontSize: 26, fontWeight: '900' },
  handoverDateTimeControl: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  overdueCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  overdueStatus: { color: colors.warning, fontSize: 13, fontWeight: '800' },
  overdueDetail: { color: colors.subtleText, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  ownerPanel: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  ownerCollectionCard: { marginTop: spacing.md },
  pickupVerificationCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  panel: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  progress: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  postInspectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  notesInput: { marginTop: 0, minHeight: 84, textAlignVertical: 'top' },
  readingField: { gap: spacing.xs },
  readingInput: { flex: 1, marginTop: 0 },
  readingInputRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  readingLabel: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  readingUnit: { color: colors.subtleText, fontSize: 15, fontWeight: '700' },
  readyState: {
    backgroundColor: colors.primarySoft,
    borderRadius: 14,
    gap: spacing.xxs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  recoverySubmittedCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  recoverySubmittedHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  recoveryFormSurface: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  recoveryResponseActions: { gap: spacing.xs },
  recoveryResponseCard: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  recoveryResponseExplanation: { gap: spacing.xs },
  recoveryResponseFootnote: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  rentalActionRow: { flexDirection: 'row', gap: spacing.sm },
  rentalActionsSection: { gap: spacing.sm, marginTop: spacing.lg },
  rentalScheduleLabel: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '700',
  },
  rentalScheduleRow: { gap: spacing.xxs },
  rentalScheduleRows: { gap: spacing.sm },
  rentalScheduleValue: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  rentalSummaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  rentalSummaryHeader: { alignItems: 'flex-start', gap: spacing.xs },
  rentalSummaryTitle: { marginTop: 0 },
  renterPanel: { borderTopWidth: 0, marginTop: 0, paddingTop: 0 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  secondary: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  secondaryCompact: {
    flexBasis: 0,
    flexGrow: 1,
    justifyContent: 'center',
    marginTop: 0,
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  secondaryInline: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  secondaryText: { color: colors.primary, fontWeight: '800', textAlign: 'center' },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  submittedInspectionStatus: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    padding: spacing.md,
  },
  summaryLabel: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  success: { color: colors.primary, fontWeight: '800', marginTop: spacing.sm },
  successCard: {
    backgroundColor: colors.muted,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  warning: { color: colors.warning, fontWeight: '800', lineHeight: 21, marginTop: spacing.sm },
  warningCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
});
