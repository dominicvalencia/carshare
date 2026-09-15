import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, domainLabel, money } from '../../ui/format';
import { invalidateBookingLifecycle } from '../../query/booking-invalidation';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { SecureCameraPhotoSlot, securePhotoPreviewStyle } from '../../ui/SecureCameraPhotoSlot';
import { ensureCameraPermission } from '../../ui/camera-permission';
import { SearchableReferenceSelector } from '../../ui/SearchableReferenceSelector';

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
  reference,
  onCancellationCompleted,
  onContinueResolving,
  scrollToCancellationForm,
  scrollToPickupCode,
  scrollResolutionFormBy,
}: {
  readonly reference: string;
  readonly onCancellationCompleted?: () => void;
  readonly onContinueResolving?: () => void;
  readonly scrollToCancellationForm?: (y: number) => void;
  readonly scrollToPickupCode?: (y: number) => void;
  readonly scrollResolutionFormBy?: (delta: number) => void;
}) {
  const client = useQueryClient();
  const panelOffsetY = useRef(0);
  const cancellationFormOffsetY = useRef(0);
  const resolutionReasonRef = useRef<TextInput>(null);
  const scrollToCancellationFormAfterLayout = useRef(false);
  const scrollToCancellationSummaryAfterLayout = useRef(false);
  const scrollToPickupCodeAfterLayout = useRef(false);
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [pickupCodeExpiresAt, setPickupCodeExpiresAt] = useState<string | null>(null);
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
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
  const pickupReview = pickup?.confirmations?.find(({ role }) => role === 'RENTER');
  const approvedPickupCorrection = pickup?.amendments?.find(({ status }) => status === 'APPROVED');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  const pickupOverdue =
    detail.status === 'READY_FOR_PICKUP' &&
    Boolean(
      detail.pickupWindowEnd && rental.dataUpdatedAt > new Date(detail.pickupWindowEnd).getTime(),
    );
  const returnOverdue = isReturnConfirmationOverdue(detail, returned, rental.dataUpdatedAt);
  const returnHandoverReady =
    detail.fulfillment.endMethod !== 'OWNER_COLLECTION' ||
    detail.handoverTravel.returnStatus === 'ARRIVED';
  return (
    <View
      onLayout={({ nativeEvent }) => {
        panelOffsetY.current = nativeEvent.layout.y;
      }}
      style={styles.panel}
    >
      <Text style={styles.heading}>Rental operations</Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      <Text style={styles.body}>Pickup scheduled: {dateTimeLabel(detail.rentalStart)}</Text>
      {pickupOverdue && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Handover confirmation overdue</Text>
          <Text style={styles.body}>
            The rental will not become active automatically. Operations can review inspection
            evidence, code activity, timestamps, and both reports.
          </Text>
          <Action label="Report handover issue" onPress={() => action.mutate('pickup-overdue')} />
        </View>
      )}
      {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && (
        <Text style={styles.body}>
          Vehicle handover is available from {dateTimeLabel(detail.pickupWindowStart)}.
        </Text>
      )}
      <Text style={styles.body}>Scheduled return: {dateTimeLabel(detail.rentalEnd)}</Text>
      {detail.status === 'CANCELLED' && detail.cancellationSettlement ? (
        <CancellationSummary detail={detail} audience="renter" />
      ) : null}
      {detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(detail.status) && (
          <HandoverTravelSummary
            address={detail.fulfillment.startLocation}
            label="Your car is being delivered"
            status={detail.handoverTravel.startStatus}
          />
        )}
      {detail.fulfillment.endMethod === 'OWNER_COLLECTION' &&
        ['ACTIVE', 'RETURN_PENDING'].includes(detail.status) && (
          <HandoverTravelSummary
            address={detail.fulfillment.endLocation}
            label="Owner collection"
            status={detail.handoverTravel.returnStatus}
          />
        )}
      {detail.status === 'READY_FOR_PICKUP' && pickup && !pickupCode && (
        <>
          <InspectionEvidence title="Pickup inspection · Submitted by owner" inspection={pickup} />
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
                            {domainLabel(response.resolutionReview?.decision ?? 'Awaiting review')}
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
                  ) : pickupReview.discrepancyResponse.resolutionReview.decision === 'ACCEPTED' ? (
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
                        <SecondaryAction label="Continue resolving" onPress={onContinueResolving} />
                      ) : (
                        <Text style={styles.body}>
                          Use CarShare support if you cannot continue with the owner in the booking
                          conversation.
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
        </>
      )}
      {detail.status === 'READY_FOR_PICKUP' && pickupCode && (
        <View
          onLayout={({ nativeEvent }) => {
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
      {detail.status === 'READY_FOR_PICKUP' && !pickup && (
        <Text style={styles.body}>Waiting for the owner to complete the pickup inspection.</Text>
      )}
      {detail.status === 'ACTIVE' && detail.actualPickupAt && (
        <View style={styles.successCard}>
          <Text style={styles.success}>✓ Vehicle received</Text>
          <Text style={styles.cardTitle}>Rental in progress</Text>
          <Text style={styles.body}>Started {dateTimeLabel(detail.actualPickupAt)}</Text>
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
        <>
          <Text style={styles.body}>Pickup odometer: {odometerLabel(pickup?.odometerMeters)}</Text>
          <Action label="Start return" onPress={() => action.mutate('return')} />
          <SecondaryAction
            label="Report an operational issue"
            onPress={() => action.mutate('incident')}
          />
        </>
      )}
      {detail.status === 'RETURN_PENDING' && !returned && !returnHandoverReady && (
        <View style={styles.actionCard}>
          <Text style={styles.actionEyebrow}>Owner collection</Text>
          <Text style={styles.cardTitle}>Waiting for the owner to arrive</Text>
          <Text style={styles.body}>
            You can document the return handover after the owner arrives at the collection location.
          </Text>
        </View>
      )}
      {detail.status === 'RETURN_PENDING' && !returned && returnHandoverReady && (
        <>
          <View style={styles.inspectionHeader}>
            <Text style={styles.cardTitle}>Document the vehicle return</Text>
            <Text style={styles.progress}>
              {photoCount(files)} photos · {completedRequired(files)} of {perspectives.length}{' '}
              required
            </Text>
          </View>
          <Text style={styles.body}>
            Capture the vehicle and dashboard at handover. The owner will acknowledge this exact
            evidence; any disagreement opens the controlled review path.
          </Text>
          <TextInput
            style={styles.input}
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            placeholder="Odometer reading (km)"
            placeholderTextColor={colors.placeholder}
          />
          {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' && (
            <TextInput
              style={styles.input}
              value={fuel}
              onChangeText={setFuel}
              keyboardType="decimal-pad"
              placeholder="Fuel percentage"
              placeholderTextColor={colors.placeholder}
            />
          )}
          {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') && (
            <TextInput
              style={styles.input}
              value={soc}
              onChangeText={setSoc}
              keyboardType="decimal-pad"
              placeholder="Battery SOC percentage"
              placeholderTextColor={colors.placeholder}
            />
          )}
          {[...perspectives, 'ADDITIONAL' as const].map((perspective) => {
            const captured = files[perspective] ?? [];
            const latest = captured.at(-1);
            const multiple = (multiPerspectives as readonly string[]).includes(perspective);
            return (
              <View key={perspective}>
                <SecureCameraPhotoSlot
                  busy={capture.isPending && capture.variables?.perspective === perspective}
                  guidance={inspectionPhotoGuidance(perspective)}
                  name={domainLabel(perspective)}
                  onCapture={() => capture.mutate({ mode: 'replace', perspective })}
                  previewUri={latest?.uri}
                  required={perspective !== 'ADDITIONAL'}
                  uploaded={Boolean(latest)}
                />
                {multiple && latest && (
                  <SecondaryAction
                    label={`Add another ${domainLabel(perspective).toLowerCase()} photo`}
                    onPress={() => capture.mutate({ mode: 'append', perspective })}
                  />
                )}
                {captured.length > 1 && (
                  <CapturedPreviews files={captured.slice(0, -1)} perspective={perspective} />
                )}
              </View>
            );
          })}
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Return condition notes (optional)"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={notes}
          />
          <Action
            label="Confirm vehicle return"
            disabled={!hasRequiredPhotos(files) || !odometer}
            onPress={() => action.mutate('inspection')}
          />
        </>
      )}
      {detail.status === 'RETURN_PENDING' && returned && (
        <>
          <Text style={styles.body}>Return odometer: {odometerLabel(returned.odometerMeters)}</Text>
          <Text style={styles.body}>Waiting for owner to confirm vehicle receipt.</Text>
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
        <UsageSummary detail={detail} />
      )}
      {action.isError && <Text style={styles.error}>{action.error.message}</Text>}
      {capture.isError && <Text style={styles.error}>{capture.error.message}</Text>}
    </View>
  );
}

export function OwnerRentalPanel({
  reference,
  scrollConditionFormBy,
  scrollToConditionForm,
}: {
  readonly reference: string;
  readonly scrollConditionFormBy?: (delta: number) => void;
  readonly scrollToConditionForm?: (y: number) => void;
}) {
  const client = useQueryClient();
  const { width: viewportWidth } = useWindowDimensions();
  const scrollToConditionFormAfterLayout = useRef(false);
  const panelOffsetY = useRef(0);
  const conditionCardOffsetY = useRef(0);
  const conditionDescriptionRef = useRef<TextInput>(null);
  const ownerDiscrepancyResponseRef = useRef<TextInput>(null);
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
  const [conditionGallery, setConditionGallery] = useState<readonly string[]>([]);
  const [conditionEvidenceIds, setConditionEvidenceIds] = useState<readonly string[]>([]);
  const [ownerDiscrepancyResponse, setOwnerDiscrepancyResponse] = useState('');
  const [ownerDiscrepancyResponseError, setOwnerDiscrepancyResponseError] = useState('');
  const [renterNoShowSubmitted, setRenterNoShowSubmitted] = useState(false);
  const [code, setCode] = useState('');
  const [claimCategory, setClaimCategory] =
    useState<(typeof claimCategories)[number]>('EXCESS_MILEAGE');
  const [claimDescription, setClaimDescription] = useState('');
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
      const focusedInput = conditionDescriptionRef.current?.isFocused()
        ? conditionDescriptionRef.current
        : ownerDiscrepancyResponseRef.current?.isFocused()
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
      await apiClient.request(`/owner/bookings/${reference}/rental/pickup/inspection/draft/media`, {
        body: JSON.stringify({
          fileAssetId: uploaded.id,
          perspective,
          replace: mode === 'replace',
        }),
        method: 'PUT',
      });
      return { id: uploaded.id, mode, perspective, uri: asset.uri };
    },
    onSuccess: (result) => {
      if (result) {
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
  const pickupOverdue =
    detail.status === 'READY_FOR_PICKUP' &&
    Boolean(
      detail.pickupWindowEnd && rental.dataUpdatedAt > new Date(detail.pickupWindowEnd).getTime(),
    );
  const renterNoShowIncident = detail.rentalIncidents.find(
    ({ category }) => category === 'RENTER_NO_SHOW',
  );
  const pickupHandoverReady =
    detail.fulfillment.startMethod !== 'OWNER_DELIVERY' ||
    detail.handoverTravel.startStatus === 'ARRIVED';
  return (
    <View
      onLayout={({ nativeEvent }) => {
        panelOffsetY.current = nativeEvent.layout.y;
      }}
      style={styles.panel}
    >
      <Text style={styles.heading}>
        {detail.vehicle.make} {detail.vehicle.model}
      </Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      <Text style={styles.body}>Pickup scheduled: {dateTimeLabel(detail.rentalStart)}</Text>
      {pickupOverdue && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Handover confirmation overdue</Text>
          <Text style={styles.body}>
            The booking remains non-active until participant handover or an audited admin
            resolution.
          </Text>
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
      {detail.fulfillment.startMethod === 'OWNER_DELIVERY' &&
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(detail.status) && (
          <OwnerTravelActions
            address={detail.fulfillment.startLocation}
            phase="start"
            status={detail.handoverTravel.startStatus}
            mutate={(operation) => action.mutate(operation)}
          />
        )}
      {detail.fulfillment.endMethod === 'OWNER_COLLECTION' &&
        ['ACTIVE', 'RETURN_PENDING'].includes(detail.status) && (
          <OwnerTravelActions
            actionsEnabled={detail.status === 'RETURN_PENDING'}
            address={detail.fulfillment.endLocation}
            phase="return"
            status={detail.handoverTravel.returnStatus}
            mutate={(operation) => action.mutate(operation)}
          />
        )}
      {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && (
        <Text style={styles.body}>
          Handover available from {dateTimeLabel(detail.pickupWindowStart)}.
        </Text>
      )}
      {needsInspection && !handoverStarted && !pickupHandoverReady && (
        <View style={styles.actionCard}>
          <Text style={styles.actionEyebrow}>Delivery</Text>
          <Text style={styles.cardTitle}>Complete delivery travel first</Text>
          <Text style={styles.body}>
            The pickup handover becomes available after you mark arrival at the delivery location.
          </Text>
        </View>
      )}
      {needsInspection && !handoverStarted && pickupHandoverReady && (
        <View style={styles.actionCard}>
          <Text style={styles.actionEyebrow}>Action required</Text>
          <Text style={styles.cardTitle}>Complete pickup inspection</Text>
          <Text style={styles.body}>Document the vehicle before handing it to the renter.</Text>
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
      {needsInspection && handoverStarted && (
        <>
          <View style={styles.inspectionHeader}>
            <Text style={styles.cardTitle}>Pickup inspection</Text>
            <Text style={styles.progress}>
              {photoCount(inspectionFiles)} photos · {completedRequired(inspectionFiles)} of{' '}
              {perspectives.length} required
            </Text>
          </View>
          <Text style={styles.body}>
            Capture each guided view, then record the physical readings exactly as shown.
          </Text>
          <TextInput
            style={styles.input}
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            placeholder="Odometer reading (km)"
            placeholderTextColor={colors.placeholder}
          />
          {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' && (
            <TextInput
              style={styles.input}
              value={fuel}
              onChangeText={setFuel}
              keyboardType="decimal-pad"
              placeholder="Fuel percentage"
              placeholderTextColor={colors.placeholder}
            />
          )}
          {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') && (
            <TextInput
              style={styles.input}
              value={soc}
              onChangeText={setSoc}
              keyboardType="decimal-pad"
              placeholder="Battery SOC percentage"
              placeholderTextColor={colors.placeholder}
            />
          )}
          {perspectives.map((perspective) => {
            const captured = inspectionFiles[perspective] ?? [];
            const latest = captured.at(-1);
            const multiple = (multiPerspectives as readonly string[]).includes(perspective);
            return (
              <View key={perspective}>
                <SecureCameraPhotoSlot
                  busy={capture.isPending && capture.variables?.perspective === perspective}
                  guidance={inspectionPhotoGuidance(perspective)}
                  name={domainLabel(perspective)}
                  onCapture={() => capture.mutate({ mode: 'replace', perspective })}
                  persistedPreview={
                    latest && !latest.uri ? (
                      <AuthorizedInspectionImage
                        fileAssetId={latest.id}
                        label={`${domainLabel(perspective)} secure draft preview`}
                        large
                      />
                    ) : undefined
                  }
                  previewUri={latest?.uri}
                  required
                  uploaded={Boolean(latest)}
                />
                {multiple && latest && (
                  <SecondaryAction
                    label={`Add another ${domainLabel(perspective).toLowerCase()} photo`}
                    onPress={() => capture.mutate({ mode: 'append', perspective })}
                  />
                )}
                {captured.length > 1 && (
                  <CapturedPreviews files={captured.slice(0, -1)} perspective={perspective} />
                )}
              </View>
            );
          })}
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Pickup condition notes (optional)"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            value={notes}
          />
          <View
            onLayout={({ nativeEvent }) => {
              conditionCardOffsetY.current = nativeEvent.layout.y;
            }}
            style={styles.actionCard}
          >
            <Text style={styles.cardTitle}>Existing vehicle condition</Text>
            <Text style={styles.body}>
              Record any existing damage or condition issues before handing over the vehicle. These
              become part of the pre-rental condition.
            </Text>
            <SecondaryAction
              label="No known existing issues"
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
                  setEditingConditionIssue(null);
                  setShowConditionIssueForm(false);
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
            />
            <SecondaryAction
              label="Report existing issues"
              onPress={() => {
                setConditionDisclosureState('ISSUES_REPORTED');
                setShowConditionIssueForm(false);
              }}
            />
            {conditionDisclosureState === 'ISSUES_REPORTED' ? (
              <>
                <Text style={[styles.cardTitle, styles.knownIssuesHeading]}>
                  Known issues from your vehicle (
                  {conditionIssues.filter(({ knownIssueId }) => knownIssueId).length})
                </Text>
                {conditionIssues.filter(({ knownIssueId }) => knownIssueId).length === 0 ? (
                  <Text style={styles.body}>
                    No active known issues are recorded for this vehicle.
                  </Text>
                ) : null}
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
                {conditionIssues.some(({ knownIssueId }) => !knownIssueId) ? (
                  <Text style={styles.cardTitle}>
                    New findings (
                    {conditionIssues.filter(({ knownIssueId }) => !knownIssueId).length})
                  </Text>
                ) : null}
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
                          label="Edit"
                          onPress={() => {
                            scrollToConditionFormAfterLayout.current = true;
                            setConditionCategory(issue.category);
                            setConditionArea(issue.vehicleArea);
                            setConditionClassification(issue.classification);
                            setConditionDescription(issue.description);
                            setConditionEvidenceIds(issue.evidenceFileAssetIds);
                            setEditingConditionIssue(index);
                            setShowConditionIssueForm(true);
                          }}
                        />
                        <SecondaryAction
                          label="Remove"
                          onPress={() =>
                            Alert.alert('Remove issue?', 'This removes the issue from the draft.', [
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
                            ])
                          }
                        />
                      </View>
                    </View>
                  ) : null,
                )}
                {!showConditionIssueForm ? (
                  <SecondaryAction
                    label="+ Add another issue"
                    onPress={() => {
                      scrollToConditionFormAfterLayout.current = true;
                      setEditingConditionIssue(null);
                      setConditionDescription('');
                      setConditionEvidenceIds([]);
                      setConditionDescriptionError('');
                      setShowConditionIssueForm(true);
                    }}
                  />
                ) : (
                  <View
                    onLayout={({ nativeEvent }) => {
                      if (scrollToConditionFormAfterLayout.current) {
                        scrollToConditionFormAfterLayout.current = false;
                        scrollToConditionForm?.(
                          Math.max(
                            0,
                            panelOffsetY.current +
                              conditionCardOffsetY.current +
                              nativeEvent.layout.y -
                              spacing.md,
                          ),
                        );
                      }
                    }}
                    style={styles.issueForm}
                  >
                    <Text style={styles.cardTitle}>
                      {editingConditionIssue === null ? 'Add another issue' : 'Edit new finding'}
                    </Text>
                    <SearchableReferenceSelector
                      label="What’s the issue?"
                      onChange={setConditionCategory}
                      options={conditionCategoryOptions}
                      value={conditionCategory}
                    />
                    <SearchableReferenceSelector
                      label="Where is it?"
                      onChange={setConditionArea}
                      options={conditionAreaOptions}
                      value={conditionArea}
                    />
                    <SearchableReferenceSelector
                      label="How serious is it?"
                      onChange={setConditionClassification}
                      options={conditionClassificationOptions}
                      value={conditionClassification}
                    />
                    <Text accessibilityLiveRegion="polite" style={styles.classificationHelper}>
                      {conditionClassificationExplanation(conditionClassification)}
                    </Text>
                    <Text style={styles.cardTitle}>Describe the issue</Text>
                    <TextInput
                      accessibilityLabel="Describe the issue"
                      multiline
                      ref={conditionDescriptionRef}
                      onChangeText={(value) => {
                        setConditionDescription(value);
                        if (value.trim().length >= 3) setConditionDescriptionError('');
                      }}
                      placeholder="Add a clear description"
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
                      Add private evidence of this finding. Photos are visible only to authorized
                      reviewers.
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
                              setConditionEvidenceIds((ids) => ids.filter((id) => id !== file.id));
                              const captured = Object.keys(current).length ? current : draftFiles;
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
                            capture.isPending && capture.variables?.perspective === 'ADDITIONAL'
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
                    <SecondaryAction
                      label={editingConditionIssue === null ? 'Save issue' : 'Save changes'}
                      onPress={() => {
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
                            : current.map((value, index) =>
                                index === editingConditionIssue ? issue : value,
                              ),
                        );
                        setConditionDescription('');
                        setConditionEvidenceIds([]);
                        setEditingConditionIssue(null);
                        setShowConditionIssueForm(false);
                      }}
                    />
                    <SecondaryAction
                      label="Cancel"
                      onPress={() => {
                        Keyboard.dismiss();
                        setConditionDescription('');
                        setConditionEvidenceIds([]);
                        setConditionDescriptionError('');
                        setEditingConditionIssue(null);
                        setShowConditionIssueForm(false);
                      }}
                    />
                  </View>
                )}
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
          <Action
            label="Submit inspection"
            disabled={
              !hasRequiredPhotos(inspectionFiles) ||
              !odometer ||
              conditionDisclosureState === 'NOT_REVIEWED' ||
              (conditionDisclosureState === 'ISSUES_REPORTED' && conditionIssues.length === 0)
            }
            onPress={() => action.mutate('inspection')}
          />
        </>
      )}
      {detail.status === 'READY_FOR_PICKUP' &&
        detail.inspections.some(({ type }) => type === 'PICKUP') &&
        !pickupDiscrepancyUnresolved && (
          <View style={styles.actionCard}>
            <Text style={styles.actionEyebrow}>Action required</Text>
            <Text style={styles.cardTitle}>Confirm vehicle handover</Text>
            <Text style={styles.body}>
              Ask the renter for their 6-digit pickup code. The code confirms they reviewed the
              pickup condition and received the vehicle.
            </Text>
            {pickup && <InspectionEvidence title="Submitted pickup evidence" inspection={pickup} />}
            <TextInput
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
        )}
      {detail.status === 'READY_FOR_PICKUP' && pickupDiscrepancyUnresolved && pickup ? (
        <View style={styles.warningCard}>
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
      {detail.status === 'ACTIVE' && detail.actualPickupAt && (
        <Text style={styles.success}>
          Vehicle handed over · {dateTimeLabel(detail.actualPickupAt)}
        </Text>
      )}
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
      {detail.status === 'ACTIVE' && (
        <Text style={styles.body}>
          Rental in progress. The renter can start return when the vehicle reaches the agreed
          location.
        </Text>
      )}
      {detail.status === 'RETURN_PENDING' && !returned && (
        <Text style={styles.body}>
          Waiting for the renter to submit the return photos and dashboard readings.
        </Text>
      )}
      {detail.status === 'RETURN_PENDING' && returned && (
        <>
          <InspectionEvidence title="Return evidence · Submitted by renter" inspection={returned} />
          <Text style={styles.body}>
            Review the renter’s immutable evidence and confirm physical receipt. If the condition
            differs, report an issue to open the controlled dispute and optional evidence pathway.
          </Text>
          <Action label="Confirm vehicle received" onPress={() => action.mutate('agree')} />
          <SecondaryAction label="Report an issue" onPress={() => action.mutate('disagree')} />
        </>
      )}
      {detail.status === 'RETURNED' && (
        <>
          <UsageSummary detail={detail} />
          <Text style={styles.cardTitle}>Start a controlled claim</Text>
          <Text style={styles.body}>
            Select the measured issue. You cannot enter a charge amount.
          </Text>
          {claimCategories.map((category) => (
            <SecondaryAction
              key={category}
              label={`${claimCategory === category ? '✓ ' : ''}${domainLabel(category)}`}
              onPress={() => setClaimCategory(category)}
            />
          ))}
          <TextInput
            style={styles.input}
            value={claimDescription}
            onChangeText={setClaimDescription}
            placeholder="Describe the specific issue"
            placeholderTextColor={colors.placeholder}
            multiline
          />
          <Action
            label="Submit evidence for renter and admin review"
            disabled={claimDescription.trim().length < 3}
            onPress={() => action.mutate('claim')}
          />
        </>
      )}
      {['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(detail.status) && (
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

function UsageSummary({ detail }: { readonly detail: RentalDetail }) {
  const usage = detail.usageSummary;
  if (!usage) return <Text style={styles.body}>Return evidence is under review.</Text>;
  return (
    <View style={styles.summary}>
      <Text style={styles.cardTitle}>Measured usage</Text>
      <Text style={styles.body}>Travelled: {usage.distanceTravelledKm} km</Text>
      <Text style={styles.body}>Included: {usage.includedDistanceKm ?? 'Unlimited'} km</Text>
      <Text style={styles.body}>Excess: {usage.excessDistanceKm} km</Text>
      <Text style={styles.body}>Late: {Math.ceil(usage.lateDurationSeconds / 60)} minutes</Text>
      <Text style={styles.body}>
        Claim window ends: {detail.claimDeadlineAt ? dateTimeLabel(detail.claimDeadlineAt) : '—'}
      </Text>
      <Text style={styles.body}>
        No additional charge has been created. Administrator approval is required.
      </Text>
    </View>
  );
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
      onPress={onPress}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
function SecondaryAction({
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
      disabled={disabled}
      style={[styles.secondary, disabled && styles.disabled]}
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

function photoCount(files: Record<string, CapturedFile[]>) {
  return Object.values(files).reduce((total, entries) => total + entries.length, 0);
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

function isReturnConfirmationOverdue(
  detail: RentalDetail,
  returned: RentalDetail['inspections'][number] | undefined,
  observedAt: number,
): boolean {
  if (detail.status !== 'RETURN_PENDING' || !returned?.finalizedAt) return false;
  return (
    observedAt >
    new Date(returned.finalizedAt).getTime() +
      detail.operationalPolicy.returnConfirmationGraceMinutes * 60_000
  );
}

function invalidateRentalQueries(
  client: ReturnType<typeof useQueryClient>,
  reference: string,
): void {
  invalidateBookingLifecycle(client, reference);
}

const styles = StyleSheet.create({
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
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  classificationHelper: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    color: colors.ink,
    lineHeight: 21,
    marginTop: spacing.md,
    padding: spacing.md,
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
  conditionIssuePhotos: { gap: spacing.md },
  countdown: { color: colors.primary, fontWeight: '800', marginTop: spacing.sm },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 12,
    padding: spacing.md,
  },
  disabled: { opacity: 0.45 },
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
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  issueDescriptionInput: { minHeight: 96, textAlignVertical: 'top' },
  issueForm: { gap: spacing.sm, marginTop: spacing.md },
  knownIssuesHeading: { marginTop: spacing.lg },
  inspectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
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
  panel: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  progress: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  secondary: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
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
