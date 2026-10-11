import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('App.tsx', 'utf8');
const provider = readFileSync('src/auth/AuthProvider.tsx', 'utf8');
const account = readFileSync('src/features/account/AccountScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');
const ownerGuide = readFileSync('src/onboarding/owner-onboarding-storage.ts', 'utf8');

describe('server-authoritative marketplace persona routing', () => {
  it('presents an unselected roleless choice and enrolls only the selected persona', () => {
    expect(app).toContain('How would you like to use CarShare?');
    expect(app).toContain("useState<'RENTER' | 'OWNER' | null>(null)");
    expect(app).toContain('Rent a car');
    expect(app).toContain('List my car');
    expect(provider).toContain("('/me/personas', {");
  });

  it('uses server completion state and a server mutation instead of SecureStore authority', () => {
    expect(provider).toContain('renterOnboardingCompletedAt');
    expect(provider).toContain("'/me/personas/renter/onboarding-completion'");
    expect(provider).not.toContain('renterOnboardingStorage');
  });

  it('keeps roleless and owner-only accounts out of the renter default', () => {
    expect(app).toContain('return <PersonaSelection />');
    expect(app).toContain('resolvePersonaMode({');
    expect(app).toContain('initialMarketplacePersona');
    expect(app).toContain('restoredModeKey !== modeResolutionKey');
  });

  it('uses one logout path in Renting and Hosting and clears principal-scoped local state', () => {
    expect(provider).toContain('apiClient.setAccessToken(null)');
    expect(provider).toContain('tokenStorage.clear()');
    expect(provider).toContain('appLockStorage.clearAccount(currentUserId)');
    expect(provider).toContain('activeRoleStorage.clear(currentUserId)');
    expect(provider).toContain('ownerWorkspaceStorage.clear(currentUserId)');
    expect(provider).toContain('Promise.allSettled');
    expect(provider).toMatch(/setUser\(null\)[\s\S]*Promise\.allSettled/);
    expect(account.match(/<LogoutButton/g)).toHaveLength(4);
    expect(account).toContain('export function OwnerMoreScreen');
  });

  it('prevents a native gesture from bypassing owner wizard steps', () => {
    expect(navigation).toMatch(
      /name="OwnerOnboarding"[\s\S]*?options=\{\{ gestureEnabled: false, headerShown: false \}\}/,
    );
    expect(app).toMatch(/name="OwnerOnboarding"[\s\S]*?options=\{\{ gestureEnabled: false \}\}/);
  });

  it('uses server authority plus a non-authorizing same-session dismissal cache', () => {
    expect(app).toContain('ownerOnboardingStorage.isDismissed(userId)');
    expect(app).toContain('shouldPresentOwnerFirstEntry({');
    expect(app).toContain('!ownerGuideDismissed');
    expect(ownerGuide).toContain('owner-onboarding-dismissed_');
    expect(ownerGuide).not.toContain('VERIFIED');
    expect(ownerGuide).not.toContain('/owners/me/submission');
  });

  it('gates incomplete Renter onboarding by active mode and preserves Hosting access', () => {
    expect(app).toContain("if (mode === 'renter' && auth.renterOnboardingPending)");
    expect(app).not.toContain('if (auth.renterOnboardingPending)');
    expect(account).toContain('const renterSetupPending');
    expect(account).toContain('Continue Renter Setup');
  });

  it('routes Owner Profile separately from first-time Owner onboarding', () => {
    expect(navigation).toContain('<OwnerProfileScreen />');
    expect(navigation).toContain('name="OwnerProfile"');
    expect(account).toContain("navigation.navigate('OwnerProfile')");
  });

  it('limits automatic Owner Welcome to the authoritative first-entry state', () => {
    expect(app).toContain('ownerOnboardingFirstEnteredAt');
    expect(provider).toContain("'/me/personas/owner/onboarding-entry'");
    expect(app).not.toContain('ownerFirstEntryUserId');
    expect(account).toContain('accessibilityLabel="Switch to owner mode"');
    expect(account).toContain("onPress={() => onModeChange('owner')}");
  });

  it('persists explicit first-Owner intent before the identity refresh can remount navigation', () => {
    const intentWrite = provider.indexOf('ownerFirstEntryIntentStorage.set(user.id)');
    const identityRefresh = provider.indexOf(
      'const refreshToken = await tokenStorage.getRefreshToken()',
      intentWrite,
    );
    expect(intentWrite).toBeGreaterThan(-1);
    expect(identityRefresh).toBeGreaterThan(intentWrite);
    expect(provider).toContain("persona === 'OWNER' && enrollment.newlyEnrolled");
    expect(provider).toContain("activeRoleStorage.set(user.id, 'owner')");
    expect(provider).toContain('ownerFirstEntryIntentStorage.clear(user.id)');
  });
});
