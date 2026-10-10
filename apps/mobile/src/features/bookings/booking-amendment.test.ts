import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../auth/api-client';
import {
  amendmentErrorMessage,
  amendmentPreviewFinancialSummary,
  amendmentStatusCopy,
  ownerAmendmentIsProcessing,
  ownerAmendmentStatusCopy,
  transientAmendmentStatuses,
  type AmendmentDetail,
  type AmendmentPreview,
} from './booking-amendment';
import { tripDateSummary } from '../discovery/trip-date-policy';
import { adaptiveSheetLayout } from './booking-amendment-sheet-layout';

const renter = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/BookingAmendmentSheet.tsx'),
  'utf8',
);
const sheetLayout = readFileSync(resolve(process.cwd(), 'src/ui/adaptive-sheet-layout.ts'), 'utf8');
const bookings = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/MyBookingsScreen.tsx'),
  'utf8',
);
const owner = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);
const navigation = readFileSync(resolve(process.cwd(), 'src/navigation/AppNavigation.tsx'), 'utf8');

function detail(overrides: Partial<AmendmentDetail> = {}): AmendmentDetail {
  return {
    amendmentId: 'amendment-id',
    appliedAt: null,
    bookingReference: 'CR-TEST',
    current: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-02T00:00:00.000Z',
      rentalStart: '2026-10-01T00:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
      totalMinor: '10000',
    },
    expiresAt: '2026-10-01T00:00:00.000Z',
    financial: { additionalPaymentMinor: '0', currency: 'PHP', expectedRefundMinor: '0' },
    history: [],
    paymentDeadlineAt: null,
    paymentInitiationAllowed: false,
    paymentState: null,
    proposed: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-03T00:00:00.000Z',
      rentalStart: '2026-10-01T00:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
      totalMinor: '12000',
    },
    refundState: null,
    status: 'PENDING_OWNER',
    ...overrides,
  };
}

function preview(financial: Partial<AmendmentPreview['financial']> = {}): AmendmentPreview {
  return {
    availability: { available: true },
    bookingReference: 'CR-TEST',
    current: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-14T01:00:00.000Z',
      rentalStart: '2026-10-13T01:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
      totalMinor: '150000',
    },
    evaluatedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2099-10-01T00:10:00.000Z',
    financial: {
      additionalPaymentMinor: '0',
      currency: 'PHP',
      expectedRefundMinor: '0',
      proposedEconomicTotalMinor: '150000',
      ...financial,
    },
    previewToken: 'token',
    proposed: {
      endMethod: 'RENTER_RETURN',
      rentalEnd: '2026-10-17T01:00:00.000Z',
      rentalStart: '2026-10-16T01:00:00.000Z',
      startMethod: 'RENTER_PICKUP',
    },
    warnings: [],
  };
}

describe('amendment preview financial safety', () => {
  it.each([
    ['zero delta', {}, 'ZERO_DELTA', 0],
    [
      'additional payment',
      { additionalPaymentMinor: '50000', proposedEconomicTotalMinor: '200000' },
      'ADDITIONAL_PAYMENT',
      50000,
    ],
    [
      'refund',
      { expectedRefundMinor: '40000', proposedEconomicTotalMinor: '110000' },
      'REFUND',
      40000,
    ],
  ] as const)('maps a valid %s preview', (_, overrides, direction, differenceMinor) => {
    expect(amendmentPreviewFinancialSummary(preview(overrides))).toMatchObject({
      differenceMinor,
      direction,
      valid: true,
    });
  });

  it.each([
    ['missing proposed total', { proposedEconomicTotalMinor: undefined }],
    ['malformed amount', { proposedEconomicTotalMinor: 'NaN' }],
    ['non-finite amount', { proposedEconomicTotalMinor: 'Infinity' }],
    ['unsafe integer', { proposedEconomicTotalMinor: '999999999999999999999' }],
    ['contradictory directions', { additionalPaymentMinor: '1', expectedRefundMinor: '1' }],
  ])('fails safely for %s', (_, overrides) => {
    const result = amendmentPreviewFinancialSummary(
      preview(overrides as Partial<AmendmentPreview['financial']>),
    );
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain('NaN');
    expect(JSON.stringify(result)).not.toContain('Infinity');
  });
});

