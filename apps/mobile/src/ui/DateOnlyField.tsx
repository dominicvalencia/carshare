import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Button, Icon } from './primitives';

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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => parseDate(value));
  const show = () => {
    setDraft(parseDate(value));
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
          {...(maximumDate ? { maximumDate } : {})}
          {...(minimumDate ? { minimumDate } : {})}
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
            <DateTimePicker
              {...(maximumDate ? { maximumDate } : {})}
              {...(minimumDate ? { minimumDate } : {})}
              display="inline"
              mode="date"
              onChange={(_, selected) => selected && setDraft(selected)}
              value={draft}
            />
            <Button
              label="Use this date"
              onPress={() => {
                onChange(canonicalDate(draft));
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
});
