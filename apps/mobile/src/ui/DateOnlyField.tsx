import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../theme/tokens';
import { adaptiveSheetLayout } from './adaptive-sheet-layout';
import { CalendarMonth } from './CalendarMonth';
import { BackControl, Button, Icon } from './primitives';
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
  const [month, setMonth] = useState(() => monthStart(draft));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [yearPageStart, setYearPageStart] = useState(() => draft.getFullYear() - 5);
  const [contentHeight, setContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bottomAllowance = Math.max(safeArea.bottom, spacing.md);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        safeAreaAllowance: bottomAllowance,
      }),
    [bottomAllowance, contentHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(560, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  useEffect(() => {
    if (!open || contentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [contentHeight, measuredLayout.height, open, sheetHeight]);
  const show = () => {
    Keyboard.dismiss();
    const nextDraft = dateWithinBounds(parseDate(value), pickerMinimumDate, pickerMaximumDate);
    setDraft(nextDraft);
    setMonth(monthStart(nextDraft));
    setYearPageStart(nextDraft.getFullYear() - 5);
    setYearPickerOpen(false);
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
          animationType="fade"
          onRequestClose={() => setOpen(false)}
          presentationStyle="overFullScreen"
          statusBarTranslucent
          transparent
          visible={open}
        >
          <View style={styles.modalRoot}>
            <View style={styles.backdrop} />
            <Reanimated.View style={[styles.sheet, animatedSheetStyle]}>
              <ScrollView
                contentContainerStyle={[styles.sheetContent, { paddingBottom: bottomAllowance }]}
                onContentSizeChange={(_width, height) => setContentHeight(height)}
                scrollEnabled={measuredLayout.scrollEnabled}
                showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
              >
                <BackControl label="Back" onPress={() => setOpen(false)} />
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  {label.replace(' *', '')}
                </Text>
                {yearPickerOpen ? (
                  <YearPicker
                    {...(pickerMaximumDate ? { maximumYear: pickerMaximumDate.getFullYear() } : {})}
                    {...(pickerMinimumDate ? { minimumYear: pickerMinimumDate.getFullYear() } : {})}
                    pageStart={yearPageStart}
                    selectedYear={month.getFullYear()}
                    onPageChange={setYearPageStart}
                    onSelect={(year) => {
                      setMonth(new Date(year, month.getMonth(), 1, 12));
                      setYearPickerOpen(false);
                    }}
                  />
                ) : (
                  <CalendarMonth
                    disabledDate={(day) =>
                      Boolean(
                        (pickerMinimumDate && day < pickerMinimumDate) ||
                        (pickerMaximumDate && day > pickerMaximumDate),
                      )
                    }
                    {...(pickerMaximumDate ? { maximumDate: pickerMaximumDate } : {})}
                    {...(pickerMinimumDate ? { minimumDate: pickerMinimumDate } : {})}
                    month={month}
                    onMonthChange={setMonth}
                    onSelect={(selected) => setDraft(normalizeDateOnly(selected))}
                    onTitlePress={() => {
                      setYearPageStart(month.getFullYear() - 5);
                      setYearPickerOpen(true);
                    }}
                    selected={draft}
                  />
                )}
                <Button
                  disabled={
                    Boolean(pickerMinimumDate && draft < pickerMinimumDate) ||
                    Boolean(pickerMaximumDate && draft > pickerMaximumDate)
                  }
                  label="Use this date"
                  onPress={() => {
                    onChange(
                      canonicalDate(dateWithinBounds(draft, pickerMinimumDate, pickerMaximumDate)),
                    );
                    setOpen(false);
                  }}
                />
              </ScrollView>
            </Reanimated.View>
          </View>
        </Modal>
      )}
    </View>
  );
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

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function YearPicker({
  maximumYear,
  minimumYear,
  onPageChange,
  onSelect,
  pageStart,
  selectedYear,
}: {
  readonly maximumYear?: number;
  readonly minimumYear?: number;
  readonly onPageChange: (year: number) => void;
  readonly onSelect: (year: number) => void;
  readonly pageStart: number;
  readonly selectedYear: number;
}) {
  const years = Array.from({ length: 12 }, (_, index) => pageStart + index);
  return (
    <View style={styles.yearPicker}>
      <View style={styles.yearPickerHeader}>
        <Button
          compact
          label="Earlier years"
          onPress={() => onPageChange(pageStart - 12)}
          variant="ghost"
        />
        <Text accessibilityRole="header" style={styles.yearPickerRange}>
          {pageStart}–{pageStart + 11}
        </Text>
        <Button
          compact
          label="Later years"
          onPress={() => onPageChange(pageStart + 12)}
          variant="ghost"
        />
      </View>
      <View style={styles.yearGrid}>
        {years.map((year) => {
          const disabled =
            (minimumYear !== undefined && year < minimumYear) ||
            (maximumYear !== undefined && year > maximumYear);
          const selected = year === selectedYear;
          return (
            <Pressable
              accessibilityLabel={`${year}${selected ? ', selected' : ''}`}
              accessibilityRole="button"
              accessibilityState={{ disabled, selected }}
              disabled={disabled}
              key={year}
              onPress={() => onSelect(year)}
              style={[
                styles.yearOption,
                selected && styles.yearOptionSelected,
                disabled && styles.yearOptionDisabled,
              ]}
            >
              <Text style={[styles.yearOptionText, selected && styles.yearOptionTextSelected]}>
                {year}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parseDate(value));
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  error: { color: colors.danger, fontSize: 12 },
  field: { gap: spacing.xs },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
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
  yearGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  yearOption: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 44,
    width: '23%',
  },
  yearOptionDisabled: { opacity: 0.35 },
  yearOptionSelected: { backgroundColor: colors.primary },
  yearOptionText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  yearOptionTextSelected: { color: colors.onPrimary },
  yearPicker: { gap: spacing.sm },
  yearPickerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  yearPickerRange: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  sheetContent: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
});
