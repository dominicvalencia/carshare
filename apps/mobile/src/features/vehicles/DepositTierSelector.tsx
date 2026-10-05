import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius, spacing } from '../../theme/tokens';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { Button, Icon } from '../../ui/primitives';

export interface DepositTierOption {
  readonly label: string;
  readonly value: number;
}

export function DepositTierSelector({
  onChange,
  options,
  value,
}: {
  readonly onChange: (value: number) => void;
  readonly options: readonly DepositTierOption[];
  readonly value: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bottomAllowance = Math.max(safeArea.bottom, spacing.lg);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const selected = options.find((option) => option.value === value);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: measuredContentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        // The measured ScrollView content already includes its safe-area padding.
        safeAreaAllowance: 0,
      }),
    [maximumHeight, measuredContentHeight],
  );
  const sheetHeight = useSharedValue(Math.min(320, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));

  useEffect(() => {
    if (!open || measuredContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [measuredContentHeight, measuredLayout.height, open, options, sheetHeight, viewportHeight]);

  const close = () => setOpen(false);
  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>Deposit amount</Text>
        <Pressable
          accessibilityLabel={`Deposit amount: ${selected?.label ?? 'Select amount'}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={styles.control}
        >
          <Text style={styles.value}>{selected?.label ?? 'Select amount'}</Text>
          <Icon color={colors.primary} name="chevron-down" size={18} />
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={close}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={open}
      >
        <View style={styles.modalRoot}>
          <View style={styles.backdrop} />
          <Reanimated.View accessibilityViewIsModal style={[styles.sheet, animatedSheetStyle]}>
            <ScrollView
              contentContainerStyle={[styles.sheetContent, { paddingBottom: bottomAllowance }]}
              nestedScrollEnabled
              onContentSizeChange={(_width, height) => setMeasuredContentHeight(height)}
              scrollEnabled={measuredLayout.scrollEnabled}
              showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
            >
              <Text accessibilityRole="header" style={styles.title}>
                Select deposit amount
              </Text>
              <View accessibilityLabel="Deposit amount options" style={styles.options}>
                {options.map((option, index) => {
                  const checked = option.value === value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityLabel={option.label}
                      accessibilityRole="radio"
                      accessibilityState={{ checked }}
                      onPress={() => {
                        onChange(option.value);
                        close();
                      }}
                      style={[styles.option, index < options.length - 1 && styles.optionDivider]}
                    >
                      <Text style={styles.optionLabel}>{option.label}</Text>
                      {checked && <Icon color={colors.primary} name="checkmark-circle" size={22} />}
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.cancelAction}>
                <Button label="Cancel" onPress={close} variant="secondary" />
              </View>
            </ScrollView>
          </Reanimated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  cancelAction: { marginTop: spacing.md },
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
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  sheetContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  title: { color: colors.ink, fontSize: 21, fontWeight: '900' },
  value: { color: colors.ink, flex: 1, fontSize: 15 },
});
