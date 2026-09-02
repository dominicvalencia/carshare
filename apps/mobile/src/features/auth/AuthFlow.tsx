import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { apiClient } from '../../auth/api-client';
import { useAuth } from '../../auth/AuthProvider';
import { colors, spacing } from '../../theme/tokens';

type Screen = 'welcome' | 'login' | 'register' | 'forgot' | 'reset' | 'email' | 'otp';
const credentialsSchema = z.object({
  confirmPassword: z.string(),
  identifier: z.string(),
  password: z.string(),
});
type Credentials = z.infer<typeof credentialsSchema>;

export function AuthFlow() {
  const [screen, setScreen] = useState<Screen>('welcome');
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safeArea}
      >
        {screen === 'welcome' ? (
          <Welcome onSelect={setScreen} />
        ) : (
          <CredentialScreen mode={screen} onBack={() => setScreen('welcome')} />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Welcome({ onSelect }: { readonly onSelect: (screen: Screen) => void }) {
  return (
    <View style={styles.page}>
      <Text style={styles.eyebrow}>PHILIPPINES CAR SHARING</Text>
      <Text style={styles.title}>One account. Two ways to drive.</Text>
      <Text style={styles.body}>
        Rent a car today, or complete owner verification when you are ready to host.
      </Text>
      <Button label="Log in" onPress={() => onSelect('login')} />
      <Button label="Create account" secondary onPress={() => onSelect('register')} />
      <Pressable accessibilityRole="button" onPress={() => onSelect('otp')}>
        <Text style={styles.link}>Continue with mobile OTP</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onSelect('forgot')}>
        <Text style={styles.link}>Forgot password</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onSelect('reset')}>
        <Text style={styles.link}>Open reset link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onSelect('email')}>
        <Text style={styles.link}>Verify email</Text>
      </Pressable>
    </View>
  );
}

