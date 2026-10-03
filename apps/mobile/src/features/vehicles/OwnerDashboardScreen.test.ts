import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  groupOwnerUpcoming,
  ownerHomeIsOperationallyEmpty,
  ownerTodayDateLabel,
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
    const attention = source.indexOf('title="Needs attention"');
    const pickup = source.indexOf('title="Pickups today"');
    const active = source.indexOf('title="Active rentals"');
    const returns = source.indexOf('title="Returns today"');
    expect(attention).toBeGreaterThan(0);
    expect(attention).toBeLessThan(pickup);
    expect(pickup).toBeLessThan(active);
    expect(active).toBeLessThan(returns);
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
    expect(source).toContain('requests need');
    expect(source).not.toContain('filteredAmendments');
  });

  it('supports recoverable loading, failure, empty, next-upcoming, focus, and resume states', () => {
    expect(source).toContain('Loading today…');
    expect(source).toContain('Today is unavailable');
    expect(source).toContain('Nothing scheduled today');
    expect(source).toContain('model.today.nextUpcoming');
    expect(source).toContain('View upcoming');
    expect(source).toContain('useRefreshOnFocusAndForeground');
  });

  it('uses the current server-projected return timestamp for ACTIVE extensions', () => {
    expect(card('ACTIVE', '2026-10-05T09:00:00.000Z').return.at).toBe('2026-10-05T09:00:00.000Z');
    expect(source).toContain("kind === 'pickup' ? item.pickup.at : item.return.at");
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
    const attention = source.indexOf('title="Needs attention"', tabs);
    expect(screen).toBeGreaterThan(0);
    expect(tabs).toBeGreaterThan(screen);
    expect(attention).toBeGreaterThan(tabs);
    expect(source).toContain("alignSelf: 'center'");
    expect(source).toContain('backgroundColor: colors.background');
    expect(source).not.toContain("selectedTab === 'Today'\n          ? ownerTodayDateLabel");
    expect(source).not.toContain('eyebrow="Owner mode"');
    expect(source).not.toContain('title="Today"');
  });

  it('centers the unverified Owner state in the available screen', () => {
    expect(source).toContain('<Screen scroll={false}>');
    expect(source).toContain('<View style={styles.centeredState}>');
    expect(source).toContain("centeredState: { flex: 1, justifyContent: 'center' }");
  });

  it('centers the empty Today card when no request summary follows it', () => {
    expect(source).toContain('style={requestCount === 0 && styles.centeredEmpty}');
    expect(source).toContain(
      "centeredEmpty: { alignItems: 'center', flex: 1, justifyContent: 'center' }",
    );
    expect(source).toContain('tabContent: { flexGrow: 1 }');
    expect(source).toContain("emptyCard: { alignItems: 'center'");
  });

  it('offers contextual vehicle setup actions from the empty Today card', () => {
    expect(source).toContain("apiClient.request<OwnerVehicleSummary[]>('/owner/vehicles')");
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
    expect(source).toContain('upcomingImage: { borderRadius: radius.md, height: 128, width: 108 }');
    expect(source).toContain('upcomingStatus: { marginTop: spacing.xxs }');
    expect(source).toContain(
      "new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short' })",
    );
    expect(source).not.toContain('styles.upcomingTime');
  });

  it('keeps all three views in one selected top-tab surface with isolated errors', () => {
    expect(source).toContain("route.params?.initialTab ?? 'Today'");
    expect(source).toContain("selectedTab === 'Upcoming'");
    expect(source).toContain("selectedTab === 'Requests'");
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
});
