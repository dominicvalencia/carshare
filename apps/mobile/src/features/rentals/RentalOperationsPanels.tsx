import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';

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
  readonly claimDeadlineAt: string | null;
  readonly inspections: readonly {
    id: string;
    type: string;
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
}

export function RenterRentalPanel({ reference }: { readonly reference: string }) {
  const client = useQueryClient();
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  const rental = useQuery({
    queryKey: ['rental', reference],
    queryFn: () => apiClient.request<RentalDetail>(`/bookings/${reference}/rental`),
  });
  const action = useMutation({
    mutationFn: async (operation: 'pickup' | 'return' | 'agree' | 'disagree' | 'incident') => {
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
      void client.invalidateQueries({ queryKey: ['rental', reference] });
      void client.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
  const detail = rental.data;
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const pickup = detail.inspections.find(({ type }) => type === 'PICKUP');
  const returned = detail.inspections.find(({ type }) => type === 'RETURN');
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Rental operations</Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      <Text style={styles.body}>
        Scheduled return: {new Date(detail.rentalEnd).toLocaleString()}
      </Text>
      {detail.status === 'READY_FOR_PICKUP' && pickup && !pickupCode && (
        <Action
          label="Review inspection and generate pickup code"
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
      {detail.status === 'ACTIVE' && (
        <>
          <Text style={styles.body}>Pickup odometer: {pickup?.odometerMeters ?? '—'} m</Text>
          <Action label="Start vehicle return" onPress={() => action.mutate('return')} />
          <SecondaryAction
            label="Report an operational issue"
            onPress={() => action.mutate('incident')}
          />
        </>
      )}
      {detail.status === 'RETURN_PENDING' && returned && (
        <>
          <Text style={styles.body}>Return odometer: {returned.odometerMeters ?? '—'} m</Text>
          <Action label="Agree with return evidence" onPress={() => action.mutate('agree')} />
          <SecondaryAction label="Record disagreement" onPress={() => action.mutate('disagree')} />
        </>
      )}
      {(detail.status === 'RETURNED' || detail.status === 'COMPLETED') && (
        <UsageSummary detail={detail} />
      )}
      {action.isError && <Text style={styles.error}>{action.error.message}</Text>}
    </View>
  );
}

export function OwnerRentalPanel({ reference }: { readonly reference: string }) {
  const client = useQueryClient();
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState('');
  const [soc, setSoc] = useState('');
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
    mutationFn: async (operation: 'inspection' | 'verify' | 'return' | 'claim' | 'incident') => {
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
      const type = detail.status === 'RETURN_PENDING' ? 'return' : 'pickup';
      return apiClient.request(`/owner/bookings/${reference}/rental/${type}/inspection`, {
        body: JSON.stringify({
          odometerMeters: odometer,
          ...(fuel ? { fuelBasisPoints: Math.round(Number(fuel) * 100) } : {}),
          ...(soc ? { batterySocBasisPoints: Math.round(Number(soc) * 100) } : {}),
          media: perspectives.map((perspective) => ({
            fileAssetId: files[perspective],
            perspective,
          })),
          notes: `${type === 'pickup' ? 'Pickup' : 'Return'} inspection submitted from owner mobile mode.`,
        }),
        method: 'POST',
      });
    },
    onSuccess: () => {
      setFiles({});
      void client.invalidateQueries({ queryKey: ['owner-rental', reference] });
      void client.invalidateQueries({ queryKey: ['owner-rentals'] });
    },
  });
  const detail = rental.data;
  if (!detail) return <Text style={styles.body}>Loading rental operations…</Text>;
  const needsInspection =
    (detail.status === 'READY_FOR_PICKUP' &&
      !detail.inspections.some(({ type }) => type === 'PICKUP')) ||
    (detail.status === 'RETURN_PENDING' &&
      !detail.inspections.some(({ type }) => type === 'RETURN'));
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>
        {detail.vehicle.make} {detail.vehicle.model}
      </Text>
      <Text style={styles.status}>{friendlyStatus(detail.status)}</Text>
      {needsInspection && (
        <>
          <TextInput
            style={styles.input}
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            placeholder="Odometer metres"
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
              label={`${files[perspective] ? '✓ ' : ''}${perspective.replaceAll('_', ' ')}`}
              onPress={() => capture.mutate(perspective)}
            />
          ))}
          <Action
            label="Finalize immutable inspection"
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
              label="Verify code and activate rental"
              disabled={code.length !== 6}
              onPress={() => action.mutate('verify')}
            />
          </>
        )}
      {detail.status === 'ACTIVE' && (
        <Action label="Start return handover" onPress={() => action.mutate('return')} />
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
              label={`${claimCategory === category ? '✓ ' : ''}${category.replaceAll('_', ' ')}`}
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
        Claim window ends:{' '}
        {detail.claimDeadlineAt ? new Date(detail.claimDeadlineAt).toLocaleString() : '—'}
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
  panel: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
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
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
});
