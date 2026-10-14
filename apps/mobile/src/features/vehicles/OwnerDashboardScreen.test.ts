import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  groupOwnerUpcoming,
  ownerAttentionLabel,
  ownerHomeIsOperationallyEmpty,
  ownerRequestSummaryLabel,
  ownerRequestTabAccessibilityLabel,
  ownerTodayDateLabel,
  ownerUnreadMessageCount,
  ownerUnreadMessagesLabel,
  type OwnerHomeCard,
  type OwnerHomeReadModel,
} from './owner-home';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerDashboardScreen.tsx'),
  'utf8',
);
const requestsSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);
const primitivesSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/primitives.tsx'),
  'utf8',
);
const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);
const queryRefreshSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../query/use-query-refresh.ts'),
  'utf8',
);

const card = (status = 'CONFIRMED', returnAt = '2026-10-02T09:00:00.000Z'): OwnerHomeCard => ({
  bookingReference: 'CR-OWNER-HOME',
  deepLinkTarget: { bookingReference: 'CR-OWNER-HOME', route: 'Booking' },
  pickup: {
    at: '2026-10-02T01:00:00.000Z',
    handoverStatus: null,
    location: 'Makati City',
    method: 'RENTER_PICKUP',
  },
  renterDisplayName: 'Mika Santos',
  return: { at: returnAt, method: 'RENTER_RETURN', workflowStatus: null },
  status,
  vehicle: { make: 'Mitsubishi', model: 'Mirage' },
});

function model(overrides: Partial<OwnerHomeReadModel['today']> = {}): OwnerHomeReadModel {
  return {
    asOf: '2026-10-02T04:00:00.000Z',
    requests: {
      amendmentRequestsCount: 1,
      bookingRequestsCount: 1,
      totalRequestsCount: 2,
    },
    timezone: 'Asia/Manila',
    today: {
      activeRentals: [],
      attention: [],
      counts: {
        actionableRequestsCount: 2,
        activeRentalsCount: 0,
        needsAttentionCount: 0,
        pickupsTodayCount: 0,
        returnsTodayCount: 0,
      },
      endExclusive: '2026-10-02T16:00:00.000Z',
      nextUpcoming: null,
      pickups: [],
      returns: [],
      startInclusive: '2026-10-01T16:00:00.000Z',
      ...overrides,
    },
  };
}

