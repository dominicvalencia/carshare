import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { colors, radius, spacing } from '../../theme/tokens';

const maximumSeats = 20;

export function MinimumSeatsSlider({
  onChange,
  value,
}: {
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const initialSeats = value ? Number(value) : 0;
  const [displayedSeats, setDisplayedSeats] = useState(initialSeats);
  const [trackWidth, setTrackWidth] = useState(0);
  const progress = useSharedValue(initialSeats / maximumSeats);
  const gestureStart = useSharedValue(progress.value);
  const updateDisplayedSeats = (nextProgress: number) =>
    setDisplayedSeats(Math.round(nextProgress * maximumSeats));
  const commitProgress = (nextProgress: number) => {
    const seats = Math.round(nextProgress * maximumSeats);
    onChange(seats === 0 ? '' : String(seats));
  };
  const gesture = Gesture.Pan()
    .activeOffsetX([-2, 2])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      gestureStart.value = progress.value;
    })
    .onUpdate(({ translationX }) => {
      if (trackWidth <= 0) return;
      progress.value = Math.max(0, Math.min(1, gestureStart.value + translationX / trackWidth));
      runOnJS(updateDisplayedSeats)(progress.value);
    })
    .onEnd(() => {
      progress.value = Math.round(progress.value * maximumSeats) / maximumSeats;
      runOnJS(updateDisplayedSeats)(progress.value);
      runOnJS(commitProgress)(progress.value);
    });
  const thumbStyle = useAnimatedStyle(() => ({ left: `${progress.value * 100}%` }));
  const selectionStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const adjust = (direction: -1 | 1) => {
    const nextSeats = Math.max(0, Math.min(maximumSeats, initialSeats + direction));
    onChange(nextSeats === 0 ? '' : String(nextSeats));
  };

  return (
    <View style={styles.container}>
      <View style={styles.valueRow}>
        <Text style={styles.help}>Show cars with at least this many seats</Text>
        <Text style={styles.value}>{displayedSeats === 0 ? 'Any' : `${displayedSeats}+`}</Text>
      </View>
      <View
        onLayout={({ nativeEvent }) => setTrackWidth(nativeEvent.layout.width)}
        style={styles.track}
      >
        <View style={styles.rail} />
        <Reanimated.View style={[styles.selection, selectionStyle]} />
        <GestureDetector gesture={gesture}>
          <Reanimated.View
            accessibilityActions={[
              { name: 'decrement', label: 'Decrease minimum seats' },
              { name: 'increment', label: 'Increase minimum seats' },
            ]}
            accessibilityLabel={
              displayedSeats === 0 ? 'Any number of seats' : `Minimum ${displayedSeats} seats`
            }
            accessibilityRole="adjustable"
            accessibilityValue={{ max: maximumSeats, min: 0, now: displayedSeats }}
            hitSlop={12}
            onAccessibilityAction={({ nativeEvent }) =>
              adjust(nativeEvent.actionName === 'increment' ? 1 : -1)
            }
            style={[styles.thumb, thumbStyle]}
          />
        </GestureDetector>
      </View>
      <View style={styles.endLabels}>
        <Text style={styles.endLabel}>Any</Text>
        <Text style={styles.endLabel}>20+</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  endLabel: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  endLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  help: { color: colors.subtleText, flex: 1, fontSize: 13, lineHeight: 19 },
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
    left: 0,
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
  track: { height: 44, justifyContent: 'center' },
  value: { color: colors.ink, fontSize: 16, fontWeight: '900', minWidth: 44, textAlign: 'right' },
  valueRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
});
