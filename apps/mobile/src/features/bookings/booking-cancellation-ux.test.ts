import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const sheet = readFileSync(resolve(directory, 'BookingCancellationSheet.tsx'), 'utf8');
const renter = readFileSync(resolve(directory, 'MyBookingsScreen.tsx'), 'utf8');
const owner = readFileSync(resolve(directory, 'OwnerBookingRequestsScreen.tsx'), 'utf8');
const ownerRentals = readFileSync(resolve(directory, '../rentals/OwnerRentalsScreen.tsx'), 'utf8');

describe('confirmed-booking cancellation UX', () => {
  it('offers ordinary cancellation only before custody and preserves request cancellation', () => {
    expect(renter).toContain("['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status)");
    expect(owner).toContain("['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status)");
    expect(ownerRentals).toContain(
      "['CONFIRMED', 'READY_FOR_PICKUP'].includes(selectedBooking.status)",
    );
    expect(renter).toContain("['HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER'].includes(");
    expect(renter).toContain('Cancel booking request');
    expect(sheet).not.toContain("'ACTIVE'");
    expect(sheet).not.toContain("'RETURN_PENDING'");
  });

  it('uses the separate renter and Owner preview and execution authorities', () => {
    expect(sheet).toContain('`/owner/bookings/${bookingReference}`');
    expect(sheet).toContain('`/bookings/${bookingReference}`');
    expect(sheet).toContain('`${endpoint}/cancellation-preview`');
    expect(sheet).toContain('`${endpoint}/cancellation`');
    expect(sheet).toContain("'Idempotency-Key': executionKey.current");
    expect(sheet).toContain('disabled={execute.isPending}');
    expect(sheet).toContain("'Cancelling…'");
  });

  it('requires the accepted role-specific structured reasons', () => {
    for (const label of [
      'Change of plans',
      'Booked another vehicle',
      'Trip cancelled',
      'Schedule changed',
      'Vehicle or listing concern',
      'Vehicle unavailable',
      'Vehicle maintenance',
      'Owner schedule conflict',
      'Renter or trip concern',
      'Safety concern',
      'Emergency',
      'Other',
    ])
      expect(sheet).toContain(`'${label}'`);
    expect(sheet).toContain('accessibilityRole="radio"');
    expect(sheet).toContain('accessibilityState={{ selected: reasonCode === code }}');
    expect(sheet).toContain('disabled={!reasonCode');
  });

  it('renders authoritative renter refunds and Owner penalties without local totals', () => {
    expect(sheet).toContain('value={value.capturedAmountMinor}');
    expect(sheet).toContain('value={value.cancellationFeeMinor}');
    expect(sheet).toContain('value={value.totalRefundMinor}');
    expect(sheet).toContain('label="Refund amount"');
    expect(sheet).toContain('The cancellation fee is deducted from your booking amount.');
    expect(sheet).toContain('This booking is now non-refundable.');
    expect(sheet).toContain('label="Non-refundable amount"');
    expect(sheet).toContain('value={value.nonRefundableRentalMinor}');
    expect(sheet).toContain('Number(value.cancellationFeeMinor) > 0');
    expect(sheet).toContain('If you cancel now, no refund will be issued.');
    expect(sheet).toContain(
      'The rental amount is non-refundable. The refund shown includes eligible fulfillment fees.',
    );
    expect(sheet).toContain('value={value.deliveryTreatment.refundedMinor}');
    expect(sheet).toContain('value={value.ownerPenaltyMinor}');
    expect(sheet).toContain('recovered from your future eligible earnings');
    expect(sheet).not.toContain('72 hours');
    expect(sheet).not.toContain('6 hours');
  });

  it('uses review-stage copy and shows the selected cancellation reason', () => {
    expect(sheet).toContain(
      'Review the current cancellation details before making your final decision.',
    );
    expect(sheet).toContain('const selectedReason = reasons.find');
    expect(sheet).toContain('selectedReason={selectedReason}');
    expect(sheet).toContain('<Text style={styles.selectedReasonLabel}>Reason</Text>');
    expect(sheet).toContain('{selectedReason}');
    expect(sheet).not.toContain('label="Rental refund"');
  });

  it('refreshes stale previews and canonical booking/search/financial queries after success', () => {
    expect(sheet).toContain("error.code === 'CANCELLATION_PREVIEW_STALE'");
    expect(sheet).toContain('previewRequest.mutate(reasonCode)');
    expect(sheet).toContain('Review these updated amounts before');
    expect(renter).toContain('onCancellationCompleted={() => refresh(client, selected)}');
    expect(owner).toContain("queryKey: ['owner-booking-requests']");
    expect(owner).toContain("queryKey: ['owner-earnings']");
    expect(owner).toContain("queryKey: ['public-search']");
    expect(ownerRentals).toContain('role="OWNER"');
  });

  it('uses an accessible adaptive bottom-up sheet with unambiguous safe and destructive actions', () => {
    expect(sheet).toContain('animationType="slide"');
    expect(sheet).toContain('presentationStyle="overFullScreen"');
    expect(sheet).toContain('transparent');
    expect(sheet).toContain('const compactSheet = Boolean');
    expect(sheet).toContain('useAnimatedStyle');
    expect(sheet).toContain('const heightRatio = result ? 0.5 : compactSheet ? 0.78 : 0.92');
    expect(sheet).toContain('withTiming(viewportHeight * heightRatio');
    expect(sheet).toContain('duration: 280');
    expect(sheet).toContain('style={[styles.sheet, animatedSheetStyle]}');
    expect(sheet).toContain('accessibilityViewIsModal');
    expect(sheet).toContain("title={result ? 'Booking cancelled' : 'Cancel this booking?'}");
    expect(sheet).toContain('label="Keep booking"');
    expect(sheet).toContain("label={execute.isPending ? 'Cancelling…' : 'Cancel booking'}");
    expect(sheet).toContain('accessibilityLabel="Close cancellation sheet"');
    expect(sheet).toContain('accessibilityLiveRegion="polite"');
  });

  it('uses a compact, non-duplicative confirmation with status-aware refund copy', () => {
    expect(sheet).toContain('label="Refund amount"');
    expect(sheet).toContain("result.refundStatus === 'COMPLETED'");
    expect(sheet).toContain('Your cancellation is confirmed and your refund has been processed.');
    expect(sheet).toContain('Your refund has been processed.');
    expect(sheet).toContain('Your refund is being processed.');
    expect(sheet).not.toContain('label="Refund processing"');
    expect(sheet).not.toContain('Funds have not been described as received');
  });

  it('uses Owner-specific success copy and displays the authoritative execution penalty', () => {
    expect(sheet).toContain("your renter's refund has been processed");
    expect(sheet).toContain("your renter's refund is underway");
    expect(sheet).toContain('label="Renter refund"');
    expect(sheet).toContain('value={result.refundAmountMinor}');
    expect(sheet).toContain('label="Cancellation penalty"');
    expect(sheet).toContain('value={penalty}');
    expect(sheet).not.toContain('Your renter will receive the authoritative refund.');
  });

  it('presents the cancelled renter booking as a compact, final financial summary', () => {
    expect(renter).toContain('Booking cancelled');
    expect(renter).toContain('Your rental did not start and custody was not transferred.');
    expect(renter).toContain('style={styles.cancelledSummary}');
    expect(renter).toContain('<StatusBadge label="Cancelled" tone="neutral" />');
    expect(renter).toContain('label="Original total"');
    expect(renter).toContain('booking.pricing.totalMinor');
    expect(renter).toContain('label="Refund"');
    expect(renter).toContain('booking.cancellationSettlement.refundAmountMinor');
    expect(renter).toContain('cancellationSettlementRows(booking.cancellationSettlement)');
    expect(renter).toContain('label={titleCase(booking.cancellationSettlement.refundStatus');
    expect(renter).not.toContain('label="CarShare commission retained"');
    expect(renter).not.toContain('label="Delivery retained / refunded"');
    expect(renter).not.toContain('label="Collection refunded"');
  });
});