describe('change-booking range summaries', () => {
  it.each([
    [new Date(2026, 9, 16, 9), new Date(2026, 9, 17, 9), 'Oct 16–17, 2026'],
    [new Date(2026, 9, 31, 9), new Date(2026, 10, 2, 15), 'Oct 31 – Nov 2, 2026'],
    [new Date(2026, 11, 31, 9), new Date(2027, 0, 2, 15), 'Dec 31, 2026 – Jan 2, 2027'],
  ])('formats %s through %s', (start, end, expected) => {
    expect(tripDateSummary(start, end, { alwaysShowYear: true })).toBe(expected);
  });
});

describe('booking amendment state presentation', () => {
  it.each([
    ['PENDING_OWNER', 'Waiting for Owner approval'],
    ['OWNER_ACCEPTED_PAYMENT_PENDING', 'Payment required'],
    ['OWNER_ACCEPTED_PROCESSING', 'Applying booking change'],
    ['APPLIED', 'Booking updated successfully'],
    ['DECLINED', 'Owner declined the change'],
    ['WITHDRAWN', 'Change request withdrawn'],
    ['EXPIRED', 'Change request expired'],
    ['FAILED', 'Change could not be completed'],
    ['FINANCIAL_RECOVERY_PENDING', 'Booking change could not be applied'],
  ] as const)('maps %s without exposing internal enum copy', (status, expected) => {
    expect(amendmentStatusCopy(detail({ status }))[0]).toBe(expected);
  });

  it('distinguishes payment and refund reconciliation states', () => {
    expect(amendmentStatusCopy(detail({ paymentState: 'PAYMENT_PROCESSING' }))[0]).toBe(
      'Payment processing',
    );
    expect(amendmentStatusCopy(detail({ paymentState: 'PAYMENT_VERIFYING' }))[0]).toBe(
      'Payment being verified',
    );
    expect(
      amendmentStatusCopy(detail({ paymentState: 'PAYMENT_RECEIVED_AWAITING_APPLICATION' }))[0],
    ).toBe('Payment received — applying booking change');
    expect(amendmentStatusCopy(detail({ refundState: 'REFUND_VERIFYING' }))[0]).toBe(
      'Refund being verified',
    );
    expect(
      amendmentStatusCopy(detail({ refundState: 'REFUND_COMPLETED_AWAITING_APPLICATION' }))[0],
    ).toBe('Refund completed — applying booking change');
    expect(
      amendmentStatusCopy(
        detail({ refundState: 'FINANCIAL_RECOVERY_SETTLED', status: 'FINANCIAL_RECOVERY_PENDING' }),
      )[0],
    ).toBe('Refund settled');
  });

  it('maps actionable server errors to recoverable customer copy', () => {
    expect(amendmentErrorMessage(new ApiError('raw', 'QUOTE_EXPIRED', 409))).toContain(
      'preview expired',
    );
    expect(
      amendmentErrorMessage(new ApiError('raw', 'BOOKING_AVAILABILITY_CONFLICT', 409)),
    ).toContain('no longer available');
    expect(
      amendmentErrorMessage(new ApiError('raw', 'BOOKING_FINANCIAL_AUTHORITY_UNAVAILABLE', 409)),
    ).toContain('financial details are unavailable');
    expect(amendmentErrorMessage(new ApiError('raw', 'RETURN_WORKFLOW_STARTED', 409))).toContain(
      'return process',
    );
  });
});

