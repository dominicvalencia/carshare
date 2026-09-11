import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/tokens';
import { Button, Icon, type IconName } from '../ui/primitives';

export function GuidedOnboarding({
  children,
  currentPage,
  onPageChange,
  onSkip,
  pageCount,
}: {
  readonly children: readonly ReactNode[];
  readonly currentPage: number;
  readonly onPageChange: (page: number) => void;
  readonly onSkip: () => void;
  readonly pageCount: number;
}) {
  const { width } = useWindowDimensions();
  const [translateX] = useState(() => new Animated.Value(0));
  useEffect(() => translateX.setValue(-currentPage * width), [currentPage, translateX, width]);
  const settle = useCallback(
    (requestedPage: number) => {
      const nextPage = Math.max(0, Math.min(pageCount - 1, requestedPage));
      Animated.spring(translateX, {
        damping: 24,
        mass: 0.8,
        stiffness: 240,
        toValue: -nextPage * width,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onPageChange(nextPage);
      });
    },
    [onPageChange, pageCount, translateX, width],
  );
  const pager = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_event, gesture) => {
          const atFirst = currentPage === 0 && gesture.dx > 0;
          const atLast = currentPage === pageCount - 1 && gesture.dx < 0;
          translateX.setValue(-currentPage * width + gesture.dx * (atFirst || atLast ? 0.25 : 1));
        },
        onPanResponderRelease: (_event, gesture) => {
          const advance = gesture.dx < -width * 0.2 || gesture.vx < -0.5;
          const retreat = gesture.dx > width * 0.2 || gesture.vx > 0.5;
          if (advance && currentPage < pageCount - 1) settle(currentPage + 1);
          else if (retreat && currentPage > 0) settle(currentPage - 1);
          else settle(currentPage);
        },
        onPanResponderTerminate: () => settle(currentPage),
      }),
    [currentPage, pageCount, settle, translateX, width],
  );
  return (
    <SafeAreaView
      accessibilityHint="Swipe left for next or right for previous"
      edges={['top', 'bottom']}
      style={styles.shell}
    >
      <View style={styles.progressHeader}>
        <PageIndicator count={pageCount} current={currentPage} />
        <Button label="Skip onboarding" onPress={onSkip} variant="ghost" />
      </View>
      <View style={styles.viewport} {...pager.panHandlers}>
        <Animated.View
          style={[styles.track, { transform: [{ translateX }], width: width * pageCount }]}
        >
          {children.map((page, index) => (
            <View key={index} style={{ width }}>
              {page}
            </View>
          ))}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

export function OnboardingWelcome({
  body,
  icon,
  onNext,
  title,
}: {
  readonly body: string;
  readonly icon: IconName;
  readonly onNext: () => void;
  readonly title: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.welcome} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.icon}>
          <Icon color={colors.primary} name={icon} size={52} />
        </View>
        <Text style={styles.eyebrow}>WELCOME TO CARSHARE</Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Button label="Get started" onPress={onNext} />
    </ScrollView>
  );
}

function PageIndicator({ count, current }: { readonly count: number; readonly current: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`Onboarding page ${current + 1} of ${count}`}
      style={styles.pageDots}
    >
      <Text style={styles.pageStatus}>
        {current + 1} / {count}
      </Text>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.pageDot, index === current && styles.pageDotActive]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, fontSize: 18, lineHeight: 27, textAlign: 'center' },
  eyebrow: { color: colors.primary, fontSize: 13, fontWeight: '900', letterSpacing: 2 },
  hero: { alignItems: 'center', flex: 1, gap: 18, justifyContent: 'center' },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  pageDot: { backgroundColor: colors.border, borderRadius: 4, height: 8, width: 8 },
  pageDotActive: { backgroundColor: colors.primary, width: 24 },
  pageDots: { flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center' },
  pageStatus: { color: colors.subtleText, fontSize: 12, fontWeight: '700' },
  progressHeader: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: 20 },
  shell: { backgroundColor: colors.surface, flex: 1 },
  title: { color: colors.ink, fontSize: 34, fontWeight: '900', textAlign: 'center' },
  track: { flex: 1, flexDirection: 'row' },
  viewport: { flex: 1, overflow: 'hidden' },
  welcome: { flexGrow: 1, gap: 20, padding: 24 },
});
