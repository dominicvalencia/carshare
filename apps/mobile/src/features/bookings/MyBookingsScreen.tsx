import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { apiClient } from '../../auth/api-client';
import type { RenterTabParamList } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateLabel, dateTimeLabel, money, titleCase } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import {
  Button,
  Card,
  Icon,
  Screen,
  SectionHeader,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import { RenterClaimsPanel } from '../claims/ClaimsPanels';
import { RenterRentalPanel } from '../rentals/RentalOperationsPanels';
import { ReviewPanel } from '../reviews/ReviewPanel';

interface ContentGrant {
  readonly contentPath: string;
  readonly expiresAt: string;
}

export interface BookingView {
  readonly publicReference: string;
  readonly conversationId: string | null;
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
    coverPhoto: ContentGrant | null;
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
type BookingGroup = 'Upcoming' | 'Active' | 'Completed' | 'Cancelled';
export function MyBookingsScreen() {
  const navigation = useNavigation<NavigationProp<RenterTabParamList>>();
  const route = useRoute<RouteProp<RenterTabParamList, 'Bookings'>>();
  const client = useQueryClient();
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const selected = manualSelection ?? route.params?.bookingId ?? null;
  const [group, setGroup] = useState<BookingGroup>('Upcoming');
  const [filterOpen, setFilterOpen] = useState(false);
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
    onSuccess: () => refresh(client, selected),
  });
  const payment = useMutation({
    mutationFn: async (booking: BookingView) => {
      if (booking.status === 'HOLD')
        await apiClient.request(`/bookings/${booking.publicReference}/continue`, {
          method: 'POST',
        });
      const result = await apiClient.request<{ customerActionUrl: string | null; status: string }>(
        `/bookings/${booking.publicReference}/payment/authorize`,
        { method: 'POST' },
      );
      if (result.customerActionUrl) await Linking.openURL(result.customerActionUrl);
      return result;
    },
    onSuccess: () => refresh(client, selected),
  });
  const refreshPayment = useMutation({
    mutationFn: (reference: string) => apiClient.request(`/bookings/${reference}/payment`),
    onSuccess: () => refresh(client, selected),
  });
  if (selected)
    return (
      <BookingDetail
        booking={detail.data}
        loading={detail.isPending}
        error={detail.error}
        onBack={() => {
          setManualSelection(null);
          navigation.setParams({ bookingId: undefined });
        }}
        onMessage={(conversationId) => navigation.navigate('Messages', { conversationId })}
        cancel={cancel}
        payment={payment}
        refreshPayment={refreshPayment}
      />
    );
  const filtered = (bookings.data ?? []).filter(
    (booking) => bookingGroup(booking.status) === group,
  );
  return (
    <Screen
      eyebrow="Your trips"
      title="Bookings"
      subtitle="Everything you need before pickup, during your rental, and after return."
    >
      <BookingFilter
        group={group}
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onOpen={() => setFilterOpen(true)}
        onSelect={(value) => {
          setGroup(value);
          setFilterOpen(false);
        }}
      />
      {bookings.isPending && <StateView loading title="Loading bookings…" />}
      {bookings.isError && (
        <StateView
          icon="cloud-offline-outline"
          title="Bookings unavailable"
          message={bookings.error.message}
          actionLabel="Retry"
          onAction={() => void bookings.refetch()}
        />
      )}
      {!bookings.isPending && !bookings.isError && filtered.length === 0 && (
        <StateView
          icon="calendar-outline"
          title={
            group === 'Upcoming'
              ? "You don't have any bookings yet"
              : `No ${group.toLowerCase()} bookings`
          }
          message={
            group === 'Upcoming'
              ? 'Find a car and confirm your dates to start your next trip.'
              : 'Bookings will move here automatically as their status changes.'
          }
        />
      )}
      {!bookings.isError &&
        filtered.map((booking) => (
          <Pressable
            key={booking.publicReference}
            accessibilityRole="button"
            onPress={() => setManualSelection(booking.publicReference)}
          >
            <Card style={styles.bookingCard}>
              <VehicleImage
                contentPath={booking.vehicle.coverPhoto?.contentPath}
                accessibilityLabel={`${booking.vehicle.make ?? ''} ${booking.vehicle.model ?? 'vehicle'}`.trim()}
                style={styles.image}
              />
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.vehicle}>
                  {booking.vehicle.year} {booking.vehicle.make} {booking.vehicle.model}
                </Text>
                <Text style={styles.dates}>
                  {dateLabel(booking.rentalStart)} – {dateLabel(booking.rentalEnd)}
                </Text>
                <StatusBadge
                  label={bookingStatusLabel(booking.status)}
                  tone={statusTone(booking.status)}
                />
                <Text style={styles.reference}>{booking.publicReference}</Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.price}>
                    {money(booking.pricing.totalMinor, booking.pricing.currency)}
                  </Text>
                  <Text style={styles.actionCopy}>{primaryAction(booking.status)} →</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
    </Screen>
  );
}

const bookingGroups = ['Upcoming', 'Active', 'Completed', 'Cancelled'] as const;
function BookingFilter({
  group,
  open,
  onOpen,
  onClose,
  onSelect,
}: {
  readonly group: BookingGroup;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onSelect: (value: BookingGroup) => void;
}) {
  return (
    <View style={styles.filterSection}>
      <Text style={styles.filterLabel}>Status</Text>
      <Pressable
        accessibilityLabel={`Booking status filter: ${group}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onOpen}
        style={styles.filterButton}
      >
        <Text style={styles.filterValue}>{group}</Text>
        <Icon color={colors.primary} name="chevron-down" size={18} />
      </Pressable>
      <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
        <View style={styles.filterOverlay}>
          <Pressable
            accessibilityLabel="Close booking status menu"
            accessibilityRole="button"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View accessibilityViewIsModal style={styles.filterMenu}>
            <Text style={styles.filterMenuTitle}>Show bookings</Text>
            {bookingGroups.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: group === value }}
                onPress={() => onSelect(value)}
                style={styles.filterOption}
              >
                <Text style={[styles.filterOptionText, group === value && styles.filterSelected]}>
                  {value}
                </Text>
                {group === value && <Icon color={colors.primary} name="checkmark" size={20} />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function BookingDetail({
  booking,
  loading,
  error,
  onBack,
  onMessage,
  cancel,
  payment,
  refreshPayment,
}: {
  readonly booking?: BookingView | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onBack: () => void;
  readonly onMessage: (id: string) => void;
  readonly cancel: ReturnType<typeof useMutation<BookingView, Error, string>>;
  readonly payment: ReturnType<typeof useMutation<unknown, Error, BookingView>>;
  readonly refreshPayment: ReturnType<typeof useMutation<unknown, Error, string>>;
}) {
  if (loading)
    return (
      <Screen title="Booking">
        <StateView loading title="Loading booking…" />
      </Screen>
    );
  if (error || !booking)
    return (
      <Screen title="Booking">
        <StateView
          icon="alert-circle-outline"
          title="Booking unavailable"
          message={error?.message}
          actionLabel="Back"
          onAction={onBack}
        />
      </Screen>
    );
  const rentalPayment =
    booking.payments.find((item) => item.purpose === 'RENTAL') ?? booking.payments[0];
  const operational = [
    'CONFIRMED',
    'READY_FOR_PICKUP',
    'ACTIVE',
    'RETURN_PENDING',
    'RETURNED',
    'COMPLETED',
  ].includes(booking.status);
  return (
    <Screen
      eyebrow="Booking details"
      title={
        booking.vehicle.make && booking.vehicle.model
          ? `${booking.vehicle.make} ${booking.vehicle.model}`
          : booking.publicReference
      }
      subtitle={`Reference ${booking.publicReference}`}
    >
      <Button icon="arrow-back" label="All bookings" onPress={onBack} variant="ghost" />
      <VehicleImage
        contentPath={booking.vehicle.coverPhoto?.contentPath}
        accessibilityLabel={`${booking.vehicle.make ?? ''} ${booking.vehicle.model ?? 'vehicle'}`.trim()}
        style={styles.hero}
      />
      <View style={styles.summaryRow}>
        <StatusBadge label={bookingStatusLabel(booking.status)} tone={statusTone(booking.status)} />
        <Text style={styles.total}>
          {money(booking.pricing.totalMinor, booking.pricing.currency)}
        </Text>
      </View>
      <Card>
        <Detail label="Pickup" value={dateTimeLabel(booking.rentalStart)} icon="calendar-outline" />
        <Detail
          label="Return"
          value={dateTimeLabel(booking.rentalEnd)}
          icon="return-down-back-outline"
        />
        <Detail
          label="Payment"
          value={rentalPayment ? paymentLabel(rentalPayment.status) : 'No payment yet'}
          icon="card-outline"
        />
        {booking.vehicle.location && (
          <Detail
            label="Pickup area"
            value={`${booking.vehicle.location.city}, ${booking.vehicle.location.province}`}
            icon="location-outline"
          />
        )}
      </Card>
      {booking.conversationId && (
        <Button
          icon="chatbubble-outline"
          label="Message owner"
          onPress={() => onMessage(booking.conversationId!)}
          variant="secondary"
        />
      )}
      {(booking.status === 'HOLD' || booking.status === 'AWAITING_PAYMENT') && (
        <Card style={styles.notice}>
          <Text style={styles.vehicle}>Secure your booking request</Text>
          <Text style={styles.body}>
            Authorize your payment method by{' '}
            {booking.holdExpiresAt ? dateTimeLabel(booking.holdExpiresAt) : 'the hold deadline'}.
            You are charged only after the owner accepts.
          </Text>
          <Button
            disabled={payment.isPending}
            label={payment.isPending ? 'Opening secure payment…' : 'Continue to payment'}
            onPress={() => payment.mutate(booking)}
          />
        </Card>
      )}
      {rentalPayment &&
        ['AUTHORIZED', 'AUTHORIZING', 'CAPTURING'].includes(rentalPayment.status) && (
          <Card style={styles.notice}>
            <Text style={styles.vehicle}>
              {rentalPayment.status === 'AUTHORIZED'
                ? 'Payment method authorized'
                : 'Payment is being confirmed'}
            </Text>
            <Text style={styles.body}>
              {rentalPayment.status === 'AUTHORIZED'
                ? 'You will be charged only if the owner accepts.'
                : 'A timeout is not a decline. We are confirming the provider result before another payment action.'}
            </Text>
            {rentalPayment.status !== 'AUTHORIZED' && (
              <Button
                label="Refresh payment status"
                onPress={() => refreshPayment.mutate(booking.publicReference)}
                variant="secondary"
              />
            )}
          </Card>
        )}
      {booking.status === 'EXPIRED' && (
        <StateView
          icon="time-outline"
          title="This reservation expired"
          message="The reservation expired before payment or owner confirmation was completed. No unnecessary capture was made."
          actionLabel="Back to bookings"
          onAction={onBack}
        />
      )}
      {operational && <RenterRentalPanel reference={booking.publicReference} />}
      <RenterClaimsPanel bookingReference={booking.publicReference} />
      {booking.status === 'COMPLETED' && <ReviewPanel bookingReference={booking.publicReference} />}
      <SectionHeader title="Trip timeline" />
      <Card>
        {booking.statusHistory.map((entry, index) => (
          <View key={`${entry.occurredAt}-${entry.toStatus}`} style={styles.timelineRow}>
            <View style={styles.timelineTrack}>
              <View style={styles.timelineDot} />
              {index < booking.statusHistory.length - 1 && <View style={styles.timelineLine} />}
            </View>
            <View style={styles.flex}>
              <Text style={styles.vehicle}>{bookingStatusLabel(entry.toStatus)}</Text>
              <Text style={styles.body}>{dateTimeLabel(entry.occurredAt)}</Text>
            </View>
          </View>
        ))}
      </Card>
      {['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER'].includes(booking.status) && (
        <Button
          disabled={cancel.isPending}
          label={cancel.isPending ? 'Cancelling…' : 'Cancel booking request'}
          onPress={() =>
            Alert.alert(
              'Cancel this request?',
              'The vehicle hold will be released. Any uncaptured payment authorization will be voided; no unnecessary charge and refund will be created.',
              [
                { style: 'cancel', text: 'Keep request' },
                {
                  onPress: () => cancel.mutate(booking.publicReference),
                  style: 'destructive',
                  text: 'Cancel request',
                },
              ],
            )
          }
          variant="danger"
        />
      )}
    </Screen>
  );
}

function Detail({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly icon: Parameters<typeof Icon>[0]['name'];
}) {
  return (
    <View style={styles.detail}>
      <View style={styles.detailIcon}>
        <Icon color={colors.primary} name={icon} size={20} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}
function refresh(client: ReturnType<typeof useQueryClient>, selected: string | null) {
  void client.invalidateQueries({ queryKey: ['bookings'] });
  void client.invalidateQueries({ queryKey: ['booking', selected] });
}
function bookingGroup(status: string): BookingGroup {
  if (['ACTIVE', 'READY_FOR_PICKUP', 'RETURN_PENDING', 'RETURNED'].includes(status))
    return 'Active';
  if (status === 'COMPLETED') return 'Completed';
  if (['CANCELLED', 'EXPIRED'].includes(status)) return 'Cancelled';
  return 'Upcoming';
}
function statusTone(status: string): 'success' | 'warning' | 'neutral' | 'danger' {
  if (['CANCELLED', 'EXPIRED'].includes(status)) return 'danger';
  if (
    ['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER', 'CAPTURE_PENDING', 'RETURN_PENDING'].includes(
      status,
    )
  )
    return 'warning';
  if (['CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'COMPLETED'].includes(status)) return 'success';
  return 'neutral';
}
function primaryAction(status: string) {
  if (['HOLD', 'AWAITING_PAYMENT'].includes(status)) return 'Continue';
  if (status === 'READY_FOR_PICKUP') return 'Pickup details';
  if (status === 'ACTIVE') return 'View rental';
  if (status === 'COMPLETED') return 'View receipt';
  return 'View details';
}
function paymentLabel(status: string) {
  return (
    {
      AUTHORIZED: 'Authorized — not charged yet',
      CAPTURED: 'Paid',
      AUTHORIZING: 'Authorizing',
      CAPTURING: 'Confirming payment',
      VOIDED: 'Authorization released',
      REFUNDED: 'Refunded',
    }[status] ?? titleCase(status)
  );
}

const styles = StyleSheet.create({
  actionCopy: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  body: { color: colors.subtleText, lineHeight: 21, marginTop: 3 },
  bookingCard: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  dates: { color: colors.subtleText, fontSize: 13, marginBottom: spacing.xs, marginTop: 3 },
  detail: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 66,
  },
  detailIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  detailLabel: {
    color: colors.subtleText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  detailValue: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 2 },
  flex: { flex: 1, minWidth: 0 },
  filterButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  filterLabel: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  filterMenu: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    width: '100%',
  },
  filterMenuTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
    padding: spacing.sm,
  },
  filterOption: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  filterOptionText: { color: colors.ink, fontSize: 15 },
  filterOverlay: {
    backgroundColor: 'rgba(16, 35, 27, 0.35)',
    flex: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: 180,
  },
  filterSection: { alignItems: 'flex-start', gap: spacing.xxs },
  filterSelected: { color: colors.primary, fontWeight: '800' },
  filterValue: { color: colors.ink, fontSize: 14, fontWeight: '800', minWidth: 82 },
  hero: { borderRadius: radius.lg, height: 210, width: '100%' },
  image: { borderRadius: radius.md, height: 124, width: 112 },
  notice: { backgroundColor: colors.warningSoft },
  price: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  reference: { color: colors.subtleText, fontSize: 11, marginTop: spacing.xs },
  summaryRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  timelineDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 12,
    width: 12,
  },
  timelineLine: { backgroundColor: colors.border, flex: 1, marginVertical: 3, width: 2 },
  timelineRow: { flexDirection: 'row', gap: spacing.sm, minHeight: 62 },
  timelineTrack: { alignItems: 'center', width: 16 },
  total: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  vehicle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
