import { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius, spacing } from '../../theme/tokens';
import { adaptiveSheetLayout } from '../../ui/adaptive-sheet-layout';
import { money } from '../../ui/format';
import { Button } from '../../ui/primitives';

export interface SecurityDepositInfo {
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly required: boolean;
}

export function SecurityDepositInfoSheet({
  deposit,
  executionAvailable,
  onDismiss,
  visible,
}: {
  readonly deposit: SecurityDepositInfo;
  readonly executionAvailable: boolean;
  readonly onDismiss: () => void;
  readonly visible: boolean;
}) {
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);
  const { height: viewportHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bottomAllowance = Math.max(safeArea.bottom, spacing.lg);
  const maximumHeight = viewportHeight - Math.max(safeArea.top, spacing.md);
  const measuredLayout = useMemo(
    () =>
      adaptiveSheetLayout({
        contentHeight: measuredContentHeight,
        headerHeight: 0,
        maxSafeViewportHeight: maximumHeight,
        // The measured content already includes the safe-area allowance.
        safeAreaAllowance: 0,
      }),
    [maximumHeight, measuredContentHeight],
  );
  const sheetHeight = useSharedValue(Math.min(deposit.required ? 520 : 300, maximumHeight));
  const animatedSheetStyle = useAnimatedStyle(() => ({ height: sheetHeight.value }));
  const currency = deposit.currency ?? 'PHP';
  const amount = deposit.amountMinor ?? 0;

  useEffect(() => {
    if (!visible || measuredContentHeight <= 0) return;
    // Reanimated shared values are intentionally mutable UI-thread animation state.
    // eslint-disable-next-line react-hooks/immutability
    sheetHeight.value = withTiming(measuredLayout.height, { duration: 220 });
  }, [deposit, measuredContentHeight, measuredLayout.height, sheetHeight, viewportHeight, visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <View style={styles.backdrop} />
        <Reanimated.View accessibilityViewIsModal style={[styles.sheet, animatedSheetStyle]}>
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: bottomAllowance }]}
            nestedScrollEnabled
            onContentSizeChange={(_width, height) => setMeasuredContentHeight(height)}
            scrollEnabled={measuredLayout.scrollEnabled}
            showsVerticalScrollIndicator={measuredLayout.scrollEnabled}
          >
            <Text accessibilityRole="header" style={styles.title}>
              Security deposit
            </Text>
            {deposit.required ? (
              <>
                <Text style={styles.amount}>{money(amount, currency)} refundable deposit</Text>
                <Text style={styles.body}>This deposit is separate from the rental price.</Text>
                <Text style={styles.body}>
                  CarShare may require this deposit before pickup. After the trip is cleared, the
                  deposit is released unless approved charges apply.
                </Text>
                <Text accessibilityRole="header" style={styles.examplesTitle}>
                  Examples of approved charges
                </Text>
                <View accessibilityRole="list" style={styles.examplesList}>
                  <Text style={styles.exampleItem}>{'\u2022'} Damage</Text>
                  <Text style={styles.exampleItem}>{'\u2022'} Late return</Text>
                  <Text style={styles.exampleItem}>
                    {'\u2022'} Other eligible trip-related costs
                  </Text>
                </View>
                {!executionAvailable && (
                  <Text style={styles.infoNote}>
                    Deposit processing isn’t active yet. No hold will be placed and pickup won’t be
                    blocked.
                  </Text>
                )}
                <Text style={styles.policyNote}>
                  Security deposits are handled through CarShare. Owners should not ask renters to
                  pay a separate cash or off-platform deposit.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.noDeposit}>No security deposit required</Text>
                <Text style={styles.body}>No deposit will be held for this booking.</Text>
              </>
            )}
            <View style={styles.dismissAction}>
              <Button label="Got it" onPress={onDismiss} />
            </View>
          </ScrollView>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  amount: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: spacing.md },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8, 24, 18, 0.32)',
  },
  body: { color: colors.subtleText, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  dismissAction: { marginTop: spacing.md },
  exampleItem: { color: colors.subtleText, fontSize: 15, lineHeight: 22 },
  examplesList: { gap: spacing.xxs, marginTop: spacing.xs },
  examplesTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  infoNote: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    color: colors.subtleText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  noDeposit: { color: colors.ink, fontSize: 18, fontWeight: '900', marginTop: spacing.md },
  policyNote: {
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.subtleText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  title: { color: colors.ink, fontSize: 24, fontWeight: '900' },
});
