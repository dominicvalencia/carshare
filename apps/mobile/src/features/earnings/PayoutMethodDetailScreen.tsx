import type { OwnerPayoutMethodDetail } from '@carrental/api-contracts';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiClient } from '../../auth/api-client';
import type { RootStackParamList } from '../../navigation/routes';
import { colors, spacing, typography } from '../../theme/tokens';
import { Button, Card, FullScreenState, NestedScreen, StatusBadge } from '../../ui/primitives';
import { payoutMethodStatusPresentation } from './PayoutPanels';

type Navigator = NavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'OwnerPayoutMethodDetail'>;

export function OwnerPayoutMethodDetailScreen() {
  const navigation = useNavigation<Navigator>();
  const route = useRoute<DetailRoute>();
  const queryClient = useQueryClient();
  const payoutMethodId = route.params.payoutMethodId;
  const detail = useQuery({
    queryKey: ['owner-payout-method-detail', payoutMethodId],
    queryFn: () =>
      apiClient.request<OwnerPayoutMethodDetail>(`/owner/payout-methods/${payoutMethodId}`),
  });
  const refreshAuthorities = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['owner-payout-method-detail', payoutMethodId] }),
      queryClient.invalidateQueries({ queryKey: ['owner-payout-methods'] }),
      queryClient.invalidateQueries({ queryKey: ['owner-earnings-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['owner-payouts'] }),
    ]);
  };
  const setPrimary = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/payout-accounts/${payoutMethodId}/default`, { method: 'POST' }),
    onSuccess: async () => {
      await refreshAuthorities();
    },
  });
  const remove = useMutation({
    mutationFn: () =>
      apiClient.request(`/owner/payout-accounts/${payoutMethodId}/disable`, {
        body: JSON.stringify({ reason: 'Removed by owner from payout methods.' }),
        method: 'POST',
      }),
    onSuccess: async () => {
      await refreshAuthorities();
      navigation.navigate('OwnerPayoutMethods');
    },
  });

  const mutationError = ownerSafeMutationError(setPrimary.error ?? remove.error);
  const method = detail.data;

  if (detail.isPending) {
    return (
      <NestedScreen scroll={false} title="Payout method" onBack={() => navigation.goBack()}>
        <FullScreenState loading title="Loading payout method…" />
      </NestedScreen>
    );
  }
  if (detail.isError || !method) {
    const notFound =
      detail.error instanceof ApiError && detail.error.code === 'PAYOUT_METHOD_NOT_FOUND';
    return (
      <NestedScreen scroll={false} title="Payout method" onBack={() => navigation.goBack()}>
        <FullScreenState
          icon={notFound ? 'wallet-outline' : 'cloud-offline-outline'}
          title={notFound ? 'Payout method not found' : 'Payout method unavailable'}
          message={
            notFound
              ? 'This payout method is no longer available.'
              : "We couldn't load this payout method."
          }
          actionLabel={notFound ? 'Back' : 'Retry'}
          onAction={notFound ? () => navigation.goBack() : () => void detail.refetch()}
        />
      </NestedScreen>
    );
  }

  const status = payoutMethodStatusPresentation(method.status);
  const statusCopy = payoutMethodStatusCopy(method.status);
  const canSetPrimary = method.status === 'READY' && method.actions.canSetPrimary;
  const removalBlocked = method.actions.removalBlockedReason === 'PAYOUT_IN_PROGRESS';

  const confirmPrimary = () => {
    Alert.alert(
      `Make ${method.institution.displayName} ${method.maskedAccountIdentifier} your primary payout method?`,
      'Future payouts will use this method. Payouts already in progress keep their current destination.',
      [
        { style: 'cancel', text: 'Cancel' },
        {
          text: 'Set as primary',
          onPress: () => {
            if (!setPrimary.isPending) setPrimary.mutate();
          },
        },
      ],
    );
  };
  const confirmRemove = () => {
    const primaryCopy = method.isPrimary
      ? ' After removal, add or select another ready method before future payouts can be sent.'
      : '';
    Alert.alert(
      'Remove payout method?',
      `${method.institution.displayName} ${method.maskedAccountIdentifier} will no longer be available for future payouts.${primaryCopy}`,
      [
        { style: 'cancel', text: 'Cancel' },
        {
          style: 'destructive',
          text: 'Remove payout method',
          onPress: () => {
            if (!remove.isPending) remove.mutate();
          },
        },
      ],
    );
  };

  return (
    <NestedScreen
      title={method.institution.displayName}
      subtitle={method.maskedAccountIdentifier}
      onBack={() => navigation.goBack()}
    >
      <View
        accessibilityLabel={`${method.institution.displayName}. ${method.maskedAccountIdentifier}. ${method.isPrimary ? 'Primary. ' : ''}${status.label}. Account holder ${method.accountHolderName}.`}
        style={styles.badges}
      >
        {method.isPrimary && <StatusBadge label="Primary" tone="success" />}
        <StatusBadge label={status.label} tone={status.tone} />
      </View>

      {statusCopy && (
        <View style={styles.statusCopy}>
          <Text style={styles.body}>{statusCopy}</Text>
        </View>
      )}

      <Card style={styles.detailsCard}>
        <DetailRow label="Account holder" value={method.accountHolderName} />
        <DetailRow label="Added" value={dateLabel(method.createdAt)} />
        {method.verifiedAt && <DetailRow label="Verified" value={dateLabel(method.verifiedAt)} />}
        {method.disabledAt && <DetailRow label="Removed" value={dateLabel(method.disabledAt)} />}
      </Card>

      {(canSetPrimary || method.actions.canRemove || removalBlocked) && (
        <>
          <Text accessibilityRole="header" style={styles.actionsTitle}>
            Actions
          </Text>
          {canSetPrimary && (
            <View style={styles.actionBlock}>
              <Button
                label={setPrimary.isPending ? 'Setting as primary…' : 'Set as primary'}
                disabled={setPrimary.isPending || remove.isPending}
                onPress={confirmPrimary}
              />
              <Text style={styles.helper}>
                Future payouts will use this method. Payouts already in progress will not change.
              </Text>
            </View>
          )}
          {(method.actions.canRemove || removalBlocked) && (
            <View style={styles.removeSection}>
              <Text style={styles.removeTitle}>Remove payout method</Text>
              {removalBlocked && (
                <Text style={styles.helper}>
                  This payout method can’t be removed while a payout is in progress.
                </Text>
              )}
              {method.actions.canRemove && (
                <Button
                  label={remove.isPending ? 'Removing payout method…' : 'Remove payout method'}
                  variant="danger"
                  disabled={remove.isPending || setPrimary.isPending}
                  onPress={confirmRemove}
                />
              )}
            </View>
          )}
        </>
      )}

      {mutationError && (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <Text style={styles.errorText}>{mutationError}</Text>
        </View>
      )}
    </NestedScreen>
  );
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function payoutMethodStatusCopy(status: OwnerPayoutMethodDetail['status']) {
  if (status === 'PENDING_VERIFICATION')
    return 'This method can’t receive payouts until verification is complete.';
  if (status === 'NEEDS_ATTENTION')
    return 'This payout method needs attention before it can be used.';
  if (status === 'UNAVAILABLE') return 'This payout method is unavailable for future payouts.';
  return null;
}

function ownerSafeMutationError(error: Error | null) {
  if (!error) return null;
  if (
    error instanceof ApiError &&
    (error.code === 'PAYOUT_METHOD_IN_USE' || error.code === 'PAYOUT_ACCOUNT_IN_USE')
  )
    return 'This payout method can’t be removed while a payout is in progress.';
  if (error instanceof ApiError && error.code === 'PAYOUT_METHOD_NOT_READY')
    return 'Only a ready payout method can be set as primary.';
  if (error instanceof ApiError && error.code === 'PAYOUT_METHOD_NOT_FOUND')
    return 'This payout method is no longer available.';
  return 'We could not update this payout method. Try again.';
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  actionBlock: { gap: spacing.sm },
  actionsTitle: { color: colors.ink, fontSize: typography.heading, fontWeight: '900' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  body: { color: colors.subtleText, fontSize: typography.body, lineHeight: 22 },
  detailLabel: { color: colors.subtleText, fontSize: typography.label, fontWeight: '700' },
  detailRow: { gap: spacing.xs },
  detailValue: { color: colors.ink, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  detailsCard: { gap: spacing.lg },
  error: { backgroundColor: colors.dangerSoft, borderRadius: 14, padding: spacing.md },
  errorText: { color: colors.danger, fontSize: typography.body, lineHeight: 21 },
  helper: { color: colors.subtleText, fontSize: typography.body, lineHeight: 22 },
  removeSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  removeTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  statusCopy: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md },
});
