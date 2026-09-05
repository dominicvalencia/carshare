import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dateWithinBounds, normalizeDateOnly } from '../../ui/date-only';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Phase 12 renter acceptance stabilization', () => {
  it('validates confirm password without sending it through registration persistence', () => {
    const authFlow = source('features/auth/AuthFlow.tsx');
    const provider = source('auth/AuthProvider.tsx');
    expect(authFlow).toContain("path: ['confirmPassword']");
    expect(authFlow).toContain('Passwords do not match.');
    expect(authFlow).toContain('at least 12 characters');
    expect(provider).toContain('apiClient.register(email, password)');
    expect(provider).not.toContain('apiClient.register(email, password, confirmPassword)');
  });

  it('persists a skippable eight-page onboarding flow without embedding account Verification', () => {
    const app = source('../App.tsx');
    const onboarding = source('features/account/RenterOnboardingPages.tsx');
    const provider = source('auth/AuthProvider.tsx');
    const storage = source('auth/renter-onboarding-storage.ts');
    expect(provider).toContain('renterOnboardingStorage.markPending');
    expect(provider).toContain('renterOnboardingStorage.isPending');
    expect(provider).toContain('catch {');
    expect(storage).toContain('renter-onboarding_${userId}');
    expect(storage).not.toContain('renter-onboarding:${userId}');
    expect(app).toContain('Skip onboarding');
    expect(app).not.toContain('<VerificationScreen');
    expect(app).toContain('WELCOME TO CAR RENTAL');
    expect(app).toContain('<PageIndicator count={8} current={stage} />');
    for (const title of [
      'Personal information',
      'Contact verification',
      'Address',
      'Driver’s license',
      'Verification documents',
      'Selfie',
      'Review & finish',
    ])
      expect(onboarding).toContain(title);
    expect(onboarding).toContain('onboardingNavigation={{ onBack, onNext, step }}');
    expect(app).toContain('PanResponder.create');
    expect(app).toContain('translateX.setValue(-stage * width + gesture.dx * resistance)');
    expect(app).toContain('const pages = Array.from({ length: 8 }, (_, page) => page)');
    expect(app).toContain('<View key={page} style={{ width }}>');
    expect(app).toContain('toValue: -boundedStage * width');
    expect(app).toContain("overflow: 'hidden'");
    expect(app).toContain('<Button label="Skip onboarding" onPress={onSkip} variant="ghost" />');
    const workflow = source('features/account/RenterVerificationWorkflow.tsx');
    expect(workflow).not.toContain('registerSwipeNext');
    expect(workflow).not.toContain(
      'if (onboardingNavigation) return onboardingNavigation.onNext();',
    );
    expect(workflow).toContain('RenterOnboardingDraftProvider');
    expect(workflow).toContain('client.setQueryData<RenterVerificationSnapshot>');
    expect(workflow).toContain('onNext={() => submit.mutate()}');
    expect(workflow).toContain('(save.error ?? upload.error ?? submit.error)?.message');
  });

  it('hydrates one shared draft and reviews the latest saved onboarding values', () => {
    const workflow = source('features/account/RenterVerificationWorkflow.tsx');
    const app = source('../App.tsx');
    expect(app).toContain('<RenterOnboardingDraftProvider>');
    expect(workflow).toContain('sharedDraft.setForm(draftFromSnapshot(snapshot))');
    expect(workflow).toContain(
      'profile: { ...(current.profile ?? updatedProfile), ...updatedProfile }',
    );
    expect(workflow).toContain('save.mutate(body, {');
    expect(workflow).toContain('onboardingNavigation.onNext()');
    for (const section of [
      'Personal information',
      'Address',
      'Contact',
      'Driver information',
      'Emergency contact',
      'Document completion',
    ])
      expect(workflow).toContain(`title="${section}"`);
    expect(workflow).toContain('••••');
  });

  it('keeps Home discovery-focused after onboarding is skipped', () => {
    const discovery = source('features/discovery/DiscoveryScreen.tsx');
    expect(discovery).not.toContain('Complete your verification');
    expect(discovery).not.toContain('Continue verification');
    expect(discovery).toContain("reserve.error.code === 'RENTER_VERIFICATION_REQUIRED'");
  });

  it('does not autofocus selectors and dismisses the keyboard on selection', () => {
    for (const path of [
      'ui/SearchableReferenceSelector.tsx',
      'features/account/RenterVerificationWorkflow.tsx',
    ]) {
      const selector = source(path);
      expect(selector).toContain('autoFocus={false}');
      expect(selector).toContain('Keyboard.dismiss()');
    }
    const sharedSelector = source('ui/SearchableReferenceSelector.tsx');
    expect(sharedSelector).toContain('keyboardShouldPersistTaps="always"');
    expect(sharedSelector).toContain('<Screen scroll={false}');
    expect(sharedSelector).toContain('style={styles.list}');
  });

  it('keeps the date picker value inside its native bounds', () => {
    const minimum = new Date(2026, 7, 30, 12);
    expect(dateWithinBounds(new Date(2026, 7, 29, 12), minimum)).toEqual(minimum);
    expect(dateWithinBounds(new Date(2026, 8, 1, 12), minimum)).toEqual(new Date(2026, 8, 1, 12));
  });

  it('normalizes moving native date-picker bounds to stable date-only timestamps', () => {
    const firstMinimum = new Date(2026, 7, 31, 10, 44, 28, 100);
    const nextRenderMinimum = new Date(2026, 7, 31, 10, 44, 28, 900);

    expect(normalizeDateOnly(firstMinimum)).toEqual(new Date(2026, 7, 31, 12));
    expect(normalizeDateOnly(nextRenderMinimum)).toEqual(new Date(2026, 7, 31, 12));
    expect(dateWithinBounds(new Date(2026, 7, 30), nextRenderMinimum)).toEqual(
      new Date(2026, 7, 31, 12),
    );
  });

  it('uses the bounded native iOS spinner without the crashing inline mode', () => {
    const field = source('ui/DateOnlyField.tsx');
    const iosPicker = field.slice(field.indexOf("{Platform.OS === 'ios'"));
    expect(iosPicker).toContain('<DateTimePicker');
    expect(iosPicker).toContain('display="spinner"');
    expect(iosPicker).not.toContain('display="inline"');
    expect(field).toContain('pickerMinimumDate');
    expect(field).toContain('pickerMaximumDate');
  });

  it('uses the same DateOnlyField presentation for every active renter date-only field', () => {
    const workflow = source('features/account/RenterVerificationWorkflow.tsx');
    expect(workflow.match(/<DateOnlyField/g)).toHaveLength(2);
    expect(workflow).toContain('label="Date of birth *"');
    expect(workflow).toContain('maximumDate={new Date()}');
    expect(workflow).toContain('label="Expiration date *"');
    expect(workflow).toContain('minimumDate={tomorrow()}');
    expect(workflow).not.toContain('YYYY-MM-DD');
  });

  it('keeps the selfie preview and centralizes approval invalidation', () => {
    const workflow = source('features/account/RenterVerificationWorkflow.tsx');
    const account = source('features/account/AccountScreen.tsx');
    const invalidation = source('query/verification-invalidation.ts');
    expect(workflow).toContain('Captured selfie preview');
    expect(workflow).not.toContain('setCapturedSelfie(null)');
    expect(account).toContain('refetchInterval: (query)');
    expect(account).toContain('client.setQueryData<RenterVerificationSnapshot>');
    expect(invalidation).toContain("['public-vehicle']");
  });

  it('rehydrates private KYC document previews with renewable authorized grants', () => {
    const workflow = source('features/account/RenterVerificationWorkflow.tsx');
    expect(workflow).toContain('function AuthorizedDocumentPreview');
    expect(workflow).toContain('`/files/${fileAssetId}/access-grants`');
    expect(workflow).toContain('refetchInterval: 4 * 60 * 1000');
    expect(workflow).not.toContain("classification: 'PUBLIC'");
  });

  it('clears stale email failures and hides OTP controls in the verified mobile state', () => {
    const account = source('features/account/AccountScreen.tsx');
    expect(account).toContain('verifyEmail.reset();');
    expect(account).toContain('requestEmail.reset();');
    expect(account).toContain('✓ Mobile number verified');
    expect(account).toContain('setChangingMobile(true)');
    expect(account).toContain('It will remain unverified until you confirm its code.');
    expect(account).toContain("We couldn't complete verification right now. Please try again.");
  });
});
