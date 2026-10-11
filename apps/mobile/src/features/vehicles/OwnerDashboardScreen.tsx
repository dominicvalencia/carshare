import type { NavigationProp } from '@react-navigation/native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../auth/api-client';
import type { OwnerStatus, OwnerWorkspace } from '../../auth/auth.types';
import { OwnerBookingRequestsScreen } from '../bookings/OwnerBookingRequestsScreen';
import { OwnerRentalsScreen } from '../rentals/OwnerRentalsScreen';
import { hasOwnerPermission } from '../../navigation/owner-workspace';
import type { OwnerTabParamList, RootStackParamList } from '../../navigation/routes';
import {
  useFocusedPollingInterval,
  useRefreshOnFocusAndForeground,
} from '../../query/use-query-refresh';
import { OWNER_REQUEST_POLL_INTERVAL_MS } from '../../query/owner-request-freshness';
import { colors, radius, spacing } from '../../theme/tokens';
import { bookingStatusLabel, dateLabel, timeLabel, titleCase } from '../../ui/format';
import { VehicleImage } from '../../ui/VehicleImage';
import {
  Button,
  Card,
  FullScreenState,
  Icon,
  Screen,
  SectionHeader,
  StateView,
  StatusBadge,
} from '../../ui/primitives';
import {
  groupOwnerUpcoming,
  ownerHomeIsOperationallyEmpty,
  ownerHomeQueryKey,
  type OwnerHomeAttention,
  type OwnerHomeCard,
  type OwnerHomeReadModel,
  type OwnerHomeUpcomingPage,
} from './owner-home';

type OwnerHomeTab = 'Today' | 'Upcoming' | 'Requests';
type OwnerVehicleSummary = { readonly id: string; readonly status: string };
type OwnerAmendmentTarget = {
  readonly amendmentReference: string;
  readonly bookingReference: string;
};

