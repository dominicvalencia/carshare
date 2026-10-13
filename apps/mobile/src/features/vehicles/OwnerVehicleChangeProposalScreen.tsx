import type {
  OwnerVehicleChangeProposalDecisionResponse,
  OwnerVehicleChangeProposalReviewModel,
  VehicleChangeField,
  VehicleChangeProposalSnapshotV1,
} from '@carrental/api-contracts';
import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiClient } from '../../auth/api-client';
import type { RootStackParamList } from '../../navigation/routes';
import { colors, spacing, typography } from '../../theme/tokens';
import { dateTimeLabel, domainLabel, money } from '../../ui/format';
import { BackControl, Button, Card, Screen, StateView, StatusBadge } from '../../ui/primitives';
import { VehicleOwnerReturnSheet } from './VehiclesScreen';

const fieldLabels: Readonly<Record<string, string>> = {
  'vehicle.category': 'Category',
  'vehicle.make': 'Make',
  'vehicle.model': 'Model',
  'vehicle.variant': 'Variant',
  'vehicle.year': 'Model year',
  'vehicle.transmission': 'Transmission',
  'vehicle.powertrain': 'Powertrain',
  'vehicle.fuelType': 'Fuel type',
  'vehicle.seats': 'Seats',
  'vehicle.doors': 'Doors',
  'vehicle.color': 'Color',
  'vehicle.plate': 'Plate number',
  'vehicle.vin': 'VIN',
  'vehicle.description': 'Description',
  'vehicle.rentalRequirements': 'Rental requirements',
  features: 'Features',
  photos: 'Photos',
  documents: 'Documents',
  'documents.registration': 'Registration document',
  'documents.insurance': 'Insurance document',
  'documents.ownership': 'Ownership document',
  location: 'Location',
};

const policyLabels: Readonly<Record<string, string>> = {
  dailyRateMinor: 'Daily rate',
  minimumRentalDays: 'Minimum rental',
  maximumRentalDays: 'Maximum rental',
  mileagePolicy: 'Mileage policy',
  includedKilometersPerDay: 'Included distance',
  excessKilometerRateMinor: 'Excess distance rate',
  turnaroundMinutes: 'Preparation time',
  availabilityPolicy: 'Availability',
  securityDepositRequired: 'Security deposit',
  securityDepositAmountMinor: 'Security deposit amount',
  supportsRenterPickup: 'Renter pickup',
  supportsOwnerDelivery: 'Owner delivery',
  supportsRenterReturn: 'Renter return',
  supportsOwnerCollection: 'Owner collection',
};

function fieldLabel(field: VehicleChangeField): string {
  if (field.startsWith('policy.')) {
    const key = field.slice('policy.'.length);
    return policyLabels[key] ?? domainLabel(key);
  }
  return fieldLabels[field] ?? domainLabel(field.split('.').at(-1) ?? field);
}

function displayValue(
  field: VehicleChangeField,
  snapshot: VehicleChangeProposalSnapshotV1,
): string {
  if (field === 'features') return `${snapshot.featureIds.length} selected`;
  if (field === 'photos') return `${snapshot.photos.length} photos`;
  if (field.startsWith('documents')) return `${snapshot.documents.length} documents`;
  if (field === 'location')
    return snapshot.location
      ? [snapshot.location.city, snapshot.location.province].filter(Boolean).join(', ')
      : 'Not configured';
  if (field.startsWith('vehicle.')) {
    const key = field.slice('vehicle.'.length);
    const aliases: Record<string, keyof VehicleChangeProposalSnapshotV1['vehicle']> = {
      year: 'modelYear',
      seats: 'seatCount',
      doors: 'doorCount',
      plate: 'plateNumber',
    };
    if (key === 'category') return 'Updated category';
    if (key === 'vin') return snapshot.vehicle.vin ? 'Provided' : 'Not provided';
    const value = snapshot.vehicle[aliases[key] ?? (key as keyof typeof snapshot.vehicle)];
    return value === null || value === '' ? 'Not provided' : String(value);
  }
  const key = field.slice('policy.'.length) as keyof VehicleChangeProposalSnapshotV1['policy'];
  const value = snapshot.policy[key];
  if (key.endsWith('Minor') && typeof value === 'number')
    return money(value, snapshot.policy.currency);
  if (key.endsWith('Minutes') && typeof value === 'number') return `${value} minutes`;
  if (key.endsWith('Days') && typeof value === 'number') return `${value} days`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value === null ? 'Not configured' : domainLabel(String(value));
}

