import type { NavigationProp } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import type { OwnerStatus } from '../../auth/auth.types';
import type { OwnerTabParamList, RootStackParamList } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { titleCase } from '../../ui/format';
import { Card, Icon, Screen, SectionHeader, StateView, StatusBadge } from '../../ui/primitives';

interface VehicleSummary {
  readonly id: string;
  readonly status: string;
}
interface BookingSummary {
  readonly status: string;
}
export function OwnerDashboardScreen({
  ownerStatus,
}: {
  readonly ownerStatus: OwnerStatus | null;
}) {
  const navigation = useNavigation<NavigationProp<OwnerTabParamList & RootStackParamList>>();
  const vehicles = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => apiClient.request<VehicleSummary[]>('/owner/vehicles'),
  });
  const bookings = useQuery({
    queryKey: ['owner-booking-requests'],
    queryFn: () => apiClient.request<BookingSummary[]>('/owner/bookings/requests'),
    enabled: ownerStatus === 'VERIFIED',
    retry: false,
  });
  useRefreshOnFocusAndForeground(() => {
    void vehicles.refetch();
    if (ownerStatus === 'VERIFIED') void bookings.refetch();
  });
  const dashboardError = vehicles.error ?? bookings.error;
  if (dashboardError)
    return (
      <Screen eyebrow="Owner mode" title="Dashboard">
        <StateView
          icon="cloud-offline-outline"
          title="Dashboard unavailable"
          message={dashboardError.message}
          actionLabel="Retry"
          onAction={() => {
            void vehicles.refetch();
            if (ownerStatus === 'VERIFIED') void bookings.refetch();
          }}
        />
      </Screen>
    );
  if (vehicles.isPending || (ownerStatus === 'VERIFIED' && bookings.isPending))
    return (
      <Screen eyebrow="Owner mode" title="Dashboard">
        <StateView loading title="Loading owner dashboard…" />
      </Screen>
    );
  const counts = (vehicles.data ?? []).reduce<Record<string, number>>((result, vehicle) => {
    result[vehicle.status] = (result[vehicle.status] ?? 0) + 1;
    return result;
  }, {});
  const requests = bookings.data?.filter((item) => item.status === 'AWAITING_OWNER').length ?? 0;
  const upcoming =
    bookings.data?.filter((item) => ['CONFIRMED', 'READY_FOR_PICKUP'].includes(item.status))
      .length ?? 0;
  const active = bookings.data?.filter((item) => item.status === 'ACTIVE').length ?? 0;
  return (
    <Screen
      eyebrow="Owner mode"
      title="Dashboard"
      subtitle="A quick view of your fleet and rental activity."
      action={
        <StatusBadge
          label={titleCase(ownerStatus ?? 'DRAFT')}
          tone={ownerStatus === 'VERIFIED' ? 'success' : 'warning'}
        />
      }
    >
      {ownerStatus !== 'VERIFIED' && (
        <Card style={styles.verification}>
          <View style={styles.row}>
            <Icon color={colors.warning} name="shield-outline" size={28} />
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>Complete owner verification</Text>
              <Text style={styles.body}>
                You can build vehicle drafts now. Publishing listings and accepting requests unlock
                after verification.
              </Text>
            </View>
          </View>
          <Pressable onPress={() => navigation.navigate('OwnerOnboarding')}>
            <Text style={styles.link}>Continue verification →</Text>
          </Pressable>
        </Card>
      )}
      <View style={styles.grid}>
        <Metric icon="car-sport-outline" label="Fleet" value={vehicles.data?.length ?? 0} />
        <Metric
          icon="file-tray-full-outline"
          label="Requests"
          value={requests}
          attention={requests > 0}
        />
        <Metric icon="key-outline" label="Active rentals" value={active} />
        <Metric icon="calendar-outline" label="Upcoming rentals" value={upcoming} />
        <Metric icon="create-outline" label="Drafts" value={counts.DRAFT ?? 0} />
      </View>
      <SectionHeader title="Quick actions" />
      <View style={styles.actions}>
        <Action
          icon="car-sport-outline"
          label="Manage fleet"
          onPress={() => navigation.navigate('Vehicles')}
        />
        <Action
          icon="file-tray-full-outline"
          label="Booking requests"
          onPress={() => navigation.navigate('Requests')}
        />
        <Action
          icon="key-outline"
          label="Active rentals"
          onPress={() => navigation.navigate('OwnerRentals')}
        />
        <Action
          icon="wallet-outline"
          label="Earnings"
          onPress={() => navigation.navigate('OwnerEarnings')}
        />
      </View>
      {(counts.CHANGES_REQUIRED ?? 0) + (counts.REJECTED ?? 0) > 0 && (
        <Card style={styles.verification}>
          <Text style={styles.cardTitle}>Listings need attention</Text>
          <Text style={styles.body}>
            Review admin feedback, make the requested corrections, and resubmit when ready.
          </Text>
        </Card>
      )}
    </Screen>
  );
}
function Metric({
  icon,
  label,
  value,
  attention = false,
}: {
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly label: string;
  readonly value: number;
  readonly attention?: boolean;
}) {
  return (
    <Card style={styles.metric}>
      <Icon color={attention ? colors.warning : colors.primary} name={icon} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.body}>{label}</Text>
    </Card>
  );
}
function Action({
  icon,
  label,
  onPress,
}: {
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
      <View style={styles.actionIcon}>
        <Icon color={colors.primary} name={icon} />
      </View>
      <Text style={styles.actionText}>{label}</Text>
      <Icon color={colors.subtleText} name="chevron-forward" size={18} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 64,
    padding: spacing.sm,
  },
  actionIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  actionText: { color: colors.ink, flex: 1, fontWeight: '800' },
  actions: { gap: spacing.xs },
  body: { color: colors.subtleText, lineHeight: 20, marginTop: 2 },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  link: { color: colors.primary, fontWeight: '800', marginTop: spacing.sm },
  metric: { minWidth: '46%' },
  metricValue: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: spacing.xs },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  verification: { backgroundColor: colors.warningSoft },
});
