import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'DiscoveryScreen.tsx'),
  'utf8',
);
const primitivesSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/primitives.tsx'),
  'utf8',
);
const dateTimeSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/DateTimeField.tsx'),
  'utf8',
);
const locationPickerSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../location/LocationPicker.tsx'),
  'utf8',
);
const bookingsSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../bookings/MyBookingsScreen.tsx'),
  'utf8',
);

describe('Task 14C vehicle-detail trip and booking CTA', () => {
  const detail = source.slice(
    source.indexOf('function VehicleView('),
    source.indexOf('function QuoteCard('),
  );
  const quoteCard = source.slice(
    source.indexOf('function QuoteCard('),
    source.indexOf('function ConfirmedLocationCard('),
  );

  it('removes the inline editor and reuses existing trip authority in a sheet', () => {
    expect(detail).not.toContain('<Card style={styles.tripCard}>');
    expect(detail).toContain('presentationStyle="pageSheet"');
    expect(detail).toContain('visible={tripOpen}');
    expect(detail).toContain('title="Your trip"');
    expect(detail).toContain('value={draftPickup}');
    expect(detail).toContain('value={draftReturnAt}');
    expect(detail).toContain('properties.setPickup(draftPickup)');
    expect(detail).toContain('properties.setReturnAt(draftReturnAt)');
    expect(source).toContain('datesExplicit={tripDatesEstablished || exactTimesSelected}');
    expect(source).toContain('setExactTimesSelected(true)');
    expect(detail).toContain('properties.datesExplicit && properties.returnAt > properties.pickup');
  });

  it('uses one explicit date range with the Search calendar and independent times', () => {
    expect(detail).toContain('<TripDateCalendar');
    expect(detail).toContain('preselect={draftDatesExplicit}');
    expect(detail).toContain(
      "draftDatesExplicit ? tripDateSummary(draftPickup, draftReturnAt) : 'Add dates'",
    );
    expect(detail).toContain("label={draftDatesExplicit ? 'Change dates' : 'Add dates'}");
    expect(detail).toContain('setDraftDatesExplicit(properties.datesExplicit)');
    expect(detail).toContain('setDraftDatesExplicit(true)');
    expect(detail).toContain('nextPickup.setHours(draftPickup.getHours()');
    expect(detail).toContain('nextReturnAt.setHours(');
    expect(detail).toContain('label="Pickup time"');
    expect(detail).toContain('label="Return time"');
    expect(detail.match(/mode="time"/g)).toHaveLength(2);
    expect(detail).not.toContain('label="Pickup"');
    expect(detail).not.toContain('label="Return"');
  });

  it('shows truthful advisory duration discounts beside the draft range', () => {
    expect(detail).toContain('positiveDurationDiscounts(vehicle.pricing.durationDiscounts)');
    expect(detail).toContain('durationDiscounts.length > 0 && draftDiscountMessage');
    expect(detail).toContain(
      'const draftChargeableDays = chargeableDays(draftPickup, draftReturnAt)',
    );
    expect(detail).toContain('durationDiscountMessage(draftChargeableDays, durationDiscounts)');
    expect(detail).toContain("'Longer-trip discounts available.'");
    expect(detail).toContain('draftDatesExplicit &&');
    expect(detail).toContain(
      'Published policy only. Check price for the authoritative discount and total.',
    );
    expect(detail).not.toContain('draftChargeableDays * vehicle.pricing.dailyRateMinor');
  });

  it('opens from Select trip and preserves draft/save/cancel semantics', () => {
    expect(detail).toContain("label: 'Select trip'");
    expect(detail).toContain('onPress: openTripConfiguration');
    expect(detail).toContain('setDraftPickup(properties.pickup)');
    expect(detail).toContain('setDraftDatesExplicit(properties.datesExplicit)');
    expect(detail).toContain('setDraftStartMethod(startMethod)');
    expect(detail).toContain('onRequestClose={closeTripConfiguration}');
    expect(detail).toContain('<BackControl label="Close" onPress={closeTripConfiguration} />');
    const save = detail.slice(
      detail.indexOf('const saveTripConfiguration'),
      detail.indexOf('const bookingBarAction'),
    );
    expect(save).toContain('properties.setPickup(draftPickup)');
    expect(save).toContain('setStartMethod(draftStartMethod)');
    expect(save).not.toContain('properties.quote.mutate');
  });

  it('uses Close only for presentation dismissal and preserves domain cancellation copy', () => {
    expect(detail).toContain('<BackControl label="Close" onPress={closeTripConfiguration} />');
    expect(detail).toContain(
      '<BackControl label="Close" onPress={() => setTripCalendarOpen(false)} />',
    );
    expect(detail.match(/dismissLabel="Close"/g)).toHaveLength(3);
    expect(detail).not.toContain('<BackControl label="Cancel"');
    expect(detail).toContain('label="Save"');
    expect(dateTimeSource).toContain(
      '<Button label={dismissLabel} onPress={() => setOpen(false)} variant="ghost" />',
    );
    expect(locationPickerSource).toContain(
      '<BackControl label={dismissLabel} onPress={onCancel} />',
    );
    expect(bookingsSource).toContain("'Cancel booking request'");
  });

  it('renders only projected fulfillment choices and retains required destinations', () => {
    expect(detail).toContain('vehicle.fulfillment.renterPickupAvailable &&');
    expect(detail).toContain('vehicle.fulfillment.ownerDeliveryAvailable &&');
    expect(detail).toContain('vehicle.fulfillment.renterReturnAvailable &&');
    expect(detail).toContain('vehicle.fulfillment.ownerCollectionAvailable &&');
    expect(detail).toContain("draftStartMethod === 'OWNER_DELIVERY'");
    expect(detail).toContain("draftEndMethod === 'OWNER_COLLECTION'");
    expect(detail).toContain('<ConfirmedLocationCard');
    expect(source).toContain('The server checks the owner’s service area and notice requirement.');
  });

  it('uses a safe-area-aware persistent sibling bar that cannot cover scroll content', () => {
    expect(detail).toMatch(/<Screen[\s\S]*bottomAccessory=\{bookingBar\}/);
    expect(detail).toContain('paddingBottom: Math.max(bottomSafeArea, spacing.sm)');
    expect(source).toMatch(/bookingBar:[\s\S]*flexDirection: 'row'/);
    expect(primitivesSource).toContain('readonly bottomAccessory?: ReactNode | undefined');
    expect(primitivesSource).toMatch(
      /<\/KeyboardAvoidingView>\s*\{overlay\}\s*\{bottomAccessory\}/,
    );
  });

  it('keeps Vehicle Detail and its overlays in the tab-hidden presentation', () => {
    expect(source).toContain(
      "const detailPresentationActive = mode === 'detail' || mode === 'quote'",
    );
    expect(source).toContain(
      "isFocused && ((mode === 'results' && fullMap) || detailPresentationActive)",
    );
    expect(source).toContain(
      'useEffect(() => () => onTabBarHiddenChange?.(false), [onTabBarHiddenChange])',
    );
  });

  it('releases Detail-only tab hiding when booking navigation takes focus', () => {
    expect(source).toContain('const isFocused = useIsFocused()');
    expect(source).toContain(
      "navigation.navigate('Bookings', { bookingId: booking.publicReference })",
    );
    expect(source).toContain(
      "isFocused && ((mode === 'results' && fullMap) || detailPresentationActive)",
    );
    expect(source).not.toMatch(/cancel[^\n]*onTabBarHiddenChange/s);
  });

  it('distinguishes advisory pricing, pending quote, and authoritative quoted total', () => {
    expect(detail).toContain("context: 'Advisory daily price'");
    expect(detail).toContain('label: `From ${money(vehicle.pricing.dailyRateMinor');
    expect(detail).toContain("label: 'Checking price…'");
    expect(detail).toContain("context: 'Authoritative quoted total'");
    expect(detail).toContain('label: money(quoteData.totalMinor, quoteData.currency)');
    expect(detail).toContain("label: 'Reserve car'");
    expect(detail).toContain('properties.reserve.mutate(quoteData.id)');
    expect(detail).toContain('bookingBarTripContext');
    expect(detail).toContain('tripDateSummary(properties.pickup, properties.returnAt)');
    expect(quoteCard).toContain('quote.durationDiscountAmountMinor > 0');
    expect(quoteCard).toContain('money(quote.durationDiscountAmountMinor, quote.currency)');
    expect(quoteCard).toContain('money(quote.totalMinor, quote.currency)');
  });

  it('scrolls once to the measured quote-card top below the sticky header', () => {
    const quotePresentation = detail.slice(
      detail.indexOf("{properties.mode === 'quote' && quoteData && ("),
      detail.indexOf('<SectionHeader title="Features" />'),
    );
    expect(quotePresentation).toContain('quotePosition.current = event.nativeEvent.layout.y');
    expect(quotePresentation).toContain('lastScrolledQuoteId.current === quoteData.id');
    expect(quotePresentation).toContain('lastScrolledQuoteId.current = quoteData.id');
    expect(quotePresentation).toContain(
      'y: Math.max(0, quotePosition.current - stickyHeaderHeight - spacing.sm)',
    );
    expect(quotePresentation.match(/scrollRef\.current\?\.scrollTo/g)).toHaveLength(1);
    expect(quotePresentation).not.toContain('durationDiscountAmountMinor');
    expect(quotePresentation).not.toContain('quote.totalMinor');
    expect(detail).toContain("{properties.mode === 'quote' && quoteData && (");
    expect(detail).toContain('bottomAccessory={bookingBar}');
  });

  it('keeps long ranges on the existing calendar-to-quote-to-reserve path', () => {
    expect(detail).toContain('<TripDateCalendar');
    expect(detail).toContain('properties.setPickup(draftPickup)');
    expect(detail).toContain('properties.setReturnAt(draftReturnAt)');
    expect(detail).toContain('properties.quote.mutate(fulfillmentInput())');
    expect(detail).toContain('properties.reserve.mutate(quoteData.id)');
    expect(detail).not.toContain('Math.min(draftChargeableDays');
    expect(detail).not.toContain('Math.max(draftChargeableDays');
  });

  it('invalidates a stale quote only when saved criteria change', () => {
    expect(detail).toContain('const criteriaChanged =');
    expect(detail).toContain(
      'if (criteriaChanged || !properties.datesExplicit) resetUnheldQuote()',
    );
    expect(detail).toContain('draftDatesExplicit !== properties.datesExplicit');
    expect(detail).toContain('if (properties.reserve.data) return');
  });

  it('uses the same explicit range semantics in the persistent booking bar', () => {
    expect(detail).toContain('const bookingBarTripContext = properties.datesExplicit');
    expect(detail).toContain('tripDateSummary(properties.pickup, properties.returnAt)');
    expect(detail).toContain(": 'Add dates'");
    expect(detail).toContain('draftDatesExplicit && draftReturnAt > draftPickup');
  });

  it('expires quote authority and requires a current server price', () => {
    expect(detail).toContain('quoteExpiresAt <= quoteClock');
    expect(detail).toContain("'Check current price'");
    expect(quoteCard).toContain('Price needs refreshing');
    expect(quoteCard).toContain('This quote is no longer current.');
  });

  it('keeps one post-hold payment continuation and no duplicate reserve action', () => {
    expect(detail).toContain("'Authorize payment'");
    expect(detail).toContain(
      'properties.continueBooking.mutate(properties.reserve.data!.publicReference)',
    );
    expect(detail.match(/properties\.reserve\.mutate\(quoteData\.id\)/g)).toHaveLength(1);
    expect(quoteCard).not.toContain("label={reserve.isPending ? 'Reserving…' : 'Reserve car'}");
    expect(quoteCard).not.toContain("label={continueBooking.isPending ? 'Securing payment…'");
    expect(quoteCard).toContain("navigation.navigate('Verification')");
  });

  it('preserves the Task 14B gallery and origin-restoration implementation', () => {
    expect(detail.match(/<FlatList\n/g)).toHaveLength(2);
    expect(detail).toContain('styles.detailStickyControls');
    expect(detail).toContain('overlay={stickyGalleryHeader}');
    expect(source).toContain(
      "mode === 'favorites' ? 'favorites' : mode === 'results' ? 'results' : 'form'",
    );
  });
});
