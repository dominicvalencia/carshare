import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Icon } from './primitives';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function calendarDayKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

export function CalendarMonth({
  disabledDate,
  maximumDate,
  minimumDate,
  month,
  onMonthChange,
  onSelect,
  onTitlePress,
  selected,
  selectedRangeEnd,
  selectedRangeStart,
}: {
  readonly disabledDate?: (date: Date) => boolean;
  readonly maximumDate?: Date;
  readonly minimumDate?: Date;
  readonly month: Date;
  readonly onMonthChange: (date: Date) => void;
  readonly onSelect: (date: Date) => void;
  readonly onTitlePress?: () => void;
  readonly selected?: Date | null;
  readonly selectedRangeEnd?: Date | null;
  readonly selectedRangeStart?: Date | null;
}) {
  const firstWeekday = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1)
    cells.push(new Date(month.getFullYear(), month.getMonth(), day, 12));
  const todayKey = calendarDayKey(new Date());
  const startKey = selectedRangeStart ? calendarDayKey(selectedRangeStart) : '';
  const endKey = selectedRangeEnd ? calendarDayKey(selectedRangeEnd) : '';
  const selectedKey = selected ? calendarDayKey(selected) : '';
  const previousMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1, 12);
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1, 12);
  const previousDisabled = Boolean(
    minimumDate &&
    previousMonth < new Date(minimumDate.getFullYear(), minimumDate.getMonth(), 1, 12),
  );
  const nextDisabled = Boolean(
    maximumDate && nextMonth > new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1, 12),
  );

  return (
    <View style={styles.calendar}>
      <View style={styles.monthHeader}>
        <Pressable
          accessibilityLabel="Previous month"
          accessibilityRole="button"
          accessibilityState={{ disabled: previousDisabled }}
          disabled={previousDisabled}
          hitSlop={8}
          onPress={() => onMonthChange(previousMonth)}
          style={[styles.monthButton, previousDisabled && styles.monthButtonDisabled]}
        >
          <Icon color={colors.ink} name="chevron-back" />
        </Pressable>
        <Pressable
          accessibilityHint={onTitlePress ? 'Opens year selection' : undefined}
          accessibilityRole={onTitlePress ? 'button' : undefined}
          disabled={!onTitlePress}
          onPress={onTitlePress}
          style={styles.monthTitleControl}
        >
          <Text accessibilityRole="header" style={styles.monthTitle}>
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          {onTitlePress && <Icon color={colors.primary} name="chevron-down" size={17} />}
        </Pressable>
        <Pressable
          accessibilityLabel="Next month"
          accessibilityRole="button"
          accessibilityState={{ disabled: nextDisabled }}
          disabled={nextDisabled}
          hitSlop={8}
          onPress={() => onMonthChange(nextMonth)}
          style={[styles.monthButton, nextDisabled && styles.monthButtonDisabled]}
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
          const key = calendarDayKey(day);
          const disabled = disabledDate?.(day) ?? false;
          const rangeStart = key === startKey;
          const rangeEnd = key === endKey;
          const boundary = rangeStart || rangeEnd;
          const singleSelected = key === selectedKey;
          const inRange = Boolean(
            selectedRangeStart &&
            selectedRangeEnd &&
            day > selectedRangeStart &&
            day < selectedRangeEnd,
          );
          const isSelected = boundary || singleSelected || inRange;
          const state = disabled
            ? 'disabled'
            : rangeStart
              ? 'selected, range start'
              : rangeEnd
                ? 'selected, range end'
                : inRange
                  ? 'selected, in range'
                  : singleSelected
                    ? 'selected'
                    : 'available';
          return (
            <View key={key} style={[styles.dayColumn, inRange && styles.rangeMiddle]}>
              <Pressable
                accessibilityLabel={`${day.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}, ${state}`}
                accessibilityRole="button"
                accessibilityState={{ disabled, selected: isSelected }}
                disabled={disabled}
                onPress={() => onSelect(day)}
                style={[
                  styles.dayButton,
                  key === todayKey && styles.today,
                  (boundary || singleSelected) && styles.rangeBoundary,
                  disabled && styles.dayDisabled,
                ]}
              >
                <Text
                  maxFontSizeMultiplier={1.25}
                  style={[
                    styles.dayText,
                    inRange && styles.rangeMiddleText,
                    (boundary || singleSelected) && styles.rangeBoundaryText,
                    disabled && styles.dayDisabledText,
                  ]}
                >
                  {day.getDate()}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.sm },
  dayButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 40,
  },
  dayColumn: { alignItems: 'center', justifyContent: 'center', width: '14.2857%' },
  dayDisabled: { opacity: 0.42 },
  dayDisabledText: { textDecorationLine: 'line-through' },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
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
  monthTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  monthTitleControl: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    justifyContent: 'center',
    minHeight: 44,
  },
  rangeBoundary: { backgroundColor: colors.primary },
  rangeBoundaryText: { color: colors.onPrimary },
  rangeMiddle: { backgroundColor: colors.primarySoft },
  rangeMiddleText: { fontWeight: '900', textDecorationLine: 'underline' },
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
