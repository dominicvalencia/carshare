import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme/tokens';
import { Button } from '../../ui/primitives';
import { BookingTimeSelector } from './BookingTimeSelector';
import { timeLabel } from '../../ui/format';
import {
  isBookingTimeAligned,
  isBookingTimeSlotSelectable,
  tripDateSummary,
} from './trip-date-policy';

export function BookingDateTimeEditorSummary({
  end,
  onChangeDates,
  onChangeTime,
  onValidityChange,
  minimumNoticeMinutes = 0,
  start,
  timeEstablished = true,
}: {
  readonly end: Date;
  readonly onChangeDates: () => void;
  readonly onChangeTime: (value: Date) => void;
  readonly onValidityChange?: (valid: boolean) => void;
  readonly minimumNoticeMinutes?: number;
  readonly start: Date;
  readonly timeEstablished?: boolean;
}) {
  const [selectionError, setSelectionError] = useState('');
  const currentMinutes = start.getHours() * 60 + start.getMinutes();
  const currentValueError =
    !timeEstablished ||
    (isBookingTimeAligned(start) &&
      isBookingTimeSlotSelectable(start, currentMinutes, new Date(), minimumNoticeMinutes))
      ? ''
      : isBookingTimeAligned(start)
        ? minimumNoticeMinutes > 0
          ? "Choose a later time that meets the vehicle's preparation window."
          : "Choose a later time for today's pickup."
        : 'Choose a time on the hour or half hour.';
  const validationError = selectionError || currentValueError;

  return (
    <View style={styles.card}>
      <View accessibilityLiveRegion="polite" style={styles.summaryRow}>
        <Text style={styles.summary}>{tripDateSummary(start, end)}</Text>
        {timeEstablished ? (
          <Text style={styles.time}>· {timeLabel(start)}</Text>
        ) : (
          <View style={styles.incompleteSummary}>
            <Text style={styles.separator}>·</Text>
            <View accessibilityLabel="Select time, required" style={styles.warningTag}>
              <Text style={styles.warningTagText}>Select time</Text>
            </View>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <Button compact label="Change dates" onPress={onChangeDates} variant="secondary" />
        <BookingTimeSelector
          actionLabel={timeEstablished ? 'Change time' : 'Select time'}
          established={timeEstablished}
          hideValidationError
          label="Pickup & return time"
          minimumNoticeMinutes={minimumNoticeMinutes}
          pickupDate={start}
          value={start}
          onChange={onChangeTime}
          onValidationErrorChange={setSelectionError}
          {...(onValidityChange ? { onValidityChange } : {})}
        />
      </View>
      {validationError ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {validationError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  incompleteSummary: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  separator: {
    color: colors.subtleText,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 24,
  },
  summary: { color: colors.ink, fontSize: 17, fontWeight: '900', lineHeight: 24 },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  time: { color: colors.primaryDark, fontSize: 17, fontWeight: '900', lineHeight: 24 },
  warningTag: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  warningTagText: { color: colors.warning, fontSize: 13, fontWeight: '800', lineHeight: 18 },
});
