import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { colors, radius, spacing } from '../../theme/tokens';
import { money } from '../../ui/format';

export function PriceRangeSlider({
  bounds,
  maximum,
  minimum,
  onChange,
}: {
  readonly bounds: { readonly minMinor: number; readonly maxMinor: number };
  readonly maximum: number;
  readonly minimum: number;
  readonly onChange: (minimum: number, maximum: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [displayedPrices, setDisplayedPrices] = useState({ minimum, maximum });
  const [minimumInput, setMinimumInput] = useState(String(minimum));
  const [maximumInput, setMaximumInput] = useState(String(maximum));
  const lower = Math.round(bounds.minMinor / 100);
  const upper = Math.round(bounds.maxMinor / 100);
  const span = Math.max(1, upper - lower);
  const minimumProgress = useSharedValue((minimum - lower) / span);
  const maximumProgress = useSharedValue((maximum - lower) / span);
  const minimumStart = useSharedValue(0);
  const maximumStart = useSharedValue(1);

  const commitProgress = (minimumValue: number, maximumValue: number) => {
    onChange(Math.round(lower + minimumValue * span), Math.round(lower + maximumValue * span));
  };
  const updateDisplayedPrices = (minimumValue: number, maximumValue: number) => {
    const nextMinimum = Math.round(lower + minimumValue * span);
    const nextMaximum = Math.round(lower + maximumValue * span);
    setDisplayedPrices({ minimum: nextMinimum, maximum: nextMaximum });
    setMinimumInput(String(nextMinimum));
    setMaximumInput(String(nextMaximum));
  };
  const updateFromInput = (target: 'minimum' | 'maximum', text: string) => {
    const digits = text.replace(/\D/g, '');
    if (target === 'minimum') setMinimumInput(digits);
    else setMaximumInput(digits);
    if (!digits) return;
    const entered = Number(digits);
    const currentMinimum = Math.round(lower + minimumProgress.value * span);
    const currentMaximum = Math.round(lower + maximumProgress.value * span);
    if (target === 'minimum') {
      const nextMinimum = Math.min(currentMaximum, Math.max(lower, entered));
      minimumProgress.value = (nextMinimum - lower) / span;
      setDisplayedPrices((current) => ({ ...current, minimum: nextMinimum }));
    } else {
      const nextMaximum = Math.max(currentMinimum, Math.min(upper, entered));
      maximumProgress.value = (nextMaximum - lower) / span;
      setDisplayedPrices((current) => ({ ...current, maximum: nextMaximum }));
    }
  };
  const commitInput = () => {
    setMinimumInput(String(displayedPrices.minimum));
    setMaximumInput(String(displayedPrices.maximum));
    onChange(displayedPrices.minimum, displayedPrices.maximum);
  };
  const minimumGesture = Gesture.Pan()
    .activeOffsetX([-2, 2])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      minimumStart.value = minimumProgress.value;
    })
    .onUpdate(({ translationX }) => {
      if (trackWidth <= 0) return;
      minimumProgress.value = Math.min(
        maximumProgress.value,
        Math.max(0, minimumStart.value + translationX / trackWidth),
      );
      runOnJS(updateDisplayedPrices)(minimumProgress.value, maximumProgress.value);
    })
    .onEnd(() => {
      runOnJS(commitProgress)(minimumProgress.value, maximumProgress.value);
    });
  const maximumGesture = Gesture.Pan()
    .activeOffsetX([-2, 2])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      maximumStart.value = maximumProgress.value;
    })
    .onUpdate(({ translationX }) => {
      if (trackWidth <= 0) return;
      maximumProgress.value = Math.max(
        minimumProgress.value,
        Math.min(1, maximumStart.value + translationX / trackWidth),
      );
      runOnJS(updateDisplayedPrices)(minimumProgress.value, maximumProgress.value);
    })
    .onEnd(() => {
      runOnJS(commitProgress)(minimumProgress.value, maximumProgress.value);
    });
  const minimumThumbStyle = useAnimatedStyle(() => ({
    left: `${minimumProgress.value * 100}%`,
  }));
  const maximumThumbStyle = useAnimatedStyle(() => ({
    left: `${maximumProgress.value * 100}%`,
  }));
  const selectionStyle = useAnimatedStyle(() => ({
    left: `${minimumProgress.value * 100}%`,
    width: `${(maximumProgress.value - minimumProgress.value) * 100}%`,
  }));
  const adjust = (target: 'minimum' | 'maximum', direction: -1 | 1) => {
    const increment = Math.max(1, Math.round(span / 20));
    if (target === 'minimum')
      onChange(Math.min(maximum, Math.max(lower, minimum + increment * direction)), maximum);
    else onChange(minimum, Math.max(minimum, Math.min(upper, maximum + increment * direction)));
  };

  return (
    <View accessibilityLabel="Daily price range" style={styles.container}>
      <View
        onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
        style={styles.track}
      >
        <View style={styles.rail} />
        <Reanimated.View style={[styles.selection, selectionStyle]} />
        <GestureDetector gesture={minimumGesture}>
          <Reanimated.View
            accessibilityActions={[
              { name: 'decrement', label: 'Decrease minimum price' },
              { name: 'increment', label: 'Increase minimum price' },
            ]}
            accessibilityLabel={`Minimum price ${money(minimum * 100, 'PHP')}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ max: upper, min: lower, now: minimum }}
            hitSlop={12}
            onAccessibilityAction={({ nativeEvent }) =>
              adjust('minimum', nativeEvent.actionName === 'increment' ? 1 : -1)
            }
            style={[styles.thumb, minimumThumbStyle]}
          />
        </GestureDetector>
        <GestureDetector gesture={maximumGesture}>
          <Reanimated.View
            accessibilityActions={[
              { name: 'decrement', label: 'Decrease maximum price' },
              { name: 'increment', label: 'Increase maximum price' },
            ]}
            accessibilityLabel={`Maximum price ${money(maximum * 100, 'PHP')}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ max: upper, min: lower, now: maximum }}
            hitSlop={12}
            onAccessibilityAction={({ nativeEvent }) =>
              adjust('maximum', nativeEvent.actionName === 'increment' ? 1 : -1)
            }
            style={[styles.thumb, maximumThumbStyle]}
          />
        </GestureDetector>
      </View>
      <View style={styles.fields}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Minimum</Text>
          <View style={styles.field}>
            <Text style={styles.currency}>₱</Text>
            <TextInput
              accessibilityLabel="Minimum daily price"
              keyboardType="number-pad"
              onBlur={commitInput}
              onChangeText={(text) => updateFromInput('minimum', text)}
              selectTextOnFocus
              style={styles.input}
              value={minimumInput}
            />
          </View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Maximum</Text>
          <View style={styles.field}>
            <Text style={styles.currency}>₱</Text>
            <TextInput
              accessibilityLabel="Maximum daily price"
              keyboardType="number-pad"
              onBlur={commitInput}
              onChangeText={(text) => updateFromInput('maximum', text)}
              selectTextOnFocus
              style={styles.input}
              value={maximumInput}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingVertical: spacing.sm },
  currency: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    left: spacing.xs,
    position: 'absolute',
  },
  field: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    height: 44,
    paddingHorizontal: spacing.xs,
  },
  fieldGroup: { gap: spacing.xs, width: 96 },
  fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  fields: { flexDirection: 'row', justifyContent: 'space-between' },
  input: { color: colors.ink, flex: 1, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  rail: {
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 20,
  },
  selection: {
    backgroundColor: colors.primary,
    height: 4,
    position: 'absolute',
    top: 20,
  },
  thumb: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 44,
    position: 'absolute',
    top: 0,
    transform: [{ translateX: -22 }],
    width: 44,
  },
  track: { height: 44, justifyContent: 'center', marginHorizontal: spacing.md },
});