function CredentialScreen({
  mode,
  onBack,
}: {
  readonly mode: Screen;
  readonly onBack: () => void;
}) {
  const auth = useAuth();
  const schema = credentialsSchema.superRefine((value, context) => {
    if (value.identifier.trim().length < 3) {
      context.addIssue({
        code: 'custom',
        message:
          mode === 'otp'
            ? 'Enter a Philippine mobile number.'
            : mode === 'reset' || mode === 'email'
              ? 'Enter the verification token.'
              : 'Enter your email or mobile number.',
        path: ['identifier'],
      });
    }
    if (mode === 'register' && !z.email().safeParse(value.identifier.trim()).success) {
      context.addIssue({
        code: 'custom',
        message: 'Enter a valid email address.',
        path: ['identifier'],
      });
    }
    if ((mode === 'register' || mode === 'reset') && value.password.length < 12) {
      context.addIssue({
        code: 'custom',
        message: 'Use at least 12 characters.',
        path: ['password'],
      });
    }
    if (mode === 'register' && value.confirmPassword !== value.password) {
      context.addIssue({
        code: 'custom',
        message: 'Passwords do not match.',
        path: ['confirmPassword'],
      });
    }
  });
  const form = useForm<Credentials>({
    defaultValues: { confirmPassword: '', identifier: '', password: '' },
    resolver: zodResolver(schema),
  });
  const mutation = useMutation({
    mutationFn: ({ identifier, password }: Credentials) =>
      mode === 'register' ? auth.register(identifier, password) : auth.login(identifier, password),
  });
  const utility = useMutation({
    mutationFn: async ({ identifier, password }: Credentials) => {
      if (mode === 'forgot')
        return apiClient.request('/auth/password-reset/requests', {
          body: JSON.stringify({ email: identifier }),
          method: 'POST',
        });
      if (mode === 'reset')
        return apiClient.request('/auth/password-reset/confirmations', {
          body: JSON.stringify({ token: identifier, newPassword: password }),
          method: 'POST',
        });
      if (mode === 'email')
        return apiClient.request('/auth/email-verification/confirmations', {
          body: JSON.stringify({ token: identifier }),
          method: 'POST',
        });
      if (mode === 'otp')
        return apiClient.request('/auth/otp/requests', {
          body: JSON.stringify({ mobileNumber: identifier, purpose: 'LOGIN', platform: 'UNKNOWN' }),
          method: 'POST',
        });
    },
  });
  const standard = mode === 'login' || mode === 'register';
  const submit = form.handleSubmit((values) => {
    mutation.reset();
    utility.reset();
    if (standard) mutation.mutate(values);
    else utility.mutate(values);
  });
  const title = {
    login: 'Welcome back',
    register: 'Create your account',
    forgot: 'Forgot password',
    reset: 'Reset password',
    email: 'Verify email',
    otp: 'Mobile OTP',
    welcome: '',
  }[mode];
  return (
    <View style={styles.page}>
      <Text style={styles.title}>{title}</Text>
      <Controller
        control={form.control}
        name="identifier"
        render={({ field: { onChange, value } }) => (
          <TextInput
            accessibilityLabel={
              mode === 'otp'
                ? 'Philippine mobile number'
                : mode === 'reset' || mode === 'email'
                  ? 'Verification token'
                  : 'Email or mobile number'
            }
            autoCapitalize="none"
            onChangeText={onChange}
            placeholder={
              mode === 'otp'
                ? '+63 mobile number'
                : mode === 'reset' || mode === 'email'
                  ? 'Verification token'
                  : 'Email or mobile'
            }
            style={styles.input}
            value={value}
          />
        )}
      />
      {form.formState.errors.identifier?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.identifier.message}</Text>
      )}
      {(standard || mode === 'reset') && (
        <Controller
          control={form.control}
          name="password"
          render={({ field: { onChange, value } }) => (
            <TextInput
              accessibilityLabel={mode === 'reset' ? 'New password' : 'Password'}
              onChangeText={onChange}
              placeholder={mode === 'reset' ? 'New password' : 'Password'}
              secureTextEntry
              style={styles.input}
              value={value}
            />
          )}
        />
      )}
      {(mode === 'register' || mode === 'reset') && (
        <Text style={styles.requirement}>Password must contain at least 12 characters.</Text>
      )}
      {form.formState.errors.password?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.password.message}</Text>
      )}
      {mode === 'register' && (
        <Controller
          control={form.control}
          name="confirmPassword"
          render={({ field: { onChange, value } }) => (
            <TextInput
              accessibilityLabel="Confirm password"
              autoComplete="new-password"
              onChangeText={onChange}
              placeholder="Confirm password"
              secureTextEntry
              style={styles.input}
              textContentType="newPassword"
              value={value}
            />
          )}
        />
      )}
      {form.formState.errors.confirmPassword?.message && (
        <Text style={styles.fieldError}>{form.formState.errors.confirmPassword.message}</Text>
      )}
      <Button
        disabled={mutation.isPending || utility.isPending}
        label={mutation.isPending || utility.isPending ? 'Please wait…' : 'Continue'}
        onPress={() => {
          void submit();
        }}
      />
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
      {(mutation.error || utility.error) && (
        <Text style={styles.error}>{(mutation.error ?? utility.error)?.message}</Text>
      )}
      {mode === 'login' && (
        <View style={styles.utility}>
          <Pressable accessibilityRole="button" onPress={() => onBack()}>
            <Text style={styles.link}>
              Password and verification tools are available from Welcome.
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.subtleText, fontSize: 17, lineHeight: 26, marginBottom: spacing.lg },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: colors.onPrimary, fontWeight: '700' },
  error: { color: '#A12626', marginTop: spacing.md },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '700', letterSpacing: 1.4 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  link: { color: colors.primary, marginTop: spacing.lg, textAlign: 'center' },
  requirement: { color: colors.subtleText, fontSize: 13, marginTop: spacing.xs },
  page: {
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  secondary: { backgroundColor: colors.surface, borderColor: colors.primary, borderWidth: 1 },
  secondaryText: { color: colors.primary },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: '800',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  utility: { marginTop: spacing.md },
});
