import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import type { OwnerWorkspace } from '../../auth/auth.types';
import { hasOwnerPermission } from '../../navigation/owner-workspace';
import {
  useFocusedPollingInterval,
  useRefreshOnFocusAndForeground,
} from '../../query/use-query-refresh';
import { OWNER_REQUEST_POLL_INTERVAL_MS } from '../../query/owner-request-freshness';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateTimeLabel, money, timeLabel, titleCase } from '../../ui/format';
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
import { SecurityDepositSummary } from './SecurityDepositSummary';
import { tripDateSummary } from '../discovery/trip-date-policy';
import {
  amendmentErrorMessage,
  idempotencyKey,
  ownerAmendmentIsProcessing,
  ownerAmendmentStatusCopy,
  transientAmendmentStatuses,
  type AmendmentDetail,
} from './booking-amendment';

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
    profilePhoto: { readonly contentPath: string; readonly expiresAt: string } | null;
    reviewCount: number;
    verificationLabel: string;
    verified: boolean;
  };
}

type Filter = 'Needs response' | 'Upcoming' | 'All';

interface OwnerAmendmentPage {
  readonly items: readonly AmendmentDetail[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export function OwnerBookingRequestsScreen({
  embedded = false,
  history = false,
  initialAmendmentReference,
  initialBookingReference,
  onOpenAmendment,
  onOpenBookingRequest,
  onHistory,
  onClose,
  ownerWorkspace,
}: {
  readonly embedded?: boolean;
  readonly history?: boolean;
  readonly initialAmendmentReference?: string;
  readonly initialBookingReference?: string;
  readonly onOpenAmendment?: (target: {
    readonly amendmentReference: string;
    readonly bookingReference: string;
  }) => void;
  readonly onOpenBookingRequest?: (bookingReference: string) => void;
  readonly onHistory?: () => void;
  readonly onClose?: () => void;
  readonly ownerWorkspace?: OwnerWorkspace;
} = {}) {
  const client = useQueryClient();
  const endpointBase = ownerWorkspace
    ? `/owner/workspaces/${ownerWorkspace.ownerProfileId}/bookings`
    : '/owner/bookings';
  const workspaceKey = ownerWorkspace?.ownerProfileId ?? 'owner';
  const [selected, setSelected] = useState<string | null>(
    initialAmendmentReference ? null : (initialBookingReference ?? null),
  );
  const [selectedAmendment, setSelectedAmendment] = useState<{
    bookingReference: string;
    amendmentReference: string;
  } | null>(
    initialAmendmentReference && initialBookingReference
      ? {
          amendmentReference: initialAmendmentReference,
          bookingReference: initialBookingReference,
        }
      : null,
  );
  const [filter, setFilter] = useState<Filter>(history ? 'All' : 'Needs response');
  const effectiveFilter: Filter = embedded ? 'Needs response' : filter;
  const requestPollingInterval = useFocusedPollingInterval(
    OWNER_REQUEST_POLL_INTERVAL_MS,
    embedded,
  );
  const requests = useQuery({
    queryKey: ['owner-workspace', workspaceKey, 'booking-requests'],
    queryFn: () => apiClient.request<OwnerBookingView[]>(`${endpointBase}/requests`),
    refetchInterval: requestPollingInterval,
  });
  const amendmentScope = ownerAmendmentScope(effectiveFilter);
  const amendments = useInfiniteQuery({
    enabled: !ownerWorkspace,
    queryKey: ['owner-amendments', amendmentScope],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiClient.request<OwnerAmendmentPage>(
        `/owner/bookings/amendments?scope=${amendmentScope}&page=${pageParam}&pageSize=20`,
      ),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    refetchInterval: embedded ? requestPollingInterval : effectiveFilter === 'All' ? false : 10_000,
  });
  const detail = useQuery({
    enabled: Boolean(selected),
    queryKey: ['owner-workspace', workspaceKey, 'booking', selected],
    queryFn: () => apiClient.request<OwnerBookingView>(`${endpointBase}/${selected}`),
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
    void amendments.refetch();
    if (selected) void detail.refetch();
  });

  const decision = useMutation({
    mutationFn: ({ reference, action }: { reference: string; action: 'accept' | 'reject' }) =>
      apiClient.request(`${endpointBase}/${reference}/${action}`, {
        ...(action === 'reject'
          ? { body: JSON.stringify({ reason: 'Owner cannot accommodate the requested dates' }) }
          : {}),
        method: 'POST',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['owner-home'] });
      void client.invalidateQueries({ queryKey: ['owner-home-upcoming'] });
      void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
      void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
      void client.invalidateQueries({ queryKey: ['owner-rentals'] });
      void client.invalidateQueries({ queryKey: ['owner-earnings'] });
      void client.invalidateQueries({ queryKey: ['public-search'] });
    },
  });

  if (selectedAmendment)
    return (
      <OwnerAmendmentDetail
        target={selectedAmendment}
        onClose={() => {
          if (onClose) {
            onClose();
            return;
          }
          setSelectedAmendment(null);
          void amendments.refetch();
          void requests.refetch();
        }}
      />
    );

  if (selected) {
    return (
      <OwnerRequestDetail
        booking={detail.data}
        error={detail.error}
        loading={detail.isPending}
        onBack={onClose ?? (() => setSelected(null))}
        onCancellationCompleted={() => {
          void client.invalidateQueries({ queryKey: ['owner-home'] });
          void client.invalidateQueries({ queryKey: ['owner-home-upcoming'] });
          void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
          void client.invalidateQueries({ queryKey: ['owner-booking', selected] });
          void client.invalidateQueries({ queryKey: ['owner-rentals'] });
          void client.invalidateQueries({ queryKey: ['owner-earnings'] });
          void client.invalidateQueries({ queryKey: ['public-search'] });
        }}
        decision={decision}
        canAccept={!ownerWorkspace || hasOwnerPermission(ownerWorkspace, 'bookings.accept')}
        canReject={!ownerWorkspace || hasOwnerPermission(ownerWorkspace, 'bookings.reject')}
        allowCancellation={!ownerWorkspace}
      />
    );
  }

  const items = (requests.data ?? []).filter((booking) => {
    if (effectiveFilter === 'Needs response') return booking.status === 'AWAITING_OWNER';
    if (effectiveFilter === 'Upcoming')
      return ['CAPTURE_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status);
    return true;
  });
  const filteredAmendments = ownerWorkspace
    ? []
    : (amendments.data?.pages.flatMap((page) => page.items) ?? []);
  const empty = items.length === 0 && filteredAmendments.length === 0;
  const feedPending = requests.isPending || (!ownerWorkspace && amendments.isPending);
  const feedError = requests.error ?? (ownerWorkspace ? null : amendments.error);
  const feed = (
    <>
      {!embedded && !history && (
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
      )}
      {embedded && (
        <View style={styles.embeddedHeader}>
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={styles.sectionLabel}>
              Needs your response
            </Text>
            <Text style={styles.body}>New bookings and requested booking changes.</Text>
          </View>
          {onHistory && <Button compact label="History" onPress={onHistory} variant="ghost" />}
        </View>
      )}
      {filteredAmendments.length > 0 && (
        <View style={styles.changeRequests}>
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            {effectiveFilter === 'Needs response'
              ? 'Changes needing your response'
              : 'Booking changes'}
          </Text>
          {filteredAmendments.map((amendment) => {
            const booking = (requests.data ?? []).find(
              (item) => item.publicReference === amendment.bookingReference,
            );
            const identity =
              amendment.renterDisplayName && amendment.vehicleName
                ? { renter: amendment.renterDisplayName, vehicle: amendment.vehicleName }
                : booking
                  ? {
                      renter: booking.renter.displayName,
                      vehicle: `${booking.vehicle.make} ${booking.vehicle.model}`,
                    }
                  : { renter: 'Renter', vehicle: amendment.bookingReference };
            const delta = safeMoneyMinor(amendment.financial.ownerEarningsDeltaMinor);
            const [cardStatus] = ownerAmendmentStatusCopy(amendment);
            const applied = amendment.status === 'APPLIED';
            const activeExtension = amendment.scope === 'ACTIVE_EXTENSION';
            return (
              <Pressable
                key={amendment.amendmentReference ?? amendment.amendmentId}
                accessibilityLabel={`${embedded ? 'Change requested' : cardStatus} for ${identity.renter} and ${identity.vehicle}. ${applied ? 'Updated' : `Current ${accessibleDateRange(amendment.current.rentalStart, amendment.current.rentalEnd)}. Requested`} ${accessibleDateRange(amendment.proposed.rentalStart, amendment.proposed.rentalEnd)}. ${earningsDeltaAccessibility(delta, amendment.financial.currency)}.${amendment.actionable ? ` Respond by ${dateTimeLabel(amendment.expiresAt)}.` : ''}`}
                accessibilityRole="button"
                onPress={() =>
                  (onOpenAmendment ?? setSelectedAmendment)({
                    amendmentReference: (amendment.amendmentReference ?? amendment.amendmentId)!,
                    bookingReference: amendment.bookingReference,
                  })
                }
              >
                <Card style={styles.changeCard}>
                  <View style={styles.changeCardHeader}>
                    <View style={styles.flex}>
                      {embedded ? (
                        <Text style={styles.changeEyebrow}>Change requested</Text>
                      ) : (
                        <Text style={styles.changeEyebrow}>{cardStatus}</Text>
                      )}
                      <Text style={styles.changeRenter}>{identity.renter}</Text>
                      <Text style={styles.body}>{identity.vehicle}</Text>
                    </View>
                    <Icon color={colors.primary} name="chevron-forward" size={22} />
                  </View>
                  <View style={styles.rangeGrid}>
                    {activeExtension
                      ? !applied && (
                          <CompactReturn
                            compact
                            label="Current return"
                            value={amendment.current.rentalEnd}
                          />
                        )
                      : !applied && (
                          <CompactDateRange
                            compactTime
                            label="Current"
                            start={amendment.current.rentalStart}
                            end={amendment.current.rentalEnd}
                          />
                        )}
                    {activeExtension ? (
                      <CompactReturn
                        compact
                        label={applied ? 'Updated return' : 'Requested return'}
                        value={amendment.proposed.rentalEnd}
                      />
                    ) : (
                      <CompactDateRange
                        compactTime
                        label={applied ? 'Updated trip dates' : 'Requested'}
                        start={amendment.proposed.rentalStart}
                        end={amendment.proposed.rentalEnd}
                      />
                    )}
                  </View>
                  <View style={styles.changeMetaGrid}>
                    <View style={styles.flex}>
                      <Text style={styles.metaLabel}>Owner earnings change</Text>
                      <Text style={styles.metaValue}>
                        {earningsDeltaCopy(delta, amendment.financial.currency)}
                      </Text>
                    </View>
                    {amendment.actionable && (
                      <View style={styles.flex}>
                        <Text style={styles.metaLabel}>Respond by</Text>
                        <Text style={styles.metaValue}>{compactDeadline(amendment.expiresAt)}</Text>
                      </View>
                    )}
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
      {feedPending && <StateView loading title="Loading requests…" />}
      {feedError && (
        <StateView
          icon="cloud-offline-outline"
          title="Requests unavailable"
          message={feedError.message}
          actionLabel="Retry"
          onAction={() => {
            void requests.refetch();
            void amendments.refetch();
          }}
        />
      )}
      {!feedPending && !feedError && empty && (
        <StateView
          compact
          icon="file-tray-outline"
          title={
            embedded ? 'No requests need your response' : ownerAmendmentEmptyTitle(effectiveFilter)
          }
          message={
            embedded
              ? 'New booking and change requests will appear here.'
              : ownerAmendmentEmptyMessage(effectiveFilter)
          }
        />
      )}
      {amendments.hasNextPage && (
        <Button
          disabled={amendments.isFetchingNextPage}
          label={amendments.isFetchingNextPage ? 'Loading…' : 'Load more changes'}
          variant="secondary"
          onPress={() => void amendments.fetchNextPage()}
        />
      )}
      {items.map((booking) => (
        <Pressable
          key={booking.publicReference}
          accessibilityRole="button"
          accessibilityLabel={`New booking request for ${booking.renter.displayName}, ${booking.vehicle.make} ${booking.vehicle.model}${booking.ownerResponseDeadlineAt ? `, respond by ${dateTimeLabel(booking.ownerResponseDeadlineAt)}` : ''}.`}
          onPress={() => (onOpenBookingRequest ?? setSelected)(booking.publicReference)}
        >
          <Card style={styles.requestCard}>
            <VehicleImage
              contentPath={booking.vehicle.coverPhoto?.contentPath}
              style={styles.thumbnail}
            />
            <View style={styles.flex}>
              {embedded && <Text style={styles.changeEyebrow}>New booking</Text>}
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
    </>
  );
  if (embedded) return <View style={styles.embeddedFeed}>{feed}</View>;
  return (
    <Screen
      contentTopPadding={history ? 0 : undefined}
      eyebrow={history ? undefined : 'Owner mode'}
      safeTop={!history}
      title={history ? undefined : 'Booking requests'}
      subtitle={
        history
          ? undefined
          : 'Requests arrive only after the renter has authorized the rental payment.'
      }
    >
      {history && (
        <Text style={styles.historyIntro}>
          Review current and closed booking and Change Booking requests.
        </Text>
      )}
      {feed}
    </Screen>
  );
}

function OwnerAmendmentDetail({
  target,
  onClose,
}: {
  readonly target: { readonly bookingReference: string; readonly amendmentReference: string };
  readonly onClose: () => void;
}) {
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ['owner-amendment', target.amendmentReference],
    queryFn: () =>
      apiClient.request<AmendmentDetail>(
        `/owner/bookings/${target.bookingReference}/amendments/${target.amendmentReference}`,
      ),
    refetchInterval: (query) =>
      query.state.data && transientAmendmentStatuses.has(query.state.data.status) ? 5_000 : false,
  });
  useRefreshOnFocusAndForeground(() => void detail.refetch());
  const decide = useMutation({
    mutationFn: ({ action, reasonCode }: { action: 'accept' | 'decline'; reasonCode?: string }) =>
      apiClient.request<AmendmentDetail>(
        `/owner/bookings/${target.bookingReference}/amendments/${target.amendmentReference}/${action}`,
        {
          ...(reasonCode ? { body: JSON.stringify({ reasonCode }) } : {}),
          headers: {
            'Idempotency-Key': idempotencyKey(`owner-${action}`, target.amendmentReference),
          },
          method: 'POST',
        },
      ),
    onSuccess: (value) => {
      client.setQueryData(['owner-amendment', target.amendmentReference], value);
      void client.invalidateQueries({ queryKey: ['owner-home'] });
      void client.invalidateQueries({ queryKey: ['owner-home-upcoming'] });
      void client.invalidateQueries({ queryKey: ['owner-amendments'] });
      void client.invalidateQueries({ queryKey: ['owner-booking-requests'] });
      void client.invalidateQueries({ queryKey: ['owner-booking', target.bookingReference] });
      void client.invalidateQueries({ queryKey: ['owner-rentals'] });
      void client.invalidateQueries({ queryKey: ['owner-earnings'] });
    },
  });
  if (detail.isPending)
    return (
      <Screen leading={<BackControl label="Back" onPress={onClose} />} title="Change request">
        <StateView loading title="Loading change request…" />
      </Screen>
    );
  if (detail.isError || !detail.data)
    return (
      <Screen leading={<BackControl label="Back" onPress={onClose} />} title="Change request">
        <StateView
          icon="cloud-offline-outline"
          title="Change request unavailable"
          message={detail.error?.message}
          actionLabel="Retry"
          onAction={() => void detail.refetch()}
        />
      </Screen>
    );
  const amendment = detail.data;
  const [statusTitle, statusCopy] = ownerAmendmentStatusCopy(amendment);
  const ownerDelta = safeMoneyMinor(amendment.financial.ownerEarningsDeltaMinor);
  const currentEarnings = safeMoneyMinor(amendment.financial.currentOwnerEarningsMinor);
  const proposedEarnings = safeMoneyMinor(amendment.financial.proposedOwnerEarningsMinor);
  const additional = safeMoneyMinor(amendment.financial.additionalPaymentMinor);
  const applied = amendment.status === 'APPLIED';
  const activeExtension = amendment.scope === 'ACTIVE_EXTENSION';
  const pickupUnchanged = amendment.current.rentalStart === amendment.proposed.rentalStart;
  const handoverChanged =
    amendment.current.startMethod !== amendment.proposed.startMethod ||
    amendment.current.endMethod !== amendment.proposed.endMethod;
  const processing = ownerAmendmentIsProcessing(amendment);
  return (
    <Screen
      leading={<BackControl label="Back" onPress={onClose} />}
      eyebrow="Booking change request"
      title={amendment.actionable ? 'Review requested change' : statusTitle}
      subtitle={
        amendment.actionable ? `Respond by ${dateTimeLabel(amendment.expiresAt)}` : statusCopy
      }
    >
      {processing && (
        <View
          accessibilityLabel="Applying booking change. Processing."
          accessibilityRole="progressbar"
          style={styles.processingCue}
        >
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.processingText}>Processing</Text>
        </View>
      )}
      {applied ? (
        <>
          <View accessibilityLabel="Authoritative updated booking details">
            <Card>
              <Text accessibilityRole="header" style={styles.cardHeading}>
                {activeExtension ? 'Return time' : 'Trip dates'}
              </Text>
              {activeExtension ? (
                <CompactReturn
                  compact
                  label="Updated return"
                  value={amendment.proposed.rentalEnd}
                />
              ) : (
                <CompactDateRange
                  start={amendment.proposed.rentalStart}
                  end={amendment.proposed.rentalEnd}
                />
              )}
              <View style={styles.detailDivider} />
              <Text style={styles.metaLabel}>Handover</Text>
              <Text style={styles.detailValue}>
                {handoverSummary(amendment.proposed.startMethod, amendment.proposed.endMethod)}
              </Text>
            </Card>
          </View>
          <Card>
            <Text accessibilityRole="header" style={styles.cardHeading}>
              Owner earnings
            </Text>
            <Text style={styles.earningsValue}>
              {money(proposedEarnings, amendment.financial.currency)}
            </Text>
            <Text style={styles.noChange}>
              {ownerDelta === 0
                ? 'No change'
                : `Changed by ${earningsDeltaCopy(ownerDelta, amendment.financial.currency)}`}
            </Text>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <Text accessibilityRole="header" style={styles.cardHeading}>
              {pickupUnchanged ? 'Return change' : 'Trip dates'}
            </Text>
            {pickupUnchanged ? (
              <View style={styles.rangeGrid}>
                <CompactReturn label="Current return" value={amendment.current.rentalEnd} />
                <CompactReturn label="Requested return" value={amendment.proposed.rentalEnd} />
              </View>
            ) : (
              <View style={styles.rangeGrid}>
                <CompactDateRange
                  label="Current"
                  start={amendment.current.rentalStart}
                  end={amendment.current.rentalEnd}
                />
                <CompactDateRange
                  label="Requested"
                  start={amendment.proposed.rentalStart}
                  end={amendment.proposed.rentalEnd}
                />
              </View>
            )}
            <View style={styles.detailDivider} />
            <Text style={styles.metaLabel}>Handover</Text>
            {handoverChanged ? (
              <View style={styles.handoverChanges}>
                {amendment.current.startMethod !== amendment.proposed.startMethod && (
                  <Transition
                    label="Receive the car"
                    current={handoverMethod(amendment.current.startMethod)}
                    requested={handoverMethod(amendment.proposed.startMethod)}
                  />
                )}
                {amendment.current.endMethod !== amendment.proposed.endMethod && (
                  <Transition
                    label="Return the car"
                    current={handoverMethod(amendment.current.endMethod)}
                    requested={handoverMethod(amendment.proposed.endMethod)}
                  />
                )}
              </View>
            ) : (
              <>
                <Text style={styles.detailValue}>
                  {handoverSummary(amendment.current.startMethod, amendment.current.endMethod)}
                </Text>
                <Text style={styles.noChange}>No change</Text>
              </>
            )}
          </Card>
          <Card>
            <Text accessibilityRole="header" style={styles.cardHeading}>
              Owner earnings
            </Text>
            {ownerDelta === 0 ? (
              <>
                <Text style={styles.earningsValue}>
                  {money(currentEarnings, amendment.financial.currency)}
                </Text>
                <Text style={styles.noChange}>No change</Text>
              </>
            ) : (
              <>
                <FinancialRow
                  label="Current earnings"
                  value={money(currentEarnings, amendment.financial.currency)}
                />
                <FinancialRow
                  label="Requested earnings"
                  value={money(proposedEarnings, amendment.financial.currency)}
                />
                <FinancialRow
                  label="Change"
                  value={earningsDeltaCopy(ownerDelta, amendment.financial.currency)}
                  emphasized
                />
              </>
            )}
            {additional > 0 && (
              <Text style={styles.note}>
                Renter additional payment: {money(additional, amendment.financial.currency)}
              </Text>
            )}
          </Card>
        </>
      )}
      {decide.isError && (
        <Card style={styles.notice}>
          <Text style={styles.error}>{amendmentErrorMessage(decide.error)}</Text>
        </Card>
      )}
      {amendment.actionable && (
        <>
          <Button
            disabled={decide.isPending}
            label={decide.isPending ? 'Saving decision…' : 'Accept change'}
            onPress={() =>
              Alert.alert(
                'Accept this change?',
                additional > 0
                  ? 'The renter will have to complete the additional payment before the change applies.'
                  : 'The accepted change will begin applying immediately.',
                [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Accept', onPress: () => decide.mutate({ action: 'accept' }) },
                ],
              )
            }
          />
          <Button
            disabled={decide.isPending}
            label="Decline change"
            onPress={() =>
              Alert.alert(
                'Decline this change?',
                'The renter’s original booking will remain unchanged.',
                [
                  { text: 'Keep reviewing', style: 'cancel' },
                  {
                    text: 'Decline',
                    style: 'destructive',
                    onPress: () =>
                      decide.mutate({ action: 'decline', reasonCode: 'OWNER_SCHEDULE_CONFLICT' }),
                  },
                ],
              )
            }
            variant="danger"
          />
        </>
      )}
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
  canAccept,
  canReject,
  allowCancellation,
}: {
  readonly booking?: OwnerBookingView | undefined;
  readonly error: Error | null;
  readonly loading: boolean;
  readonly onBack: () => void;
  readonly onCancellationCompleted: () => void;
  readonly decision: ReturnType<
    typeof useMutation<unknown, Error, { reference: string; action: 'accept' | 'reject' }>
  >;
  readonly canAccept: boolean;
  readonly canReject: boolean;
  readonly allowCancellation: boolean;
}) {
  const [trustProfileOpen, setTrustProfileOpen] = useState(false);
  const [cancellationOpen, setCancellationOpen] = useState(false);
  if (loading)
    return (
      <Screen leading={<BackControl label="Back" onPress={onBack} />} title="Booking request">
        <StateView loading title="Loading request…" />
      </Screen>
    );
  if (error || !booking)
    return (
      <Screen leading={<BackControl label="Back" onPress={onBack} />} title="Booking request">
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
      leading={<BackControl label="Back" onPress={onBack} />}
      eyebrow={booking.status === 'AWAITING_OWNER' ? 'Booking request' : 'Booking details'}
      title={`${booking.vehicle.make} ${booking.vehicle.model}`}
    >
      <VehicleImage
        accessibilityLabel={`${booking.vehicle.make} ${booking.vehicle.model}`}
        contentPath={booking.vehicle.coverPhoto?.contentPath}
        style={styles.requestHero}
      />
      <Card style={styles.requestSummary}>
        <View style={styles.requestSummaryHeader}>
          <StatusBadge
            label={bookingStatusLabel(booking.status, 'owner')}
            tone={booking.status === 'AWAITING_OWNER' ? 'warning' : 'success'}
          />
          {booking.ownerResponseDeadlineAt && (
            <Text style={styles.requestDeadline}>
              Respond by {dateTimeLabel(booking.ownerResponseDeadlineAt)}
            </Text>
          )}
        </View>
        <View style={styles.requestSummaryValues}>
          <RequestDetailRow
            emphasized
            label="Booking total"
            value={money(booking.pricing.totalMinor, booking.pricing.currency)}
          />
          <RequestDetailRow label="Reference" value={booking.publicReference} />
        </View>
      </Card>

      <Card style={styles.requestSection}>
        <Text accessibilityRole="header" style={styles.requestSectionTitle}>
          Renter
        </Text>
        <View style={styles.renterIdentity}>
          {booking.renter.profilePhoto?.contentPath ? (
            <Image
              accessible
              accessibilityLabel={`${booking.renter.displayName}'s profile photo`}
              contentFit="cover"
              source={{ uri: apiClient.assetUrl(booking.renter.profilePhoto.contentPath) }}
              style={styles.renterAvatarImage}
              transition={180}
            />
          ) : (
            <View
              accessible
              accessibilityLabel={`${booking.renter.displayName}, profile photo unavailable`}
              style={styles.renterAvatarFallback}
            >
              <Icon color={colors.primary} name="person" size={26} />
            </View>
          )}
          <View style={styles.renterIdentityCopy}>
            <Text numberOfLines={2} style={styles.renterName}>
              {booking.renter.displayName}
            </Text>
            <View style={styles.renterStatus}>
              <StatusBadge
                label={booking.renter.verificationLabel}
                tone={booking.renter.verified ? 'success' : 'warning'}
              />
            </View>
            <View style={styles.renterTrustAction}>
              <Button
                compact
                label={trustProfileOpen ? 'Hide trust profile' : 'View trust profile'}
                onPress={() => setTrustProfileOpen(!trustProfileOpen)}
                variant="ghost"
              />
            </View>
          </View>
        </View>
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
              Sensitive identity evidence is available only to authorized platform staff.
            </Text>
          </View>
        )}
      </Card>

      <Card style={styles.requestSection}>
        <Text accessibilityRole="header" style={styles.requestSectionTitle}>
          Trip
        </Text>
        <RequestDetailRow
          label="Dates & time"
          value={requestTripSummary(booking.rentalStart, booking.rentalEnd)}
        />
      </Card>

      <Card style={styles.requestSection}>
        <Text accessibilityRole="header" style={styles.requestSectionTitle}>
          Handover
        </Text>
        <RequestDetailRow
          label="Start"
          value={
            booking.fulfillment.startMethod === 'OWNER_DELIVERY'
              ? 'Deliver to renter'
              : 'Renter pickup'
          }
        />
        {booking.fulfillment.startLocation && (
          <RequestDetailRow
            label="Start location"
            value={ownerFulfillmentLocation(booking.fulfillment.startLocation)}
          />
        )}
        {booking.fulfillment.startMethod === 'OWNER_DELIVERY' && (
          <RequestDetailRow
            label="Delivery fee"
            value={money(booking.fulfillment.deliveryFeeMinor, booking.pricing.currency)}
          />
        )}
        <View style={styles.requestSectionDivider} />
        <RequestDetailRow
          label="End"
          value={
            booking.fulfillment.endMethod === 'OWNER_COLLECTION'
              ? 'Owner collection'
              : 'Renter return'
          }
        />
        {booking.fulfillment.endLocation && (
          <RequestDetailRow
            label="End location"
            value={ownerFulfillmentLocation(booking.fulfillment.endLocation)}
          />
        )}
        {booking.fulfillment.endMethod === 'OWNER_COLLECTION' && (
          <RequestDetailRow
            label="Collection fee"
            value={money(booking.fulfillment.collectionFeeMinor, booking.pricing.currency)}
          />
        )}
      </Card>

      <Card style={styles.requestSection}>
        <View style={styles.requestSectionHeader}>
          <Text accessibilityRole="header" style={styles.requestSectionTitle}>
            Payment
          </Text>
          <StatusBadge label="Authorized" tone="success" />
        </View>
        <Text style={styles.body}>
          Payment is authorized and will be captured according to the booking flow.
        </Text>
      </Card>
      {booking.securityDeposit.required && (
        <SecurityDepositSummary compact securityDeposit={booking.securityDeposit} />
      )}

      {booking.status === 'AWAITING_OWNER' ? (
        <Card style={styles.decisionCard}>
          <Text accessibilityRole="header" style={styles.requestSectionTitle}>
            Owner decision
          </Text>
          <Text style={styles.body}>Review the renter and trip details before responding.</Text>
          {canAccept ? (
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
          ) : null}
          {canReject ? (
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
          ) : null}
        </Card>
      ) : (
        <OwnerNextStep booking={booking} />
      )}
      {decision.isError && <Text style={styles.error}>{decision.error.message}</Text>}
      {allowCancellation && ['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status) && (
        <Card style={styles.dangerZone}>
          <Text style={styles.dangerEyebrow}>Danger zone</Text>
          <Text style={styles.dangerTitle}>Cancel booking</Text>
          <Text style={styles.dangerCopy}>
            Only cancel when necessary. Existing cancellation rules still apply.
          </Text>
          <Button
            label="Cancel booking"
            onPress={() => setCancellationOpen(true)}
            variant="danger"
          />
        </Card>
      )}
      {allowCancellation ? (
        <BookingCancellationSheet
          bookingReference={booking.publicReference}
          onClose={() => setCancellationOpen(false)}
          onCompleted={onCancellationCompleted}
          role="OWNER"
          visible={cancellationOpen}
        />
      ) : null}
    </Screen>
  );
}

function CompactDateRange({
  compactTime = false,
  label,
  start,
  end,
}: {
  readonly compactTime?: boolean;
  readonly label?: string;
  readonly start: string;
  readonly end: string;
}) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return (
    <View
      accessibilityLabel={`${label ? `${label}. ` : ''}${accessibleDateRange(start, end)}`}
      style={styles.compactRange}
    >
      {label && <Text style={styles.metaLabel}>{label}</Text>}
      <Text style={styles.rangeValue}>
        {tripDateSummary(startDate, endDate, { alwaysShowYear: true })}
      </Text>
      <Text style={styles.rangeTimes}>
        {compactTime
          ? `${timeLabel(startDate)} → ${timeLabel(endDate)}`
          : `Pickup ${timeLabel(startDate)} · Return ${timeLabel(endDate)}`}
      </Text>
    </View>
  );
}

function CompactReturn({
  compact = false,
  label,
  value,
}: {
  readonly compact?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  const date = new Date(value);
  return (
    <View accessibilityLabel={`${label}, ${dateTimeLabel(value)}`} style={styles.compactRange}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.rangeValue}>
        {compact
          ? `${tripDateSummary(date, date, { alwaysShowYear: true })} · ${timeLabel(date)}`
          : dateTimeLabel(value)}
      </Text>
    </View>
  );
}

function FinancialRow({
  emphasized = false,
  label,
  value,
}: {
  readonly emphasized?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View accessibilityLabel={`${label}, ${value}`} style={styles.financialRow}>
      <Text style={styles.financialLabel}>{label}</Text>
      <Text style={[styles.financialValue, emphasized && styles.financialEmphasis]}>{value}</Text>
    </View>
  );
}

function Transition({
  label,
  current,
  requested,
}: {
  readonly label: string;
  readonly current: string;
  readonly requested: string;
}) {
  return (
    <View style={styles.transition}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.detailValue}>
        {current} → {requested}
      </Text>
    </View>
  );
}

function safeMoneyMinor(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(parsed) && Number.isFinite(parsed) ? parsed : 0;
}

function ownerAmendmentScope(filter: Filter) {
  return filter === 'Needs response'
    ? 'NEEDS_RESPONSE'
    : filter === 'Upcoming'
      ? 'UPCOMING'
      : 'ALL';
}

function ownerAmendmentEmptyTitle(filter: Filter) {
  if (filter === 'Needs response') return 'No booking changes need your response';
  if (filter === 'Upcoming') return 'No upcoming booking changes';
  return 'No booking change history yet';
}

function ownerAmendmentEmptyMessage(filter: Filter) {
  return filter === 'All'
    ? 'Past and current booking changes will appear here.'
    : 'Relevant booking changes will appear here when available.';
}

function earningsDeltaCopy(value: number, currency: string) {
  if (value === 0) return 'No earnings change';
  return `${value > 0 ? '+' : ''}${money(value, currency)}`;
}

function earningsDeltaAccessibility(value: number, currency: string) {
  if (value === 0) return 'Owner earnings change, no change';
  return `Owner earnings change, ${value < 0 ? 'minus ' : 'plus '}${money(Math.abs(value), currency)}`;
}

function accessibleDateRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return `${tripDateSummary(startDate, endDate, { alwaysShowYear: true })}. Pickup ${timeLabel(startDate)}. Return ${timeLabel(endDate)}`;
}

function requestTripSummary(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startTime = timeLabel(startDate);
  const endTime = timeLabel(endDate);
  const time = startTime === endTime ? startTime : `${startTime}–${endTime}`;
  return `${tripDateSummary(startDate, endDate, { alwaysShowYear: true })} · ${time}`;
}

function compactDeadline(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${timeLabel(date)}`;
}

function handoverMethod(value: string) {
  return value === 'OWNER_DELIVERY'
    ? 'Owner delivery'
    : value === 'OWNER_COLLECTION'
      ? 'Owner collection'
      : value === 'RENTER_PICKUP'
        ? 'Renter pickup'
        : 'Renter return';
}

function handoverSummary(start: string, end: string) {
  return `${handoverMethod(start)} · ${handoverMethod(end)}`;
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

function RequestDetailRow({
  emphasized = false,
  label,
  value,
}: {
  readonly emphasized?: boolean;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View accessibilityLabel={`${label}, ${value}`} style={styles.requestDetailRow}>
      <Text style={styles.requestDetailLabel}>{label}</Text>
      <Text style={[styles.requestDetailValue, emphasized && styles.requestDetailValueEmphasized]}>
        {value}
      </Text>
    </View>
  );
}

function OwnerNextStep({ booking }: { readonly booking: OwnerBookingView }) {
  if (booking.status === 'CONFIRMED')
    return (
      <Card style={styles.nextStepCard}>
        <Text style={styles.nextStepEyebrow}>Next step</Text>
        <Text style={styles.nextStepTitle}>Prepare the vehicle for pickup.</Text>
        <View style={styles.nextStepRows}>
          <RequestDetailRow
            label="Handover available"
            value={dateTimeLabel(booking.pickupWindow?.opensAt ?? booking.rentalStart)}
          />
          <RequestDetailRow label="Pickup" value={dateTimeLabel(booking.rentalStart)} />
        </View>
      </Card>
    );
  return (
    <Card style={styles.nextStepCard}>
      <Text style={styles.nextStepEyebrow}>Next step</Text>
      <Text style={styles.nextStepTitle}>{nextStep(booking)}</Text>
    </Card>
  );
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
  cardHeading: { color: colors.ink, fontSize: 18, fontWeight: '900', marginBottom: spacing.sm },
  changeCard: { gap: spacing.sm },
  changeCardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  changeEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  changeMetaGrid: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  changeRequests: { gap: spacing.sm },
  changeRenter: { color: colors.ink, fontSize: 16, fontWeight: '900', marginTop: spacing.xxs },
  compactRange: { flex: 1, gap: spacing.xxs, minWidth: 0 },
  decisionCard: { gap: spacing.sm },
  dangerCopy: { color: colors.subtleText, lineHeight: 20 },
  dangerEyebrow: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  dangerTitle: { color: colors.danger, fontSize: 17, fontWeight: '800' },
  dangerZone: { borderColor: colors.dangerSoft, gap: spacing.sm, marginTop: spacing.md },
  detailDivider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.md,
  },
  detailValue: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: spacing.xxs },
  earningsValue: { color: colors.ink, fontSize: 22, fontWeight: '900' },
  embeddedFeed: { gap: spacing.sm },
  embeddedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  error: { color: colors.danger, marginTop: spacing.sm },
  financialEmphasis: { color: colors.ink, fontWeight: '900' },
  financialLabel: { color: colors.subtleText, flex: 1, fontSize: 13, fontWeight: '700' },
  financialRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  financialValue: { color: colors.ink, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  historyIntro: { color: colors.subtleText, lineHeight: 21 },
  handoverChanges: { gap: spacing.sm, marginTop: spacing.sm },
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
  metaLabel: { color: colors.subtleText, fontSize: 12, fontWeight: '800' },
  metaValue: { color: colors.ink, fontSize: 14, fontWeight: '800', marginTop: spacing.xxs },
  noChange: { color: colors.primary, fontSize: 12, fontWeight: '800', marginTop: spacing.xxs },
  notice: { backgroundColor: colors.warningSoft },
  nextStepCard: { gap: spacing.xs, paddingVertical: spacing.sm },
  nextStepEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  nextStepRows: { gap: spacing.xxs },
  nextStepTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  note: { color: colors.subtleText, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  price: {
    color: colors.ink,
    flexShrink: 0,
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 'auto',
  },
  processingCue: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  processingText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  requestCard: { flexDirection: 'row', gap: spacing.sm },
  requestDeadline: {
    color: colors.subtleText,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
  },
  requestDetailLabel: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  requestDetailRow: { gap: 2, paddingVertical: spacing.xs },
  requestDetailValue: { color: colors.ink, fontSize: 15, fontWeight: '800', lineHeight: 21 },
  requestDetailValueEmphasized: { fontSize: 19, lineHeight: 25 },
  requestHero: { borderRadius: radius.lg, height: 210, width: '100%' },
  requestSection: { paddingVertical: spacing.sm },
  requestSectionDivider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  requestSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  requestSectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  requestSummary: { gap: spacing.sm, paddingVertical: spacing.sm },
  requestSummaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  requestSummaryValues: { gap: spacing.xxs },
  renterAvatarFallback: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  renterAvatarImage: { borderRadius: radius.pill, height: 60, width: 60 },
  renterIdentity: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  renterIdentityCopy: { flex: 1, minWidth: 0 },
  renterName: { color: colors.ink, flex: 1, fontSize: 18, fontWeight: '900', minWidth: 0 },
  renterStatus: { alignSelf: 'flex-start', marginTop: spacing.xxs },
  renterTrustAction: { alignSelf: 'flex-start', marginLeft: -spacing.md },
  rangeGrid: { flexDirection: 'row', gap: spacing.sm },
  rangeTimes: { color: colors.subtleText, fontSize: 12, lineHeight: 17 },
  rangeValue: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  sectionLabel: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  statusSlot: { flexShrink: 1 },
  thumbnail: { borderRadius: radius.md, height: 128, width: 108 },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  transition: { gap: spacing.xxs },
});
