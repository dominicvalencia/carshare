import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { dateTimeLabel, domainLabel } from '../../ui/format';

const perspectives = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR_DASHBOARD',
  'ODOMETER',
  'FUEL_OR_BATTERY_DISPLAY',
] as const;

const claimCategories = [
  'EXCESS_MILEAGE',
  'FUEL_DEFICIENCY',
  'EV_BATTERY_DEFICIENCY',
  'LATE_RETURN',
  'CLEANING',
  'DAMAGE',
  'OTHER',
] as const;

interface RentalDetail {
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly actualPickupAt: string | null;
  readonly actualReturnAt: string | null;
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
    media: readonly { perspective: string; fileAsset: { id: string } }[];
  }[];
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
  readonly rentalIncidents: readonly {
    id: string;
    category: string;
    severity: string;
    status: string;
  }[];
  readonly vehicle: {
    make: string | null;
    model: string | null;
    powertrain: string | null;
  };
  readonly operationalPolicy: { readonly returnConfirmationGraceMinutes: number };
}

export function RenterRentalPanel({ reference }: { readonly reference: string }) {
  const client = useQueryClient();
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [soc, setSoc] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const rental = useQuery({
    queryKey: ['rental', reference],
    queryFn: () => apiClient.request<RentalDetail>(`/bookings/${reference}/rental`),
  });
  const capture = useMutation({
    mutationFn: async (perspective: string) => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted)
        throw new Error('Camera permission is required for return evidence.');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
      const asset = result.assets?.[0];
      if (!asset) return null;
      const uploaded = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `${perspective.toLowerCase()}.jpg`,
        uri: asset.uri,
      });
      return { id: uploaded.id, perspective };
    },
    onSuccess: (result) => {
      if (result) setFiles((current) => ({ ...current, [result.perspective]: result.id }));
    },
  });
  const action = useMutation({
    mutationFn: async (
      operation:
        'pickup' | 'return' | 'inspection' | 'agree' | 'disagree' | 'incident' | 'pickup-overdue',
    ) => {
      if (operation === 'pickup') {
        return apiClient.request<{ code: string }>(`/bookings/${reference}/rental/pickup/confirm`, {
          method: 'POST',
        });
      }
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
            media: perspectives.map((perspective) => ({
              fileAssetId: files[perspective],
              perspective,
            })),
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
        setPickupCode(String(result.code));
      }
      if (operation === 'inspection') setFiles({});
      invalidateRentalQueries(client, reference);
    },
  });
  const detail = rental.data;
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  const pickupOverdue =
    detail.status === 'READY_FOR_PICKUP' &&
    Boolean(
      detail.pickupWindowEnd && rental.dataUpdatedAt > new Date(detail.pickupWindowEnd).getTime(),
    );
  const returnOverdue = isReturnConfirmationOverdue(detail, returned, rental.dataUpdatedAt);
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Rental operations</Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      <Text style={styles.body}>Pickup scheduled: {dateTimeLabel(detail.rentalStart)}</Text>
      {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && (
        <Text style={styles.body}>
          Vehicle handover is available from {dateTimeLabel(detail.pickupWindowStart)}.
        </Text>
      )}
      <Text style={styles.body}>Scheduled return: {dateTimeLabel(detail.rentalEnd)}</Text>
      {detail.status === 'READY_FOR_PICKUP' && pickup && !pickupCode && (
        <Action
          label="Review vehicle condition and show pickup code"
          onPress={() => action.mutate('pickup')}
        />
      )}
      {pickupCode && (
        <View style={styles.codeCard}>
          <Text style={styles.code}>{pickupCode}</Text>
          <Text style={styles.body}>
            Show this short-lived, single-use code to the verified owner.
          </Text>
        </View>
      )}
      {detail.status === 'READY_FOR_PICKUP' && !pickup && (
        <Text style={styles.body}>Waiting for the owner to complete the pickup inspection.</Text>
      )}
      {pickupOverdue && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Handover confirmation overdue</Text>
          <Text style={styles.body}>
            The rental will not become active automatically. Operations can review inspection
            evidence, code activity, timestamps, and both reports.
          </Text>
          <Action
            label="I received the vehicle but handover isn’t confirmed"
            onPress={() => action.mutate('pickup-overdue')}
          />
        </View>
      )}
      {detail.status === 'ACTIVE' && detail.actualPickupAt && (
        <Text style={styles.success}>
          Vehicle received · rental started {dateTimeLabel(detail.actualPickupAt)}
        </Text>
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
      {detail.status === 'RETURN_PENDING' && !returned && (
        <>
          <View style={styles.inspectionHeader}>
            <Text style={styles.cardTitle}>Document the vehicle return</Text>
            <Text style={styles.progress}>
              {Object.keys(files).length} of {perspectives.length} photos
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
          />
          {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' && (
            <TextInput
              style={styles.input}
              value={fuel}
              onChangeText={setFuel}
              keyboardType="decimal-pad"
              placeholder="Fuel percentage"
            />
          )}
          {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') && (
            <TextInput
              style={styles.input}
              value={soc}
              onChangeText={setSoc}
              keyboardType="decimal-pad"
              placeholder="Battery SOC percentage"
            />
          )}
          {perspectives.map((perspective) => (
            <SecondaryAction
              key={perspective}
              label={`${files[perspective] ? '✓ ' : ''}${domainLabel(perspective)}`}
              onPress={() => capture.mutate(perspective)}
            />
          ))}
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Return condition notes (optional)"
            style={styles.input}
            value={notes}
          />
          <Action
            label="Confirm vehicle returned to owner or agreed location"
            disabled={Object.keys(files).length !== perspectives.length || !odometer}
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

export function OwnerRentalPanel({ reference }: { readonly reference: string }) {
  const client = useQueryClient();
  const [handoverStarted, setHandoverStarted] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [soc, setSoc] = useState('');
  const [notes, setNotes] = useState('');
  const [code, setCode] = useState('');
  const [claimCategory, setClaimCategory] =
    useState<(typeof claimCategories)[number]>('EXCESS_MILEAGE');
  const [claimDescription, setClaimDescription] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const rental = useQuery({
    queryKey: ['owner-rental', reference],
    queryFn: () => apiClient.request<RentalDetail>(`/owner/bookings/${reference}/rental`),
  });
  const capture = useMutation({
    mutationFn: async (perspective: string) => {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted)
        throw new Error('Camera permission is required for inspection evidence.');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
      const asset = result.assets?.[0];
      if (!asset) return null;
      const uploaded = await apiClient.upload<{ id: string }>('/files', 'SENSITIVE', {
        mimeType: asset.mimeType ?? 'image/jpeg',
        name: asset.fileName ?? `${perspective.toLowerCase()}.jpg`,
        uri: asset.uri,
      });
      return { id: uploaded.id, perspective };
    },
    onSuccess: (result) => {
      if (result) setFiles((current) => ({ ...current, [result.perspective]: result.id }));
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
        | 'renter-no-show',
    ) => {
      const detail = rental.data;
      if (!detail) throw new Error('Rental is unavailable.');
      if (operation === 'verify') {
        return apiClient.request(`/owner/bookings/${reference}/rental/pickup/verify`, {
          body: JSON.stringify({ code }),
          method: 'POST',
        });
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
      if (operation === 'return-inspection') {
        return apiClient.request(`/owner/bookings/${reference}/rental/return/inspection`, {
          body: JSON.stringify({
            odometerMeters: String(Math.round(Number(odometer) * 1000)),
            ...(fuel ? { fuelBasisPoints: Math.round(Number(fuel) * 100) } : {}),
            ...(soc ? { batterySocBasisPoints: Math.round(Number(soc) * 100) } : {}),
            media: perspectives.map((perspective) => ({
              fileAssetId: files[perspective],
              perspective,
            })),
            notes: notes.trim() || 'Owner receipt inspection submitted from owner mobile mode.',
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
          media: perspectives.map((perspective) => ({
            fileAssetId: files[perspective],
            perspective,
          })),
          notes: notes.trim() || 'Pickup inspection submitted from owner mobile mode.',
        }),
        method: 'POST',
      });
    },
    onSuccess: () => {
      setFiles({});
      invalidateRentalQueries(client, reference);
    },
  });
  const detail = rental.data;
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const needsInspection =
    detail.status === 'READY_FOR_PICKUP' &&
    !detail.inspections.some(({ type }) => type === 'PICKUP');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  const ownerReturn = detail.inspections.find(
    ({ type, version }) => type === 'RETURN' && version > (returned?.version ?? 0),
  );
  const pickupOverdue =
    detail.status === 'READY_FOR_PICKUP' &&
    Boolean(
      detail.pickupWindowEnd && rental.dataUpdatedAt > new Date(detail.pickupWindowEnd).getTime(),
    );
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>
        {detail.vehicle.make} {detail.vehicle.model}
      </Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      <Text style={styles.body}>Pickup scheduled: {dateTimeLabel(detail.rentalStart)}</Text>
      {detail.pickupWindowStart && detail.status === 'READY_FOR_PICKUP' && (
        <Text style={styles.body}>
          Handover available from {dateTimeLabel(detail.pickupWindowStart)}.
        </Text>
      )}
      {needsInspection && !handoverStarted && (
        <Action label="Start handover" onPress={() => setHandoverStarted(true)} />
      )}
      {needsInspection && handoverStarted && (
        <>
          <View style={styles.inspectionHeader}>
            <Text style={styles.cardTitle}>Pickup inspection</Text>
            <Text style={styles.progress}>
              {Object.keys(files).length} of {perspectives.length} photos
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
          />
          {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' && (
            <TextInput
              style={styles.input}
              value={fuel}
              onChangeText={setFuel}
              keyboardType="decimal-pad"
              placeholder="Fuel percentage"
            />
          )}
          {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') && (
            <TextInput
              style={styles.input}
              value={soc}
              onChangeText={setSoc}
              keyboardType="decimal-pad"
              placeholder="Battery SOC percentage"
            />
          )}
          {perspectives.map((perspective) => (
            <SecondaryAction
              key={perspective}
              label={`${files[perspective] ? '✓ ' : ''}${domainLabel(perspective)}`}
              onPress={() => capture.mutate(perspective)}
            />
          ))}
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Pickup condition notes (optional)"
            style={styles.input}
            value={notes}
          />
          <Action
            label="Submit pickup inspection"
            disabled={Object.keys(files).length !== perspectives.length || !odometer}
            onPress={() => action.mutate('inspection')}
          />
        </>
      )}
      {detail.status === 'READY_FOR_PICKUP' &&
        detail.inspections.some(({ type }) => type === 'PICKUP') && (
          <>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="Renter pickup code"
            />
            <Action
              label="Complete handover"
              disabled={code.length !== 6}
              onPress={() => action.mutate('verify')}
            />
          </>
        )}
      {pickupOverdue && (
        <View style={styles.overdueCard}>
          <Text style={styles.cardTitle}>Handover confirmation overdue</Text>
          <Text style={styles.body}>
            The booking remains non-active until participant handover or an audited admin
            resolution.
          </Text>
          <SecondaryAction
            label="Renter did not arrive"
            onPress={() => action.mutate('renter-no-show')}
          />
        </View>
      )}
      {detail.status === 'ACTIVE' && detail.actualPickupAt && (
        <Text style={styles.success}>
          Vehicle handed over · {dateTimeLabel(detail.actualPickupAt)}
        </Text>
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
      {detail.status === 'RETURN_PENDING' && returned && !ownerReturn && (
        <>
          <Text style={styles.cardTitle}>Vehicle returned — perform receipt inspection</Text>
          <Text style={styles.body}>
            Capture the vehicle as received. Original renter evidence remains immutable and both
            inspection versions are available to operations if measurements differ.
          </Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setOdometer}
            placeholder="Receipt odometer reading (km)"
            style={styles.input}
            value={odometer}
          />
          {detail.vehicle.powertrain !== 'BATTERY_ELECTRIC' && (
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setFuel}
              placeholder="Receipt fuel percentage"
              style={styles.input}
              value={fuel}
            />
          )}
          {['BATTERY_ELECTRIC', 'PLUG_IN_HYBRID'].includes(detail.vehicle.powertrain ?? '') && (
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setSoc}
              placeholder="Receipt battery SOC percentage"
              style={styles.input}
              value={soc}
            />
          )}
          {perspectives.map((perspective) => (
            <SecondaryAction
              key={perspective}
              label={`${files[perspective] ? '✓ ' : ''}${domainLabel(perspective)}`}
              onPress={() => capture.mutate(perspective)}
            />
          ))}
          <TextInput
            multiline
            onChangeText={setNotes}
            placeholder="Receipt condition notes (optional)"
            style={styles.input}
            value={notes}
          />
          <Action
            disabled={Object.keys(files).length !== perspectives.length || !odometer}
            label="Submit receipt inspection"
            onPress={() => action.mutate('return-inspection')}
          />
        </>
      )}
      {detail.status === 'RETURN_PENDING' && returned && ownerReturn && (
        <>
          <Text style={styles.cardTitle}>Vehicle returned — inspect and confirm</Text>
          <Text style={styles.body}>
            Renter odometer: {odometerLabel(returned.odometerMeters)} · owner receipt odometer:{' '}
            {odometerLabel(ownerReturn.odometerMeters)}. Agree only after checking both immutable
            evidence sets. A disagreement opens the controlled review path.
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
      {action.isError && <Text style={styles.error}>{action.error.message}</Text>}
      {capture.isError && <Text style={styles.error}>{capture.error.message}</Text>}
    </View>
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
  label,
  onPress,
}: {
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable style={styles.secondary} onPress={onPress}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}
function friendlyStatus(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: 'Active rental',
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
  for (const queryKey of [
    ['rental', reference],
    ['owner-rental', reference],
    ['bookings'],
    ['booking', reference],
    ['owner-rentals'],
    ['owner-booking-requests'],
    ['owner-booking', reference],
    ['vehicles'],
    ['public-search'],
    ['public-vehicle'],
    ['notifications'],
    ['notification-summary'],
  ]) {
    void client.invalidateQueries({ queryKey });
  }
}

const styles = StyleSheet.create({
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
  code: { color: colors.ink, fontSize: 32, fontWeight: '900', letterSpacing: 8 },
  codeCard: {
    alignItems: 'center',
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  disabled: { opacity: 0.45 },
  error: { color: '#A12626', marginTop: spacing.md },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  inspectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
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
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  warning: { color: colors.warning, fontWeight: '800', lineHeight: 21, marginTop: spacing.sm },
});
