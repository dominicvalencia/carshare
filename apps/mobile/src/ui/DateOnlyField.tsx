import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Button, Icon } from './primitives';
import { dateWithinBounds, normalizeDateOnly } from './date-only';

export function DateOnlyField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  error,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (canonicalDate: string) => void;
  readonly minimumDate?: Date;
  readonly maximumDate?: Date;
  readonly error?: string;
}) {
  // Native date pickers compare complete timestamps even in date-only mode. Normalize
  // every prop so a freshly calculated bound cannot drift milliseconds past `value`.
  const pickerMinimumDate = minimumDate ? normalizeDateOnly(minimumDate) : undefined;
  const candidateMaximumDate = maximumDate ? normalizeDateOnly(maximumDate) : undefined;
  const pickerMaximumDate =
    candidateMaximumDate && (!pickerMinimumDate || candidateMaximumDate >= pickerMinimumDate)
      ? candidateMaximumDate
      : undefined;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() =>
    dateWithinBounds(parseDate(value), pickerMinimumDate, pickerMaximumDate),
  );
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(draft));
  const show = () => {
    Keyboard.dismiss();
    const nextDraft = dateWithinBounds(parseDate(value), pickerMinimumDate, pickerMaximumDate);
    setDraft(nextDraft);
    setVisibleMonth(monthStart(nextDraft));
    setOpen(true);
  };
  const androidChange = (event: DateTimePickerEvent, selected?: Date) => {
    setOpen(false);
    if (event.type === 'set' && selected) onChange(canonicalDate(selected));
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={show}
        style={[styles.value, Boolean(error) && styles.valueError]}
      >
        <Text style={[styles.valueText, !value && styles.placeholder]}>
          {value ? readableDate(value) : 'Select date'}
        </Text>
        <Icon color={colors.primary} name="calendar-outline" size={20} />
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          {...(pickerMaximumDate ? { maximumDate: pickerMaximumDate } : {})}
          {...(pickerMinimumDate ? { minimumDate: pickerMinimumDate } : {})}
          mode="date"
          onChange={androidChange}
          value={draft}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal
          animationType="slide"
          onRequestClose={() => setOpen(false)}
          presentationStyle="pageSheet"
          visible={open}
        >
          <View style={styles.modal}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{label}</Text>
            <BoundedCalendar
              {...(pickerMaximumDate ? { maximumDate: pickerMaximumDate } : {})}
              {...(pickerMinimumDate ? { minimumDate: pickerMinimumDate } : {})}
              onChange={setDraft}
              onVisibleMonthChange={setVisibleMonth}
              selected={draft}
              visibleMonth={visibleMonth}
            />
            <Button
              label="Use this date"
              onPress={() => {
                onChange(
                  canonicalDate(dateWithinBounds(draft, pickerMinimumDate, pickerMaximumDate)),
                );
                setOpen(false);
              }}
            />
            <Button label="Cancel" onPress={() => setOpen(false)} variant="ghost" />
          </View>
        </Modal>
      )}
    </View>
  );
}

