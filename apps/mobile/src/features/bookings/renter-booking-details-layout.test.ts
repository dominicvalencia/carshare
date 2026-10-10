import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'MyBookingsScreen.tsx'),
  'utf8',
);
const prePickup = source.slice(
  source.indexOf('{!pickupHasBegun && ('),
  source.indexOf("{(booking.status === 'HOLD'", source.indexOf('{!pickupHasBegun && (')),
);

describe('Renter pre-pickup Booking Details presentation', () => {
  it('keeps authoritative summary values in compact surfaces', () => {
    expect(prePickup).toContain('style={styles.hero}');
    expect(source).toContain("hero: { borderRadius: radius.lg, height: 176, width: '100%' }");
    expect(prePickup).toContain('<View style={styles.summaryRow}>');
    expect(prePickup).not.toContain('style={styles.bookingSummaryCard}');
    expect(source).toContain('marginTop: -spacing.xs');
    expect(prePickup).toContain('bookingStatusLabel(booking.status)');
    expect(prePickup).toContain('bookingTotalLabel(booking)');
    expect(prePickup).toContain('Trip summary');
    expect(prePickup).toContain('label="Dates & time"');
    expect(prePickup).toContain('bookingTripSummary(booking.rentalStart, booking.rentalEnd)');
    expect(prePickup).toContain('paymentLabel(rentalPayment.status)');
    expect(prePickup).toContain('label="Pickup area"');
  });

  it('uses compact start/end terminology without changing fulfillment values or fees', () => {
    expect(prePickup).toContain('Handover details');
    expect(prePickup).toContain('label="Start of rental"');
    expect(prePickup).toContain('label="Start location"');
    expect(prePickup).toContain('label="End of rental"');
    expect(prePickup).toContain('label="End location"');
    expect(prePickup).toContain("booking.fulfillment.startMethod === 'OWNER_DELIVERY'");
    expect(prePickup).toContain("booking.fulfillment.endMethod === 'OWNER_COLLECTION'");
    expect(prePickup).toContain('booking.fulfillment.deliveryFeeMinor');
    expect(prePickup).toContain('booking.fulfillment.collectionFeeMinor');
  });

  it('hides no-deposit content and groups valid secondary actions', () => {
    expect(prePickup).toContain('{booking.securityDeposit.required && (');
    expect(prePickup).toContain('securityDeposit={booking.securityDeposit}');
    expect(prePickup).toContain('Booking actions');
    expect(prePickup).toContain('label="Message"');
    expect(prePickup).toContain('onMessage(booking.conversationId!)');
    expect(prePickup).toContain('label={changeBookingLabel}');
    expect(prePickup).toContain('setAmendmentOpen(true)');
  });

  it('uses authoritative deposit state to gate accepted-booking delivery progress', () => {
    expect(source).toContain("booking.securityDeposit.status === 'AUTHORIZED'");
    expect(source).toContain(
      'booking.securityDeposit.heldMinor >= (booking.securityDeposit.amountMinor ?? 0)',
    );
    expect(prePickup).toContain(
      "{acceptedUpcoming && securityDepositPlaced && upcomingRentalSection('travel')}",
    );
    expect(prePickup).toContain("{acceptedUpcoming && upcomingRentalSection('next-step')}");
    expect(source).toContain('securityDepositPending={securityDepositPending}');
    expect(prePickup).toContain('compact={acceptedUpcoming && securityDepositPlaced}');
  });

  it('orders accepted-booking content from summary through actions', () => {
    const summary = prePickup.indexOf('Trip summary');
    const deposit = prePickup.indexOf('<SecurityDepositSummary');
    const travel = prePickup.indexOf("upcomingRentalSection('travel')");
    const handover = prePickup.indexOf('Handover details');
    const nextStep = prePickup.indexOf("upcomingRentalSection('next-step')");
    const actions = prePickup.indexOf('Booking actions');

    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(deposit);
    expect(deposit).toBeLessThan(travel);
    expect(travel).toBeLessThan(handover);
    expect(handover).toBeLessThan(nextStep);
    expect(nextStep).toBeLessThan(actions);
    expect(prePickup).toContain('<View style={styles.summaryRow}>');
    expect(prePickup).toContain('bookingStatusLabel(booking.status)');
    expect(prePickup).toContain('bookingTotalLabel(booking)');
    expect(prePickup).toContain('label="Dates & time"');
    expect(prePickup).toContain('bookingTripSummary(booking.rentalStart, booking.rentalEnd)');
  });
});
