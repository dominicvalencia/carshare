import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import type { BookingView } from './MyBookingsScreen';

interface OwnerBookingView extends BookingView {
  readonly renter: {
    displayName: string;
    driverLicenseVerified: boolean;
    emailVerified: boolean;
    mobileVerified: boolean;
  };
}

export function OwnerBookingRequestsScreen() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const requests = useQuery({
    queryKey: ['owner-booking-requests'],
    queryFn: () => apiClient.request<OwnerBookingView[]>('/owner/bookings/requests'),
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['owner-booking', selected],
    queryFn: () => apiClient.request<OwnerBookingView>(`/owner/bookings/${selected}`),
  });
  const decision = useMutation({
    mutationFn: ({ reference, action }: { reference: string; action: 'accept' | 'reject' }) =>
      apiClient.request(`/owner/bookings/${reference}/${action}`, {
        ...(action === 'reject'
          ? { body: JSON.stringify({ reason: 'Owner cannot accommodate requested dates' }) }
          : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
      void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
    },
  });
  const booking = detail.data;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {booking ? (
        <>
          <Pressable onPress={() => setSelected(null)}>
            <Text style={styles.link}>← Requests</Text>
          </Pressable>
          <Text style={styles.title}>{booking.publicReference}</Text>
          <Text style={styles.status}>{booking.status.replaceAll('_', ' ')}</Text>
          <Text style={styles.heading}>{booking.renter.displayName}</Text>
          <Text style={styles.body}>
            Email {booking.renter.emailVerified ? 'verified' : 'not verified'} · Mobile{' '}
            {booking.renter.mobileVerified ? 'verified' : 'not verified'} · License{' '}
            {booking.renter.driverLicenseVerified ? 'verified' : 'not verified'}
          </Text>
          <Text style={styles.heading}>
            {booking.vehicle.make} {booking.vehicle.model}
          </Text>
          <Text style={styles.body}>
            {new Date(booking.rentalStart).toLocaleString()} →{' '}
            {new Date(booking.rentalEnd).toLocaleString()}
          </Text>
          <Text style={styles.heading}>Rental amount</Text>
          <Text style={styles.price}>₱{(booking.pricing.totalMinor / 100).toLocaleString()}</Text>
          <Text style={styles.body}>
            The renter payment method is authorized. Accepting starts capture; confirmation appears
            only after the provider confirms capture.
          </Text>
          {booking.status === 'AWAITING_OWNER' ? (
            <View style={styles.actions}>
              <Pressable
                style={styles.button}
                onPress={() =>
                  decision.mutate({ action: 'accept', reference: booking.publicReference })
                }
              >
                <Text style={styles.buttonText}>Accept request</Text>
              </Pressable>
              <Pressable
                style={styles.secondary}
                onPress={() =>
                  decision.mutate({ action: 'reject', reference: booking.publicReference })
                }
              >
                <Text style={styles.secondaryText}>Reject request</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.notice}>
              <Text style={styles.body}>
                {booking.status === 'CAPTURE_PENDING'
                  ? 'Payment capture is being confirmed. The booking is not confirmed yet.'
                  : booking.status === 'CONFIRMED'
                    ? 'Payment capture is confirmed. Your earning remains pending until the post-return controls are implemented.'
                    : 'No owner decision is available in this state.'}
              </Text>
            </View>
          )}
        </>
      ) : (
        <>
          <Text style={styles.eyebrow}>OWNER MODE</Text>
          <Text style={styles.title}>Booking requests</Text>
          <Text style={styles.body}>
            Requests appear only after the renter payment method is authoritatively authorized.
          </Text>
          {requests.data?.filter(({ status }) => status === 'AWAITING_OWNER').length === 0 && (
            <View style={styles.notice}>
              <Text style={styles.body}>No requests awaiting your response.</Text>
            </View>
          )}
          {requests.data?.map((item) => (
            <Pressable
              key={item.publicReference}
              style={styles.card}
              onPress={() => setSelected(item.publicReference)}
            >
              <Text style={styles.cardTitle}>
                {item.vehicle.make} {item.vehicle.model}
              </Text>
              <Text style={styles.status}>{item.status.replaceAll('_', ' ')}</Text>
              <Text style={styles.body}>{item.publicReference}</Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.xl },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xs },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.md,
  },
  buttonText: { color: colors.onPrimary, fontWeight: '800' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.xl },
  link: { color: colors.primary, fontWeight: '700', marginBottom: spacing.md },
  notice: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  price: { color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: spacing.xs },
  secondary: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
