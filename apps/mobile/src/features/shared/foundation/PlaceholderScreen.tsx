import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../../theme/tokens';

interface PlaceholderScreenProperties {
  readonly detail?: string;
  readonly title: string;
}

export function PlaceholderScreen({ detail, title }: PlaceholderScreenProperties) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>PHASE 1 FOUNDATION</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail}>
        {detail ?? 'Business functionality begins in a later phase.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  detail: {
    color: colors.subtleText,
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
});
