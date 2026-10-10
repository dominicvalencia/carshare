import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const vehiclesSource = readFileSync(resolve(here, '../vehicles/VehiclesScreen.tsx'), 'utf8');
const discoverySource = readFileSync(resolve(here, '../discovery/DiscoveryScreen.tsx'), 'utf8');
const renterBookingsSource = readFileSync(resolve(here, './MyBookingsScreen.tsx'), 'utf8');
const ownerBookingsSource = readFileSync(resolve(here, './OwnerBookingRequestsScreen.tsx'), 'utf8');
const summarySource = readFileSync(resolve(here, './SecurityDepositSummary.tsx'), 'utf8');
const tierSelectorSource = readFileSync(
  resolve(here, '../vehicles/DepositTierSelector.tsx'),
  'utf8',
);
const infoSheetSource = readFileSync(resolve(here, './SecurityDepositInfoSheet.tsx'), 'utf8');

describe('Security Deposit Phase 2 mobile disclosure', () => {
  it('loads the server catalog and saves coherent required or no-deposit policy values', () => {
    expect(vehiclesSource).toContain(
      "apiClient.request<SecurityDepositPolicyCatalog>('/security-deposit/policy')",
    );
    expect(vehiclesSource).toContain('allowedTiersByCurrency[selectedDepositCurrency]');
    expect(vehiclesSource).toContain('securityDepositRequired: depositRequiredForPayload');
    expect(vehiclesSource).toContain('securityDepositAmountMinor: depositAmountForPayload');
    expect(vehiclesSource).toContain('securityDepositCurrency: depositCurrencyForPayload');
    expect(vehiclesSource).toContain('label="No deposit"');
    expect(vehiclesSource).toContain('label="Require deposit"');
    expect(vehiclesSource).toContain('Deposit options unavailable');
  });

  it('uses a compact accessible selector and conditionally reveals server-owned deposit tiers', () => {
    expect(vehiclesSource).toContain('function DepositRequirementSelector');
    expect(vehiclesSource).toContain('style={styles.depositSegmentedControl}');
    expect(vehiclesSource).toContain('accessibilityRole="radio"');
    expect(vehiclesSource).toContain('accessibilityState={{ checked: selected }}');
    expect(vehiclesSource).toContain('{securityDepositRequired && (');
    expect(vehiclesSource).toContain('<DepositTierSelector');
    expect(vehiclesSource).toContain('options={allowedDepositTiers.map((amountMinor) => ({');
    expect(tierSelectorSource).not.toContain('TextInput');
    expect(tierSelectorSource).not.toContain('Search');
    expect(vehiclesSource).toContain('Changes apply to new booking requests only.');
    expect(vehiclesSource).toContain('Deposit processing isn’t active yet. No hold will be placed');
    expect(vehiclesSource).not.toContain(
      'CarShare may require this temporary deposit before pickup',
    );
  });

  it('omits no-deposit Price Summary content and keeps a required deposit outside Total', () => {
    const priceSummary = discoverySource.slice(
      discoverySource.indexOf('function QuoteCard('),
      discoverySource.indexOf('function ConfirmedLocationCard('),
    );

    expect(priceSummary).toContain('{quote.securityDeposit.required && (');
    expect(priceSummary).not.toContain('No security deposit required');
    expect(priceSummary).not.toContain('No refundable deposit is added to this booking.');
    expect(discoverySource).toContain('refundable deposit · Separate from the rental price');
    const deposit = priceSummary.indexOf('<Text style={styles.cardTitle}>Security deposit</Text>');
    const total = priceSummary.indexOf('<Text style={styles.totalLabel}>Total</Text>', deposit);
    expect(deposit).toBeGreaterThan(-1);
    expect(total).toBeGreaterThan(deposit);
    expect(priceSummary.slice(deposit, total)).toContain(
      'No deposit hold is placed at this stage.',
    );
    expect(priceSummary).toContain('{money(quote.totalMinor, quote.currency)}');
    expect(discoverySource).toContain('body: JSON.stringify({ quoteId })');
    expect(discoverySource).toContain('start: pickup.toISOString()');
    expect(discoverySource).toContain('end: returnAt.toISOString()');
    expect(discoverySource).toContain('...fulfillment');
  });

  it('shows immutable booking projection terms for renter and owner details', () => {
    expect(renterBookingsSource.match(/<SecurityDepositSummary/g)?.length).toBe(2);
    expect(renterBookingsSource.match(/\{booking\.securityDeposit\.required && \(/g)?.length).toBe(
      2,
    );
    expect(ownerBookingsSource).toContain(
      '<SecurityDepositSummary compact securityDeposit={booking.securityDeposit} />',
    );
    expect(summarySource).toContain('Required · Not yet held');
    expect(summarySource).toContain('No security deposit required');
    expect(summarySource).toContain('pickup is not blocked');
  });

  it('prioritizes the accepted-booking deposit while preserving the booking-details sheet order', () => {
    const handoverIndices = [...renterBookingsSource.matchAll(/Handover details/g)].map(
      (match) => match.index,
    );
    const depositIndices = [...renterBookingsSource.matchAll(/<SecurityDepositSummary/g)].map(
      (match) => match.index,
    );

    expect(handoverIndices).toHaveLength(2);
    expect(depositIndices).toHaveLength(2);
    expect(depositIndices[0]!).toBeGreaterThan(handoverIndices[0]!);
    expect(depositIndices[1]!).toBeLessThan(handoverIndices[1]!);
  });

  it('omits the no-deposit card from the renter booking-details sheet only', () => {
    const bookingDetailsSheet = renterBookingsSource.slice(
      renterBookingsSource.indexOf('visible={bookingDetailsOpen}'),
      renterBookingsSource.indexOf('{!pickupHasBegun && ('),
    );

    expect(bookingDetailsSheet).toContain('{booking.securityDeposit.required && (');
    expect(bookingDetailsSheet).toContain('<SecurityDepositSummary');
    expect(bookingDetailsSheet).toContain('securityDeposit={booking.securityDeposit}');
    expect(bookingDetailsSheet).toContain('label="Pickup"');
    expect(bookingDetailsSheet).toContain('label="Return"');
    expect(bookingDetailsSheet).toContain('label="Payment"');
    expect(bookingDetailsSheet).toContain('label="Pickup area"');
    expect(bookingDetailsSheet).toContain('label="Pickup method"');
    expect(bookingDetailsSheet).toContain('label="Return method"');
    expect(bookingDetailsSheet).not.toContain('label="Message owner"');
    expect(renterBookingsSource).toContain('<BookingAction label="Message"');
    expect(renterBookingsSource).toContain('label="Message"');
    expect(renterBookingsSource).toContain('onMessage(booking.conversationId!)');
  });

  it('uses the readable shared body-text authority for supporting deposit copy', () => {
    expect(summarySource).toContain('body: {');
    expect(summarySource).toContain('color: colors.subtleText');
    expect(summarySource).toContain('lineHeight: 22');
    expect(summarySource).toContain('marginTop: spacing.sm');
    expect(summarySource).not.toContain('body: { color: colors.muted');
    expect(renterBookingsSource.match(/<SecurityDepositSummary/g)?.length).toBe(2);
    expect(ownerBookingsSource).toContain(
      '<SecurityDepositSummary compact securityDeposit={booking.securityDeposit} />',
    );
    expect(summarySource).toContain('compactRequiredCard: { paddingVertical: spacing.sm }');
    expect(summarySource).toContain(
      'compactRequiredBody: { lineHeight: 20, marginTop: spacing.xs }',
    );
  });

  it('keeps the no-deposit variant concise and compact without changing required hierarchy', () => {
    expect(summarySource).toContain('No deposit will be held for this booking.');
    expect(summarySource).not.toContain(
      'This booking does not require a refundable security deposit.',
    );
    expect(summarySource).toContain('!required && styles.compactCard');
    expect(summarySource).toContain('compact && required && styles.compactRequiredCard');
    expect(summarySource).toContain('<Text style={[styles.body, styles.compactBody]}>');
    expect(summarySource).toContain('{required && (');
    expect(summarySource).toContain(
      '<Text style={[styles.body, compact && styles.compactRequiredBody]}>',
    );
    expect(summarySource).toContain('compactCard: { paddingVertical: spacing.sm }');
    expect(summarySource).toContain('compactBody: { marginTop: spacing.xs }');
    expect(summarySource).toContain('style={styles.noDepositTitle}');
    expect(summarySource).toContain(
      "noDepositTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' }",
    );
    expect(summarySource).toContain("? 'Required · Not yet held'");
    expect(summarySource).toContain(
      "tone={securityDeposit.status === 'AUTHORIZED' ? 'success' : 'warning'}",
    );
    expect(summarySource).toContain('Deposit processing is not yet available');
  });

  it('exposes only the server-authorized Phase 3 placement action on renter booking details', () => {
    expect(summarySource).toContain('securityDeposit.actionRequired && onPlace');
    expect(summarySource).toContain("'Place security deposit'");
    expect(summarySource).toContain("'Continue security deposit'");
    expect(summarySource).toContain('accessible={!renterView}');
    expect(summarySource).toContain('accessibilityLiveRegion="polite"');
    expect(
      renterBookingsSource.match(/errorMessage={securityDepositMutation.error\?\.message}/g),
    ).toHaveLength(2);
    expect(renterBookingsSource).toContain('/security-deposit/authorize');
    expect(summarySource).not.toMatch(/Pay deposit|Place hold|Retry hold/);
    expect(vehiclesSource).not.toMatch(/SecurityDepositAuthorization/);
    expect(discoverySource).not.toMatch(/Pay deposit|Place hold|Retry hold/);
    expect(infoSheetSource).not.toMatch(/Pay deposit|Place hold|Retry hold|Release deposit/);
  });

  it('uses safe renter and owner copy for held, failed, and uncertain authorization states', () => {
    expect(summarySource).toContain("securityDeposit.status === 'UNKNOWN'");
    expect(summarySource).toContain('Verifying deposit status');
    expect(summarySource).toContain('Another attempt is unavailable until this check finishes.');
    expect(summarySource).toContain('Couldn’t place deposit');
    expect(summarySource).toContain('Action required from renter');
    expect(summarySource).toContain('Your deposit is authorized for this booking.');
    expect(summarySource).not.toMatch(/Deposit paid|Deposit charged|Payment complete/);
  });
});
