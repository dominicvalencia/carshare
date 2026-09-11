import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AccountScreen.tsx'),
  'utf8',
);
const onboarding = source.slice(
  source.indexOf('export function OwnerOnboardingScreen'),
  source.indexOf('export function VerificationScreen'),
);

describe('owner onboarding draft continuity', () => {
  it('hydrates editable fields from the authoritative owner profile', () => {
    expect(onboarding).toContain('owner.data.legalName');
    expect(onboarding).toContain('owner.data.addressLine1');
    expect(onboarding).toContain('hydratedOwnerId');
  });

  it('persists valid partial draft fields without blocking guided navigation', () => {
    expect(onboarding).toContain('const partialDraft');
    expect(onboarding).toContain('void save.mutateAsync(draft)');
    expect(onboarding).toContain('setStep(Math.max(0, Math.min(4, nextPage)))');
    expect(onboarding).toContain('<Button label="Next"');
    expect(onboarding).toContain('setQueryData');
  });

  it('uses guided onboarding primitives and explicit owner-document terminology', () => {
    expect(onboarding).toContain('<OwnerOnboardingSection');
    expect(onboarding).toContain('<GuidedOnboarding');
    expect(onboarding).toContain('<OnboardingWelcome');
    expect(onboarding).toContain('Owner identity document');
    expect(onboarding).toMatch(/Camera-only\s+capture is not required/);
    expect(onboarding).toContain('Owner identity document preview');
    expect(onboarding).toContain('<OwnerReviewRow');
  });

  it('maps Back and swipe to the same bounded wizard navigation', () => {
    expect(onboarding).toContain('onPageChange={navigateTo}');
    expect(onboarding).toContain('onPress={() => navigateTo(page - 1)}');
    expect(onboarding).not.toContain('onPress={() => navigation.goBack()}');
  });

  it('shows Welcome plus four finite steps without changing the owner lifecycle', () => {
    expect(onboarding).toContain('List your car and start earning.');
    expect(onboarding).toContain('pageCount={5}');
    expect(onboarding).toContain("['DRAFT', 'REJECTED']");
    expect(onboarding).toContain("owner.data.status === 'VERIFIED'");
  });

  it('keeps skipping separate from explicit authoritative submission', () => {
    expect(onboarding).toContain('ownerOnboardingStorage.dismiss');
    expect(onboarding).toContain('onSkip={() => void skip()}');
    expect(onboarding).toContain("apiClient.request('/owners/me/submission'");
    expect(onboarding).toContain('disabled={!document || submit.isPending}');
  });

  it('records the first guided entry once without coupling it to profile verification', () => {
    expect(onboarding).toContain('const recordedGuidedEntry = useRef(false)');
    expect(onboarding).toContain("presentation !== 'guided' || recordedGuidedEntry.current");
    expect(onboarding).toContain('void auth.recordOwnerOnboardingEntry()');
    expect(onboarding).toContain('recordedGuidedEntry.current = false');
  });

  it('separates the first-time guide from the required verification profile', () => {
    expect(onboarding).toContain("presentation = 'guided'");
    expect(onboarding).toContain("presentation === 'profile'");
    expect(onboarding).toContain('Complete the required fields:');
    expect(onboarding).toContain('Choose a valid owner identity document before submitting.');
    expect(onboarding).toContain('export function OwnerProfileScreen');
    expect(onboarding).toContain('presentation="profile"');
    expect(onboarding).toContain('Step {step + 1} of 4');
    expect(onboarding).toContain("label={save.isPending ? 'Saving…' : 'Save and continue'}");
    expect(onboarding).toContain('continueVerification');
  });

  it('keeps Welcome and Skip exclusively in the guided branch', () => {
    const profileBranch = onboarding.slice(
      onboarding.indexOf("if (presentation === 'profile')"),
      onboarding.indexOf('return (\n    <GuidedOnboarding'),
    );
    expect(profileBranch).toContain('title="Owner profile"');
    expect(profileBranch).toContain('Submit for verification');
    expect(profileBranch).not.toContain('<OnboardingWelcome');
    expect(profileBranch).not.toContain('Skip onboarding');
  });
});
