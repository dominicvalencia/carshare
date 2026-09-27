import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateTimeLabel, money, titleCase } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import {
  BackControl,
  Button,
  Card,
  Chip,
  Icon,
  Screen,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import type { BookingView } from './MyBookingsScreen';
import { BookingCancellationSheet } from './BookingCancellationSheet';

interface OwnerBookingView extends BookingView {
  readonly renter: {
    accountStanding: string;
    averageRating: number | null;
    completedRentals: number;
    displayName: string;
    driverLicenseVerified: boolean;
    emailVerified: boolean;
    identityVerified: boolean;
    memberSince: string;
    mobileVerified: boolean;
    reviewCount: number;
    verificationLabel: string;
    verified: boolean;
  };
}

type Filter = 'Needs response' | 'Upcoming' | 'All';

export function OwnerBookingRequestsScreen({
  initialBookingReference,
  onClose,
}: {
  readonly initialBookingReference?: string;
  readonly onClose?: () => void;
} = {}) {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(initialBookingReference ?? null);
  const [filter, setFilter] = useState<Filter>('Needs response');
  const requests = useQuery({
    queryKey: ['owner-booking-requests'],
    queryFn: () => apiClient.request<OwnerBookingView[]>('/owner/bookings/requests'),
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['owner-booking', selected],
    queryFn: () => apiClient.request<OwnerBookingView>(`/owner/bookings/${selected}`),
    refetchInterval: (query) =>
      query.state.data &&
      ['AWAITING_OWNER', 'CAPTURE_PENDING', 'READY_FOR_PICKUP', 'RETURN_PENDING'].includes(
        query.state.data.status,
      )
        ? 5_000
        : false,
  });
  useRefreshOnFocusAndForeground(() => {
    void requests.refetch();
    if (selected) void detail.refetch();
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
      void client.invalidateQueries({ queryKey: ['public-search'] });
    },
  });

  if (selected) {
    return (
      <OwnerRequestDetail
        booking={detail.data}
        error={detail.error}
        loading={detail.isPending}
        onBack={onClose ?? (() => setSelected(null))}
        onCancellationCompleted={() => {
          void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
          void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
          void client.invalidateQueries({ queryKey: ['owner-rentals'] });
          void client.invalidateQueries({ queryKey: ['owner-earnings'] });
          void client.invalidateQueries({ queryKey: ['public-search'] });
        }}
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
                <View style={styles.statusSlot}>
                  <StatusBadge
                    label={bookingStatusLabel(booking.status, 'owner')}
                    tone={booking.status === 'AWAITING_OWNER' ? 'warning' : 'success'}
                  />
                </View>
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
  onCancellationCompleted,
  decision,
}: {
  readonly booking?: OwnerBookingView | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly onCancellationCompleted: () => void;
  readonly decision: ReturnType<
    typeof useMutation<unknown, Error, { reference: string; action: 'accept' | 'reject' }>
  >;
}) {
  const [trustProfileOpen, setTrustProfileOpen] = useState(false);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  if (loading)
    return (
      <Screen
        leading={<BackControl label="All requests" onPress={onBack} />}
        title="Booking request"
      >
        <StateView loading title="Loading request…" />
      </Screen>
    );
  if (error || !booking)
    return (
      <Screen
        leading={<BackControl label="All requests" onPress={onBack} />}
        title="Booking request"
      >
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
    <Screen
      leading={<BackControl label="All requests" onPress={onBack} />}
      eyebrow="Booking request"
      title={`${booking.vehicle.make} ${booking.vehicle.model}`}
    >
      <VehicleImage contentPath={booking.vehicle.coverPhoto?.contentPath} style={styles.hero} />
      <View style={styles.metaRow}>
        <View style={styles.statusSlot}>
          <StatusBadge
            label={bookingStatusLabel(booking.status, 'owner')}
            tone={booking.status === 'AWAITING_OWNER' ? 'warning' : 'success'}
          />
        </View>
        <Text style={styles.price}>
          {money(booking.pricing.totalMinor, booking.pricing.currency)}
        </Text>
      </View>
      {booking.status === 'AWAITING_OWNER' && (
        <Card style={styles.notice}>
          <Text style={styles.title}>Waiting for your response</Text>
          <Text style={styles.body}>
            The renter is waiting for you to accept or decline this booking request.
          </Text>
        </Card>
      )}
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
      <Card>
        <Text style={styles.title}>Handover request</Text>
        <Info
          icon="navigate-outline"
          label="Start"
          value={
            booking.fulfillment.startMethod === 'OWNER_DELIVERY'
              ? 'Deliver to renter'
              : 'Renter pickup'
          }
        />
        {booking.fulfillment.startLocation && (
          <Info
            icon="location-outline"
            label="Start location"
            value={ownerFulfillmentLocation(booking.fulfillment.startLocation)}
          />
        )}
        {booking.fulfillment.startMethod === 'OWNER_DELIVERY' && (
          <Info
            icon="cash-outline"
            label="Delivery fee"
            value={money(booking.fulfillment.deliveryFeeMinor, booking.pricing.currency)}
          />
        )}
        <Info
          icon="return-down-back-outline"
          label="End"
          value={
            booking.fulfillment.endMethod === 'OWNER_COLLECTION'
              ? 'Owner collection'
              : 'Renter return'
          }
        />
        {booking.fulfillment.endLocation && (
          <Info
            icon="location-outline"
            label="End location"
            value={ownerFulfillmentLocation(booking.fulfillment.endLocation)}
          />
        )}
        {booking.fulfillment.endMethod === 'OWNER_COLLECTION' && (
          <Info
            icon="cash-outline"
            label="Collection fee"
            value={money(booking.fulfillment.collectionFeeMinor, booking.pricing.currency)}
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
        <View style={styles.metaRow}>
          <Text style={styles.title}>Renter verification</Text>
          <StatusBadge
            label={booking.renter.verificationLabel}
            tone={booking.renter.verified ? 'success' : 'warning'}
          />
        </View>
        <Text style={styles.body}>
          Identity {verified(booking.renter.identityVerified)} · Email{' '}
          {verified(booking.renter.emailVerified)} · Mobile{' '}
          {verified(booking.renter.mobileVerified)} · Driver’s license{' '}
          {verified(booking.renter.driverLicenseVerified)}
        </Text>
        <Button
          label={trustProfileOpen ? 'Hide renter profile' : 'View renter trust profile'}
          onPress={() => setTrustProfileOpen(!trustProfileOpen)}
          variant="ghost"
        />
        {trustProfileOpen && (
          <View style={styles.trustProfile}>
            <Info icon="person-circle-outline" label="Renter" value={booking.renter.displayName} />
            <Info
              icon="star-outline"
              label="Marketplace history"
              value={
                booking.renter.averageRating
                  ? `${booking.renter.averageRating.toFixed(1)} rating · ${booking.renter.reviewCount} reviews`
                  : 'No published renter reviews yet'
              }
            />
            <Info
              icon="car-outline"
              label="Completed rentals"
              value={String(booking.renter.completedRentals)}
            />
            <Info
              icon="shield-outline"
              label="Account standing"
              value={titleCase(booking.renter.accountStanding)}
            />
            <Text style={styles.note}>
              Identity documents, license numbers, and residential address are reviewed only by
              authorized platform staff and are never shown here.
            </Text>
          </View>
        )}
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
          <Text style={styles.body}>{nextStep(booking)}</Text>
        </Card>
      )}
      <Card>
        <Text style={styles.title}>Booking timeline</Text>
        <Text style={styles.note}>Only recorded booking events appear here.</Text>
        {booking.statusHistory.map((entry, index) => (
          <View key={`${entry.occurredAt}-${entry.toStatus}`} style={styles.timelineRow}>
            <View style={styles.timelineTrack}>
              <View style={styles.timelineDot} />
              {index < booking.statusHistory.length - 1 && <View style={styles.timelineLine} />}
            </View>
            <View style={styles.flex}>
              <Text style={styles.infoValue}>{bookingStatusLabel(entry.toStatus, 'owner')}</Text>
              <Text style={styles.body}>{dateTimeLabel(entry.occurredAt)}</Text>
            </View>
          </View>
        ))}
      </Card>
      {decision.isError && <Text style={styles.error}>{decision.error.message}</Text>}
      {['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status) && (
        <Button label="Cancel booking" onPress={() => setCancellationOpen(true)} variant="danger" />
      )}
      <BookingCancellationSheet
        bookingReference={booking.publicReference}
        onClose={() => setCancellationOpen(false)}
        onCompleted={onCancellationCompleted}
        role="OWNER"
        visible={cancellationOpen}
      />
    </Screen>
  );
}

function ownerFulfillmentLocation(location: {
  readonly addressLine1: string | null;
  readonly city: string;
  readonly province: string;
}) {
  return [location.addressLine1, location.city, location.province].filter(Boolean).join(', ');
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
function nextStep(booking: OwnerBookingView) {
  if (booking.status === 'CAPTURE_PENDING')
    return 'Payment capture is being confirmed. Do not hand over the vehicle yet.';
  if (booking.status === 'CONFIRMED')
    return `Pickup is scheduled for ${dateTimeLabel(booking.rentalStart)}. Handover becomes available at ${dateTimeLabel(booking.pickupWindow?.opensAt ?? booking.rentalStart)}. Prepare the vehicle and complete the pickup inspection with the renter.`;
  if (booking.status === 'READY_FOR_PICKUP')
    return 'Complete pickup inspection, then verify the renter’s six-digit code.';
  return 'This request can no longer be accepted or rejected.';
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, fontSize: 13, lineHeight: 19, marginTop: 2 },
  error: { color: colors.danger, marginTop: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  hero: { borderRadius: radius.lg, height: 210, width: '100%' },
  trustProfile: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: spacing.sm },
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
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  notice: { backgroundColor: colors.warningSoft },
  note: { color: colors.subtleText, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  price: {
    color: colors.ink,
    flexShrink: 0,
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 'auto',
  },
  requestCard: { flexDirection: 'row', gap: spacing.sm },
  statusSlot: { flexShrink: 1 },
  thumbnail: { borderRadius: radius.md, height: 128, width: 108 },
  timelineDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 12,
    width: 12,
  },
  timelineLine: { backgroundColor: colors.border, flex: 1, marginVertical: 3, width: 2 },
  timelineRow: { flexDirection: 'row', gap: spacing.sm, minHeight: 58, marginTop: spacing.sm },
  timelineTrack: { alignItems: 'center', width: 16 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
