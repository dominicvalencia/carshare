import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { PayoutPanels } from './PayoutPanels';
import { dateTimeLabel, earningStatusLabel, money } from '../../ui/format';
import { StateView } from '../../ui/primitives';

interface EarningsResponse {
  readonly notice: string;
  readonly summary: {
    availableMinor: number;
    heldMinor: number;
    pendingMinor: number;
  };
  readonly items: readonly {
    booking: { publicReference: string; vehicle: { make: string | null; model: string | null } };
    commissionAmountMinor: number;
    additionalCompensationMinor: number;
    adjustmentAmountMinor: number;
    heldAmountMinor: number;
    projectedTotalMinor: number;
    availableAt: string | null;
    currency: string;
    netEarningAmountMinor: number;
    status: string;
  }[];
}

export function OwnerEarningsScreen() {
  const earnings = useQuery({
    queryKey: ['owner-earnings'],
    queryFn: () => apiClient.request<EarningsResponse>('/owner/earnings'),
  });
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.eyebrow}>OWNER FINANCES</Text>
        <Text style={styles.title}>Earnings</Text>
        {earnings.isPending && <StateView loading title="Loading earnings…" />}
        {earnings.isError && (
          <StateView
            icon="cloud-offline-outline"
            title="Earnings unavailable"
            message={earnings.error.message}
            actionLabel="Retry"
            onAction={() => void earnings.refetch()}
          />
        )}
        {earnings.data?.summary && (
          <View style={styles.summary}>
            <Text style={styles.cardTitle}>Pending</Text>
            <Text style={styles.amount}>{money(earnings.data.summary.pendingMinor)}</Text>
            <Text style={styles.cardTitle}>Held · {money(earnings.data.summary.heldMinor)}</Text>
            <Text style={styles.cardTitle}>
              Available · {money(earnings.data.summary.availableMinor)}
            </Text>
            <Text style={styles.body}>Available balance can enter your next eligible payout</Text>
          </View>
        )}
        <View style={styles.notice}>
          <Text style={styles.body}>
            {earnings.data?.notice ?? 'Confirmed rental earnings remain pending.'}
          </Text>
        </View>
        {earnings.data?.items.map((item) => (
          <View key={item.booking.publicReference} style={styles.card}>
            <Text style={styles.cardTitle}>
              {item.booking.vehicle.make} {item.booking.vehicle.model}
            </Text>
            <Text style={styles.amount}>{money(item.projectedTotalMinor, item.currency)}</Text>
            <Text style={styles.body}>
              {earningStatusLabel(item.status)} · platform commission{' '}
              {money(item.commissionAmountMinor)}
            </Text>
            <Text style={styles.body}>
              Additional compensation {money(item.additionalCompensationMinor)} · held{' '}
              {money(item.heldAmountMinor)}
            </Text>
            {item.availableAt && (
              <Text style={styles.body}>
                Available for payout after {dateTimeLabel(item.availableAt)}
              </Text>
            )}
            <Text style={styles.body}>{item.booking.publicReference}</Text>
          </View>
        ))}
        {earnings.data?.items.length === 0 && (
          <Text style={styles.body}>No captured rental earnings yet.</Text>
        )}
        <PayoutPanels />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  amount: { color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: spacing.sm },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  notice: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginVertical: spacing.lg,
    padding: spacing.lg,
  },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
