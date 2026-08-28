import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { dateLabel, timeLabel } from './format';
import { Button, Icon } from './primitives';

export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
}: {
  readonly label: string;
  readonly value: Date;
  readonly onChange: (value: Date) => void;
  readonly minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const [androidMode, setAndroidMode] = useState<'date' | 'time'>('date');
  const [draft, setDraft] = useState(value);
  const show = () => {
    setDraft(value);
    setAndroidMode('date');
    setOpen(true);
  };
  const androidChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type === 'dismissed' || !selected) {
      setOpen(false);
      return;
    }
    if (androidMode === 'date') {
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
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable accessibilityRole="button" onPress={show} style={styles.value}>
        <View style={styles.valueCopy}>
          <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.date}>
            {dateLabel(value)}
          </Text>
          <Text numberOfLines={1} style={styles.time}>
            {timeLabel(value)}
          </Text>
        </View>
        <View style={styles.calendarIcon}>
          <Icon color={colors.primary} name="calendar-outline" size={20} />
        </View>
      </Pressable>
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          {...(minimumDate ? { minimumDate } : {})}
          mode={androidMode}
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
              {...(minimumDate ? { minimumDate } : {})}
              display="inline"
              mode="date"
              onChange={(_, selected) =>
                selected &&
                setDraft(new Date(selected.setHours(draft.getHours(), draft.getMinutes(), 0, 0)))
              }
              value={draft}
            />
            <DateTimePicker
              display="spinner"
              mode="time"
              onChange={(_, selected) =>
                selected &&
                setDraft(new Date(draft.setHours(selected.getHours(), selected.getMinutes(), 0, 0)))
              }
              value={draft}
            />
            <Button
              label="Done"
              onPress={() => {
                onChange(draft);
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

const styles = StyleSheet.create({
  calendarIcon: { marginLeft: spacing.sm },
  date: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  field: {
    flexBasis: 140,
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 140,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: 3,
    height: 5,
    marginBottom: spacing.lg,
    width: 42,
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  modal: {
    backgroundColor: colors.background,
    flex: 1,
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  modalTitle: { color: colors.ink, fontSize: 24, fontWeight: '800' },
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
});
