import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { PayoutPanels } from './PayoutPanels';

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
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>OWNER MODE · MORE</Text>
      <Text style={styles.title}>Earnings</Text>
      {earnings.data?.summary && (
        <View style={styles.summary}>
          <Text style={styles.cardTitle}>Pending</Text>
          <Text style={styles.amount}>
            ₱{(earnings.data.summary.pendingMinor / 100).toLocaleString()}
          </Text>
          <Text style={styles.cardTitle}>
            Held · ₱{(earnings.data.summary.heldMinor / 100).toLocaleString()}
          </Text>
          <Text style={styles.cardTitle}>
            Available · ₱{(earnings.data.summary.availableMinor / 100).toLocaleString()}
          </Text>
          <Text style={styles.body}>Eligible for next payout</Text>
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
          <Text style={styles.amount}>₱{(item.projectedTotalMinor / 100).toLocaleString()}</Text>
          <Text style={styles.body}>
            {item.status} · commission ₱{(item.commissionAmountMinor / 100).toLocaleString()}
          </Text>
          <Text style={styles.body}>
            Additional compensation ₱{(item.additionalCompensationMinor / 100).toLocaleString()} ·
            held ₱{(item.heldAmountMinor / 100).toLocaleString()}
          </Text>
          {item.availableAt && (
            <Text style={styles.body}>
              Eligible after {new Date(item.availableAt).toLocaleString()}
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
  );
}

const styles = StyleSheet.create({
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
