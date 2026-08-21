import { useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';

interface VehicleSummary {
  readonly id: string;
  readonly status: string;
}

export function OwnerDashboardScreen() {
  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiClient.request<VehicleSummary[]>('/owner/vehicles'),
  });
  const counts = (vehicles.data ?? []).reduce<Record<string, number>>((result, vehicle) => {
    result[vehicle.status] = (result[vehicle.status] ?? 0) + 1;
    return result;
  }, {});
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>OWNER MODE</Text>
      <Text style={styles.title}>Fleet dashboard</Text>
      <Text style={styles.body}>
        Vehicle supply is ready here. Booking, earnings, and rental activity activate in later
        phases.
      </Text>
      <View style={styles.grid}>
        <Metric label="Total vehicles" value={(vehicles.data?.length ?? 0).toString()} />
        <Metric label="Drafts to finish" value={(counts.DRAFT ?? 0).toString()} />
        <Metric label="Pending review" value={(counts.PENDING_APPROVAL ?? 0).toString()} />
        <Metric label="Approved" value={(counts.APPROVED ?? 0).toString()} />
      </View>
      {(counts.CHANGES_REQUIRED ?? 0) + (counts.REJECTED ?? 0) > 0 && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Listings need attention</Text>
          <Text style={styles.body}>
            Open My Vehicles to review feedback, correct, and resubmit.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xl },
  metric: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    minWidth: '46%',
    padding: spacing.lg,
  },
  metricValue: { color: colors.ink, fontSize: 28, fontWeight: '800' },
  notice: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  noticeTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: spacing.sm },
});
