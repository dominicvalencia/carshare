import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';

const directory = dirname(fileURLToPath(import.meta.url));
const selector = readFileSync(resolve(directory, 'BookingTimeSelector.tsx'), 'utf8');
const summaryEditor = readFileSync(resolve(directory, 'BookingDateTimeEditorSummary.tsx'), 'utf8');
const discovery = readFileSync(resolve(directory, 'DiscoveryScreen.tsx'), 'utf8');
const amendment = readFileSync(resolve(directory, '../bookings/BookingAmendmentSheet.tsx'), 'utf8');
const dateTimeField = readFileSync(resolve(directory, '../../ui/DateTimeField.tsx'), 'utf8');

describe('shared renter booking-time selection', () => {
  it('uses one accessible native time field without the old custom slot list', () => {
    expect(selector).toContain('<DateTimeField');
    expect(selector).toContain('mode="time"');
    expect(selector).toContain('minuteInterval={BOOKING_TIME_INCREMENT_MINUTES}');
    expect(selector).not.toContain('bookingTimeSlots()');
    expect(selector).not.toContain('accessibilityRole="radio"');
    expect(selector).not.toContain('<TextInput');
  });

  it('applies the selected time to pickup and return in discovery and pre-trip amendments', () => {
    expect(summaryEditor).toContain('label="Pickup & return time"');
    expect(discovery).toContain('applySharedBookingTime(');
    expect(amendment).toContain('<BookingDateTimeEditorSummary');
    expect(amendment).toContain('applySharedBookingTime(');
  });

  it('rejects non-30-minute values and elapsed same-day times without applying them', () => {
    expect(selector).toContain('isBookingTimeAligned(selected)');
    expect(selector).toContain(
      'isBookingTimeSlotSelectable(pickupDate, minutes, new Date(), minimumNoticeMinutes)',
    );
    expect(selector).toContain("meets the vehicle's preparation window");
    expect(selector).toContain('Choose a time on the hour or half hour.');
    expect(selector).toContain("Choose a later time for today's pickup.");
    expect(selector).toContain('accessibilityRole="alert"');
    expect(selector).toContain('container: { flexShrink: 1, gap: spacing.xs, minWidth: 0 }');
  });

  it('uses a top-left cancel action and a content-driven native picker sheet', () => {
    expect(dateTimeField).toContain('<BackControl label={dismissLabel}');
    expect(dateTimeField).not.toContain('<Button label={dismissLabel}');
    expect(dateTimeField).not.toContain('<View style={styles.handle} />');
    expect(dateTimeField).toContain("style={mode === 'time' ? styles.timePickerFrame : undefined}");
    expect(dateTimeField).toContain('height: 216');
    expect(dateTimeField).toContain("overflow: 'hidden'");
    expect(dateTimeField).toContain('safeAreaAllowance: 0');
    expect(dateTimeField).toContain('<View style={styles.sheetActions}>');
    expect(dateTimeField).toContain(
      'onContentSizeChange={(_width, height) => setContentHeight(height)}',
    );
    expect(dateTimeField).toContain('scrollEnabled={measuredLayout.scrollEnabled}');
    expect(dateTimeField).not.toContain('<Text style={styles.pickerLabel}>Time</Text>');
    expect(dateTimeField).toContain('{helperText ? <Text style={styles.pickerHelper}>');
    expect(selector).toContain('helperText="The same time applies to pickup and return."');

    expect(
      adaptiveSheetLayout({
        contentHeight: 430,
        headerHeight: 0,
        maxSafeViewportHeight: 780,
        safeAreaAllowance: 34,
      }),
    ).toEqual({ height: 464, intrinsicHeight: 464, scrollEnabled: false });
    expect(
      adaptiveSheetLayout({
        contentHeight: 900,
        headerHeight: 0,
        maxSafeViewportHeight: 780,
        safeAreaAllowance: 34,
      }),
    ).toEqual({ height: 780, intrinsicHeight: 934, scrollEnabled: true });
  });

  it('uses a combined responsive trip dates and time summary in compact search', () => {
    const searchSheet = discovery.slice(
      discovery.indexOf('function LocationSheet'),
      discovery.indexOf('type FilterProperties'),
    );
    const summaryStart = searchSheet.indexOf(
      'accessibilityLabel={`Trip dates and time, ${',
      searchSheet.indexOf('draftDateTimeEditing ?'),
    );
    const summary = searchSheet.slice(summaryStart, searchSheet.indexOf(') : !whereExpanded'));

    expect(summary).toContain('Trip dates &amp; time');
    expect(summary).toContain('tripDateTimeSummary(draftStart, draftEnd)');
    expect(summary).toContain("'Add trip dates and time'");
    expect(summary).toContain('<Text style={styles.searchEdit}>Edit</Text>');
    expect(summary).toContain('label="Apply date and time"');
    expect(summary).not.toContain('label="Pickup & return time"');
    expect(discovery).toContain('setDraftDateTimeEditing(true)');
  });

  it('keeps the expanded editor compact without the old stacked date and time fields', () => {
    const searchSheet = discovery.slice(
      discovery.indexOf('function LocationSheet'),
      discovery.indexOf('type FilterProperties'),
    );
    const editingStart = searchSheet.indexOf('draftDateTimeEditing ?');
    const editingEnd = searchSheet.indexOf('label="Done editing"', editingStart);
    const editing = searchSheet.slice(editingStart, editingEnd);

    expect(editing).toContain('<BookingDateTimeEditorSummary');
    expect(editing).not.toContain('Trip dates &amp; time');
    expect(editing).toContain('timeEstablished={draftTimeEstablished}');
    expect(editing).not.toContain('style={styles.tripDateRange}');
    expect(summaryEditor).toContain('{tripDateSummary(start, end)}');
    expect(summaryEditor).toContain('· {timeLabel(start)}');
    expect(summaryEditor).toContain('styles.warningTag');
    expect(summaryEditor).toContain('accessibilityLabel="Select time, required"');
    expect(summaryEditor).toContain('>Select time</Text>');
    expect(summaryEditor).toContain('label="Change dates"');
    expect(summaryEditor).toContain(
      "actionLabel={timeEstablished ? 'Change time' : 'Select time'}",
    );
    expect(summaryEditor).toContain('hideValidationError');
    expect(summaryEditor).toContain('onValidationErrorChange={setSelectionError}');
    expect(summaryEditor).toContain('...(onValidityChange ? { onValidityChange } : {})');
    expect(summaryEditor).toContain('accessibilityRole="alert"');
    expect(dateTimeField).toContain(
      'actionLabel ? styles.action : [styles.value, compact && styles.compactValue]',
    );
    expect(dateTimeField).toContain('compactValue: {');
    expect(dateTimeField).toContain('minHeight: 50');
  });

  it('keeps exact ISO timestamp request contracts unchanged', () => {
    expect(discovery).toContain('start: pickup.toISOString()');
    expect(discovery).toContain('end: returnAt.toISOString()');
    expect(amendment).toContain('proposedPickupAt: pickup.toISOString()');
    expect(amendment).toContain('proposedReturnAt: returnAt.toISOString()');
  });

  it('keeps active extension editing separate from shared pre-trip time selection', () => {
    expect(amendment).toContain("picker === 'return'");
    expect(amendment).toContain('minimumDate={new Date(booking.rentalEnd)}');
    expect(amendment).toContain('<DateTimeEditor');
  });
});
