import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bookingGroup } from './booking-presentation';

const screen = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'MyBookingsScreen.tsx'),
  'utf8',
);

describe('renter booking information architecture', () => {
  it.each(['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED'])(
    'maps %s to Current',
    (status) => expect(bookingGroup(status)).toBe('Current'),
  );

  it.each(['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER', 'CAPTURE_PENDING', 'CONFIRMED'])(
    'maps %s to Upcoming',
    (status) => expect(bookingGroup(status)).toBe('Upcoming'),
  );

  it.each(['COMPLETED', 'CANCELLED', 'EXPIRED'])('maps %s to Past', (status) =>
    expect(bookingGroup(status)).toBe('Past'),
  );

  it('uses the shared Explore chip selector instead of a status dropdown', () => {
    expect(screen).toContain('function BookingTabs(');
    expect(screen).toContain('<Chip');
    expect(screen).toContain('accessibilityRole="tab"');
    expect(screen).toContain('compact');
    expect(screen).toContain('selected={group === value}');
    expect(screen).not.toContain('Booking status filter:');
    expect(screen).not.toContain('<Text style={styles.filterLabel}>Status</Text>');
  });

  it('removes the large heading and makes the centered tabs the sticky screen control', () => {
    expect(screen).toContain(
      '<Screen stickyHeader={<BookingTabs group={group} onSelect={setGroup} />}>',
    );
    expect(screen).not.toContain('eyebrow="Your trips"');
    expect(screen).not.toContain('title="Bookings"');
    expect(screen).not.toContain(
      'subtitle="Everything you need before pickup, during your rental, and after return."',
    );
    expect(screen).toContain("justifyContent: 'center'");
    expect(screen).toContain('paddingTop: spacing.sm');
    expect(screen).toContain('paddingBottom: spacing.sm');
    expect(screen).toContain('borderBottomWidth: StyleSheet.hairlineWidth');
  });

  it('renders all renter-facing groups and filters loaded bookings locally', () => {
    expect(screen).toContain("const bookingGroups = ['Current', 'Upcoming', 'Past'] as const");
    expect(screen).toContain('onPress={() => onSelect(value)}');
    expect(screen).toContain('bookingGroup(booking.status) === group');
    expect(screen).toContain("queryKey: ['bookings']");
  });

  it('groups Upcoming by pickup date and Past by return date', () => {
    expect(screen).toContain('groupBookingsByDate(filtered, group)');
    expect(screen).toContain("group === 'Upcoming' ? booking.rentalStart : booking.rentalEnd");
    expect(screen).toContain("const direction = group === 'Upcoming' ? 1 : -1");
    expect(screen).toContain('<SectionHeader flush title={section.title} />');
  });

  it('keeps context-specific card actions and safe long-name presentation', () => {
    expect(screen).toContain("return 'Pickup details'");
    expect(screen).toContain("return 'View rental'");
    expect(screen).toContain("return 'View receipt'");
    expect(screen).toContain("return 'View details'");
    expect(screen).toContain('<Text numberOfLines={1} style={styles.vehicle}>');
    expect(screen).toContain('onPress={() => setManualSelection(booking.publicReference)}');
  });

  it('keeps historical Past bookings without pricing renderable', () => {
    expect(screen).toContain("type RenterBookingView = Omit<BookingView, 'pricing'>");
    expect(screen).toContain("readonly pricing: BookingView['pricing'] | null;");
    expect(screen).toContain('bookingTotalLabel(booking)');
    expect(screen).toContain(
      "return booking.pricing?.currency ?? booking.payments[0]?.currency ?? 'PHP'",
    );
    expect(screen).toContain('? money(booking.pricing.totalMinor, booking.pricing.currency)');
    expect(screen).toContain(": 'Total unavailable'");
  });

  it('uses specific empty copy per tab and retains loading and retry states', () => {
    expect(screen).toContain("return 'No active trips right now.'");
    expect(screen).toContain("return 'No upcoming bookings.'");
    expect(screen).toContain("return 'No past trips yet.'");
    expect(screen).toContain('<StateView loading title="Loading bookings…" />');
    expect(screen).toContain('title="Bookings unavailable"');
    expect(screen).toContain('actionLabel="Retry"');
    expect(screen.indexOf('stickyHeader={<BookingTabs')).toBeLessThan(
      screen.indexOf('title={emptyBookingTitle(group)}'),
    );
  });
});