describe('renter change-booking UX integration', () => {
  it('offers pre-trip Change Booking and ACTIVE Extend Trip without ACTIVE shortening', () => {
    expect(bookings).toContain("booking.status === 'ACTIVE'");
    expect(bookings).toContain("? 'Extend Trip'");
    expect(bookings).toContain(": 'Change Booking'");
    expect(renter).toContain('...(active ? {} : { proposedPickupAt:');
    expect(renter).toContain('proposedReturnAt: returnAt.toISOString()');
    expect(renter).toContain('active ? new Date(booking.rentalEnd) : pickup');
  });

  it('supports dates, fulfillment destinations, server preview, review, and explicit submit', () => {
    expect(renter).toContain('proposedStartMethod');
    expect(renter).toContain('proposedEndMethod');
    expect(renter).toContain('proposedDeliveryDestination');
    expect(renter).toContain('proposedCollectionDestination');
    expect(renter).toContain('/amendment-preview');
    expect(renter).toContain('Confirm your request');
    expect(renter).toContain('Request Owner approval');
    expect(renter).toContain("'Idempotency-Key': submitKey.current");
  });

  it('uses one Back action in review while preserving the current draft', () => {
    const review = renter.slice(
      renter.indexOf('function Review('),
      renter.indexOf('function AmendmentState('),
    );
    const reviewTransition = renter.slice(
      renter.indexOf("stage === 'REVIEW' && preview"),
      renter.indexOf('onClose={close}', renter.indexOf("stage === 'REVIEW' && preview")),
    );

    expect(review).toContain('leading={<BackControl label="Back" onPress={onBack} />}');
    expect(review).not.toContain('label="Edit change"');
    expect(review).toContain("label={pending ? 'Sending request…' : 'Request Owner approval'}");
    expect(review).toContain('label="Discard changes"');
    expect(reviewTransition).toContain("setStage('EDIT')");
    expect(reviewTransition).not.toContain('setReturnAt');
    expect(reviewTransition).not.toContain('setPickup');
    expect(reviewTransition).not.toContain('setDelivery');
    expect(reviewTransition).not.toContain('setCollection');
  });

  it('opens a combined PRE_TRIP range editor and retains focused ACTIVE return editing', () => {
    expect(renter).toContain("picker === 'dates'");
    expect(renter).toContain('<TripDateCalendar');
    expect(renter).toContain('<BookingDateTimeEditorSummary');
    expect(renter).toContain('title="Change dates"');
    expect(renter).toContain("active ? 'Extend return' : 'Change return'");
    expect(renter).toContain("picker === 'return'");
    expect(renter).not.toContain("openPicker('pickup')");
  });

  it('reuses the shared compact date and time editor without a redundant inner heading', () => {
    const editor = renter.slice(
      renter.indexOf('function DateRangeEditor'),
      renter.indexOf("type StartMethod = 'RENTER_PICKUP'"),
    );

    expect(editor).toContain('<BookingDateTimeEditorSummary');
    expect(editor).toContain('onChangeDates={onOpenCalendar}');
    expect(editor).toContain('applySharedBookingTime(');
    expect(editor).toContain('label="Done"');
    expect(editor).toContain('onValidityChange={setTimeValid}');
    expect(editor).toContain('disabled={!valid || !timeValid}');
    expect(editor).not.toContain('When?');
    expect(editor).not.toContain('Select your trip dates and shared handover time');
  });

  it('presents one shared handover time and compact start/end rental sections', () => {
    const dateRangeControl = renter.slice(
      renter.indexOf('function DateRangeControl'),
      renter.indexOf('function Review('),
    );

    expect(dateRangeControl).toContain('Dates &amp; time');
    expect(dateRangeControl).toContain('· {timeLabel(pickup)}');
    expect(dateRangeControl).toContain('Change dates &amp; time');
    expect(dateRangeControl).not.toContain('Pickup {timeLabel(pickup)} · Return');
    expect(renter).toContain('label="Start of rental"');
    expect(renter).toContain('label="End of rental"');
    expect(renter).toContain('const showSelector = props.changeable && props.allowed.length > 1;');
    expect(renter).toContain('<Card style={styles.handoverCard}>');
    expect(renter).toContain('<View style={styles.handoverDivider} />');
    expect(renter).toContain('compactNestedHeader');
    expect(renter).toContain(
      "? 'Checking availability and price…'\n                        : 'Review change'",
    );
  });

  it('keeps one accessible Done action and only the top-left Cancel in the date editor', () => {
    const dateEditor = renter.slice(
      renter.indexOf('function DateTimeEditor'),
      renter.indexOf('function DateRangeEditor'),
    );
    const footer = dateEditor.slice(
      dateEditor.indexOf('bottomAccessory={'),
      dateEditor.indexOf('contentBottomPadding={spacing.sm}'),
    );

    expect(dateEditor.match(/label="Done"/g)).toHaveLength(1);
    expect(dateEditor.match(/label="Cancel"/g)).toHaveLength(1);
    expect(dateEditor).not.toContain('accessibilityLabel="Save date and time"');
    expect(dateEditor).toContain('bottomAccessory={');
    expect(dateEditor).toContain('leading={<BackControl label="Cancel" onPress={onCancel} />}');
    expect(footer).not.toContain('label="Cancel"');
    expect(dateEditor).toContain('measureBottomAccessory');
    expect(dateEditor).toContain('paddingBottom: adaptiveScreen.contentBottomPadding');
    expect(dateEditor).toContain('contentBottomPadding={spacing.sm}');
  });

  it('measures every state, caps it to the safe viewport, and only scrolls on overflow', () => {
    expect(renter).toContain('presentationStyle="overFullScreen"');
    expect(renter).toContain('style={[styles.sheet, animatedSheetStyle]}');
    expect(sheetLayout).toContain('headerHeight + contentHeight + safeAreaAllowance');
    expect(renter).toContain('viewportHeight - Math.max(safeArea.top, spacing.md)');
    expect(renter).toContain('adaptiveSheetLayout({');
    expect(renter).toContain('scrollEnabled: measuredLayout.scrollEnabled');
    expect(renter).toContain('onContentSizeChange={onContentSizeChange}');
    expect(renter).toContain('contentBottomPadding={bottomPadding}');
    expect(renter).not.toContain('fixedHeightRatio');
    expect(renter).not.toContain("bottomAction: { marginTop: 'auto'");
    expect(renter).not.toContain('scroll={false}');
  });

  it('shows the exact server-authorized Pay CTA and not a payment-state inference', () => {
    expect(renter).toContain('{amendment.paymentInitiationAllowed && (');
    expect(renter).toContain('`Pay ${money(additional, amendment.financial.currency)}`');
    expect(renter).toContain('disabled={paying}');
    expect(renter).not.toContain("amendment.paymentState === 'WAITING_FOR_PAYMENT'");
  });

  it('refreshes payment truth after success and ambiguous transport failure', () => {
    expect(renter).toContain('onError: async () =>');
    expect(renter).toContain('await detail.refetch()');
    expect(renter).toContain('onSuccess: async () =>');
    expect(renter).toContain("payKey.current ||= idempotencyKey('pay-amendment'");
    expect(renter).toContain('if (payRequest.current) return payRequest.current');
    expect(renter).toContain('payRequest.current = null');
  });

  it('clears stale submission errors and idempotency state before a new change attempt', () => {
    expect(renter).toContain('const justOpened = visible && !wasVisible.current');
    expect(renter).toContain('if (!justOpened) return');
    expect(renter).toContain('previewMutation.reset()');
    expect(renter).toContain('submit.reset()');
    expect(renter).toContain("submitKey.current = ''");
    expect(renter).toContain("setStage(restoredId ? 'DETAIL' : 'EDIT')");
    expect(renter).toContain('setPickup(new Date(booking.rentalStart))');
    expect(renter).toContain('setReturnAt(new Date(booking.rentalEnd))');
  });

  it('keeps payment states distinct and removes the obsolete Owner deadline after acceptance', () => {
    expect(renter).toContain("amendment.status === 'PENDING_OWNER'");
    expect(renter).toContain('label="Owner response deadline"');
    expect(renter).toContain('label="Payment deadline"');
    expect(amendmentStatusCopy(detail({ paymentState: 'PAYMENT_PROCESSING' }))[0]).toBe(
      'Payment processing',
    );
    expect(amendmentStatusCopy(detail({ paymentState: 'PAYMENT_VERIFYING' }))[0]).toBe(
      'Payment being verified',
    );
    expect(
      amendmentStatusCopy(detail({ paymentState: 'PAYMENT_RECEIVED_AWAITING_APPLICATION' }))[0],
    ).toBe('Payment received — applying booking change');
  });

  it('renders APPLIED from authoritative current booking values without diff semantics', () => {
    const appliedSummary = renter.slice(
      renter.indexOf('function AppliedSummary'),
      renter.indexOf('function DeadlineRow'),
    );
    expect(renter).toContain("const applied = amendment.status === 'APPLIED'");
    expect(renter).toContain('<AppliedSummary current={amendment.current} />');
    expect(appliedSummary).toContain('tripDateSummary(start, end, { alwaysShowYear: true })');
    expect(appliedSummary).toContain('Pickup {timeLabel(start)} · Return {timeLabel(end)}');
    expect(appliedSummary).toContain('Handover');
    expect(appliedSummary).toContain('methodLabel(current.startMethod)');
    expect(appliedSummary).toContain('methodLabel(current.endMethod)');
    expect(appliedSummary).not.toContain('No change');
    expect(appliedSummary).not.toContain('Current');
    expect(appliedSummary).not.toContain('Proposed');
    expect(
      tripDateSummary(new Date(2026, 9, 26), new Date(2026, 9, 27), { alwaysShowYear: true }),
    ).toBe('Oct 26–27, 2026');
  });

  it('switches from processing comparison to APPLIED authority while mounted', () => {
    expect(renter).toContain('{applied ? (');
    expect(renter).toContain('<AppliedSummary current={amendment.current} />');
    expect(renter).toContain(
      '<Comparison active={false} current={amendment.current} proposed={amendment.proposed} />',
    );
    expect(transientAmendmentStatuses.has('OWNER_ACCEPTED_PROCESSING')).toBe(true);
    expect(transientAmendmentStatuses.has('APPLIED')).toBe(false);
  });

  it('omits an empty status card and labels meaningful APPLIED financial outcomes', () => {
    expect(renter).toContain('{showStatusMeta && (');
    expect(renter).toContain(
      "additional > 0 || refund > 0 || showPaymentDeadline || amendment.status === 'PENDING_OWNER'",
    );
    expect(renter).toContain("label={applied ? 'Payment completed' : 'Additional payment'}");
    expect(renter).toContain("label={applied ? 'Refund completed' : 'Expected refund'}");
    expect(renter).toContain('const showPaymentDeadline = !applied');
  });

  it('keeps one bottom Done action and one top Cancel control on the date editor', () => {
    const rangeEditor = renter.slice(
      renter.indexOf('function DateRangeEditor'),
      renter.indexOf('type StartMethod'),
    );
    expect(rangeEditor).toContain('leading={<BackControl label="Cancel"');
    expect(rangeEditor).toContain(
      '<Button disabled={!valid || !timeValid} label="Done" onPress={onSave} />',
    );
    expect(rangeEditor).not.toContain('action={');
    expect(rangeEditor).not.toContain('variant="ghost"');
  });

  it('renders the trip-date calendar inside the existing booking-change sheet', () => {
    const rangeEditor = renter.slice(
      renter.indexOf('function DateRangeEditor'),
      renter.indexOf('type StartMethod'),
    );
    expect(rangeEditor).toContain('if (calendarOpen)');
    expect(rangeEditor).toContain('<TripDateCalendar');
    expect(rangeEditor).toContain('onOpenCalendar');
    expect(rangeEditor).not.toContain('<Modal');
  });

  it('saves editor drafts locally and cancels without changing the saved booking draft', () => {
    expect(renter).toContain(
      'setRangeDraft({ pickup: new Date(pickup), returnAt: new Date(returnAt) })',
    );
    expect(renter).toContain('setPickup(rangeDraft.pickup)');
    expect(renter).toContain('setReturnAt(rangeDraft.returnAt)');
    expect(renter).toContain('const cancelPicker = () =>');
    expect(renter).toContain('setPickerDraft(null)');
  });

  it('keeps Review change separate from date editing and server preview', () => {
    expect(renter).toContain("? 'Checking availability and price…'");
    expect(renter).toContain("'Review change'");
    expect(renter).toContain('previewMutation.mutate();');
    expect(renter).toContain('submit.reset();');
    expect(renter).not.toContain('onSave={() => previewMutation.mutate()}');
  });

  it('preserves pickup while editing return and limits ACTIVE extensions to return', () => {
    expect(renter).toContain('!active && (');
    expect(renter).toContain('onPress={openDates}');
    expect(renter).toContain('onPress={openReturn}');
    expect(renter).toContain("active ? 'Extend return' : 'Change return'");
    expect(renter).toContain('minimumDate={new Date(booking.rentalEnd)}');
  });

  it('renders fulfillment choices only from projected capability and changeability authority', () => {
    expect(renter).toContain('booking.fulfillment.allowedStartMethods');
    expect(renter).toContain('booking.fulfillment.allowedEndMethods');
    expect(renter).toContain('booking.fulfillment.startFulfillmentChangeable');
    expect(renter).toContain('booking.fulfillment.endFulfillmentChangeable');
    expect(renter).toContain('props.changeable && props.allowed.length > 1');
    expect(renter).toContain('style={styles.fulfillmentSummary}');
    expect(renter).toContain('props.changeable && props.allowed.length > 1');
    expect(renter).toContain('<Chip');
  });

  it('prevents saving an invalid combined range and announces the complete Dates action', () => {
    expect(renter).toContain('const valid = returnAt > pickup');
    expect(renter).toContain('Return must be after pickup.');
    expect(renter).toContain('disabled={!valid || !timeValid}');
    expect(renter).toContain('accessibilityHint="Opens the pickup and return date editor"');
  });

  it('announces interactive rows, selected values, changed state, and editor actions', () => {
    expect(renter).toContain(
      'accessibilityHint={`Opens the ${label.toLowerCase()} date and time editor`}',
    );
    expect(renter).toContain("${changed ? ', changed' : ''}");
    expect(renter).toContain('<Button label="Done" onPress={onSave} />');
    expect(renter).toContain('leading={<BackControl label="Cancel"');
  });

  it('renders zero, payment, refund, full-price, availability, and preview-expiry UX', () => {
    expect(renter).toContain('No price difference');
    expect(renter).toContain('Additional payment');
    expect(renter).toContain('Refund due');
    expect(renter).toContain('Current total');
    expect(renter).toContain('New total');
    expect(renter).toContain('Difference');
    expect(renter).toContain('availability and price');
    expect(renter).toContain('Review the latest change');
    expect(renter).not.toContain('preview.proposed.totalMinor');
    expect(renter).toContain('amendmentPreviewFinancialSummary(preview)');
    expect(renter).toContain('disabled={pending || !trustworthy}');
    expect(renter).toContain('leading={<BackControl label="Back" onPress={onBack} />}');
  });

  it('reviews only changed fields and keeps ACTIVE pickup out of the comparison', () => {
    expect(renter).toContain('const startChanged = current.startMethod !== proposed.startMethod');
    expect(renter).toContain('const endChanged = current.endMethod !== proposed.endMethod');
    expect(renter).toContain("{active ? 'Return change' : 'Trip dates'}");
    expect(renter).toContain('label="Start of rental"');
    expect(renter).toContain('label="End of rental"');
  });

  it('restores, polls, refreshes, withdraws, and pays through accepted endpoints', () => {
    expect(bookings).toContain('booking.latestAmendment');
    expect(renter).toContain("queryKey: ['booking-amendment'");
    expect(renter).toContain('transientAmendmentStatuses.has');
    expect(renter).toContain('useRefreshOnFocusAndForeground');
    expect(renter).toContain('/withdraw');
    expect(renter).toContain('/payment');
    expect(renter).toContain('disabled={paying}');
    expect(renter).toContain('disabled={withdrawing}');
  });

  it('presents amendment deadlines and status actions with a compact visual hierarchy', () => {
    expect(renter).toContain('function DeadlineRow');
    expect(renter).toContain('label="Owner response deadline"');
    expect(renter).toContain('label="Payment deadline"');
    expect(renter).toContain('name="time-outline"');
    expect(renter).toContain('style={styles.statusActions}');
  });
});

