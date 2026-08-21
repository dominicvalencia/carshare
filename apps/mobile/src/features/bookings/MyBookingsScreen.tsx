import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, spacing } from '../../theme/tokens';
import { RenterRentalPanel } from '../rentals/RentalOperationsPanels';
import { RenterClaimsPanel } from '../claims/ClaimsPanels';

export interface BookingView {
  readonly publicReference: string;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly holdExpiresAt: string | null;
  readonly ownerResponseDeadlineAt: string | null;
  readonly pricing: { totalMinor: number; currency: string };
  readonly payments: readonly {
    amountMinor: number;
    authorizedAmountMinor: number;
    capturedAmountMinor: number;
    currency: string;
    purpose: string;
    status: string;
  }[];
  readonly vehicle: {
    make: string | null;
    model: string | null;
    year: number | null;
    location: { city: string; province: string } | null;
  };
  readonly statusHistory: readonly {
    toStatus: string;
    occurredAt: string;
    reasonCode: string | null;
  }[];
}

export function MyBookingsScreen() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: () => apiClient.request<BookingView[]>('/bookings'),
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['booking', selected],
    queryFn: () => apiClient.request<BookingView>(`/bookings/${selected}`),
  });
  const cancel = useMutation({
    mutationFn: (reference: string) =>
      apiClient.request<BookingView>(`/bookings/${reference}/cancel`, {
        body: JSON.stringify({ reason: 'Cancelled by renter in mobile application' }),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['bookings'] });
      void client.invalidateQueries({ queryKey: ['booking', selected] });
    },
  });
  const payment = useMutation({
    mutationFn: async (booking: BookingView) => {
      if (booking.status === 'HOLD') {
        await apiClient.request(`/bookings/${booking.publicReference}/continue`, {
          method: 'POST',
        });
      }
      const result = await apiClient.request<{
        customerActionUrl: string | null;
        status: string;
      }>(`/bookings/${booking.publicReference}/payment/authorize`, { method: 'POST' });
      if (result.customerActionUrl) await Linking.openURL(result.customerActionUrl);
      return result;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['bookings'] });
      void client.invalidateQueries({ queryKey: ['booking', selected] });
    },
  });
  const refreshPayment = useMutation({
    mutationFn: (reference: string) => apiClient.request(`/bookings/${reference}/payment`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['booking', selected] });
      void client.invalidateQueries({ queryKey: ['bookings'] });
    },
  });

  const booking = detail.data;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {booking ? (
        <>
          <Pressable onPress={() => setSelected(null)}>
            <Text style={styles.link}>← My bookings</Text>
          </Pressable>
          <Text style={styles.title}>{booking.publicReference}</Text>
          <Text style={styles.status}>{statusLabel(booking.status)}</Text>
          <Text style={styles.heading}>
            {booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model}
          </Text>
          <Text style={styles.body}>
            {new Date(booking.rentalStart).toLocaleString()} →{' '}
            {new Date(booking.rentalEnd).toLocaleString()}
          </Text>
          <Text style={styles.price}>₱{(booking.pricing.totalMinor / 100).toLocaleString()}</Text>
          {(booking.status === 'HOLD' || booking.status === 'AWAITING_PAYMENT') && (
            <View style={styles.notice}>
              <Text style={styles.cardTitle}>Authorize your payment method</Text>
              <Text style={styles.body}>
                You will be charged only if the owner accepts. The vehicle hold expires{' '}
                {booking.holdExpiresAt
                  ? new Date(booking.holdExpiresAt).toLocaleString()
                  : 'at its deadline'}
                .
              </Text>
              <Pressable
                style={styles.button}
                disabled={payment.isPending}
                onPress={() => payment.mutate(booking)}
              >
                <Text style={styles.buttonText}>
                  {payment.isPending ? 'Opening secure payment…' : 'Continue to secure payment'}
                </Text>
              </Pressable>
            </View>
          )}
          {booking.payments.some(({ status }) => status === 'AUTHORIZED') && (
            <View style={styles.notice}>
              <Text style={styles.cardTitle}>Payment method authorized</Text>
              <Text style={styles.body}>
                You will be charged if the owner accepts your booking.
              </Text>
            </View>
          )}
          {booking.payments.some(
            ({ status }) => status === 'AUTHORIZING' || status === 'CAPTURING',
          ) && (
            <View style={styles.notice}>
              <Text style={styles.cardTitle}>Payment processing</Text>
              <Text style={styles.body}>
                A timeout is not a decline. We are checking the provider before allowing another
                financial action.
              </Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => refreshPayment.mutate(booking.publicReference)}
              >
                <Text style={styles.secondaryText}>Refresh authoritative status</Text>
              </Pressable>
            </View>
          )}
          {[
            'CONFIRMED',
            'READY_FOR_PICKUP',
            'ACTIVE',
            'RETURN_PENDING',
            'RETURNED',
            'COMPLETED',
          ].includes(booking.status) && <RenterRentalPanel reference={booking.publicReference} />}
          <RenterClaimsPanel bookingReference={booking.publicReference} />
          <Text style={styles.heading}>Status history</Text>
          {booking.statusHistory.map((entry) => (
            <View key={`${entry.occurredAt}-${entry.toStatus}`} style={styles.history}>
              <Text style={styles.cardTitle}>{statusLabel(entry.toStatus)}</Text>
              <Text style={styles.body}>{new Date(entry.occurredAt).toLocaleString()}</Text>
            </View>
          ))}
          {['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER'].includes(booking.status) && (
            <Pressable
              style={styles.dangerButton}
              onPress={() => cancel.mutate(booking.publicReference)}
            >
              <Text style={styles.dangerText}>Cancel and release hold</Text>
            </Pressable>
          )}
        </>
      ) : (
        <>
          <Text style={styles.eyebrow}>RENTER MODE</Text>
          <Text style={styles.title}>My bookings</Text>
          {bookings.isPending && <Text style={styles.body}>Loading bookings…</Text>}
          {bookings.isError && <Text style={styles.error}>{bookings.error.message}</Text>}
          {bookings.data?.length === 0 && (
            <View style={styles.notice}>
              <Text style={styles.body}>
                No booking holds yet. Start from an authoritative quote.
              </Text>
            </View>
          )}
          {bookings.data?.map((item) => (
            <Pressable
              key={item.publicReference}
              style={styles.card}
              onPress={() => setSelected(item.publicReference)}
            >
              <Text style={styles.cardTitle}>
                {item.vehicle.make} {item.vehicle.model}
              </Text>
              <Text style={styles.status}>{statusLabel(item.status)}</Text>
              <Text style={styles.body}>{item.publicReference}</Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    HOLD: 'Vehicle held temporarily',
    AWAITING_PAYMENT: 'Awaiting payment setup',
    AWAITING_OWNER: 'Awaiting owner response',
    CAPTURE_PENDING: 'Owner accepted · confirming payment',
    CONFIRMED: 'Confirmed · payment captured',
    READY_FOR_PICKUP: 'Ready for pickup',
    ACTIVE: 'Active rental',
    RETURN_PENDING: 'Return pending',
    RETURNED: 'Returned · under review',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    EXPIRED: 'Expired',
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: { color: colors.ink, fontWeight: '800' },
  dangerButton: {
    alignItems: 'center',
    borderColor: '#A12626',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  dangerText: { color: '#A12626', fontWeight: '800' },
  error: { color: '#A12626', marginTop: spacing.md },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  heading: { color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: spacing.xl },
  history: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: spacing.md },
  link: { color: colors.primary, fontWeight: '700', marginBottom: spacing.md },
  notice: {
    backgroundColor: '#FFF6DE',
    borderRadius: 14,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  page: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.xl },
  price: { color: colors.ink, fontSize: 24, fontWeight: '800', marginTop: spacing.lg },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  status: { color: colors.primary, fontWeight: '700', marginTop: spacing.xs },
  title: { color: colors.ink, fontSize: 28, fontWeight: '800' },
});
