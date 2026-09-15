import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AccountScreen.tsx'),
  'utf8',
);

describe('contact verification presentation', () => {
  it('exposes email and Philippine mobile verification flows', () => {
    expect(source).toContain('Contact information');
    expect(source).toContain('/auth/email-verification/requests');
    expect(source).toContain('/auth/email-verification/confirmations');
    expect(source).toContain('/auth/mobile-verification/requests');
    expect(source).toContain('/auth/otp/verifications');
    expect(source).toContain('placeholder="09XXXXXXXXX"');
  });

  it('keeps the local delivery viewer out of production UI', () => {
    expect(source).toContain('__DEV__ &&');
    expect(source).toContain('/development/auth-deliveries');
  });
});

describe('renter profile persona presentation', () => {
  it('restores the accepted owner CTA copy without a duplicate Hosting section', () => {
    expect(source).toContain("? 'Switch to owner mode'");
    expect(source).toContain(": 'List your car'");
    expect(source).toContain("'Manage your fleet, requests, rentals and earnings.'");
    expect(source).toContain("'Start verification and build your first listing.'");
    expect(source).not.toContain('<MenuSection title="Hosting">');
  });

  it('preserves OWNER enrollment, immediate onboarding, and shared logout', () => {
    expect(source).toContain("mutationFn: () => auth.enrollPersona('OWNER')");
    expect(source).toContain("onSuccess: () => onModeChange('owner')");
    expect(source).not.toContain("onSuccess: () => navigation.navigate('OwnerOnboarding')");
    expect(source).not.toContain('<LogoutButton variant="secondary" />');
  });
});

describe('hosting profile persona and verification presentation', () => {
  it('uses customer-safe Owner verification labels', () => {
    expect(source).toContain("DRAFT: 'Verification required'");
    expect(source).toContain("PENDING_VERIFICATION: 'Verification pending'");
    expect(source).toContain("VERIFIED: 'Verified'");
    expect(source).toContain("REJECTED: 'Changes required'");
    expect(source).toContain("SUSPENDED: 'Account restricted'");
  });

  it('uses one Owner Profile route instead of a duplicate setup card', () => {
    expect(source).toContain('label="Owner Profile"');
    expect(source).toContain("navigation.navigate('OwnerProfile')");
    expect(source).not.toContain('<Text style={styles.cardTitle}>Vehicle Owner</Text>');
    expect(source).not.toContain('label="Resume Vehicle Owner Setup"');
  });

  it('presents incomplete Renter setup independently from Owner verification', () => {
    expect(source).toContain('const renterSetupPending');
    expect(source).toContain("'Continue Renter Setup'");
    expect(source).toContain('renterOnboardingCompletedAt');
    expect(source).toContain('accessibilityLabel={`Owner Profile. ${ownerStatusLabel');
  });
});