describe('change-booking adaptive sheet layout', () => {
  it('keeps the short ACTIVE Extend Trip state at its intrinsic height', () => {
    const layout = adaptiveSheetLayout({
      contentHeight: 210,
      headerHeight: 150,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 20,
    });

    expect(layout).toEqual({ height: 380, intrinsicHeight: 380, scrollEnabled: false });
    expect(layout.height).toBeLessThan(780);
  });

  it('caps long PRE_TRIP/review content and leaves it scrollable', () => {
    const layout = adaptiveSheetLayout({
      contentHeight: 920,
      headerHeight: 170,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 20,
    });

    expect(layout.height).toBe(780);
    expect(layout.intrinsicHeight).toBe(1110);
    expect(layout.scrollEnabled).toBe(true);
  });

  it('recomputes after content changes without making the CTA force maximum height', () => {
    const compact = adaptiveSheetLayout({
      contentHeight: 210,
      headerHeight: 150,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 20,
    });
    const withValidation = adaptiveSheetLayout({
      contentHeight: 290,
      headerHeight: 150,
      maxSafeViewportHeight: 780,
      safeAreaAllowance: 20,
    });

    expect(withValidation.height - compact.height).toBe(80);
    expect(withValidation.scrollEnabled).toBe(false);
    expect(renter).toContain('bottomAction: { marginTop: spacing.xs }');
  });
});

