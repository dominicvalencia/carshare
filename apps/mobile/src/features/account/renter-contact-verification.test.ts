import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'features/account/RenterOnboardingPages.tsx'), 'utf8');

describe('Renter onboarding contact verification', () => {
  it('renders the account email with authoritative verification states', () => {
    expect(source).toContain('{snapshot.email}');
    expect(source).toContain('snapshot.emailVerifiedAt');
    expect(source).toContain("{ label: 'Verified', tone: 'success' as const }");
    expect(source).toContain("{ label: 'Email sent', tone: 'warning' as const }");
    expect(source).toContain("{ label: 'Not verified', tone: 'warning' as const }");
    expect(source).toContain('{!snapshot.emailVerifiedAt &&');
  });

  it('preserves the email-verification request contract and duplicate guard', () => {
    expect(source).toContain("apiClient.request('/auth/email-verification/requests'");
    expect(source).toContain('disabled={requestEmail.isPending}');
    expect(source).toContain('onPress={() => requestEmail.mutate()}');
  });

  it('uses a compact resend action after the email request succeeds', () => {
    expect(source).toContain('requestEmail.isSuccess ? (');
    expect(source).toContain("'Resend verification email'");
    expect(source).toContain('style={styles.textAction}');
    expect(source).not.toContain('label="Resend verification email"');
  });

  it('progressively reveals mobile OTP entry only after a challenge is issued', () => {
    expect(source).toContain('{challengeId && (');
    expect(source).toContain('label="Verification code"');
    expect(source).toContain('placeholder="Enter 6-digit code"');
    expect(source).toContain("value.replaceAll(/\\D/g, '').slice(0, 6)");
    expect(source).toContain("'Resend code'");
    expect(source).not.toContain('label="Resend verification code"');
  });

  it('preserves mobile request and verification API contracts', () => {
    expect(source).toContain("'/auth/mobile-verification/requests'");
    expect(source).toContain("'/auth/otp/verifications'");
    expect(source).toContain("body: JSON.stringify({ challengeId, code, platform: 'UNKNOWN' })");
    expect(source).toContain('disabled={code.length !== 6 || verifyMobile.isPending}');
    expect(source).toContain("label={verifyMobile.isPending ? 'Verifying…' : 'Verify number'}");
    expect(source).toContain('onPress={() => verifyMobile.mutate()}');
  });

  it('keeps compact verification actions accessible and comfortably tappable', () => {
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('minHeight: 44');
    expect(source).toContain('style={styles.compactAction}');
  });

  it('hides mobile actions after verification and keeps status accessible as text', () => {
    expect(source).toContain('snapshot.mobileVerifiedAt ? (');
    expect(source).toContain('<Text style={styles.contactValue}>{snapshot.mobileNumber}</Text>');
    expect(source).toContain('<StatusBadge label={mobileStatus.label} tone={mobileStatus.tone} />');
  });

  it('does not render or query the development inbox from onboarding Step 3', () => {
    expect(source).not.toContain('Open local verification inbox');
    expect(source).not.toContain('Use latest mobile code');
    expect(source).not.toContain("queryKey: ['development-auth-deliveries']");
    expect(source).not.toContain("apiClient.request('/development/auth-deliveries')");
  });

  it('keeps onboarding navigation independent from contact verification state', () => {
    expect(source).toContain(
      '<RenterOnboardingFooter onBack={onBack} onPrimary={onNext} primaryLabel="Continue" />',
    );
    expect(source).toContain('onBack={onBack}');
    expect(source).not.toContain('disabled={!snapshot.emailVerifiedAt');
  });
});
