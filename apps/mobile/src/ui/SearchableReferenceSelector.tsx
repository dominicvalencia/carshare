import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius, spacing } from '../theme/tokens';
import { adaptiveSheetLayout } from './adaptive-sheet-layout';
import { Button, Icon } from './primitives';

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
  const [headerHeight, setHeaderHeight] = useState(0);
  const [listContentHeight, setListContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const selected = options.find((option) => option.id === value || option.name === value);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter(({ name }) => name.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);
  const bottomAllowance = Math.max(safeArea.bottom, spacing.lg);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: listContentHeight,
        headerHeight: headerHeight + footerHeight,
        maxSafeViewportHeight: maximumHeight,
        // The measured footer includes the sheet's bottom safe-area padding.
        safeAreaAllowance: 0,
      }),
    [footerHeight, headerHeight, listContentHeight, maximumHeight],
  );
  const sheetHeight = useSharedValue(Math.min(320, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!open || headerHeight <= 0 || listContentHeight <= 0 || footerHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [
    filtered.length,
    footerHeight,
    headerHeight,
    listContentHeight,
    measuredLayout.height,
    open,
    sheetHeight,
    viewportHeight,
  ]);

  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
  };
  const select = (next: string) => {
    onChange(next);
    close();
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
        animationType="fade"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}
        >
          <View style={styles.backdrop} />
          <Reanimated.View accessibilityViewIsModal style={[styles.sheet, animatedSheetStyle]}>
            <View
              onLayout={({ nativeEvent }) => setHeaderHeight(nativeEvent.layout.height)}
              style={styles.header}
            >
              <Text accessibilityRole="header" style={styles.title}>
                Select {label.toLocaleLowerCase()}
              </Text>
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
            </View>
            <ScrollView
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={styles.listContent}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              onContentSizeChange={(_width, height) => setListContentHeight(height)}
              scrollEnabled={measuredLayout.scrollEnabled}
              style={styles.list}
              showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
            >
              <View accessibilityRole="radiogroup" style={styles.options}>
                {allowAny && (
                  <Option checked={!value} label={anyLabel} onPress={() => select('')} />
                )}
                {filtered.map((item, index) => (
                  <Option
                    key={item.id}
                    checked={item.id === value || item.name === value}
                    divider={index < filtered.length - 1}
                    label={item.name}
                    onPress={() => select(item.id)}
                  />
                ))}
              </View>
            </ScrollView>
            <View
              onLayout={({ nativeEvent }) => setFooterHeight(nativeEvent.layout.height)}
              style={[styles.footer, { paddingBottom: bottomAllowance }]}
            >
              <Button label="Cancel" onPress={close} variant="secondary" />
            </View>
          </Reanimated.View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Option({
  checked,
  divider = true,
  label,
  onPress,
}: {
  readonly checked: boolean;
  readonly divider?: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.option, divider && styles.optionDivider]}
    >
      <Text style={styles.optionLabel}>{label}</Text>
      {checked && <Icon color={colors.primary} name="checkmark-circle" size={22} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
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
  footer: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  list: { flex: 1, marginHorizontal: spacing.xl, marginTop: spacing.sm },
  listContent: { flexGrow: 0, paddingBottom: spacing.sm },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  option: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  optionDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  optionLabel: { color: colors.ink, flex: 1, fontSize: 16, fontWeight: '700' },
  options: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  placeholder: { color: colors.subtleText },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  value: { color: colors.ink, flex: 1, fontSize: 15 },
});