describe('Owner booking-change UX integration', () => {
  it('keeps a pending refund actionable without presenting it as processing', () => {
    const pendingRefund = detail({
      actionable: true,
      financial: {
        additionalPaymentMinor: '0',
        currency: 'PHP',
        expectedRefundMinor: '300000',
        ownerEarningsDeltaMinor: '-255000',
      },
      refundState: 'REFUND_PROCESSING',
      status: 'PENDING_OWNER',
    });
    expect(ownerAmendmentStatusCopy(pendingRefund)[0]).toBe('Review requested change');
    expect(ownerAmendmentIsProcessing(pendingRefund)).toBe(false);
    expect(owner).toContain('{amendment.actionable && (');
    expect(owner).toContain('Accept change');
    expect(owner).toContain('Decline change');
  });

  it('maps only post-acceptance states to payment/refund processing', () => {
    const refundProcessing = detail({
      actionable: false,
      financial: {
        additionalPaymentMinor: '0',
        currency: 'PHP',
        expectedRefundMinor: '300000',
      },
      status: 'OWNER_ACCEPTED_PROCESSING',
    });
    expect(ownerAmendmentStatusCopy(refundProcessing)[0]).toBe('Refund processing');
    expect(ownerAmendmentIsProcessing(refundProcessing)).toBe(true);

    const awaitingPayment = detail({
      actionable: false,
      status: 'OWNER_ACCEPTED_PAYMENT_PENDING',
    });
    expect(ownerAmendmentStatusCopy(awaitingPayment)[0]).toBe('Waiting for renter payment');
    expect(ownerAmendmentIsProcessing(awaitingPayment)).toBe(false);
    expect(
      ownerAmendmentIsProcessing(
        detail({
          actionable: false,
          paymentState: 'PAYMENT_PROCESSING',
          status: 'OWNER_ACCEPTED_PAYMENT_PENDING',
        }),
      ),
    ).toBe(true);
  });

  it.each([
    'APPLIED',
    'DECLINED',
    'WITHDRAWN',
    'EXPIRED',
    'FAILED',
    'FINANCIAL_RECOVERY_PENDING',
  ] as const)('keeps %s read-only and without a processing indicator', (status) => {
    const amendment = detail({ actionable: false, status });
    expect(ownerAmendmentIsProcessing(amendment)).toBe(false);
    expect(ownerAmendmentStatusCopy(amendment)[0]).toBeTruthy();
  });

  it('surfaces actionable requests with compact current/requested ranges and earnings', () => {
    expect(owner).toContain(
      '`/owner/bookings/amendments?scope=${amendmentScope}&page=${pageParam}&pageSize=20`',
    );
    expect(owner).toContain('Review requested change');
    expect(owner).toContain('label="Current"');
    expect(owner).toContain('label="Requested"');
    expect(owner).toContain('tripDateSummary(startDate, endDate');
    expect(owner).toContain('`${timeLabel(startDate)} → ${timeLabel(endDate)}`');
    expect(owner).toContain('Owner earnings');
    expect(owner).toContain('Renter additional payment');
  });

  it('integrates actionable amendments with Needs response and prevents empty-state contradiction', () => {
    expect(owner).toContain("filter === 'Needs response'");
    expect(owner).toContain("'NEEDS_RESPONSE'");
    expect(owner).toContain("'UPCOMING'");
    expect(owner).toContain("'ALL'");
    expect(owner).toContain('amendments.data?.pages.flatMap((page) => page.items) ?? []');
    expect(owner).toContain('items.length === 0 && filteredAmendments.length === 0');
    expect(owner).toContain('Changes needing your response');
    expect(owner).toContain('No booking changes need your response');
    expect(owner).toContain('No upcoming booking changes');
    expect(owner).toContain('No booking change history yet');
    expect(owner).toContain('Load more changes');
  });

  it('renders zero and signed earnings deltas safely', () => {
    expect(owner).toContain("if (value === 0) return 'No earnings change'");
    expect(owner).toContain("return `${value > 0 ? '+' : ''}${money(value, currency)}`");
    expect(owner).toContain('Number.isSafeInteger(parsed) && Number.isFinite(parsed)');
    expect(owner).not.toContain('Earnings change:');
    expect(owner).toContain('Owner earnings change');
    expect(owner).toContain('earningsDeltaAccessibility(delta, amendment.financial.currency)');
    expect(owner).toContain("if (value === 0) return 'Owner earnings change, no change'");
    expect(owner).toContain("value < 0 ? 'minus ' : 'plus '");
  });

  it('uses compact responsive request-card times and return-only ACTIVE extension cards', () => {
    expect(owner).toContain('`${timeLabel(startDate)} → ${timeLabel(endDate)}`');
    expect(owner).toContain("amendment.scope === 'ACTIVE_EXTENSION'");
    expect(owner).toContain('label="Current return"');
    expect(owner).toContain("label={applied ? 'Updated return' : 'Requested return'}");
    expect(owner).toContain("rangeGrid: { flexDirection: 'row', gap: spacing.sm }");
  });

  it('simplifies zero-delta earnings while retaining detailed nonzero comparisons', () => {
    expect(owner).toContain('{ownerDelta === 0 ? (');
    expect(owner).toContain('<Text style={styles.noChange}>No change</Text>');
    expect(owner).toContain('label="Current earnings"');
    expect(owner).toContain('label="Requested earnings"');
    expect(owner).toContain(
      '`Changed by ${earningsDeltaCopy(ownerDelta, amendment.financial.currency)}`',
    );
  });

  it('shows authoritative APPLIED details without a Proposed label or approval controls', () => {
    const appliedBranch = owner.slice(
      owner.indexOf('{applied ? ('),
      owner.indexOf(') : (', owner.indexOf('{applied ? (')),
    );
    expect(appliedBranch).toContain('Trip dates');
    expect(appliedBranch).not.toContain('Proposed');
    expect(appliedBranch).toContain("activeExtension ? 'Return time' : 'Trip dates'");
    expect(appliedBranch).toContain('label="Updated return"');
    expect(owner).toContain('start={amendment.proposed.rentalStart}');
    expect(owner).toContain('Owner earnings');
    expect(owner).toContain("const applied = amendment.status === 'APPLIED'");
    expect(owner).toContain('{amendment.actionable && (');
  });

  it('uses Owner-facing pending, processing, recovery, applied, and closed-state copy', () => {
    expect(ownerAmendmentStatusCopy(detail({ status: 'OWNER_ACCEPTED_PAYMENT_PENDING' }))[0]).toBe(
      'Waiting for renter payment',
    );
    expect(ownerAmendmentStatusCopy(detail({ status: 'OWNER_ACCEPTED_PROCESSING' }))[0]).toBe(
      'Applying booking change',
    );
    expect(ownerAmendmentStatusCopy(detail({ status: 'FINANCIAL_RECOVERY_PENDING' }))[0]).toBe(
      'Booking change could not be applied',
    );
    expect(ownerAmendmentStatusCopy(detail({ status: 'APPLIED' }))[0]).toBe(
      'Booking updated successfully',
    );
    expect(owner).toContain('ownerAmendmentStatusCopy(amendment)');
    expect(owner).not.toContain('amendmentStatusCopy(amendment)');
  });

  it('adds an accessible processing cue without applying success semantics', () => {
    expect(owner).toContain('ownerAmendmentIsProcessing(amendment)');
    expect(owner).toContain('accessibilityRole="progressbar"');
    expect(owner).toContain('Applying booking change. Processing.');
    expect(owner).toContain('<ActivityIndicator color={colors.primary} size="small" />');
    expect(ownerAmendmentIsProcessing(detail({ status: 'OWNER_ACCEPTED_PROCESSING' }))).toBe(true);
  });

  it('keeps historical cards read-only and presents APPLIED dates as updated', () => {
    expect(owner).toContain("const applied = amendment.status === 'APPLIED'");
    expect(owner).toContain("label={applied ? 'Updated trip dates' : 'Requested'}");
    expect(owner).toContain('{amendment.actionable && (');
    expect(owner).toContain('<Text style={styles.changeEyebrow}>{cardStatus}</Text>');
  });

  it('uses return-only comparison when pickup is unchanged and avoids duplicated handover', () => {
    expect(owner).toContain("{pickupUnchanged ? 'Return change' : 'Trip dates'}");
    expect(owner).toContain('label="Current return"');
    expect(owner).toContain('label="Requested return"');
    expect(owner).toContain('{handoverChanged ? (');
    expect(owner).toContain('No change');
  });

  it('uses actionable authority, confirmation, idempotency and duplicate-tap guards', () => {
    expect(owner).toContain('amendment.actionable');
    expect(owner).toContain('Accept this change?');
    expect(owner).toContain('Decline this change?');
    expect(owner).toContain("'Idempotency-Key': idempotencyKey");
    expect(owner).toContain('disabled={decide.isPending}');
  });

  it('routes existing booking notification links to the actionable Owner amendment', () => {
    expect(navigation).toContain("booking.data.latestAmendment?.status === 'PENDING_OWNER'");
    expect(navigation).toContain('initialAmendmentReference');
  });
});
