import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateTimeLabel, money } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import { Button, Card, Chip, Icon, Screen, StateView, StatusBadge } from '../../ui/primitives';
import type { BookingView } from './MyBookingsScreen';

interface OwnerBookingView extends BookingView {
  readonly renter: {
    displayName: string;
    driverLicenseVerified: boolean;
    emailVerified: boolean;
    mobileVerified: boolean;
  };
}

type Filter = 'Needs response' | 'Upcoming' | 'All';

export function OwnerBookingRequestsScreen() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('Needs response');
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
          ? { body: JSON.stringify({ reason: 'Owner cannot accommodate the requested dates' }) }
          : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
      void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
      void client.invalidateQueries({ queryKey: ['owner-rentals'] });
      void client.invalidateQueries({ queryKey: ['owner-earnings'] });
    },
  });

  if (selected) {
    return (
      <OwnerRequestDetail
        booking={detail.data}
        error={detail.error}
        loading={detail.isPending}
        onBack={() => setSelected(null)}
        decision={decision}
      />
    );
  }

  const items = (requests.data ?? []).filter((booking) => {
    if (filter === 'Needs response') return booking.status === 'AWAITING_OWNER';
    if (filter === 'Upcoming')
      return ['CAPTURE_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status);
    return true;
  });
  return (
    <Screen
      eyebrow="Owner mode"
      title="Booking requests"
      subtitle="Requests arrive only after the renter has authorized the rental payment."
    >
      <View style={styles.filters}>
        {(['Needs response', 'Upcoming', 'All'] as const).map((value) => (
          <Chip
            key={value}
            label={value}
            selected={filter === value}
            onPress={() => setFilter(value)}
          />
        ))}
      </View>
      {requests.isPending && <StateView loading title="Loading requests…" />}
      {requests.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Requests unavailable"
          message={requests.error.message}
          actionLabel="Retry"
          onAction={() => void requests.refetch()}
        />
      )}
      {!requests.isPending && !requests.isError && items.length === 0 && (
        <StateView
          icon="file-tray-outline"
          title={filter === 'Needs response' ? 'You’re all caught up' : 'No requests here'}
          message="New authorized requests and their deadlines will appear here."
        />
      )}
      {items.map((booking) => (
        <Pressable
          key={booking.publicReference}
          accessibilityRole="button"
          onPress={() => setSelected(booking.publicReference)}
        >
          <Card style={styles.requestCard}>
            <VehicleImage
              contentPath={booking.vehicle.coverPhoto?.contentPath}
              style={styles.thumbnail}
            />
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.title}>
                {booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model}
              </Text>
              <Text style={styles.body}>{booking.renter.displayName}</Text>
              <Text style={styles.body}>
                {dateTimeLabel(booking.rentalStart)} → {dateTimeLabel(booking.rentalEnd)}
              </Text>
              <View style={styles.metaRow}>
                <StatusBadge
                  label={bookingStatusLabel(booking.status)}
                  tone={booking.status === 'AWAITING_OWNER' ? 'warning' : 'success'}
                />
                <Text style={styles.price}>
                  {money(booking.pricing.totalMinor, booking.pricing.currency)}
                </Text>
              </View>
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

function OwnerRequestDetail({
  booking,
  error,
  loading,
  onBack,
  decision,
}: {
  readonly booking?: OwnerBookingView | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly decision: ReturnType<
    typeof useMutation<unknown, Error, { reference: string; action: 'accept' | 'reject' }>
  >;
}) {
  if (loading)
    return (
      <Screen title="Booking request">
        <StateView loading title="Loading request…" />
      </Screen>
    );
  if (error || !booking)
    return (
      <Screen title="Booking request">
        <StateView
          icon="alert-circle-outline"
          title="Request unavailable"
          message={error?.message}
          actionLabel="Back"
          onAction={onBack}
        />
      </Screen>
    );
  return (
    <Screen eyebrow="Booking request" title={`${booking.vehicle.make} ${booking.vehicle.model}`}>
      <Button icon="arrow-back" label="All requests" onPress={onBack} variant="ghost" />
      <VehicleImage contentPath={booking.vehicle.coverPhoto?.contentPath} style={styles.hero} />
      <View style={styles.metaRow}>
        <StatusBadge
          label={bookingStatusLabel(booking.status)}
          tone={booking.status === 'AWAITING_OWNER' ? 'warning' : 'success'}
        />
        <Text style={styles.price}>
          {money(booking.pricing.totalMinor, booking.pricing.currency)}
        </Text>
      </View>
      <Card>
        <Info icon="person-outline" label="Renter" value={booking.renter.displayName} />
        <Info icon="calendar-outline" label="Pickup" value={dateTimeLabel(booking.rentalStart)} />
        <Info
          icon="return-down-back-outline"
          label="Return"
          value={dateTimeLabel(booking.rentalEnd)}
        />
        {booking.ownerResponseDeadlineAt && (
          <Info
            icon="time-outline"
            label="Respond by"
            value={dateTimeLabel(booking.ownerResponseDeadlineAt)}
          />
        )}
      </Card>
      <Card style={styles.notice}>
        <Text style={styles.title}>Payment is authorized, not captured</Text>
        <Text style={styles.body}>
          Accepting starts payment capture. The booking becomes confirmed only after the provider
          confirms capture. Rejecting releases the authorization.
        </Text>
      </Card>
      <Card>
        <Text style={styles.title}>Renter verification</Text>
        <Text style={styles.body}>
          Email {verified(booking.renter.emailVerified)} · Mobile{' '}
          {verified(booking.renter.mobileVerified)} · Driver’s license{' '}
          {verified(booking.renter.driverLicenseVerified)}
        </Text>
      </Card>
      {booking.status === 'AWAITING_OWNER' ? (
        <>
          <Button
            disabled={decision.isPending}
            label={decision.isPending ? 'Processing decision…' : 'Accept request'}
            onPress={() =>
              Alert.alert(
                'Accept this booking?',
                'Payment capture will begin. Confirmation appears only after the provider confirms it.',
                [
                  { style: 'cancel', text: 'Not yet' },
                  {
                    text: 'Accept booking',
                    onPress: () =>
                      decision.mutate({ action: 'accept', reference: booking.publicReference }),
                  },
                ],
              )
            }
          />
          <Button
            disabled={decision.isPending}
            label="Reject request"
            onPress={() =>
              Alert.alert(
                'Reject this request?',
                'The renter’s payment authorization and vehicle reservation will be released.',
                [
                  { style: 'cancel', text: 'Keep request' },
                  {
                    style: 'destructive',
                    text: 'Reject request',
                    onPress: () =>
                      decision.mutate({ action: 'reject', reference: booking.publicReference }),
                  },
                ],
              )
            }
            variant="danger"
          />
        </>
      ) : (
        <Card>
          <Text style={styles.title}>Next step</Text>
          <Text style={styles.body}>{nextStep(booking.status)}</Text>
        </Card>
      )}
      {decision.isError && <Text style={styles.error}>{decision.error.message}</Text>}
    </Screen>
  );
}

function Info({
  icon,
  label,
  value,
}: {
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View style={styles.info}>
      <Icon color={colors.primary} name={icon} size={20} />
      <View style={styles.flex}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function verified(value: boolean) {
  return value ? 'verified' : 'not yet verified';
}
function nextStep(status: string) {
  if (status === 'CAPTURE_PENDING')
    return 'Payment capture is being confirmed. Do not hand over the vehicle yet.';
  if (status === 'CONFIRMED')
    return 'Prepare the vehicle and complete the pickup inspection when the pickup window opens.';
  if (status === 'READY_FOR_PICKUP')
    return 'Complete pickup inspection, then verify the renter’s six-digit code.';
  return 'This request can no longer be accepted or rejected.';
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, fontSize: 13, lineHeight: 19, marginTop: 2 },
  error: { color: colors.danger, marginTop: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  hero: { borderRadius: radius.lg, height: 210, width: '100%' },
  info: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 62,
  },
  infoLabel: {
    color: colors.subtleText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  infoValue: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 2 },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  notice: { backgroundColor: colors.warningSoft },
  price: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  requestCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  thumbnail: { borderRadius: radius.md, height: 128, width: 108 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