describe('Owner Today mobile UI', () => {
  it('uses capability-aware request copy while retaining the Owner wording', () => {
    expect(ownerRequestSummaryLabel(1, true)).toBe('1 request needs your response');
    expect(ownerRequestSummaryLabel(2, true)).toBe('2 requests need your response');
    expect(ownerRequestSummaryLabel(1, false)).toBe('1 booking request');
    expect(ownerRequestSummaryLabel(2, false)).toBe('2 booking requests');
    expect(ownerRequestTabAccessibilityLabel(1, true)).toBe('Requests, 1 item needs your response');
    expect(ownerRequestTabAccessibilityLabel(1, false)).toBe('Requests, 1 booking request');
    expect(source).toContain("hasOwnerPermission(ownerWorkspace!, 'bookings.accept')");
    expect(source).toContain("hasOwnerPermission(ownerWorkspace!, 'bookings.reject')");
  });

  it('places Owner approval summaries after booking requests and operational sections', () => {
    const requests = source.indexOf('{canViewRequests && requestCount > 0 && (');
    const changeApprovals = source.indexOf('{pendingVehicleChanges.length > 0 ? (');
    const vehicleApprovals = source.indexOf('{pendingOwnerApprovals.length > 0 ? (');

    expect(requests).toBeGreaterThan(-1);
    expect(changeApprovals).toBeGreaterThan(requests);
    expect(vehicleApprovals).toBeGreaterThan(changeApprovals);
  });

  it('shows a message summary only when messages need attention', () => {
    expect(ownerUnreadMessageCount([{ unreadCount: 0 }])).toBe(0);
    expect(ownerUnreadMessageCount([{ unreadCount: 2 }, { unreadCount: 1 }])).toBe(3);
    expect(ownerUnreadMessagesLabel(1)).toBe('1 unread message');
    expect(ownerUnreadMessagesLabel(3)).toBe('3 unread messages');
    expect(source).toContain('canViewMessages && unreadMessageCount > 0');
    expect(source).not.toContain('<Text style={styles.cardTitle}>Messages</Text>');
    expect(source).not.toContain('<Text style={styles.cardTitle}>Vehicles</Text>');
    expect(source).not.toContain('vehicleAttentionCount');
    expect(source).not.toContain('Review vehicles');
    expect(source).not.toContain("'No assigned vehicles'");
    expect(source).not.toContain('`${vehicles.data.length} assigned`');
  });

  it('uses the shared conversation summary for Owner and delegated unread attention', () => {
    expect(source).toContain("'/conversations?limit=50&audience=OWNER'");
    expect(source).toContain(
      '`/owner/workspaces/${ownerWorkspace!.ownerProfileId}/conversations?limit=50`',
    );
    expect(source).toContain("queryKey: ['conversations', workspaceKey]");
    expect(navigationSource).toContain('delegatedOwnerTabs(ownerWorkspace)');
    expect(navigationSource).toContain(
      'options={badges.messages ? { tabBarBadge: badges.messages } : {}}',
    );
  });

  it('uses neutral attention copy when delegated users lack the matching action permission', () => {
    const attention: OwnerHomeReadModel['today']['attention'][number] = {
      bookingReference: 'CR-ATTENTION',
      deepLinkTarget: { bookingReference: 'CR-ATTENTION', route: 'Booking' },
      renterDisplayName: 'Mika Santos',
      severity: 'WARNING',
      timestamp: null,
      titleCode: 'PICKUP_DISCREPANCY',
      type: 'OPERATIONAL_HOLD',
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
    };
    expect(ownerAttentionLabel(attention, true)).toBe('Pickup discrepancy needs review');
    expect(ownerAttentionLabel(attention, false)).toBe('Pickup discrepancy');
    expect(source).toContain(
      "title={hasActionableAttention ? 'Needs attention' : 'Rental updates'}",
    );
    for (const permission of [
      'handover.perform',
      'return.perform',
      'inspections.create',
      'inspections.update',
      'incidents.create',
      'claims.create',
    ])
      expect(source).toContain(`'${permission}'`);
  });

  it('uses the server Manila window for its displayed date', () => {
    expect(ownerTodayDateLabel(model().today.startInclusive, 'Asia/Manila')).toBe('Friday, Oct 2');
  });

  it('distinguishes operational emptiness from actionable requests and next upcoming', () => {
    expect(ownerHomeIsOperationallyEmpty(model({ nextUpcoming: card() }))).toBe(true);
    expect(ownerHomeIsOperationallyEmpty(model({ pickups: [card()] }))).toBe(false);
    expect(ownerHomeIsOperationallyEmpty(model({ activeRentals: [card('ACTIVE')] }))).toBe(false);
    expect(ownerHomeIsOperationallyEmpty(model({ returns: [card('RETURN_PENDING')] }))).toBe(false);
  });

  it('renders server sections in operational priority order with compact cards', () => {
    const attention = source.indexOf("title={hasActionableAttention ? 'Needs attention'");
    const pickup = source.indexOf('title="Pickups today"');
    const active = source.indexOf('title="Active rentals"');
    const returns = source.indexOf('title="Returns today"');
    const requests = source.indexOf('{canViewRequests && requestCount > 0 && (');
    expect(attention).toBeGreaterThan(0);
    expect(attention).toBeLessThan(pickup);
    expect(pickup).toBeLessThan(active);
    expect(active).toBeLessThan(returns);
    expect(returns).toBeLessThan(requests);
    expect(source).toContain('kind="pickup"');
    expect(source).toContain('kind="active"');
    expect(source).toContain('kind="return"');
    expect(source).toContain("navigation.navigate('Booking', { bookingId: reference })");
  });

  it('renders compact attention context without redundant action copy', () => {
    expect(source).toContain(
      'const vehicleName = `${item.vehicleMake} ${item.vehicleModel}`.trim()',
    );
    expect(source).toContain('{vehicleName} · {item.renterDisplayName}');
    expect(source).toContain(
      '<Text style={styles.attentionReference}>{item.bookingReference}</Text>',
    );
    expect(source).toContain('accessibilityHint="Opens booking details"');
    expect(source).not.toContain('<Text style={styles.attentionLink}>View booking</Text>');
  });

  it('uses one server request count for the accessible tab and compact summary', () => {
    expect(source).toContain('const requestCount = model.requests.totalRequestsCount');
    expect(source).toContain('count={requestCount}');
    expect(source).toContain('label="Requests"');
    expect(source).toContain('ownerRequestSummaryLabel(requestCount, canRespondToRequests)');
    expect(source).not.toContain('filteredAmendments');
    expect(source).toContain("ownerWorkspace!.capacity === 'MANAGER' && canViewBookings");
    expect(source).toContain(
      "const activeTab = selectedTab === 'Requests' && !canViewRequests ? 'Today' : selectedTab",
    );
    expect(source).toContain('{canViewRequests && requestCount > 0 && (');
  });

  it('supports recoverable loading, failure, empty, next-upcoming, focus, and resume states', () => {
    expect(source).toContain('Loading today…');
    expect(source).toContain('Today is unavailable');
    expect(source).toContain('Nothing scheduled today');
    expect(source).toContain('model.today.nextUpcoming');
    expect(source).toContain('View upcoming');
    expect(source).toContain('useRefreshOnFocusAndForeground');
    expect(source).toContain('useFocusedPollingInterval(');
    expect(source).toContain('OWNER_REQUEST_POLL_INTERVAL_MS');
    expect(source).toContain('refetchInterval: requestPollingInterval');
    expect(requestsSource).toContain('refetchInterval: requestPollingInterval');
    expect(queryRefreshSource).toContain('useIsFocused()');
    expect(queryRefreshSource).toContain("appState === 'active'");
    expect(queryRefreshSource).toContain('AppState.addEventListener');
  });

  it('uses the current server-projected return timestamp for ACTIVE extensions', () => {
    expect(card('ACTIVE', '2026-10-05T09:00:00.000Z').return.at).toBe('2026-10-05T09:00:00.000Z');
    expect(source).toContain("kind === 'pickup' ? item.pickup.at : item.return.at");
  });

  it('uses the shared photo-card family for pickup, active, and return cards', () => {
    const operationalCard = source.slice(
      source.indexOf('function OperationalCard('),
      source.indexOf('function AttentionCard('),
    );

    expect(operationalCard).toContain('<VehicleImage');
    expect(operationalCard).toContain('contentPath={item.vehicle.coverPhoto?.contentPath}');
    expect(operationalCard).toContain('style={styles.bookingImage}');
    expect(operationalCard).toContain('{item.vehicle.make} {item.vehicle.model}');
    expect(operationalCard).toContain('{item.renterDisplayName}');
    expect(operationalCard).toContain("kind === 'pickup' ? item.pickup.at : item.return.at");
    expect(operationalCard).toContain("kind === 'pickup' ? 'Pickup' : 'Returns'");
    expect(operationalCard).toContain('bookingStatusLabel(item.status');
    expect(operationalCard).not.toContain('styles.timeColumn');
    expect(operationalCard).not.toContain('styles.time');
  });

  it('keeps photo cards responsive with decorative images and centered chevrons', () => {
    expect(source).toContain('accessible={false}');
    expect(source).toContain('accessibilityHint="Opens booking details"');
    expect(source).toContain('bookingContent: { flex: 1, minWidth: 0 }');
    expect(source).toContain("bookingChevron: { alignSelf: 'center', flexShrink: 0 }");
    expect(source).toContain('bookingImage: { borderRadius: radius.md, height: 128, width: 108 }');
    expect(source.match(/<View style={styles\.bookingChevron}>/g)).toHaveLength(2);
  });

  it('groups future rentals by Manila date, omits Today, orders groups, and deduplicates pages', () => {
    const today = card('CONFIRMED');
    const tomorrow = {
      ...card('CONFIRMED'),
      bookingReference: 'TOMORROW',
      pickup: { ...today.pickup, at: '2026-10-03T01:00:00.000Z' },
    };
    const later = {
      ...card('READY_FOR_PICKUP'),
      bookingReference: 'LATER',
      pickup: { ...today.pickup, at: '2026-10-05T01:00:00.000Z' },
    };
    const groups = groupOwnerUpcoming(
      [later, today, tomorrow, tomorrow],
      model().today.startInclusive,
      'Asia/Manila',
    );
    expect(groups.map(({ label }) => label)).toEqual(['Tomorrow', 'Oct 5']);
    expect(
      groups.flatMap(({ bookings }) => bookings.map(({ bookingReference }) => bookingReference)),
    ).toEqual(['TOMORROW', 'LATER']);
  });

  it('uses bounded server pagination with load-more and end-of-list states', () => {
    expect(source).toContain('/owner/home/upcoming?page=${pageParam}&pageSize=20');
    expect(source).toContain('lastPage.page < lastPage.totalPages');
    expect(source).toContain('Load more rentals');
    expect(source).toContain('isFetchingNextPage');
    expect(source).not.toContain('You’re up to date.');
  });

  it('starts with centered tabs and no repeated Owner Home header', () => {
    const screen = source.indexOf('<Screen\n      stickyHeader={');
    const tabs = source.indexOf('accessibilityRole="tablist"', screen);
    const attention = source.indexOf("title={hasActionableAttention ? 'Needs attention'", tabs);
    expect(screen).toBeGreaterThan(0);
    expect(tabs).toBeGreaterThan(screen);
    expect(attention).toBeGreaterThan(tabs);
    expect(source).toContain("alignSelf: 'center'");
    expect(source).toContain('backgroundColor: colors.background');
    expect(source).not.toContain("selectedTab === 'Today'\n          ? ownerTodayDateLabel");
    expect(source).not.toContain('eyebrow="Owner mode"');
    expect(source).not.toContain('title="Today"');
  });

  it('uses one shared top spacing authority for Today, Upcoming, and Requests', () => {
    expect(source.match(/<View style={styles\.tabPanel}>/g)).toHaveLength(3);
    expect(source).toContain('tabPanel: { flexGrow: 1, paddingTop: spacing.sm }');
    expect(source).toContain('<SectionHeader flush title={title} />');
    expect(source).toContain('<SectionHeader flush title={group.label} />');
    expect(source).toContain('section: { marginBottom: spacing.md }');
    expect(primitivesSource).toContain('flush && styles.sectionHeaderFlush');
    expect(primitivesSource).toContain('sectionHeaderFlush: { marginTop: 0 }');
  });

  it('centers whole-surface Owner states in the usable content viewport', () => {
    expect(source.match(/<FullScreenState/g)).toHaveLength(3);
    expect(source).toContain('title="Today is unavailable"');
    expect(source).toContain('actionLabel="Retry"');
    expect(source).toContain('onAction={() => void home.refetch()}');
    expect(source).toContain('title="Verification required"');
    expect(primitivesSource).toContain('export function FullScreenState');
    expect(primitivesSource).toContain('contentContainerStyle={styles.fullScreenStateContent}');
    expect(primitivesSource).toContain(
      "fullScreenStateContent: {\n    flexGrow: 1,\n    justifyContent: 'center'",
    );
    expect(primitivesSource).toContain('style={styles.flex}');
  });

  it('uses the parent safe-area and tab layout and scrolls large full-screen state content', () => {
    expect(primitivesSource).toContain("<SafeAreaView edges={safeTop ? ['top'] : []}");
    expect(primitivesSource).toContain('<ScrollView');
    expect(primitivesSource).toContain('paddingVertical: spacing.md');
    expect(navigationSource).toContain('height: 54 + safeBottom');
    expect(navigationSource).toContain('paddingBottom: safeBottom');
    expect(navigationSource).toContain(
      'screenOptions={({ route }) => tabOptions(ownerIcons[route.name], insets.bottom)}',
    );
  });

  it('centers the empty Today card only when no operational attention follows it', () => {
    expect(source).toContain('requestCount === 0 &&');
    expect(source).toContain('unreadMessageCount === 0 &&');
    expect(source).toContain('<View style={styles.centeredEmpty}>');
    expect(source).toContain(
      "centeredEmpty: { alignItems: 'center', flex: 1, justifyContent: 'center' }",
    );
    expect(source).toContain('tabContent: { flexGrow: 1 }');
    expect(source).toContain("emptyCard: { alignItems: 'center'");
  });

  it('offers contextual vehicle setup actions from the empty Today card', () => {
    expect(source).toContain('apiClient.request<OwnerVehicleSummary[]>');
    expect(source).toContain("'/owner/vehicles'");
    expect(source).toMatch(/const vehicleAction =\s+!delegated/);
    expect(source).toContain("? 'Add your vehicle'");
    expect(source).toContain("? 'Complete your vehicle info'");
    expect(source).toContain("navigation.navigate('Vehicles')");
  });

  it('makes the vehicle photo and identity primary in Upcoming cards', () => {
    const image = source.indexOf('<VehicleImage');
    const vehicle = source.indexOf('{item.vehicle.make} {item.vehicle.model}', image);
    const pickup = source.indexOf('Pickup · {compactDateLabel(item.pickup.at)}', vehicle);
    const status = source.indexOf('<StatusBadge', pickup);
    expect(image).toBeGreaterThan(0);
    expect(vehicle).toBeGreaterThan(image);
    expect(pickup).toBeGreaterThan(vehicle);
    expect(status).toBeGreaterThan(pickup);
    expect(source).toContain('contentPath={item.vehicle.coverPhoto?.contentPath}');
    expect(source).toContain("flexDirection: 'row'");
    expect(source).toContain('bookingImage: { borderRadius: radius.md, height: 128, width: 108 }');
    expect(source).toContain('bookingStatus: { marginTop: spacing.xxs }');
    expect(source).toContain(
      "new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short' })",
    );
    expect(source).not.toContain('styles.upcomingTime');
  });

  it('keeps all three views in one selected top-tab surface with isolated errors', () => {
    expect(source).toContain("route.params?.initialTab ?? 'Today'");
    expect(source).toContain("activeTab === 'Upcoming'");
    expect(source).toContain("activeTab === 'Requests'");
    expect(source).toContain('Upcoming rentals unavailable');
    expect(source).toContain('<OwnerBookingRequestsScreen');
    expect(source).toContain("navigation.navigate('OwnerRequestHistory')");
  });

  it('embeds mixed actionable request types and refreshes home transitions', () => {
    expect(requestsSource).toContain("effectiveFilter === 'Needs response'");
    expect(requestsSource).toContain("embedded ? 'Change requested' : cardStatus");
    expect(requestsSource).toContain('New booking');
    expect(requestsSource).toContain("queryKey: ['owner-home']");
    expect(requestsSource).toContain("queryKey: ['owner-home-upcoming']");
    expect(requestsSource).toContain('No requests need your response');
    expect(requestsSource).toContain('<StateView\n          compact');
    expect(requestsSource).toContain("useState<Filter>(history ? 'All' : 'Needs response')");
    expect(requestsSource).not.toContain("history ? 'Request history' : 'Booking requests'");
    expect(requestsSource).toContain(
      'Review current and closed booking and Change Booking requests.',
    );
    expect(requestsSource).toContain('contentTopPadding={history ? 0 : undefined}');
    expect(requestsSource).toContain('safeTop={!history}');
    expect(requestsSource).toContain('!embedded && !history');
    expect(requestsSource).toContain(
      "const effectiveFilter: Filter = embedded ? 'Needs response' : filter",
    );
  });

  it('hoists Change Booking detail out of the Owner Home scroll surface and restores Requests', () => {
    const detail = source.indexOf('if (selectedAmendment)');
    const dashboardScreen = source.indexOf('<Screen\n      stickyHeader={');
    expect(detail).toBeGreaterThan(0);
    expect(detail).toBeLessThan(dashboardScreen);
    expect(source).toContain('onOpenAmendment={setSelectedAmendment}');
    expect(source).toContain('onClose={() => setSelectedAmendment(null)}');
    expect(source).toContain('initialAmendmentReference={selectedAmendment.amendmentReference}');
    expect(requestsSource).toContain('(onOpenAmendment ?? setSelectedAmendment)({');
    expect(requestsSource).toContain('if (onClose) {');
    expect(requestsSource).toContain('<BackControl label="Back" onPress={onClose} />');
    expect(requestsSource).not.toContain(
      '<BackControl label="Booking changes" onPress={onClose} />',
    );
    expect(requestsSource).toMatch(
      /eyebrow="Booking change request"[\s\S]*title=\{amendment\.actionable \? 'Review requested change'[\s\S]*Respond by/,
    );
  });

  it('hoists standard Booking Request detail into the top-level Owner surface', () => {
    const detail = source.indexOf('if (selectedBookingReference)');
    const dashboardScreen = source.indexOf('<Screen\n      stickyHeader={');
    expect(detail).toBeGreaterThan(0);
    expect(detail).toBeLessThan(dashboardScreen);
    expect(source).toContain('onOpenBookingRequest={setSelectedBookingReference}');
    expect(source).toContain('initialBookingReference={selectedBookingReference}');
    expect(source).toContain('onClose={() => setSelectedBookingReference(null)}');
    expect(source).toContain("route.params?.initialTab ?? 'Today'");
    expect(source).not.toContain("navigation.navigate('Requests')");
    expect(requestsSource).toContain(
      '(onOpenBookingRequest ?? setSelected)(booking.publicReference)',
    );
  });

  it('keeps the standard request detail compact, accessible, and complete', () => {
    const detail = requestsSource.slice(requestsSource.indexOf('function OwnerRequestDetail('));
    expect(detail.match(/<BackControl label="Back"/g)).toHaveLength(3);
    expect(detail).not.toContain('<BackControl label="All requests"');
    expect(detail).toContain(
      "eyebrow={booking.status === 'AWAITING_OWNER' ? 'Booking request' : 'Booking details'}",
    );
    expect(detail).toContain('style={styles.requestHero}');
    expect(detail).toContain(
      "requestHero: { borderRadius: radius.lg, height: 210, width: '100%' }",
    );
    expect(detail).toContain('style={styles.requestSummary}');
    expect(detail).toContain('label="Booking total"');
    expect(detail).toContain('label="Reference" value={booking.publicReference}');
    expect(detail).toContain('Respond by {dateTimeLabel(booking.ownerResponseDeadlineAt)}');
    expect(detail).toContain('label="Dates & time"');
    expect(detail).toContain('requestTripSummary(booking.rentalStart, booking.rentalEnd)');
    const tripCard = detail.slice(
      detail.indexOf('>\n          Trip\n        </Text>'),
      detail.indexOf('>\n          Handover\n        </Text>'),
    );
    expect(tripCard).not.toContain('<RequestDetailRow label="Pickup"');
    expect(tripCard).not.toContain('<RequestDetailRow label="Return"');
    expect(detail).toContain('View trust profile');
    expect(detail).toContain('style={styles.renterTrustAction}');
    expect(detail).toContain('booking.renter.profilePhoto?.contentPath');
    expect(detail).toContain('apiClient.assetUrl(booking.renter.profilePhoto.contentPath)');
    expect(detail).toContain('style={styles.renterAvatarImage}');
    expect(detail).toContain('style={styles.renterAvatarFallback}');
    expect(detail).toContain('name="person" size={26}');
    expect(detail).not.toContain('SELFIE_WITH_LICENSE');
    expect(detail).not.toContain('fileAssetId');
    expect(detail).toContain(
      'Sensitive identity evidence is available only to authorized platform staff.',
    );
    expect(detail).toContain('Payment is authorized and will be captured according to');
    expect(detail).toContain('booking.securityDeposit.required &&');
    expect(detail).toContain(
      '<SecurityDepositSummary compact securityDeposit={booking.securityDeposit} />',
    );
    expect(detail).toContain('Owner decision');
    expect(detail).toContain('<OwnerNextStep booking={booking} />');
    expect(detail).toContain('Prepare the vehicle for pickup.');
    expect(detail).toContain('label="Handover available"');
    expect(detail).toContain('label="Pickup" value={dateTimeLabel(booking.rentalStart)}');
    expect(detail).toContain('Danger zone');
    expect(detail).toContain('Existing cancellation rules still apply.');
    expect(detail).toContain(
      "label={decision.isPending ? 'Processing decision…' : 'Accept request'}",
    );
    expect(detail).toContain('label="Reject request"');
    expect(detail).not.toContain('Booking timeline');
    expect(detail).not.toContain('booking.statusHistory.map');
    expect(detail).not.toContain('The renter is waiting for you to accept or decline');
    expect(detail).not.toContain('/security-deposit/policy');
  });
});
