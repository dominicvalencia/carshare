import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ScrollView,
} from 'react-native';
import type { NavigationProp, RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { apiClient } from '../../auth/api-client';
import { useRefreshOnFocusAndForeground } from '../../query/use-query-refresh';
import type { RenterTabParamList, RootStackParamList } from '../../navigation/routes';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateLabel, dateTimeLabel, money, titleCase } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import {
  Button,
  BackControl,
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
import { bookingGroup, type BookingGroup } from './booking-presentation';

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
  readonly cancellation: {
    readonly reasonCode: string | null;
    readonly reasonText: string | null;
  } | null;
  readonly cancellationSettlement: {
    readonly collectionRefundedMinor: string;
    readonly commissionRetainedMinor: string;
    readonly currency: string;
    readonly deliveryCompleted: boolean;
    readonly deliveryRefundedMinor: string;
    readonly deliveryRetainedMinor: string;
    readonly refundAmountMinor: string;
    readonly refundStatus: string | null;
  } | null;
  readonly pickupWindow?: { readonly closesAt: string; readonly opensAt: string };
  readonly pricing: { totalMinor: number; currency: string };
  readonly fulfillment: {
    readonly startMethod: 'RENTER_PICKUP' | 'OWNER_DELIVERY';
    readonly endMethod: 'RENTER_RETURN' | 'OWNER_COLLECTION';
    readonly startLocation?: {
      readonly addressLine1: string | null;
      readonly city: string;
      readonly province: string;
    };
    readonly endLocation?: {
      readonly addressLine1: string | null;
      readonly city: string;
      readonly province: string;
    };
    readonly deliveryFeeMinor: number;
    readonly collectionFeeMinor: number;
    readonly deliveryDistanceMeters: number | null;
    readonly collectionDistanceMeters: number | null;
    readonly legacyCompatibility: boolean;
  };
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
export function MyBookingsScreen({
  initialBookingReference,
  onClose,
}: {
  readonly initialBookingReference?: string;
  readonly onClose?: () => void;
} = {}) {
  const navigation = useNavigation<NavigationProp<RenterTabParamList & RootStackParamList>>();
  const route = useRoute<RouteProp<RenterTabParamList, 'Bookings'>>();
  const client = useQueryClient();
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const selected = manualSelection ?? initialBookingReference ?? route.params?.bookingId ?? null;
  const [group, setGroup] = useState<BookingGroup>('Current');
  const [filterOpen, setFilterOpen] = useState(false);
  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: () => apiClient.request<BookingView[]>('/bookings'),
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['booking', selected],
    queryFn: () => apiClient.request<BookingView>(`/bookings/${selected}`),
    refetchInterval: (query) =>
      query.state.data && transitionalBookingStates.has(query.state.data.status) ? 5_000 : false,
  });
  useRefreshOnFocusAndForeground(() => {
    void bookings.refetch();
    if (selected) void detail.refetch();
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
          void bookings.refetch();
          if (onClose) {
            onClose();
            return;
          }
          setManualSelection(null);
          navigation.setParams({ bookingId: undefined });
        }}
        onMessage={(conversationId) => navigation.navigate('Conversation', { conversationId })}
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
            group === 'Current'
              ? 'No rental needs your attention'
              : `No ${group.toLowerCase()} bookings`
          }
          message={
            group === 'Current'
              ? 'Pickup-ready, active, and return-pending rentals will always appear here.'
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

const transitionalBookingStates = new Set([
  'AWAITING_PAYMENT',
  'AWAITING_OWNER',
  'CAPTURE_PENDING',
  'READY_FOR_PICKUP',
  'RETURN_PENDING',
]);

const bookingGroups = ['Current', 'Upcoming', 'Past'] as const;
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
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetY = useRef(0);
  const scrollToCancelledSummaryAfterLayout = useRef(false);
  if (loading)
    return (
      <Screen leading={<BackControl label="All bookings" onPress={onBack} />} title="Booking">
        <StateView loading title="Loading booking…" />
      </Screen>
    );
  if (error || !booking)
    return (
      <Screen leading={<BackControl label="All bookings" onPress={onBack} />} title="Booking">
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
      onScroll={({ nativeEvent }) => {
        scrollOffsetY.current = nativeEvent.contentOffset.y;
      }}
      scrollRef={scrollRef}
      leading={<BackControl label="All bookings" onPress={onBack} />}
      eyebrow="Booking details"
      title={
        booking.vehicle.make && booking.vehicle.model
          ? `${booking.vehicle.make} ${booking.vehicle.model}`
          : booking.publicReference
      }
      subtitle={`Reference ${booking.publicReference}`}
    >
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
      {booking.status === 'CANCELLED' && booking.cancellationSettlement ? (
        <View
          onLayout={({ nativeEvent }) => {
            if (scrollToCancelledSummaryAfterLayout.current) {
              scrollToCancelledSummaryAfterLayout.current = false;
              scrollRef.current?.scrollTo({
                animated: true,
                y: Math.max(0, nativeEvent.layout.y - spacing.md),
              });
            }
          }}
        >
          <Card style={styles.notice}>
            <Text style={styles.vehicle}>Booking cancelled</Text>
            <Text style={styles.body}>
              Your rental did not start and custody was not transferred.
            </Text>
            <Detail
              label="Refund"
              value={money(
                Number(booking.cancellationSettlement.refundAmountMinor),
                booking.cancellationSettlement.currency,
              )}
              icon="return-down-back-outline"
            />
            <Detail
              label="CarShare commission retained"
              value={money(
                Number(booking.cancellationSettlement.commissionRetainedMinor),
                booking.cancellationSettlement.currency,
              )}
              icon="receipt-outline"
            />
            <Detail
              label="Delivery retained / refunded"
              value={`${money(Number(booking.cancellationSettlement.deliveryRetainedMinor), booking.cancellationSettlement.currency)} / ${money(Number(booking.cancellationSettlement.deliveryRefundedMinor), booking.cancellationSettlement.currency)}`}
              icon="navigate-outline"
            />
            <Detail
              label="Collection refunded"
              value={money(
                Number(booking.cancellationSettlement.collectionRefundedMinor),
                booking.cancellationSettlement.currency,
              )}
              icon="return-down-back-outline"
            />
            <Text style={styles.body}>
              Refund status:{' '}
              {titleCase(booking.cancellationSettlement.refundStatus ?? 'processing')}
            </Text>
          </Card>
        </View>
      ) : null}
      <Card>
        <Text style={styles.vehicle}>Contractual handover</Text>
        <Detail
          label="How you'll receive the car"
          value={
            booking.fulfillment.startMethod === 'OWNER_DELIVERY'
              ? 'Owner Delivery'
              : 'Pick up the car'
          }
          icon="navigate-outline"
        />
        {booking.fulfillment.startLocation && (
          <Detail
            label="Start location"
            value={fulfillmentLocation(booking.fulfillment.startLocation)}
            icon="location-outline"
          />
        )}
        {booking.fulfillment.startMethod === 'OWNER_DELIVERY' && (
          <Detail
            label="Delivery fee"
            value={money(booking.fulfillment.deliveryFeeMinor, booking.pricing.currency)}
            icon="cash-outline"
          />
        )}
        <Detail
          label="How you'll return the car"
          value={
            booking.fulfillment.endMethod === 'OWNER_COLLECTION'
              ? 'Owner Collection'
              : 'Return it yourself'
          }
          icon="return-down-back-outline"
        />
        {booking.fulfillment.endLocation && (
          <Detail
            label="End location"
            value={fulfillmentLocation(booking.fulfillment.endLocation)}
            icon="location-outline"
          />
        )}
        {booking.fulfillment.endMethod === 'OWNER_COLLECTION' && (
          <Detail
            label="Collection fee"
            value={money(booking.fulfillment.collectionFeeMinor, booking.pricing.currency)}
            icon="cash-outline"
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
      {operational && (
        <RenterRentalPanel
          onCancellationCompleted={() => {
            scrollToCancelledSummaryAfterLayout.current = true;
          }}
          {...(booking.conversationId
            ? { onContinueResolving: () => onMessage(booking.conversationId!) }
            : {})}
          reference={booking.publicReference}
          scrollResolutionFormBy={(delta) =>
            scrollRef.current?.scrollTo({ animated: true, y: scrollOffsetY.current + delta })
          }
          scrollToCancellationForm={(y) => scrollRef.current?.scrollTo({ animated: true, y })}
          scrollToPickupCode={(y) => scrollRef.current?.scrollTo({ animated: true, y })}
        />
      )}
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

function fulfillmentLocation(location: {
  readonly addressLine1: string | null;
  readonly city: string;
  readonly province: string;
}) {
  return [location.addressLine1, location.city, location.province].filter(Boolean).join(', ');
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
