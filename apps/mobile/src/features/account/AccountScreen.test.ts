import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AccountScreen.tsx'),
  'utf8',
);
const renterProfile = source.slice(
  source.indexOf('export function AccountScreen'),
  source.indexOf('export function PersonalInformationScreen'),
);
const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);
const messagesSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../communications/MessagesScreen.tsx'),
  'utf8',
);
const ownerMore = source.slice(source.indexOf('export function OwnerMoreScreen'));

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

  it('removes redundant Personal information and keeps Reviews first in Account', () => {
    const reviews = renterProfile.indexOf('label="Reviews"');
    const verification = renterProfile.indexOf('label="Verification"');
    expect(renterProfile).not.toContain('label="Personal information"');
    expect(reviews).toBeGreaterThan(-1);
    expect(verification).toBeGreaterThan(reviews);
    expect(renterProfile).toContain("navigation.navigate('Reviews')");
  });

  it('uses the active uploaded profile photo with the initial avatar as fallback', () => {
    expect(renterProfile).toContain("definition?.code === 'PROFILE_PHOTO' && !replacedAt");
    expect(renterProfile).toContain('<AuthorizedDocumentPreview');
    expect(renterProfile).toContain('fallback={avatarFallback}');
    expect(renterProfile).toContain('fileAssetId={profilePhoto.fileAsset.id}');
  });

  it('removes renter Profile Wishlist and Notifications rows without orphaned sections', () => {
    expect(renterProfile).not.toContain('label="Wishlist"');
    expect(renterProfile).not.toContain('label="Notifications"');
    expect(renterProfile).not.toContain('<MenuSection title="Renting">');
    expect(renterProfile).not.toContain('notification-summary');
  });

  it('preserves Wishlist and Notifications navigation outside renter Profile', () => {
    expect(navigationSource).toContain('name="Wishlist"');
    expect(navigationSource).toContain("tabBarLabel: 'Wishlist'");
    expect(navigationSource).toContain('name="Notifications"');
    expect(messagesSource).toContain("navigation.navigate('Notifications')");
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

  it('places one Payout methods destination directly after Earnings & payouts', () => {
    const earnings = ownerMore.indexOf('label="Earnings & payouts"');
    const methods = ownerMore.indexOf('label="Payout methods"');
    const profile = ownerMore.indexOf('label="Owner Profile"');
    expect(earnings).toBeGreaterThan(-1);
    expect(methods).toBeGreaterThan(earnings);
    expect(profile).toBeGreaterThan(methods);
    expect(ownerMore.match(/label="Payout methods"/g)).toHaveLength(1);
    expect(ownerMore).toContain("navigation.navigate('OwnerPayoutMethods')");
    expect(ownerMore).toContain('Manage where your earnings are sent');
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
