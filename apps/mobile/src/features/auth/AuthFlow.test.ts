import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const auth = readFileSync(resolve(directory, 'AuthFlow.tsx'), 'utf8');
const config = readFileSync(resolve(directory, '../../../app.config.ts'), 'utf8');
const entry = readFileSync(resolve(directory, '../../../index.ts'), 'utf8');
const application = readFileSync(resolve(directory, '../../../App.tsx'), 'utf8');

describe('Welcome and native splash presentation', () => {
  it('keeps the Welcome surface focused on account creation and login', () => {
    const welcome = auth.slice(
      auth.indexOf('function Welcome('),
      auth.indexOf('function CredentialScreen('),
    );
    expect(welcome).toContain('PHILIPPINES CAR SHARING');
    expect(welcome).toContain('Rent cars nearby. Or earn by hosting yours.');
    expect(welcome).toContain('label="Create account"');
    expect(welcome).toContain('label="Log in"');
    expect(welcome.indexOf('label="Create account"')).toBeLessThan(
      welcome.indexOf('label="Log in"'),
    );
    expect(welcome).not.toContain('Continue with mobile OTP');
    expect(welcome).not.toContain('Forgot password');
    expect(welcome).not.toContain('Open reset link');
    expect(welcome).not.toContain('Verify email');
  });

  it('preserves auth utility flow implementations without cluttering Login', () => {
    expect(auth).toContain("| 'otp';");
    expect(auth).toContain("mode === 'otp'");
    expect(auth).toContain("apiClient.request('/auth/otp/requests'");
    expect(auth).toContain("onSelect('forgot')");
    expect(auth).toContain("apiClient.request('/auth/email-verification/confirmations'");
    expect(auth).toContain(
      "mode === 'register' ? auth.register(identifier, password) : auth.login(identifier, password)",
    );
  });

  it('presents a branded, labeled Login screen with a top back action', () => {
    expect(auth).toContain("['forgot', 'login', 'register', 'reset'].includes(mode)");
    expect(auth).toContain("'Log in to continue with CarShare.'");
    expect(auth).toContain("registration || mode === 'forgot' ? 'Email' : 'Email or mobile'");
    expect(auth).toContain("? 'Log in'");
    expect(auth).toContain('{!brandedCredentialScreen && (');
  });

  it('shows specific safe login errors without revealing whether an account exists', () => {
    expect(auth).toContain("if (error.code === 'INVALID_CREDENTIALS')");
    expect(auth).toContain('The email, mobile number, or password is incorrect.');
    expect(auth).toContain("if (error.code === 'NETWORK_ERROR')");
    expect(auth).toContain('Too many login attempts. Wait a moment and try again.');
    expect(auth).toContain('? loginErrorMessage(mutation.error)');
    expect(auth).not.toContain('No account exists');
  });

  it('keeps password recovery contextual without exposing utility actions on Login', () => {
    const credentials = auth.slice(
      auth.indexOf('function CredentialScreen('),
      auth.indexOf('function Button('),
    );
    expect(credentials).not.toContain('Continue with mobile OTP');
    expect(credentials).not.toContain('dividerLabel}>or');
    expect(credentials).not.toContain('Open reset link');
    expect(credentials).not.toContain("onSelect('email')");
    expect(auth).toContain('<Text style={styles.forgotPasswordText}>Forgot password?</Text>');
    expect(auth).not.toContain('Enter a password reset token');
  });

  it('uses the existing endpoint and transitions to a security-safe check-email state', () => {
    expect(auth).toContain("apiClient.request('/auth/password-reset/requests'");
    expect(auth).toContain("if (mode === 'forgot') onResetRequested");
    expect(auth).toContain('title="Check your email"');
    expect(auth).toContain('We sent a password reset link to ${maskEmail(resetEmail)}.');
    expect(auth).toContain('buttonLabel="Back to log in"');
  });

  it('keeps the reset token internal and provides complete reset states', () => {
    expect(auth).toContain("identifier: mode === 'reset' ? resetToken : ''");
    expect(auth).toContain('body: JSON.stringify({ token: identifier, newPassword: password })');
    expect(auth).toContain("{mode !== 'reset' && (");
    expect(auth).toContain('Confirm new password');
    expect(auth).toContain('Use 12–128 characters.');
    expect(auth).toContain('PASSWORD_RESET_TOKEN_EXPIRED');
    expect(auth).toContain('PASSWORD_RESET_TOKEN_INVALID');
    expect(auth).toContain('title="Reset link expired"');
    expect(auth).toContain('secondaryButtonLabel="Back to log in"');
    expect(auth).toContain('title="Password updated"');
    expect(auth).toContain(
      "setScreen(screen === 'forgot' || screen === 'reset' ? 'login' : 'welcome')",
    );
    expect(auth.indexOf('Confirm new password')).toBeLessThan(
      auth.lastIndexOf('Use 12–128 characters.'),
    );
  });

  it('uses the accessible password visibility control for credential Login', () => {
    expect(auth).toContain(
      "registration || mode === 'reset' ? 'new-password' : 'current-password'",
    );
    expect(auth).toContain("passwordVisible ? 'Hide password' : 'Show password'");
    expect(auth).toContain('secureTextEntry={!passwordVisible}');
  });

  it('keeps registration submission and authoritative password validation unchanged', () => {
    expect(auth).toContain("mode === 'register' ? auth.register(identifier, password)");
    expect(auth).toContain('value.password.length < 12');
    expect(auth).toContain("message: 'Use at least 12 characters.'");
    expect(auth).toContain('value.confirmPassword !== value.password');
    expect(auth).toContain("message: 'Passwords do not match.'");
  });

  it('presents registration as a compact, labeled form with a top back action', () => {
    const credentials = auth.slice(
      auth.indexOf('function CredentialScreen('),
      auth.indexOf('function Button('),
    );
    expect(credentials).toContain('Start renting cars now. You can become a host anytime.');
    expect(credentials).toContain(
      "registration || mode === 'forgot' ? 'Email' : 'Email or mobile'",
    );
    expect(credentials).toContain('style={styles.backAction}');
    expect(credentials).toContain('{!brandedCredentialScreen && (');
    expect(auth).toContain('keyboardShouldPersistTaps="handled"');
  });

  it('keeps invitation auth inside the existing credential composition', () => {
    expect(auth).toContain('invitationContext={invitationContext}');
    expect(auth).toContain('<InvitationContextCard context={invitationContext} />');
    expect(auth).toContain("mode === 'register' && invitationContext ? 'Set up your account'");
    expect(auth).toContain("onBackToContext && (screen === 'login' || screen === 'register')");
    expect(auth.indexOf('<Text accessibilityRole="header" style={styles.authTitle}>')).toBeLessThan(
      auth.indexOf('<InvitationContextCard context={invitationContext} />'),
    );
  });

  it('provides independent accessible visibility controls for both registration passwords', () => {
    expect(auth).toContain("passwordVisible ? 'Hide password' : 'Show password'");
    expect(auth).toContain(
      "confirmPasswordVisible ? 'Hide confirm password' : 'Show confirm password'",
    );
    expect(auth).toContain('secureTextEntry={!passwordVisible}');
    expect(auth).toContain('secureTextEntry={!confirmPasswordVisible}');
  });

  it('uses the Expo splash plugin with the existing CarShare asset', () => {
    expect(config).toContain("'expo-splash-screen'");
    expect(config).toContain("image: './assets/carshare-app-icon.png'");
    expect(config).toContain("backgroundColor: '#F6F7F4'");
    expect(config).toContain('imageWidth: 160');
    expect(config).toContain("resizeMode: 'contain'");
  });

  it('holds the native splash through session restoration and always releases it afterward', () => {
    expect(entry).toContain('SplashScreen.preventAutoHideAsync()');
    expect(application).toContain('if (!auth.booting)');
    expect(application).toContain('SplashScreen.hideAsync()');
    expect(application).toContain('if (auth.booting) return null');
    expect(entry).not.toContain('setTimeout');
    expect(application).not.toContain('setTimeout(500)');
  });
});
