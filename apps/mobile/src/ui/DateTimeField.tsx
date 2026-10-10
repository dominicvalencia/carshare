import DateTimePicker, {
  type DateTimePickerEvent,
  type IOSNativeProps,
} from '@react-native-community/datetimepicker';
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
import { dateLabel, timeLabel } from './format';
import { BackControl, Button, Icon } from './primitives';

export function DateTimeField({
  compact = false,
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  mode = 'dateTime',
  dismissLabel = 'Cancel',
  minuteInterval,
  hasValue = true,
  placeholder = 'Select time',
  accessibilityHint,
  helperText,
  actionLabel,
}: {
  readonly compact?: boolean;
  readonly label: string;
  readonly value: Date;
  readonly onChange: (value: Date) => void;
  readonly minimumDate?: Date;
  readonly maximumDate?: Date;
  readonly mode?: 'dateTime' | 'time';
  readonly dismissLabel?: string;
  readonly minuteInterval?: IOSNativeProps['minuteInterval'];
  readonly hasValue?: boolean;
  readonly placeholder?: string;
  readonly accessibilityHint?: string;
  readonly helperText?: string;
  readonly actionLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [androidMode, setAndroidMode] = useState<'date' | 'time'>('date');
  const [draft, setDraft] = useState(value);
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
        safeAreaAllowance: 0,
      }),
    [contentHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(mode === 'time' ? 420 : 720, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  useEffect(() => {
    if (!open || contentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [contentHeight, measuredLayout.height, open, sheetHeight]);
  const show = () => {
    Keyboard.dismiss();
    setDraft(value);
    setAndroidMode(mode === 'time' ? 'time' : 'date');
    setOpen(true);
  };
  const androidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed' || !selected) {
      setOpen(false);
      return;
    }
    if (mode === 'dateTime' && androidMode === 'date') {
      const next = new Date(selected);
      next.setHours(draft.getHours(), draft.getMinutes(), 0, 0);
      setDraft(next);
      setAndroidMode('time');
      return;
    }
    const next = new Date(draft);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    onChange(next);
    setOpen(false);
  };
  return (
    <View
      style={[
        styles.field,
        compact && styles.compactField,
        actionLabel ? styles.actionField : null,
      ]}
    >
      {!actionLabel ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        accessibilityHint={accessibilityHint}
        accessibilityLabel={`${actionLabel ? `${actionLabel}, ` : ''}${label}: ${
          hasValue ? timeLabel(value) : placeholder
        }`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={show}
        style={actionLabel ? styles.action : [styles.value, compact && styles.compactValue]}
      >
        {actionLabel ? (
          <Text style={styles.actionText}>{actionLabel}</Text>
        ) : (
          <>
            <View style={styles.valueCopy}>
              {mode === 'dateTime' && (
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  numberOfLines={1}
                  style={styles.date}
                >
                  {dateLabel(value)}
                </Text>
              )}
              <Text numberOfLines={1} style={[styles.time, !hasValue && styles.placeholder]}>
                {hasValue ? timeLabel(value) : placeholder}
              </Text>
            </View>
            <View style={styles.calendarIcon}>
              <Icon
                color={colors.primary}
                name={mode === 'time' ? 'time-outline' : 'calendar-outline'}
                size={20}
              />
            </View>
          </>
        )}
      </Pressable>
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          {...(minimumDate ? { minimumDate } : {})}
          {...(maximumDate ? { maximumDate } : {})}
          mode={androidMode}
          {...(androidMode === 'time' && minuteInterval ? { minuteInterval } : {})}
          onChange={androidChange}
          value={draft}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal
          animationType="slide"
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
                <View style={styles.sheetHeader}>
                  <BackControl label={dismissLabel} onPress={() => setOpen(false)} />
                  <Text accessibilityRole="header" style={styles.modalTitle}>
                    {label}
                  </Text>
                </View>
                {mode === 'dateTime' && (
                  <>
                    <Text style={styles.pickerLabel}>Date</Text>
                    <DateTimePicker
                      {...(minimumDate ? { minimumDate } : {})}
                      {...(maximumDate ? { maximumDate } : {})}
                      display="spinner"
                      mode="date"
                      onChange={(_, selected) => {
                        if (!selected) return;
                        const next = new Date(selected);
                        next.setHours(draft.getHours(), draft.getMinutes(), 0, 0);
                        setDraft(next);
                      }}
                      value={draft}
                      themeVariant="light"
                    />
                  </>
                )}
                <View style={mode === 'time' ? styles.timePickerFrame : undefined}>
                  <DateTimePicker
                    {...(minimumDate ? { minimumDate } : {})}
                    {...(maximumDate ? { maximumDate } : {})}
                    display="spinner"
                    {...(minuteInterval ? { minuteInterval } : {})}
                    mode="time"
                    onChange={(_, selected) => {
                      if (!selected) return;
                      const next = new Date(draft);
                      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                      setDraft(next);
                    }}
                    value={draft}
                    themeVariant="light"
                  />
                </View>
                <View style={styles.sheetActions}>
                  {helperText ? <Text style={styles.pickerHelper}>{helperText}</Text> : null}
                  <Button
                    label="Done"
                    onPress={() => {
                      onChange(draft);
                      setOpen(false);
                    }}
                  />
                </View>
              </ScrollView>
            </Reanimated.View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  actionField: { flexBasis: 0, flexGrow: 0, minWidth: 0 },
  actionText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  calendarIcon: { marginLeft: spacing.sm },
  compactField: { alignSelf: 'flex-start', flexBasis: 'auto', flexGrow: 0, minWidth: 156 },
  compactValue: { alignSelf: 'flex-start', minHeight: 50, minWidth: 156, paddingVertical: 0 },
  date: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  field: {
    flexBasis: 140,
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 140,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  pickerLabel: { color: colors.ink, fontSize: 13, fontWeight: '700', marginTop: spacing.sm },
  pickerHelper: { color: colors.subtleText, fontSize: 13, lineHeight: 18 },
  placeholder: { color: colors.placeholder },
  time: { color: colors.subtleText, fontSize: 13, marginTop: 2 },
  value: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  valueCopy: { flex: 1, minWidth: 0 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  sheetActions: { gap: spacing.sm },
  sheetContent: { gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sheetHeader: { gap: spacing.xs },
  timePickerFrame: {
    alignSelf: 'center',
    height: 216,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
});
