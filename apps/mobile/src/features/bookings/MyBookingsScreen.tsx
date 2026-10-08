import { useEffect, useRef, useState } from 'react';
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
  Chip,
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
import { BookingCancellationSheet } from './BookingCancellationSheet';
import { BookingAmendmentSheet } from './BookingAmendmentSheet';
import { SecurityDepositSummary } from './SecurityDepositSummary';
import type { BookingSecurityDepositReadModel } from '@carrental/api-contracts';

interface ContentGrant {
  readonly contentPath: string;
  readonly expiresAt: string;
}

export interface BookingView {
  readonly securityDeposit: BookingSecurityDepositReadModel;
  readonly latestAmendment?: {
    readonly amendmentId: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly paymentDeadlineAt: string | null;
    readonly reasonCode: string | null;
    readonly scope: 'PRE_TRIP' | 'ACTIVE_EXTENSION';
    readonly status: string;
    readonly withdrawable: boolean;
  } | null;
  readonly workflowCompliance?: {
    readonly start: { readonly overdue: boolean };
    readonly return: { readonly overdue: boolean };
  };
  readonly publicReference: string;
  readonly conversationId: string | null;
  readonly status: string;
  readonly rentalStart: string;
  readonly rentalEnd: string;
  readonly holdExpiresAt: string | null;
  readonly ownerResponseDeadlineAt: string | null;
  readonly overdueHandoverRecovery: {
    readonly scope: 'START' | 'RETURN' | 'BOTH';
    readonly responseDeadlineAt: string;
    readonly response: { readonly decision: 'CONFIRMED' | 'DISPUTED' } | null;
    readonly acceptance: { readonly acceptanceSource: string } | null;
  } | null;
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
    readonly allowedStartMethods: readonly ('RENTER_PICKUP' | 'OWNER_DELIVERY')[];
    readonly allowedEndMethods: readonly ('RENTER_RETURN' | 'OWNER_COLLECTION')[];
    readonly startFulfillmentChangeable: boolean;
    readonly endFulfillmentChangeable: boolean;
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

type RenterBookingView = Omit<BookingView, 'pricing'> & {
  readonly pricing: BookingView['pricing'] | null;
};

export function PendingHandoverRecoveryBanner({
  bookings,
  onReview,
}: {
  readonly bookings: readonly RenterBookingView[];
  readonly onReview: (reference: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const actionable = bookings
    .filter(
      (booking) =>
        booking.overdueHandoverRecovery &&
        !booking.overdueHandoverRecovery.acceptance &&
        (!booking.overdueHandoverRecovery.response ||
          booking.overdueHandoverRecovery.response.decision === 'DISPUTED') &&
        !['CANCELLED', 'COMPLETED', 'EXPIRED'].includes(booking.status),
    )
    .sort(
      (left, right) =>
        new Date(left.overdueHandoverRecovery!.responseDeadlineAt).getTime() -
        new Date(right.overdueHandoverRecovery!.responseDeadlineAt).getTime(),
    );
  if (!actionable.length) return null;
  const pendingCount = actionable.filter(
    (booking) => !booking.overdueHandoverRecovery?.response,
  ).length;
  return (
    <View>
      {pendingCount > 1 && (
        <Text accessibilityRole="header" style={styles.vehicle}>
          Action required: {pendingCount} handover reports need your response
        </Text>
      )}
      {actionable.map((booking) => {
        const recovery = booking.overdueHandoverRecovery!;
        const scopeLabel =
          recovery.scope === 'START'
            ? 'Pickup handover'
            : recovery.scope === 'RETURN'
              ? 'Return handover'
              : 'Pickup and Return';
        const description =
          recovery.scope === 'START'
            ? 'The Owner reported an overdue Pickup without inspection. Review the reported handover details before the response deadline.'
            : recovery.scope === 'RETURN'
              ? 'The Owner reported an overdue Return without inspection. Review the reported handover details before the response deadline.'
              : 'The Owner reported both overdue handovers. Review the reported times before the response deadline.';
        const remainingMs = Math.max(0, new Date(recovery.responseDeadlineAt).getTime() - now);
        const remainingHours = Math.floor(remainingMs / 3_600_000);
        const remainingMinutes = Math.floor((remainingMs % 3_600_000) / 60_000);
        const disputed = recovery.response?.decision === 'DISPUTED';
        return (
          <Card key={booking.publicReference} style={styles.notice}>
            <Text accessibilityRole="header" style={styles.vehicle}>
              {disputed ? 'Under Operations review' : `Action required: Confirm ${scopeLabel}`}
            </Text>
            <Text style={styles.body}>
              {disputed
                ? `Your disagreement about the ${scopeLabel} report was sent to CarShare Operations.`
                : description}
            </Text>
            {!disputed && (
              <>
                <Text style={styles.body}>
                  Response due: {dateTimeLabel(recovery.responseDeadlineAt)}
                </Text>
                <Text accessibilityLiveRegion="polite" style={styles.body}>
                  {remainingHours > 0
                    ? `${remainingHours}h ${remainingMinutes}m remaining`
                    : `${remainingMinutes}m remaining`}
                </Text>
                <Button label="Review handover" onPress={() => onReview(booking.publicReference)} />
              </>
            )}
          </Card>
        );
      })}
    </View>
  );
}

export function MyBookingsScreen({
  focusRecovery = false,
  initialBookingReference,
  onClose,
}: {
  readonly focusRecovery?: boolean;
  readonly initialBookingReference?: string;
  readonly onClose?: () => void;
} = {}) {
  const navigation = useNavigation<NavigationProp<RenterTabParamList & RootStackParamList>>();
  const route = useRoute<RouteProp<RenterTabParamList, 'Bookings'>>();
  const client = useQueryClient();
  const [manualSelection, setManualSelection] = useState<string | null>(null);
  const selected = manualSelection ?? initialBookingReference ?? route.params?.bookingId ?? null;
  const [group, setGroup] = useState<BookingGroup>('Current');
  const bookings = useQuery({
    queryKey: ['bookings'],
    queryFn: () => apiClient.request<RenterBookingView[]>('/bookings'),
    refetchInterval: 10_000,
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['booking', selected],
    queryFn: () => apiClient.request<RenterBookingView>(`/bookings/${selected}`),
    refetchInterval: (query) =>
      query.state.data && transitionalBookingStates.has(query.state.data.status) ? 5_000 : false,
  });
  useRefreshOnFocusAndForeground(() => {
    void bookings.refetch();
    if (selected) void detail.refetch();
  });
  const cancel = useMutation({
    mutationFn: (reference: string) =>
      apiClient.request<RenterBookingView>(`/bookings/${reference}/cancel`, {
        body: JSON.stringify({ reason: 'Cancelled by renter in mobile application' }),
        method: 'POST',
      }),
    onSuccess: () => refresh(client, selected),
  });
  const payment = useMutation({
    mutationFn: async (booking: RenterBookingView) => {
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
  const securityDeposit = useMutation({
    mutationFn: async (booking: RenterBookingView) => {
      const result = await apiClient.request<{ customerActionUrl: string | null }>(
        `/bookings/${booking.publicReference}/security-deposit/authorize`,
        { method: 'POST' },
      );
      if (result.customerActionUrl) await Linking.openURL(result.customerActionUrl);
      return result;
    },
    onSuccess: () => refresh(client, selected),
  });
  if (selected)
    return (
      <BookingDetail
        booking={detail.data}
        focusRecovery={focusRecovery}
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
        onCancellationCompleted={() => refresh(client, selected)}
        cancel={cancel}
        payment={payment}
        refreshPayment={refreshPayment}
        securityDepositMutation={securityDeposit}
      />
    );
  const filtered = (bookings.data ?? []).filter(
    (booking) => bookingGroup(booking.status) === group,
  );
  const datedSections = group === 'Current' ? [] : groupBookingsByDate(filtered, group);
  return (
    <Screen stickyHeader={<BookingTabs group={group} onSelect={setGroup} />}>
      <PendingHandoverRecoveryBanner
        bookings={bookings.data ?? []}
        onReview={(reference) => navigation.navigate('BookingRecovery', { bookingId: reference })}
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
          title={emptyBookingTitle(group)}
          message={
            group === 'Current'
              ? 'Pickup-ready, active, and return-pending rentals will always appear here.'
              : 'Bookings will move here automatically as their status changes.'
          }
        />
      )}
      {!bookings.isError &&
        group === 'Current' &&
        filtered.map((booking) => (
          <BookingListCard
            booking={booking}
            key={booking.publicReference}
            onPress={() => setManualSelection(booking.publicReference)}
          />
        ))}
      {!bookings.isError &&
        group !== 'Current' &&
        datedSections.map((section) => (
          <View key={section.key} style={styles.dateSection}>
            <SectionHeader flush title={section.title} />
            {section.bookings.map((booking) => (
              <BookingListCard
                booking={booking}
                key={booking.publicReference}
                onPress={() => setManualSelection(booking.publicReference)}
              />
            ))}
          </View>
        ))}
    </Screen>
  );
}

function BookingListCard({
  booking,
  onPress,
}: {
  readonly booking: RenterBookingView;
  readonly onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
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
            label={
              booking.workflowCompliance?.start.overdue
                ? 'Handover overdue'
                : booking.workflowCompliance?.return.overdue
                  ? 'Return process overdue'
                  : bookingStatusLabel(booking.status)
            }
            tone={statusTone(booking.status)}
          />
          <Text style={styles.price}>{bookingTotalLabel(booking)}</Text>
          <View style={styles.cardFooter}>
            <Text numberOfLines={1} style={styles.reference}>
              {booking.publicReference}
            </Text>
            <Text style={styles.actionCopy}>{primaryAction(booking.status)} →</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function groupBookingsByDate(bookings: readonly RenterBookingView[], group: BookingGroup) {
  const dateFor = (booking: RenterBookingView) =>
    group === 'Upcoming' ? booking.rentalStart : booking.rentalEnd;
  const direction = group === 'Upcoming' ? 1 : -1;
  const sorted = [...bookings].sort(
    (left, right) =>
      direction * (new Date(dateFor(left)).getTime() - new Date(dateFor(right)).getTime()),
  );
  const sections = new Map<string, RenterBookingView[]>();
  sorted.forEach((booking) => {
    const date = dateFor(booking);
    const key = dateLabel(date);
    const section = sections.get(key) ?? [];
    section.push(booking);
    sections.set(key, section);
  });
  return [...sections].map(([key, sectionBookings]) => ({
    bookings: sectionBookings,
    key,
    title: key,
  }));
}

const transitionalBookingStates = new Set([
  'AWAITING_PAYMENT',
  'AWAITING_OWNER',
  'CAPTURE_PENDING',
  'READY_FOR_PICKUP',
  'RETURN_PENDING',
]);

const bookingGroups = ['Current', 'Upcoming', 'Past'] as const;
function BookingTabs({
  group,
  onSelect,
}: {
  readonly group: BookingGroup;
  readonly onSelect: (value: BookingGroup) => void;
}) {
  return (
    <View accessibilityLabel="Booking groups" style={styles.bookingTabs}>
      {bookingGroups.map((value) => (
        <Chip
          accessibilityRole="tab"
          compact
          key={value}
          label={value}
          selected={group === value}
          onPress={() => onSelect(value)}
        />
      ))}
    </View>
  );
}

function emptyBookingTitle(group: BookingGroup) {
  if (group === 'Current') return 'No active trips right now.';
  if (group === 'Upcoming') return 'No upcoming bookings.';
  return 'No past trips yet.';
}

function BookingDetail({
  booking,
  focusRecovery,
  loading,
  error,
  onBack,
  onMessage,
  onCancellationCompleted,
  cancel,
  payment,
  refreshPayment,
  securityDepositMutation,
}: {
  readonly booking?: RenterBookingView | undefined;
  readonly focusRecovery: boolean;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onBack: () => void;
  readonly onMessage: (id: string) => void;
  readonly onCancellationCompleted: () => void;
  readonly cancel: ReturnType<typeof useMutation<RenterBookingView, Error, string>>;
  readonly payment: ReturnType<typeof useMutation<unknown, Error, RenterBookingView>>;
  readonly refreshPayment: ReturnType<typeof useMutation<unknown, Error, string>>;
  readonly securityDepositMutation: ReturnType<
    typeof useMutation<unknown, Error, RenterBookingView>
  >;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffsetY = useRef(0);
  const scrollToCancelledSummaryAfterLayout = useRef(false);
  const [now, setNow] = useState(0);
  const [bookingDetailsOpen, setBookingDetailsOpen] = useState(false);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  useEffect(() => {
    const initialize = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(initialize);
      clearInterval(timer);
    };
  }, []);
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
  const pickupHasBegun =
    operational && now >= new Date(booking.pickupWindow?.opensAt ?? booking.rentalStart).getTime();
  const rentalOperations = operational ? (
    <RenterRentalPanel
      focusOverdueRecovery={focusRecovery}
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
      scrollToRecoveryResponse={(y) => scrollRef.current?.scrollTo({ animated: true, y })}
    />
  ) : null;
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
      {pickupHasBegun && rentalOperations}
      {pickupHasBegun && (
        <>
          <Button
            icon="information-circle-outline"
            label="View booking details"
            onPress={() => setBookingDetailsOpen(true)}
            variant="secondary"
          />
          <Modal
            animationType="slide"
            onRequestClose={() => setBookingDetailsOpen(false)}
            presentationStyle="pageSheet"
            visible={bookingDetailsOpen}
          >
            <Screen
              action={
                <Pressable
                  accessibilityLabel="Close booking details"
                  accessibilityRole="button"
                  hitSlop={spacing.md}
                  onPress={() => setBookingDetailsOpen(false)}
                >
                  <Icon color={colors.primary} name="close" size={28} />
                </Pressable>
              }
              eyebrow="Booking details"
              title={
                booking.vehicle.make && booking.vehicle.model
                  ? `${booking.vehicle.make} ${booking.vehicle.model}`
                  : booking.publicReference
              }
              subtitle={`Reference ${booking.publicReference}`}
            >
              <Card>
                <Detail
                  label="Pickup"
                  value={dateTimeLabel(booking.rentalStart)}
                  icon="calendar-outline"
                />
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
                    value={money(booking.fulfillment.deliveryFeeMinor, bookingCurrency(booking))}
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
                    value={money(booking.fulfillment.collectionFeeMinor, bookingCurrency(booking))}
                    icon="cash-outline"
                  />
                )}
              </Card>
              <SecurityDepositSummary
                busy={securityDepositMutation.isPending}
                errorMessage={securityDepositMutation.error?.message}
                onPlace={() => securityDepositMutation.mutate(booking)}
                securityDeposit={booking.securityDeposit}
              />
              {booking.conversationId && (
                <Button
                  icon="chatbubble-outline"
                  label="Message owner"
                  onPress={() => {
                    setBookingDetailsOpen(false);
                    onMessage(booking.conversationId!);
                  }}
                  variant="secondary"
                />
              )}
            </Screen>
          </Modal>
        </>
      )}
      {!pickupHasBegun && (
        <>
          <VehicleImage
            contentPath={booking.vehicle.coverPhoto?.contentPath}
            accessibilityLabel={`${booking.vehicle.make ?? ''} ${booking.vehicle.model ?? 'vehicle'}`.trim()}
            style={styles.hero}
          />
          <View style={styles.summaryRow}>
            <StatusBadge
              label={
                booking.workflowCompliance?.start.overdue
                  ? 'Handover overdue'
                  : booking.workflowCompliance?.return.overdue
                    ? 'Return process overdue'
                    : bookingStatusLabel(booking.status)
              }
              tone={statusTone(booking.status)}
            />
            <Text style={styles.total}>{bookingTotalLabel(booking)}</Text>
          </View>
          <Card>
            <Detail
              label="Pickup"
              value={dateTimeLabel(booking.rentalStart)}
              icon="calendar-outline"
            />
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
                value={money(booking.fulfillment.deliveryFeeMinor, bookingCurrency(booking))}
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
                value={money(booking.fulfillment.collectionFeeMinor, bookingCurrency(booking))}
                icon="cash-outline"
              />
            )}
          </Card>
          <SecurityDepositSummary
            busy={securityDepositMutation.isPending}
            errorMessage={securityDepositMutation.error?.message}
            onPlace={() => securityDepositMutation.mutate(booking)}
            securityDeposit={booking.securityDeposit}
          />
          {booking.conversationId && (
            <Button
              icon="chatbubble-outline"
              label="Message owner"
              onPress={() => onMessage(booking.conversationId!)}
              variant="secondary"
            />
          )}
        </>
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
      {!pickupHasBegun && rentalOperations}
      {['CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE'].includes(booking.status) && (
        <Button
          icon="calendar-outline"
          label={
            booking.latestAmendment &&
            !['APPLIED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'FAILED'].includes(
              booking.latestAmendment.status,
            )
              ? 'View booking change'
              : booking.status === 'ACTIVE'
                ? 'Extend Trip'
                : 'Change Booking'
          }
          onPress={() => setAmendmentOpen(true)}
          variant="secondary"
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
              <Text style={styles.vehicle}>
                {entry.reasonCode === 'START_INSPECTION_EVIDENCE_WAIVED'
                  ? 'Start inspection evidence waived'
                  : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_START_REPORTED'
                    ? 'Owner reported Pickup without inspection'
                    : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_RETURN_REPORTED'
                      ? 'Owner reported Return without inspection'
                      : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_BOTH_REPORTED'
                        ? 'Owner reported Pickup and Return without inspections'
                        : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_CONFIRMED'
                          ? 'Overdue handover report confirmed'
                          : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_DISPUTED'
                            ? 'Overdue handover report disputed'
                            : entry.reasonCode === 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED'
                              ? 'Overdue handover report accepted'
                              : entry.reasonCode === 'RETURN_INSPECTION_EVIDENCE_WAIVED'
                                ? 'Return inspection evidence waived'
                                : entry.reasonCode ===
                                    'RETURN_CONFIRMED_WITHOUT_INSPECTION_EVIDENCE'
                                  ? 'Return completed without inspection evidence'
                                  : entry.reasonCode ===
                                      'PICKUP_CONFIRMED_WITHOUT_INSPECTION_EVIDENCE'
                                    ? 'Handover completed without inspection evidence'
                                    : entry.reasonCode === 'PICKUP_CONFIRMED'
                                      ? 'Verified handover'
                                      : entry.reasonCode === 'RETURN_CONFIRMED'
                                        ? 'Verified return'
                                        : bookingStatusLabel(entry.toStatus)}
              </Text>
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
      {['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status) && (
        <Button label="Cancel booking" onPress={() => setCancellationOpen(true)} variant="danger" />
      )}
      <BookingCancellationSheet
        bookingReference={booking.publicReference}
        onClose={() => setCancellationOpen(false)}
        onCompleted={onCancellationCompleted}
        role="RENTER"
        visible={cancellationOpen}
      />
      <BookingAmendmentSheet
        key={`${booking.latestAmendment?.amendmentId ?? 'new'}-${booking.latestAmendment?.status ?? 'none'}`}
        booking={booking}
        onClose={() => setAmendmentOpen(false)}
        visible={amendmentOpen}
      />
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

function bookingCurrency(booking: RenterBookingView) {
  return booking.pricing?.currency ?? booking.payments[0]?.currency ?? 'PHP';
}

function bookingTotalLabel(booking: RenterBookingView) {
  return booking.pricing
    ? money(booking.pricing.totalMinor, booking.pricing.currency)
    : 'Total unavailable';
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
  bookingTabs: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  dates: { color: colors.subtleText, fontSize: 13, marginBottom: spacing.xs, marginTop: 3 },
  dateSection: { gap: spacing.sm },
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
  hero: { borderRadius: radius.lg, height: 210, width: '100%' },
  image: { borderRadius: radius.md, height: 124, width: 112 },
  notice: { backgroundColor: colors.warningSoft },
  price: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: spacing.xs },
  reference: { color: colors.subtleText, flex: 1, fontSize: 11 },
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
