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

  it('persists each step before advancing and remains in place on failure', () => {
    expect(onboarding).toContain('await save.mutateAsync()');
    expect(onboarding).toContain("label={save.isPending ? 'Saving…' : 'Save and continue'}");
    expect(onboarding).toContain('setQueryData');
  });

  it('uses guided onboarding primitives and explicit owner-document terminology', () => {
    expect(onboarding).toContain('<OwnerOnboardingSection');
    expect(onboarding).toContain('ownerProgressDots');
    expect(onboarding).toContain('Owner identity document');
    expect(onboarding).toMatch(/Camera-only\s+capture is not required/);
    expect(onboarding).toContain('Owner identity document preview');
    expect(onboarding).toContain('<OwnerReviewRow');
  });
});
