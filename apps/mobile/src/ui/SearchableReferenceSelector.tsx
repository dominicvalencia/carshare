import { useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';
import { Button, Icon, Screen } from './primitives';

export interface ReferenceOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export function SearchableReferenceSelector({
  allowAny = false,
  anyLabel = 'Any',
  label,
  options,
  value,
  onChange,
}: {
  readonly allowAny?: boolean;
  readonly anyLabel?: string;
  readonly label: string;
  readonly options: readonly ReferenceOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.id === value || option.name === value);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter(({ name }) => name.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);
  const select = (next: string) => {
    Keyboard.dismiss();
    onChange(next);
    setOpen(false);
    setSearch('');
  };
  const show = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'android') setTimeout(() => setOpen(true), 160);
    else setOpen(true);
  };
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={`${label}: ${selected?.name ?? (value || anyLabel)}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={show}
        style={styles.control}
      >
        <Text style={[styles.value, !selected && !value && styles.placeholder]}>
          {selected?.name ?? (value || anyLabel)}
        </Text>
        <Icon color={colors.primary} name="chevron-down" size={18} />
      </Pressable>
      <Modal
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        presentationStyle="pageSheet"
        visible={open}
      >
        <Screen scroll={false} title={`Select ${label.toLocaleLowerCase()}`}>
          <TextInput
            accessibilityLabel={`Search ${label.toLocaleLowerCase()}`}
            autoFocus={false}
            autoCapitalize="words"
            onChangeText={setSearch}
            placeholder={`Search ${label.toLocaleLowerCase()}`}
            placeholderTextColor={colors.placeholder}
            style={styles.search}
            value={search}
          />
          {allowAny && <Option checked={!value} label={anyLabel} onPress={() => select('')} />}
          <FlatList
            contentContainerStyle={styles.listContent}
            data={filtered}
            style={styles.list}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => (
              <Option
                checked={item.id === value || item.name === value}
                label={item.name}
                onPress={() => select(item.id)}
              />
            )}
          />
          <Button
            label="Cancel"
            onPress={() => {
              Keyboard.dismiss();
              setOpen(false);
            }}
            variant="ghost"
          />
        </Screen>
      </Modal>
    </View>
  );
}

function Option({
  checked,
  label,
  onPress,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={styles.option}
    >
      <Text style={styles.value}>{label}</Text>
      {checked && <Icon color={colors.primary} name="checkmark-circle" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
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
  field: { gap: spacing.xs },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  list: { flex: 1 },
  listContent: { flexGrow: 1 },
  option: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.xs,
  },
  placeholder: { color: colors.subtleText },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  value: { color: colors.ink, flex: 1, fontSize: 15 },
});
