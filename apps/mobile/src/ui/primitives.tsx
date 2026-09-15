import Ionicons from '@expo/vector-icons/Ionicons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

export const formKeyboardDismissMode = Platform.OS === 'android' ? 'none' : 'on-drag';
const screenBottomPadding = 120;
const iosFocusInsets = Platform.OS === 'ios' ? { bottom: spacing.xl } : undefined;

export function useKeyboardAwareBottomPadding(basePadding = 0) {
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => {
      setAndroidKeyboardHeight(Math.max(0, endCoordinates.height));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setAndroidKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return basePadding + (Platform.OS === 'android' ? androidKeyboardHeight : 0);
}

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons color={color} name={name} size={size} />;
}

export function Screen({
  children,
  eyebrow,
  title,
  subtitle,
  leading,
  action,
  scroll = true,
  scrollRef,
  onScroll,
  onContentSizeChange,
  onScrollLayout,
  constrainOverscroll = false,
  safeTop = true,
}: ScreenProperties) {
  const keyboardAwareBottomPadding = useKeyboardAwareBottomPadding(screenBottomPadding);
  const header = (
    <>
      {leading && <View style={styles.leading}>{leading}</View>}
      {(title || eyebrow || action) && (
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
            {title && (
              <Text accessibilityRole="header" style={styles.screenTitle}>
                {title}
              </Text>
            )}
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {action}
        </View>
      )}
    </>
  );
  const content = (
    <>
      {header}
      {children}
    </>
  );
  return (
    <SafeAreaView edges={safeTop ? ['top'] : []} style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex}>
        {leading ? (
          <>
            <View style={styles.stickyNestedHeader}>{header}</View>
            {scroll ? (
              <ScrollView
                ref={scrollRef}
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                alwaysBounceVertical={!constrainOverscroll}
                bounces={!constrainOverscroll}
                contentInset={iosFocusInsets}
                contentContainerStyle={[
                  styles.nestedScreenContent,
                  { paddingBottom: keyboardAwareBottomPadding },
                ]}
                keyboardDismissMode={formKeyboardDismissMode}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                overScrollMode={constrainOverscroll ? 'never' : 'auto'}
                onScroll={onScroll}
                onContentSizeChange={onContentSizeChange}
                onLayout={onScrollLayout}
                scrollEventThrottle={onScroll ? 16 : undefined}
                scrollIndicatorInsets={iosFocusInsets}
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              <View style={styles.nestedScreenContentFlex}>{children}</View>
            )}
          </>
        ) : scroll ? (
          <ScrollView
            ref={scrollRef}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            alwaysBounceVertical={!constrainOverscroll}
            bounces={!constrainOverscroll}
            contentInset={iosFocusInsets}
            contentContainerStyle={[
              styles.screenContent,
              { paddingBottom: keyboardAwareBottomPadding },
            ]}
            keyboardDismissMode={formKeyboardDismissMode}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            overScrollMode={constrainOverscroll ? 'never' : 'auto'}
            onScroll={onScroll}
            onContentSizeChange={onContentSizeChange}
            onLayout={onScrollLayout}
            scrollEventThrottle={onScroll ? 16 : undefined}
            scrollIndicatorInsets={iosFocusInsets}
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : (
          <View style={styles.screenContentFlex}>{content}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface ScreenProperties {
  readonly children: ReactNode;
  readonly eyebrow?: string | undefined;
  readonly title?: string | undefined;
  readonly subtitle?: string | undefined;
  readonly leading?: ReactNode | undefined;
  readonly action?: ReactNode | undefined;
  readonly scroll?: boolean | undefined;
  readonly scrollRef?: RefObject<ScrollView | null> | undefined;
  readonly onScroll?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
  readonly onContentSizeChange?: ((width: number, height: number) => void) | undefined;
  readonly onScrollLayout?: ((event: LayoutChangeEvent) => void) | undefined;
  readonly constrainOverscroll?: boolean | undefined;
  readonly safeTop?: boolean | undefined;
}

export function BackControl({
  label = 'Back',
  onPress,
}: {
  readonly label?: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={styles.backControl}
    >
      <Icon color={colors.primary} name="arrow-back" size={19} />
      <Text style={styles.backControlText}>{label}</Text>
    </Pressable>
  );
}

export function NestedScreen({
  backLabel = 'Back',
  onBack,
  ...properties
}: Omit<ScreenProperties, 'leading'> & {
  readonly backLabel?: string;
  readonly onBack?: (() => void) | undefined;
}) {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const safeBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Marketplace');
  };
  return (
    <Screen
      {...properties}
      leading={<BackControl label={backLabel} onPress={onBack ?? safeBack} />}
    />
  );
}

export function Card({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: IconName | undefined;
  readonly variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | undefined;
  readonly disabled?: boolean | undefined;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        (disabled || pressed) && styles.pressed,
      ]}
    >
      {icon && (
        <Icon
          color={variant === 'primary' || variant === 'danger' ? colors.onPrimary : colors.primary}
          name={icon}
          size={19}
        />
      )}
      <Text style={[styles.buttonLabel, styles[`buttonLabel_${variant}`]]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  active = false,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly onPress: () => void;
  readonly active?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={[styles.iconButton, active && styles.iconButtonActive]}
    >
      <Icon color={active ? colors.onPrimary : colors.ink} name={icon} />
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  error,
  secureTextEntry = false,
  returnKeyType,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string | undefined;
  readonly keyboardType?: KeyboardTypeOptions | undefined;
  readonly multiline?: boolean | undefined;
  readonly error?: string | undefined;
  readonly secureTextEntry?: boolean | undefined;
  readonly returnKeyType?: ComponentProps<typeof TextInput>['returnKeyType'];
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        returnKeyType={returnKeyType ?? (multiline ? 'default' : 'next')}
        secureTextEntry={secureTextEntry}
        style={[styles.input, multiline && styles.multiline, Boolean(error) && styles.inputError]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

export function PasscodeInput({
  label,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onComplete?: ((value: string) => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly autoFocus?: boolean | undefined;
}) {
  const input = useRef<TextInput>(null);
  const completed = useRef('');
  useEffect(() => {
    if (value.length !== 6) completed.current = '';
    if (value.length === 6 && value !== completed.current) {
      completed.current = value;
      onComplete?.(value);
    }
  }, [onComplete, value]);
  return (
    <View style={styles.passcodeField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityLabel={`${label}. ${value.length} of 6 digits entered.`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => input.current?.focus()}
        style={styles.passcodeBoxes}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <View
            key={index}
            style={[styles.passcodeBox, index === value.length && styles.passcodeBoxActive]}
          >
            <Text style={styles.passcodeDot}>{index < value.length ? '●' : '○'}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel={label}
        autoFocus={autoFocus}
        caretHidden
        contextMenuHidden
        editable={!disabled}
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(next) => onChange(next.replaceAll(/\D/g, '').slice(0, 6))}
        returnKeyType="done"
        secureTextEntry
        style={styles.hiddenPasscodeInput}
        value={value}
      />
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
}: {
  readonly label: string;
  readonly selected?: boolean | undefined;
  readonly onPress?: (() => void) | undefined;
  readonly icon?: IconName | undefined;
}) {
  const content = (
    <>
      {icon && <Icon color={selected ? colors.onPrimary : colors.primary} name={icon} size={15} />}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.chip, selected && styles.chipSelected]}>{content}</View>
  );
}

export function StatusBadge({
  label,
  tone = 'success',
}: {
  readonly label: string;
  readonly tone?: 'success' | 'warning' | 'neutral' | 'danger';
}) {
  return (
    <View style={[styles.badge, styles[`badge_${tone}`]]}>
      <Text style={[styles.badgeText, styles[`badgeText_${tone}`]]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  readonly title: string;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function StateView({
  icon = 'leaf-outline',
  title,
  message,
  loading = false,
  actionLabel,
  onAction,
}: {
  readonly icon?: IconName | undefined;
  readonly title: string;
  readonly message?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly actionLabel?: string | undefined;
  readonly onAction?: (() => void) | undefined;
}) {
  return (
    <View style={styles.state}>
      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Icon color={colors.primary} name={icon} size={30} />
      )}
      <Text style={styles.stateTitle}>{title}</Text>
      {message && <Text style={styles.stateMessage}>{message}</Text>}
      {actionLabel && onAction && (
        <Button label={actionLabel} onPress={onAction} variant="secondary" />
      )}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  backControl: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingRight: spacing.sm,
  },
  backControlText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  badge_danger: { backgroundColor: colors.dangerSoft },
  badge_neutral: { backgroundColor: colors.muted },
  badge_success: { backgroundColor: colors.primarySoft },
  badge_warning: { backgroundColor: colors.warningSoft },
  badgeText: { fontSize: 12, fontWeight: '700' },
  badgeText_danger: { color: colors.danger },
  badgeText_neutral: { color: colors.subtleText },
  badgeText_success: { color: colors.primaryDark },
  badgeText_warning: { color: colors.warning },
  button: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  button_danger: { backgroundColor: colors.danger },
  button_ghost: { backgroundColor: 'transparent' },
  button_primary: { backgroundColor: colors.primary },
  button_secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  buttonLabel: { fontSize: 15, fontWeight: '800' },
  buttonLabel_danger: { color: colors.onPrimary },
  buttonLabel_ghost: { color: colors.primary },
  buttonLabel_primary: { color: colors.onPrimary },
  buttonLabel_secondary: { color: colors.primary },
  card: {
    ...shadows.card,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xxs,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  chipTextSelected: { color: colors.onPrimary },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth },
  errorText: { color: colors.danger, fontSize: 12, marginTop: spacing.xxs },
  eyebrow: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.ink, fontSize: typography.label, fontWeight: '700' },
  flex: { flex: 1 },
  headerCopy: { flex: 1 },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  hiddenPasscodeInput: { height: 1, opacity: 0, position: 'absolute', width: 1 },
  inputError: { borderColor: colors.danger },
  leading: { alignItems: 'flex-start' },
  multiline: { minHeight: 112 },
  nestedScreenContent: {
    flexGrow: 1,
    gap: spacing.md,
    paddingBottom: screenBottomPadding,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  nestedScreenContentFlex: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  passcodeBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 40,
  },
  passcodeBoxActive: { borderColor: colors.primary, borderWidth: 2 },
  passcodeBoxes: { flexDirection: 'row', gap: spacing.xxs },
  passcodeDot: { color: colors.ink, fontSize: 22 },
  passcodeField: { gap: spacing.sm },
  pressed: { opacity: 0.62 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  screenContent: {
    flexGrow: 1,
    gap: spacing.md,
    paddingBottom: screenBottomPadding,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  screenContentFlex: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  screenTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.xxs,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  sectionTitle: { color: colors.ink, fontSize: typography.heading, fontWeight: '800' },
  state: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 170,
    padding: spacing.xl,
  },
  stateMessage: { color: colors.subtleText, lineHeight: 21, textAlign: 'center' },
  stateTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  stickyNestedHeader: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxs,
  },
  subtitle: { color: colors.subtleText, lineHeight: 21, marginTop: spacing.xxs },
});
