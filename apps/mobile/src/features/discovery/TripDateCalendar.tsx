import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Button, Icon } from '../../ui/primitives';
import { discoveryDateForCalendarDay, tripDateSummary } from './trip-date-policy';

const MAX_RANGE_DAYS = 365;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function localDiscoveryDate(year: number, month: number, day: number) {
  return discoveryDateForCalendarDay(new Date(year, month, day));
}

function dayKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function calendarDaysBetween(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / DAY_MS);
}

export function TripDateCalendar({
  appliedStart,
  appliedEnd,
  preselect,
  showClear = true,
  onApply,
  onClear,
}: {
  readonly appliedStart: Date;
  readonly appliedEnd: Date;
  readonly preselect: boolean;
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
  const now = new Date();
  const earliest = localDiscoveryDate(now.getFullYear(), now.getMonth(), now.getDate());
  if (earliest.getTime() < now.getTime() - 5 * 60_000) earliest.setDate(earliest.getDate() + 1);
  const earliestMonth = localDiscoveryDate(earliest.getFullYear(), earliest.getMonth(), 1);
  const previousDisabled = month.getTime() <= earliestMonth.getTime();
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1)
    cells.push(localDiscoveryDate(month.getFullYear(), month.getMonth(), day));

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

  function moveMonth(offset: number) {
    setMonth((current) =>
      localDiscoveryDate(current.getFullYear(), current.getMonth() + offset, 1),
    );
  }

  const complete = Boolean(draftStart && draftEnd);
  return (
    <View style={styles.calendar}>
      <View style={styles.monthHeader}>
        <Pressable
          accessibilityLabel="Previous month"
          accessibilityRole="button"
          accessibilityState={{ disabled: previousDisabled }}
          disabled={previousDisabled}
          hitSlop={8}
          onPress={() => moveMonth(-1)}
          style={[styles.monthButton, previousDisabled && styles.monthButtonDisabled]}
        >
          <Icon color={colors.ink} name="chevron-back" />
        </Pressable>
        <Text accessibilityRole="header" style={styles.monthTitle}>
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </Text>
        <Pressable
          accessibilityLabel="Next month"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => moveMonth(1)}
          style={styles.monthButton}
        >
          <Icon color={colors.ink} name="chevron-forward" />
        </Pressable>
      </View>
      <View accessibilityRole="summary" style={styles.weekRow}>
        {WEEKDAYS.map((weekday) => (
          <Text key={weekday} style={styles.weekday}>
            {weekday}
          </Text>
        ))}
      </View>
      <View style={styles.dayGrid}>
        {cells.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={styles.dayColumn} />;
          const disabled = day.getTime() < earliest.getTime();
          const start = draftStart ? dayKey(day) === dayKey(draftStart) : false;
          const end = draftEnd ? dayKey(day) === dayKey(draftEnd) : false;
          const inRange = Boolean(draftStart && draftEnd && day > draftStart && day < draftEnd);
          const today = dayKey(day) === dayKey(now);
          const state = disabled
            ? 'disabled'
            : start
              ? 'selected, range start'
              : end
                ? 'selected, range end'
                : inRange
                  ? 'selected, in range'
                  : 'available';
          return (
            <View key={dayKey(day)} style={[styles.dayColumn, inRange && styles.rangeMiddle]}>
              <Pressable
                accessibilityLabel={`${day.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}, ${state}`}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected: start || end || inRange }}
                disabled={disabled}
                onPress={() => selectDate(day)}
                style={[
                  styles.dayButton,
                  today && styles.today,
                  (start || end) && styles.rangeBoundary,
                  disabled && styles.dayDisabled,
                ]}
              >
                <Text
                  maxFontSizeMultiplier={1.25}
                  style={[
                    styles.dayText,
                    inRange && styles.rangeMiddleText,
                    (start || end) && styles.rangeBoundaryText,
                    disabled && styles.dayDisabledText,
                  ]}
                >
                  {day.getDate()}
                </Text>
                {start || end ? (
                  <Text style={styles.boundaryMarker}>{start ? 'Start' : 'End'}</Text>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
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
        label="Apply dates"
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
  boundaryMarker: { color: colors.onPrimary, fontSize: 8, fontWeight: '800' },
  calendar: { gap: spacing.sm },
  dayButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 40,
  },
  dayColumn: { alignItems: 'center', justifyContent: 'center', width: '14.2857%' },
  dayDisabled: { opacity: 0.42 },
  dayDisabledText: { textDecorationLine: 'line-through' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  error: { color: colors.danger, lineHeight: 20 },
  monthHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  monthButtonDisabled: { opacity: 0.35 },
  monthTitle: { color: colors.ink, flex: 1, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  rangeBoundary: { backgroundColor: colors.primary },
  rangeBoundaryText: { color: colors.onPrimary },
  rangeMiddle: { backgroundColor: colors.primarySoft },
  rangeMiddleText: { fontWeight: '900', textDecorationLine: 'underline' },
  selection: { color: colors.ink, fontWeight: '800', textAlign: 'center' },
  today: { borderColor: colors.primary, borderWidth: 1 },
  weekRow: { flexDirection: 'row' },
  weekday: {
    color: colors.subtleText,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    width: '14.2857%',
  },
});