function errorMessage(error: Error): string {
  if (error instanceof ApiError && error.status === 409)
    return 'This proposal is out of date. Review the latest vehicle details before deciding.';
  if (error instanceof ApiError && error.status === 403)
    return 'Only the Owner can review this proposal.';
  return error.message || 'We couldn’t update this proposal. Try again.';
}

export function OwnerVehicleChangeProposalScreen({
  proposalId,
  vehicleId,
}: {
  readonly proposalId: string;
  readonly vehicleId: string;
}) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const queryClient = useQueryClient();
  const [returning, setReturning] = useState(false);
  const queryKey = ['owner-vehicle-change-proposal', vehicleId, proposalId] as const;
  const proposal = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.request<OwnerVehicleChangeProposalReviewModel>(
        `/owner/vehicles/${vehicleId}/change-proposals/${proposalId}`,
      ),
    retry: false,
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['owner-vehicle-change-proposals'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['owner-home'] }),
      queryClient.invalidateQueries({ queryKey }),
    ]);
  };
  const approve = useMutation({
    mutationFn: () =>
      apiClient.request<OwnerVehicleChangeProposalDecisionResponse>(
        `/owner/vehicles/${vehicleId}/change-proposals/${proposalId}/approval`,
        { method: 'POST' },
      ),
    onSuccess: async (result) => {
      await refresh();
      if (result.status === 'APPLIED') navigation.goBack();
      else void proposal.refetch();
    },
  });
  const returnForChanges = useMutation({
    mutationFn: (reason: string) =>
      apiClient.request<OwnerVehicleChangeProposalDecisionResponse>(
        `/owner/vehicles/${vehicleId}/change-proposals/${proposalId}/change-request`,
        { body: JSON.stringify({ reason }), method: 'POST' },
      ),
    onSuccess: async () => {
      setReturning(false);
      await refresh();
      navigation.goBack();
    },
  });

  if (proposal.isPending)
    return (
      <Screen scroll={false}>
        <StateView loading title="Loading proposed changes…" />
      </Screen>
    );
  if (proposal.isError || !proposal.data)
    return (
      <Screen scroll={false} leading={<BackControl onPress={() => navigation.goBack()} />}>
        <StateView
          actionLabel="Retry"
          icon="cloud-offline-outline"
          message={errorMessage(proposal.error ?? new Error('Proposal unavailable'))}
          onAction={() => void proposal.refetch()}
          title="Proposal unavailable"
        />
      </Screen>
    );

  const model = proposal.data;
  const pendingOwner = model.status === 'PENDING_OWNER_APPROVAL';
  const title = [model.vehicle.modelYear, model.vehicle.make, model.vehicle.model]
    .filter(Boolean)
    .join(' ');
  const statusLabel = pendingOwner
    ? 'Changes awaiting your approval'
    : model.status === 'PENDING_PLATFORM_REVIEW'
      ? 'Changes under CarShare review'
      : domainLabel(model.status);

  return (
    <>
      <Screen leading={<BackControl onPress={() => navigation.goBack()} />} title="Review changes">
        <Text accessibilityRole="header" style={styles.vehicleTitle}>
          {title}
        </Text>
        <StatusBadge label={statusLabel} tone={pendingOwner ? 'warning' : 'neutral'} />
        <Card style={styles.summaryCard}>
          <Text style={styles.sectionTitle}>Proposal details</Text>
          <DetailRow label="Submitted by" value={model.submitter.displayName} />
          <DetailRow
            label="Submitted"
            value={model.submittedAt ? dateTimeLabel(model.submittedAt) : 'Not submitted'}
          />
        </Card>

        {model.platformReviewRequired ? (
          <Card style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>CarShare review required</Text>
            <Text style={styles.body}>
              If you approve, these changes will be sent to CarShare for review. The live vehicle
              remains unchanged until that review is complete.
            </Text>
          </Card>
        ) : (
          <Card style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>Ready to apply</Text>
            <Text style={styles.body}>If you approve, these changes will apply immediately.</Text>
          </Card>
        )}

        <Text accessibilityRole="header" style={styles.heading}>
          What changed
        </Text>
        {model.comparison.changedFields.map((field) => (
          <Card key={field} style={styles.changeCard}>
            <Text style={styles.fieldTitle}>{fieldLabel(field)}</Text>
            <CompareRow
              label="Current"
              value={displayValue(field, model.comparison.currentSnapshot)}
            />
            <CompareRow
              label="Proposed"
              value={displayValue(field, model.comparison.proposedSnapshot)}
              emphasized
            />
          </Card>
        ))}

        <Text accessibilityRole="header" style={styles.heading}>
          Proposed configuration
        </Text>
        <Card style={styles.summaryCard}>
          <DetailRow label="Vehicle" value={title || 'Vehicle details updated'} />
          <DetailRow
            label="Transmission"
            value={domainLabel(
              model.comparison.proposedSnapshot.vehicle.transmission ?? 'Not configured',
            )}
          />
          <DetailRow
            label="Seats"
            value={String(model.comparison.proposedSnapshot.vehicle.seatCount ?? 'Not configured')}
          />
          <DetailRow
            label="Features"
            value={`${model.comparison.proposedSnapshot.featureIds.length} selected`}
          />
          <DetailRow
            label="Photos"
            value={`${model.comparison.proposedSnapshot.photos.length} photos`}
          />
          <DetailRow
            label="Documents"
            value={`${model.comparison.proposedSnapshot.documents.length} documents`}
          />
          <DetailRow
            label="Location"
            value={displayValue('location', model.comparison.proposedSnapshot)}
          />
          <DetailRow
            label="Daily rate"
            value={money(
              model.comparison.proposedSnapshot.policy.dailyRateMinor,
              model.comparison.proposedSnapshot.policy.currency,
            )}
          />
          <DetailRow
            label="Rental duration"
            value={`${model.comparison.proposedSnapshot.policy.minimumRentalDays}–${model.comparison.proposedSnapshot.policy.maximumRentalDays} days`}
          />
          <DetailRow
            label="Security deposit"
            value={
              model.comparison.proposedSnapshot.policy.securityDepositRequired
                ? money(
                    model.comparison.proposedSnapshot.policy.securityDepositAmountMinor ?? 0,
                    model.comparison.proposedSnapshot.policy.securityDepositCurrency ??
                      model.comparison.proposedSnapshot.policy.currency,
                  )
                : 'Not required'
            }
          />
        </Card>

        {approve.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage(approve.error)}
          </Text>
        ) : null}
        {pendingOwner ? (
          <View style={styles.actions}>
            <Button
              disabled={approve.isPending}
              label={
                model.platformReviewRequired ? 'Approve and send to CarShare' : 'Approve changes'
              }
              onPress={() =>
                Alert.alert(
                  'Approve these changes?',
                  model.platformReviewRequired
                    ? 'The proposal will be sent to CarShare for review.'
                    : 'The proposal will be applied to the live vehicle.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Approve', onPress: () => approve.mutate() },
                  ],
                )
              }
            />
            <Button
              label="Return for changes"
              onPress={() => setReturning(true)}
              variant="secondary"
            />
          </View>
        ) : null}
      </Screen>
      <VehicleOwnerReturnSheet
        error={returnForChanges.error}
        loading={returnForChanges.isPending}
        onCancel={() => setReturning(false)}
        onSubmit={(reason) => returnForChanges.mutate(reason)}
        visible={returning}
      />
    </>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function CompareRow({
  emphasized = false,
  label,
  value,
}: {
  readonly emphasized?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.compareRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, emphasized && styles.proposed]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  body: { color: colors.subtleText, fontSize: typography.body, lineHeight: 22 },
  changeCard: { gap: spacing.sm },
  compareRow: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  error: { color: colors.danger, fontSize: typography.body },
  fieldTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  heading: {
    color: colors.ink,
    fontSize: typography.heading,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  label: { color: colors.subtleText, flex: 1, fontSize: typography.body },
  noticeCard: { backgroundColor: colors.primarySoft, gap: spacing.xs },
  noticeTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  proposed: { color: colors.primary },
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  summaryCard: { gap: spacing.md },
  value: {
    color: colors.ink,
    flex: 1.4,
    fontSize: typography.body,
    fontWeight: '700',
    textAlign: 'right',
  },
  vehicleTitle: { color: colors.ink, fontSize: typography.title, fontWeight: '900' },
});