export function OwnerDashboardScreen({
  ownerStatus,
  ownerWorkspace,
}: {
  readonly ownerStatus: OwnerStatus | null;
  readonly ownerWorkspace?: OwnerWorkspace;
}) {
  const navigation = useNavigation<NavigationProp<OwnerTabParamList & RootStackParamList>>();
  const route = useRoute<RouteProp<OwnerTabParamList, 'Dashboard'>>();
  const [selectedTab, setSelectedTab] = useState<OwnerHomeTab>(route.params?.initialTab ?? 'Today');
  const [selectedAmendment, setSelectedAmendment] = useState<OwnerAmendmentTarget | null>(null);
  const [selectedBookingReference, setSelectedBookingReference] = useState<string | null>(null);
  const [selectedRentalReference, setSelectedRentalReference] = useState<string | null>(null);
  const delegated = Boolean(ownerWorkspace && ownerWorkspace.capacity !== 'OWNER');
  const workspaceKey = delegated ? ownerWorkspace!.ownerProfileId : 'owner';
  const canViewBookings = !delegated || hasOwnerPermission(ownerWorkspace!, 'bookings.view');
  const canViewRentals = !delegated || hasOwnerPermission(ownerWorkspace!, 'rentals.view');
  const canViewVehicles = !delegated || hasOwnerPermission(ownerWorkspace!, 'vehicles.view');
  const canViewMessages = !delegated || hasOwnerPermission(ownerWorkspace!, 'messages.view');
  const requestPollingInterval = useFocusedPollingInterval(
    OWNER_REQUEST_POLL_INTERVAL_MS,
    ownerStatus === 'VERIFIED',
  );
  const home = useQuery({
    enabled: delegated || ownerStatus === 'VERIFIED',
    queryFn: () =>
      apiClient.request<OwnerHomeReadModel>(
        delegated ? `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/home` : '/owner/home',
      ),
    queryKey: [...ownerHomeQueryKey, workspaceKey],
    refetchInterval: requestPollingInterval,
    retry: false,
  });
  const vehicles = useQuery({
    enabled: (delegated || ownerStatus === 'VERIFIED') && canViewVehicles,
    queryFn: () =>
      apiClient.request<OwnerVehicleSummary[]>(
        delegated
          ? `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/vehicles`
          : '/owner/vehicles',
      ),
    queryKey: ['owner-workspace', workspaceKey, 'vehicles'],
    retry: false,
  });
  const upcoming = useInfiniteQuery<OwnerHomeUpcomingPage>({
    enabled:
      (delegated || ownerStatus === 'VERIFIED') && canViewRentals && selectedTab === 'Upcoming',
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiClient.request<OwnerHomeUpcomingPage>(
        delegated
          ? `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/home/upcoming?page=${pageParam}&pageSize=20`
          : `/owner/home/upcoming?page=${pageParam}&pageSize=20`,
      ),
    queryKey: ['owner-home-upcoming', workspaceKey],
  });
  const conversations = useQuery({
    enabled: delegated && canViewMessages,
    queryFn: () =>
      apiClient.request<{ items: readonly { unreadCount: number }[] }>(
        `/owner/workspaces/${ownerWorkspace!.ownerProfileId}/conversations?limit=50`,
      ),
    queryKey: ['conversations', workspaceKey],
  });
  useRefreshOnFocusAndForeground(() => {
    if (delegated || ownerStatus === 'VERIFIED') void home.refetch();
    if ((delegated || ownerStatus === 'VERIFIED') && canViewVehicles) void vehicles.refetch();
    if ((delegated || ownerStatus === 'VERIFIED') && canViewRentals && selectedTab === 'Upcoming')
      void upcoming.refetch();
    if (delegated && canViewMessages) void conversations.refetch();
  });

  if (!delegated && ownerStatus !== 'VERIFIED')
    return (
      <Screen scroll={false}>
        <FullScreenState
          actionLabel="Continue verification"
          icon="shield-checkmark-outline"
          message="Complete owner verification before managing operational bookings."
          onAction={() => navigation.navigate('OwnerOnboarding')}
          title="Verification required"
        />
      </Screen>
    );
  if (home.isPending)
    return (
      <Screen scroll={false}>
        <FullScreenState loading title="Loading today…" />
      </Screen>
    );
  if (home.isError || !home.data)
    return (
      <Screen scroll={false}>
        <FullScreenState
          actionLabel="Retry"
          icon="cloud-offline-outline"
          message={home.error?.message ?? 'Please try again.'}
          onAction={() => void home.refetch()}
          title="Today is unavailable"
        />
      </Screen>
    );

  const model = home.data;
  const openBooking = (reference: string) =>
    delegated
      ? setSelectedRentalReference(reference)
      : navigation.navigate('Booking', { bookingId: reference });
  const openUpcoming = () => setSelectedTab('Upcoming');
  const openRequests = () => setSelectedTab('Requests');
  const requestCount = model.requests.totalRequestsCount;
  const vehicleAction =
    !delegated && vehicles.data
      ? vehicles.data.length === 0
        ? 'Add your vehicle'
        : vehicles.data.some(({ status }) => status === 'DRAFT')
          ? 'Complete your vehicle info'
          : null
      : null;
  if (selectedAmendment)
    return (
      <OwnerBookingRequestsScreen
        {...(delegated ? { ownerWorkspace } : {})}
        initialAmendmentReference={selectedAmendment.amendmentReference}
        initialBookingReference={selectedAmendment.bookingReference}
        onClose={() => setSelectedAmendment(null)}
      />
    );
  if (selectedBookingReference)
    return (
      <OwnerBookingRequestsScreen
        {...(delegated ? { ownerWorkspace } : {})}
        initialBookingReference={selectedBookingReference}
        onClose={() => setSelectedBookingReference(null)}
      />
    );
  if (selectedRentalReference)
    return (
      <OwnerRentalsScreen
        initialBookingReference={selectedRentalReference}
        onClose={() => setSelectedRentalReference(null)}
        {...(delegated ? { ownerWorkspace } : {})}
      />
    );
  return (
    <Screen
      stickyHeader={
        <View accessibilityRole="tablist" style={styles.tabs}>
          <TopTab
            label="Today"
            onPress={() => setSelectedTab('Today')}
            selected={selectedTab === 'Today'}
          />
          {canViewRentals ? (
            <TopTab label="Upcoming" onPress={openUpcoming} selected={selectedTab === 'Upcoming'} />
          ) : null}
          {canViewBookings ? (
            <TopTab
              count={requestCount}
              label="Requests"
              onPress={openRequests}
              selected={selectedTab === 'Requests'}
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.tabContent}>
        {selectedTab === 'Today' && (
          <View style={styles.tabPanel}>
            {model.today.attention.length > 0 && (
              <TodaySection title="Needs attention">
                {model.today.attention.map((item) => (
                  <AttentionCard
                    key={`${item.type}-${item.bookingReference}`}
                    item={item}
                    onPress={openBooking}
                  />
                ))}
              </TodaySection>
            )}
            {model.today.pickups.length > 0 && (
              <TodaySection title="Pickups today">
                {model.today.pickups.map((item) => (
                  <OperationalCard
                    key={item.bookingReference}
                    item={item}
                    kind="pickup"
                    onPress={openBooking}
                  />
                ))}
              </TodaySection>
            )}
            {model.today.activeRentals.length > 0 && (
              <TodaySection title="Active rentals">
                {model.today.activeRentals.map((item) => (
                  <OperationalCard
                    key={item.bookingReference}
                    item={item}
                    kind="active"
                    onPress={openBooking}
                  />
                ))}
              </TodaySection>
            )}
            {model.today.returns.length > 0 && (
              <TodaySection title="Returns today">
                {model.today.returns.map((item) => (
                  <OperationalCard
                    key={item.bookingReference}
                    item={item}
                    kind="return"
                    onPress={openBooking}
                  />
                ))}
              </TodaySection>
            )}
            {ownerHomeIsOperationallyEmpty(model) && (
              <View style={requestCount === 0 && styles.centeredEmpty}>
                <Card style={styles.emptyCard}>
                  <Icon color={colors.primary} name="sunny-outline" size={28} />
                  <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
                  {model.today.nextUpcoming ? (
                    <>
                      <Text style={styles.emptyMessage}>
                        Your next rental starts {dateLabel(model.today.nextUpcoming.pickup.at)}.
                      </Text>
                      <Button
                        compact
                        label="View upcoming"
                        onPress={openUpcoming}
                        variant="secondary"
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.emptyMessage}>
                        Future confirmed rentals will appear in Upcoming.
                      </Text>
                      {vehicleAction && (
                        <Button
                          compact
                          label={vehicleAction}
                          onPress={() => navigation.navigate('Vehicles')}
                          variant="secondary"
                        />
                      )}
                    </>
                  )}
                </Card>
              </View>
            )}
            {requestCount > 0 && (
              <Pressable
                accessibilityLabel={`${requestCount} requests need your response. View requests`}
                accessibilityRole="button"
                onPress={openRequests}
              >
                <Card style={styles.requestSummary}>
                  <View style={styles.summaryIcon}>
                    <Icon color={colors.primary} name="file-tray-full-outline" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>
                      {requestCount} {requestCount === 1 ? 'request needs' : 'requests need'} your
                      response
                    </Text>
                    <Text style={styles.link}>View requests</Text>
                  </View>
                  <Icon color={colors.primary} name="chevron-forward" />
                </Card>
              </Pressable>
            )}
            {delegated && canViewMessages ? (
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Messages')}>
                <Card style={styles.requestSummary}>
                  <View style={styles.summaryIcon}>
                    <Icon color={colors.primary} name="chatbubble-outline" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>Messages</Text>
                    <Text style={styles.link}>
                      {(conversations.data?.items ?? []).reduce(
                        (total, item) => total + item.unreadCount,
                        0,
                      )}{' '}
                      unread
                    </Text>
                  </View>
                  <Icon color={colors.primary} name="chevron-forward" />
                </Card>
              </Pressable>
            ) : null}
            {delegated && canViewVehicles ? (
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Vehicles')}>
                <Card style={styles.requestSummary}>
                  <View style={styles.summaryIcon}>
                    <Icon color={colors.primary} name="car-sport-outline" />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>Vehicles</Text>
                    <Text style={styles.link}>
                      {vehicles.data?.length
                        ? `${vehicles.data.length} assigned`
                        : 'No assigned vehicles'}
                    </Text>
                  </View>
                  <Icon color={colors.primary} name="chevron-forward" />
                </Card>
              </Pressable>
            ) : null}
          </View>
        )}
        {selectedTab === 'Upcoming' && (
          <View style={styles.tabPanel}>
            <UpcomingTab model={model} onOpenBooking={openBooking} query={upcoming} />
          </View>
        )}
        {selectedTab === 'Requests' && (
          <View style={styles.tabPanel}>
            <OwnerBookingRequestsScreen
              {...(delegated ? { ownerWorkspace } : {})}
              embedded
              onHistory={() => navigation.navigate('OwnerRequestHistory')}
              onOpenAmendment={setSelectedAmendment}
              onOpenBookingRequest={setSelectedBookingReference}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

function UpcomingTab({
  model,
  onOpenBooking,
  query,
}: {
  readonly model: OwnerHomeReadModel;
  readonly onOpenBooking: (reference: string) => void;
  readonly query: {
    readonly data: { readonly pages: readonly OwnerHomeUpcomingPage[] } | undefined;
    readonly error: Error | null;
    readonly hasNextPage: boolean;
    readonly isError: boolean;
    readonly isFetchingNextPage: boolean;
    readonly isPending: boolean;
    readonly fetchNextPage: () => Promise<unknown>;
    readonly refetch: () => Promise<unknown>;
  };
}) {
  if (query.isPending) return <StateView loading title="Loading upcoming rentals…" />;
  if (query.isError)
    return (
      <StateView
        actionLabel="Retry"
        icon="cloud-offline-outline"
        message={query.error?.message}
        onAction={() => void query.refetch()}
        title="Upcoming rentals unavailable"
      />
    );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups = groupOwnerUpcoming(items, model.today.startInclusive, model.timezone);
  if (groups.length === 0)
    return (
      <StateView
        icon="calendar-outline"
        message="Future confirmed rentals will appear here."
        title="No upcoming rentals"
      />
    );
  return (
    <View style={styles.upcomingGroups}>
      {groups.map((group) => (
        <View key={group.key} style={styles.upcomingGroup}>
          <SectionHeader flush title={group.label} />
          <View style={styles.cardList}>
            {group.bookings.map((item) => (
              <UpcomingCard key={item.bookingReference} item={item} onPress={onOpenBooking} />
            ))}
          </View>
        </View>
      ))}
      {query.hasNextPage && (
        <Button
          disabled={query.isFetchingNextPage}
          label={query.isFetchingNextPage ? 'Loading…' : 'Load more rentals'}
          onPress={() => void query.fetchNextPage()}
          variant="secondary"
        />
      )}
    </View>
  );
}

function UpcomingCard({
  item,
  onPress,
}: {
  readonly item: OwnerHomeCard;
  readonly onPress: (reference: string) => void;
}) {
  return (
    <Pressable
      accessibilityHint="Opens booking details"
      accessibilityLabel={`${item.vehicle.make} ${item.vehicle.model}. ${item.renterDisplayName}. Pickup ${dateLabel(item.pickup.at)} at ${timeLabel(item.pickup.at)}. Return ${dateLabel(item.return.at)} at ${timeLabel(item.return.at)}. ${bookingStatusLabel(item.status, 'owner')}.`}
      accessibilityRole="button"
      onPress={() => onPress(item.deepLinkTarget.bookingReference)}
    >
      <Card style={styles.bookingCard}>
        <VehicleImage
          accessible={false}
          contentPath={item.vehicle.coverPhoto?.contentPath}
          style={styles.bookingImage}
        />
        <View style={styles.bookingContent}>
          <Text style={styles.vehicle}>
            {item.vehicle.make} {item.vehicle.model}
          </Text>
          <Text style={styles.renter}>{item.renterDisplayName}</Text>
          <Text style={styles.upcomingMethod}>{titleCase(item.pickup.method)}</Text>
          <View style={styles.upcomingSchedule}>
            <Text style={styles.scheduleText}>
              Pickup · {compactDateLabel(item.pickup.at)}, {timeLabel(item.pickup.at)}
            </Text>
            <Text style={styles.scheduleText}>
              Returns · {compactDateLabel(item.return.at)}, {timeLabel(item.return.at)}
            </Text>
          </View>
          <View style={styles.bookingStatus}>
            <StatusBadge label={bookingStatusLabel(item.status, 'owner')} />
          </View>
        </View>
        <View style={styles.bookingChevron}>
          <Icon color={colors.primary} name="chevron-forward" size={20} />
        </View>
      </Card>
    </Pressable>
  );
}

function TopTab({
  count = 0,
  label,
  onPress,
  selected = false,
}: {
  readonly count?: number;
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
}) {
  const accessibilityLabel =
    label === 'Requests' && count > 0
      ? `Requests, ${count} items need your response`
      : `${label}${selected ? ', selected' : ''}`;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.topTab, selected && styles.topTabSelected]}
    >
      <Text style={[styles.topTabText, selected && styles.topTabTextSelected]}>{label}</Text>
      {count > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function TodaySection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View accessibilityLabel={title} style={styles.section}>
      <SectionHeader flush title={title} />
      <View style={[styles.cardList, styles.sectionCards]}>{children}</View>
    </View>
  );
}

function OperationalCard({
  item,
  kind,
  onPress,
}: {
  readonly item: OwnerHomeCard;
  readonly kind: 'pickup' | 'active' | 'return';
  readonly onPress: (reference: string) => void;
}) {
  const at = kind === 'pickup' ? item.pickup.at : item.return.at;
  const detail =
    kind === 'pickup'
      ? `${titleCase(item.pickup.method)}${item.pickup.location ? ` · ${item.pickup.location}` : ''}`
      : titleCase(item.return.method);
  const prefix = kind === 'pickup' ? 'Pickup' : 'Returns';
  return (
    <Pressable
      accessibilityHint="Opens booking details"
      accessibilityLabel={`${item.vehicle.make} ${item.vehicle.model}. ${item.renterDisplayName}. ${detail}. ${prefix} ${dateLabel(at)} at ${timeLabel(at)}. ${bookingStatusLabel(item.status, 'owner')}.`}
      accessibilityRole="button"
      onPress={() => onPress(item.deepLinkTarget.bookingReference)}
    >
      <Card style={styles.bookingCard}>
        <VehicleImage
          accessible={false}
          contentPath={item.vehicle.coverPhoto?.contentPath}
          style={styles.bookingImage}
        />
        <View style={styles.bookingContent}>
          <Text style={styles.vehicle}>
            {item.vehicle.make} {item.vehicle.model}
          </Text>
          <Text style={styles.renter}>{item.renterDisplayName}</Text>
          <Text style={styles.upcomingMethod}>{detail}</Text>
          <Text style={styles.scheduleText}>
            {prefix} · {compactDateLabel(at)}, {timeLabel(at)}
          </Text>
          <View style={styles.bookingStatus}>
            <StatusBadge label={bookingStatusLabel(item.status, 'owner')} />
          </View>
        </View>
        <View style={styles.bookingChevron}>
          <Icon color={colors.primary} name="chevron-forward" size={20} />
        </View>
      </Card>
    </Pressable>
  );
}

function AttentionCard({
  item,
  onPress,
}: {
  readonly item: OwnerHomeAttention;
  readonly onPress: (reference: string) => void;
}) {
  const label = attentionLabel(item);
  const vehicleName = `${item.vehicleMake} ${item.vehicleModel}`.trim();
  return (
    <Pressable
      accessibilityHint="Opens booking details"
      accessibilityLabel={`${label}. ${vehicleName}. ${item.renterDisplayName}. Booking ${item.bookingReference}.`}
      accessibilityRole="button"
      onPress={() => onPress(item.deepLinkTarget.bookingReference)}
    >
      <Card style={styles.attentionCard}>
        <View style={styles.attentionIcon}>
          <Icon color={colors.warning} name="alert-circle-outline" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{label}</Text>
          <Text style={styles.attentionContext}>
            {vehicleName} · {item.renterDisplayName}
          </Text>
          <Text style={styles.attentionReference}>{item.bookingReference}</Text>
        </View>
        <Icon color={colors.warning} name="chevron-forward" size={20} />
      </Card>
    </Pressable>
  );
}

function attentionLabel(item: OwnerHomeAttention): string {
  if (item.type === 'OVERDUE_PICKUP') return 'Pickup needs attention';
  if (item.type === 'OVERDUE_RETURN') return 'Return is overdue';
  if (item.type === 'FINANCIAL_RECOVERY') return 'Booking update needs review';
  if (item.titleCode === 'PICKUP_DISCREPANCY') return 'Pickup discrepancy needs review';
  return 'Booking needs attention';
}

function compactDateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short' }).format(
    new Date(value),
  );
}

const styles = StyleSheet.create({
  attentionCard: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  attentionIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  attentionContext: { color: colors.ink, fontWeight: '700', marginTop: spacing.xxs },
  attentionReference: { color: colors.subtleText, fontSize: 12, marginTop: 2 },
  body: { color: colors.subtleText, lineHeight: 20, marginTop: spacing.xxs },
  cardList: { gap: spacing.xs },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  centeredEmpty: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  countBadge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 22,
    minWidth: 22,
    paddingHorizontal: 6,
  },
  countBadgeText: { color: colors.onPrimary, fontSize: 12, fontWeight: '900' },
  emptyCard: { alignItems: 'center', gap: spacing.xs, justifyContent: 'center', width: '100%' },
  emptyMessage: { color: colors.subtleText, lineHeight: 20, textAlign: 'center' },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' },
  flex: { flex: 1, minWidth: 0 },
  link: { color: colors.primary, fontWeight: '800', marginTop: spacing.xxs },
  bookingCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  bookingChevron: { alignSelf: 'center', flexShrink: 0 },
  bookingContent: { flex: 1, minWidth: 0 },
  bookingImage: { borderRadius: radius.md, height: 128, width: 108 },
  bookingStatus: { marginTop: spacing.xxs },
  renter: { color: colors.subtleText, marginTop: 2 },
  requestSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xxs,
  },
  scheduleText: { color: colors.subtleText, fontSize: 12, lineHeight: 18 },
  topTab: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  topTabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  topTabText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  topTabTextSelected: { color: colors.onPrimary },
  section: { marginBottom: spacing.md },
  sectionCards: { marginTop: spacing.xs },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  tabContent: { flexGrow: 1 },
  tabPanel: { flexGrow: 1, paddingTop: spacing.sm },
  tabs: {
    alignSelf: 'center',
    backgroundColor: colors.background,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    paddingVertical: spacing.xs,
    zIndex: 1,
  },
  upcomingGroup: { gap: spacing.xs },
  upcomingGroups: { gap: spacing.lg },
  upcomingMethod: { color: colors.subtleText, lineHeight: 18, marginTop: 2 },
  upcomingSchedule: { gap: spacing.xxs },
  vehicle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
});
