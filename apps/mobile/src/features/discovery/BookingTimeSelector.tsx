import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { DateTimeField } from '../../ui/DateTimeField';
import {
  BOOKING_TIME_INCREMENT_MINUTES,
  isBookingTimeAligned,
  isBookingTimeSlotSelectable,
} from './trip-date-policy';

export function BookingTimeSelector({
  established = true,
  label = 'Trip time',
  actionLabel,
  hideValidationError = false,
  minimumNoticeMinutes = 0,
  onChange,
  onValidationErrorChange,
  onValidityChange,
  pickupDate,
  value,
}: {
  readonly established?: boolean;
  readonly label?: string;
  readonly actionLabel?: string;
  readonly hideValidationError?: boolean;
  readonly minimumNoticeMinutes?: number;
  readonly onChange: (value: Date) => void;
  readonly onValidationErrorChange?: (message: string) => void;
  readonly onValidityChange?: (valid: boolean) => void;
  readonly pickupDate: Date;
  readonly value: Date;
}) {
  const [validationError, setValidationError] = useState('');

  function updateValidation(message: string) {
    setValidationError(message);
    onValidationErrorChange?.(message);
    onValidityChange?.(!message);
  }

  function selectTime(selected: Date) {
    if (!isBookingTimeAligned(selected)) {
      updateValidation('Choose a time on the hour or half hour.');
      return;
    }
    const minutes = selected.getHours() * 60 + selected.getMinutes();
    if (!isBookingTimeSlotSelectable(pickupDate, minutes, new Date(), minimumNoticeMinutes)) {
      updateValidation(
        minimumNoticeMinutes > 0
          ? "Choose a later time that meets the vehicle's preparation window."
          : "Choose a later time for today's pickup.",
      );
      return;
    }
    updateValidation('');
    onChange(selected);
  }

  return (
    <View style={styles.container}>
      <DateTimeField
        accessibilityHint={validationError || 'Opens the native time picker'}
        {...(actionLabel ? { actionLabel } : {})}
        dismissLabel="Cancel"
        hasValue={established}
        helperText="The same time applies to pickup and return."
        label={label}
        minuteInterval={BOOKING_TIME_INCREMENT_MINUTES}
        mode="time"
        placeholder="Select time"
        value={value}
        onChange={selectTime}
      />
      {validationError && !hideValidationError ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {validationError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 1, gap: spacing.xs, minWidth: 0 },
  error: { color: colors.danger, flexShrink: 1, fontSize: 12, lineHeight: 18 },
});
