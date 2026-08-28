import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import type { BookingView } from '../bookings/MyBookingsScreen';
import { colors, spacing } from '../../theme/tokens';
import { OwnerRentalPanel } from './RentalOperationsPanels';
import { OwnerClaimsPanel } from '../claims/ClaimsPanels';
import { ReviewPanel } from '../reviews/ReviewPanel';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/routes';
import { bookingStatusLabel, dateTimeLabel } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { Card, NestedScreen, StateView, StatusBadge } from '../../ui/primitives';

const operational = new Set([
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
]);

export function OwnerRentalsScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const [selected, setSelected] = useState<string | null>(null);
  const rentals = useQuery({
    queryKey: ['owner-rentals'],
    queryFn: () => apiClient.request<BookingView[]>('/owner/bookings/requests'),
  });
  useRefreshOnFocusAndForeground(() => void rentals.refetch());
  const selectedBooking = rentals.data?.find(({ publicReference }) => publicReference === selected);
  const items = (rentals.data ?? []).filter(({ status }) => operational.has(status));
  return (
    <NestedScreen
      backLabel={selected ? 'All rentals' : 'Back'}
      onBack={selected ? () => setSelected(null) : undefined}
      eyebrow="Owner mode"
      title="Active rentals"
      subtitle="Pickup, return, claims, and renter coordination in one place."
    >
      {selected ? (
        <>
          <OwnerRentalPanel reference={selected} />
          <OwnerClaimsPanel bookingReference={selected} />
          {selectedBooking?.conversationId && (
            <Pressable
              style={styles.action}
              onPress={() =>
                navigation.navigate('Conversation', {
                  conversationId: selectedBooking.conversationId!,
                })
              }
            >
              <Text style={styles.actionText}>Open booking conversation</Text>
            </Pressable>
          )}
          {selectedBooking?.status === 'COMPLETED' && <ReviewPanel bookingReference={selected} />}
        </>
      ) : (
        <>
          {rentals.isPending && <StateView loading title="Loading rentals…" />}
          {rentals.isError && (
            <StateView
              icon="cloud-offline-outline"
              title="Rentals unavailable"
              message={rentals.error.message}
              actionLabel="Retry"
              onAction={() => void rentals.refetch()}
            />
          )}
          {!rentals.isPending && !rentals.isError && items.length === 0 && (
            <StateView
              icon="key-outline"
              title="No active rentals"
              message="Confirmed bookings will appear here as pickup approaches."
            />
          )}
          {items.map((booking) => (
            <Pressable
              key={booking.publicReference}
              onPress={() => setSelected(booking.publicReference)}
            >
              <Card style={styles.card}>
                <VehicleImage
                  contentPath={booking.vehicle.coverPhoto?.contentPath}
                  style={styles.image}
                />
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>
                    {booking.vehicle.make} {booking.vehicle.model}
                  </Text>
                  <StatusBadge label={bookingStatusLabel(booking.status)} />
                  <Text style={styles.body}>Pickup {dateTimeLabel(booking.rentalStart)}</Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </NestedScreen>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  actionText: { color: colors.primary, fontWeight: '800' },
  body: { color: colors.subtleText, marginTop: spacing.xs },
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  flex: { flex: 1, minWidth: 0 },
  image: { borderRadius: 12, height: 92, width: 92 },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.md },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
