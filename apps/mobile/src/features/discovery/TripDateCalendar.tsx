import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { CalendarMonth } from '../../ui/CalendarMonth';
import { Button } from '../../ui/primitives';
import {
  bookingCalendarMinimumDate,
  discoveryDateForCalendarDay,
  isBookingCalendarDateSelectable,
  tripDateSummary,
} from './trip-date-policy';

const MAX_RANGE_DAYS = 365;
const DAY_MS = 86_400_000;

function localDiscoveryDate(year: number, month: number, day: number) {
  return discoveryDateForCalendarDay(new Date(year, month, day));
}

function calendarDaysBetween(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / DAY_MS);
}

export function TripDateCalendar({
  appliedStart,
  appliedEnd,
  disabledDate,
  minimumDate,
  minimumNoticeMinutes = 0,
  preselect,
  applyLabel = 'Apply dates',
  showClear = true,
  onApply,
  onClear,
}: {
  readonly appliedStart: Date;
  readonly appliedEnd: Date;
  readonly disabledDate?: (date: Date) => boolean;
  readonly minimumDate?: Date;
  readonly minimumNoticeMinutes?: number;
  readonly preselect: boolean;
  readonly applyLabel?: string;
  readonly showClear?: boolean;
  readonly onApply: (start: Date, end: Date) => void;
  readonly onClear: () => void;
}) {
  const [month, setMonth] = useState(() =>
    localDiscoveryDate(appliedStart.getFullYear(), appliedStart.getMonth(), 1),
  );
  const [draftStart, setDraftStart] = useState<Date | null>(() =>
    preselect ? discoveryDateForCalendarDay(appliedStart) : null,
  );
  const [draftEnd, setDraftEnd] = useState<Date | null>(() =>
    preselect ? discoveryDateForCalendarDay(appliedEnd) : null,
  );
  const [rangeError, setRangeError] = useState('');
  const earliest = bookingCalendarMinimumDate(minimumDate);

  function selectDate(day: Date) {
    setRangeError('');
    if (!draftStart || draftEnd || day.getTime() <= draftStart.getTime()) {
      setDraftStart(day);
      setDraftEnd(null);
      return;
    }
    if (calendarDaysBetween(draftStart, day) > MAX_RANGE_DAYS) {
      setRangeError('Trip dates cannot exceed 365 days. Choose an earlier end date.');
      return;
    }
    setDraftEnd(day);
  }

  const complete = Boolean(draftStart && draftEnd);
  return (
    <View style={styles.calendar}>
      <CalendarMonth
        disabledDate={(day) =>
          !isBookingCalendarDateSelectable(day, {
            ...(disabledDate ? { disabledDate } : {}),
            minimumDate: earliest,
            minimumNoticeMinutes,
          })
        }
        minimumDate={earliest}
        month={month}
        onMonthChange={(nextMonth) => {
          const earliestMonth = localDiscoveryDate(earliest.getFullYear(), earliest.getMonth(), 1);
          if (nextMonth >= earliestMonth) setMonth(nextMonth);
        }}
        onSelect={selectDate}
        selectedRangeEnd={draftEnd}
        selectedRangeStart={draftStart}
      />
      <Text accessibilityLiveRegion="polite" style={styles.selection}>
        {draftStart && draftEnd
          ? tripDateSummary(draftStart, draftEnd)
          : draftStart
            ? `${draftStart.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} selected. Choose an end date.`
            : 'Choose a start date.'}
      </Text>
      {rangeError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {rangeError}
        </Text>
      ) : null}
      <Button
        disabled={!complete}
        label={applyLabel}
        onPress={() => {
          if (draftStart && draftEnd) onApply(draftStart, draftEnd);
        }}
      />
      {showClear && (
        <Button
          label="Clear dates"
          onPress={() => {
            setDraftStart(null);
            setDraftEnd(null);
            setRangeError('');
            onClear();
          }}
          variant="ghost"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.sm },
  error: { color: colors.danger, lineHeight: 20 },
  selection: { color: colors.ink, fontWeight: '800', textAlign: 'center' },
});