function BoundedCalendar({
  selected,
  visibleMonth,
  minimumDate,
  maximumDate,
  onChange,
  onVisibleMonthChange,
}: {
  readonly selected: Date;
  readonly visibleMonth: Date;
  readonly minimumDate?: Date;
  readonly maximumDate?: Date;
  readonly onChange: (date: Date) => void;
  readonly onVisibleMonthChange: (date: Date) => void;
}) {
  const [choosingYear, setChoosingYear] = useState(false);
  const previousMonth = addMonths(visibleMonth, -1);
  const nextMonth = addMonths(visibleMonth, 1);
  const previousDisabled = Boolean(minimumDate && monthEnd(previousMonth) < minimumDate);
  const nextDisabled = Boolean(maximumDate && nextMonth > maximumDate);
  const slots = calendarSlots(visibleMonth);

  return (
    <View style={styles.calendar}>
      <View style={styles.calendarHeader}>
        <Pressable
          accessibilityLabel="Previous month"
          disabled={previousDisabled}
          onPress={() => onVisibleMonthChange(previousMonth)}
          style={styles.monthButton}
        >
          <Icon
            color={previousDisabled ? colors.subtleText : colors.primary}
            name="chevron-back"
            size={22}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="Choose year"
          onPress={() => setChoosingYear((current) => !current)}
          style={styles.monthTitleButton}
        >
          <Text style={styles.monthTitle}>
            {new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(
              visibleMonth,
            )}
          </Text>
          <Icon color={colors.primary} name="chevron-down" size={18} />
        </Pressable>
        <Pressable
          accessibilityLabel="Next month"
          disabled={nextDisabled}
          onPress={() => onVisibleMonthChange(nextMonth)}
          style={styles.monthButton}
        >
          <Icon
            color={nextDisabled ? colors.subtleText : colors.primary}
            name="chevron-forward"
            size={22}
          />
        </Pressable>
      </View>
      {choosingYear ? (
        <ScrollView
          contentContainerStyle={styles.yearGrid}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator
          style={styles.yearScroller}
        >
          {calendarYears(minimumDate, maximumDate).map((year) => {
            const selectedYear = year === visibleMonth.getFullYear();
            return (
              <Pressable
                accessibilityLabel={`Select year ${year}`}
                accessibilityState={{ selected: selectedYear }}
                key={year}
                onPress={() => {
                  onVisibleMonthChange(new Date(year, visibleMonth.getMonth(), 1, 12));
                  setChoosingYear(false);
                }}
                style={[styles.yearCell, selectedYear && styles.daySelected]}
              >
                <Text style={[styles.dayText, selectedYear && styles.daySelectedText]}>{year}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <>
          <View style={styles.weekRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
              <Text key={`${day}-${index}`} style={styles.weekday}>
                {day}
              </Text>
            ))}
          </View>
          <View style={styles.days}>
            {slots.map((date, index) => {
              if (!date) return <View key={`empty-${index}`} style={styles.dayCell} />;
              const disabled =
                Boolean(minimumDate && date < minimumDate) ||
                Boolean(maximumDate && date > maximumDate);
              const selectedDay = sameDay(date, selected);
              return (
                <Pressable
                  accessibilityLabel={new Intl.DateTimeFormat('en-PH', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(date)}
                  accessibilityState={{ disabled, selected: selectedDay }}
                  disabled={disabled}
                  key={canonicalDate(date)}
                  onPress={() => onChange(date)}
                  style={[styles.dayCell, selectedDay && styles.daySelected]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      disabled && styles.dayDisabled,
                      selectedDay && styles.daySelectedText,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function monthEnd(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function calendarSlots(month: Date) {
  const leading = month.getDay();
  const days = monthEnd(month).getDate();
  return Array.from({ length: leading + days }, (_, index) =>
    index < leading
      ? null
      : new Date(month.getFullYear(), month.getMonth(), index - leading + 1, 12),
  );
}

function sameDay(left: Date, right: Date) {
  return canonicalDate(left) === canonicalDate(right);
}

function calendarYears(minimumDate?: Date, maximumDate?: Date) {
  const currentYear = new Date().getFullYear();
  const first = minimumDate?.getFullYear() ?? currentYear - 120;
  const last = maximumDate?.getFullYear() ?? currentYear + 20;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year!, month! - 1, day!, 12, 0, 0, 0);
}

function canonicalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parseDate(value));
}

const styles = StyleSheet.create({
  calendar: { gap: spacing.sm, paddingVertical: spacing.md },
  calendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCell: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: '14.2857%',
  },
  dayDisabled: { color: colors.subtleText },
  daySelected: { backgroundColor: colors.primary },
  daySelectedText: { color: colors.surface },
  dayText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  days: { flexDirection: 'row', flexWrap: 'wrap' },
  error: { color: colors.danger, fontSize: 12 },
  field: { gap: spacing.xs },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: 3,
    height: 5,
    marginBottom: spacing.lg,
    width: 42,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  modal: { backgroundColor: colors.background, flex: 1, padding: spacing.lg },
  modalTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  monthButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, width: 44 },
  monthTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  monthTitleButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
  },
  placeholder: { color: colors.subtleText, fontWeight: '500' },
  value: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  valueError: { borderColor: colors.danger },
  valueText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  weekday: {
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    width: '14.2857%',
  },
  weekRow: { flexDirection: 'row' },
  yearCell: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    width: '25%',
  },
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  yearScroller: { maxHeight: 360 },
});
