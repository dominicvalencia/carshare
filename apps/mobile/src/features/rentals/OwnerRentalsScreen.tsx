import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { apiClient } from '../../auth/api-client';
import type { BookingView } from '../bookings/MyBookingsScreen';
import { colors, spacing } from '../../theme/tokens';
import { OwnerRentalPanel } from './RentalOperationsPanels';
import { OwnerClaimsPanel } from '../claims/ClaimsPanels';

const operational = new Set([
  'CONFIRMED',
  'READY_FOR_PICKUP',
  'ACTIVE',
  'RETURN_PENDING',
  'RETURNED',
  'COMPLETED',
]);

export function OwnerRentalsScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const rentals = useQuery({
    queryKey: ['owner-rentals'],
    queryFn: () => apiClient.request<BookingView[]>('/owner/bookings/requests'),
  });
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.eyebrow}>OWNER MODE</Text>
      <Text style={styles.title}>Rentals</Text>
      {selected ? (
        <>
          <Pressable onPress={() => setSelected(null)}>
            <Text style={styles.link}>← All rentals</Text>
          </Pressable>
          <OwnerRentalPanel reference={selected} />
          <OwnerClaimsPanel bookingReference={selected} />
        </>
      ) : (
        rentals.data
          ?.filter(({ status }) => operational.has(status))
          .map((booking) => (
            <Pressable
              key={booking.publicReference}
              style={styles.card}
              onPress={() => setSelected(booking.publicReference)}
            >
              <Text style={styles.cardTitle}>
                {booking.vehicle.make} {booking.vehicle.model}
              </Text>
              <Text style={styles.status}>{booking.status.replaceAll('_', ' ')}</Text>
              <Text style={styles.body}>{new Date(booking.rentalStart).toLocaleString()}</Text>
            </Pressable>
          ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  link: { color: colors.primary, fontWeight: '700', marginTop: spacing.md },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
