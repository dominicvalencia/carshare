import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Renter onboarding persistent footer', () => {
  const app = source('../App.tsx');
  const guided = source('onboarding/GuidedOnboarding.tsx');
  const pages = source('features/account/RenterOnboardingPages.tsx');
  const workflow = source('features/account/RenterVerificationWorkflow.tsx');

  it('keeps the shared eight-page order and onboarding Skip behavior', () => {
    expect(app).toContain('pageCount={RENTER_ONBOARDING_STEPS.length}');
    expect(app).toContain("definition.id === 'CONTACT_VERIFICATION'");
    expect(app).toContain('step={definition.kycStep}');
    expect(guided).toContain('<Button label="Skip onboarding" onPress={onSkip} variant="ghost" />');
  });

  it('uses one reusable persistent footer on contact and KYC pages', () => {
    expect(guided).toContain('export function RenterOnboardingFooter');
    expect(guided).toContain('<RenterOnboardingFooter primaryLabel="Get started"');
    expect(pages).toContain('<RenterOnboardingFooter');
    expect(workflow).toContain('<RenterOnboardingFooter');
    expect(pages).toContain('bottomAccessory={');
    expect(workflow).toContain('bottomAccessory={');
  });

  it('keeps Back on steps with a previous destination and omits it on step one', () => {
    expect(guided).toContain('onBack && (');
    expect(guided).toContain('variant="secondary"');
    expect(pages).toContain('onBack={onBack}');
    expect(workflow).toContain('{...(step === 0 ? {} : { onBack: () => back(step - 1) })}');
  });

  it('uses Continue before the final step and preserves final submission semantics', () => {
    expect(workflow).toContain(": 'Continue'");
    expect(workflow).toContain("'Submit verification'");
    expect(workflow).toContain("'Resubmit verification'");
    expect(workflow).toContain('if (step === 6) return submit.mutate()');
    expect(workflow).toContain("apiClient.request('/renter-verification/submission'");
  });

  it('preserves step validation and save payload authorities', () => {
    expect(workflow).toContain('personalError(form)');
    expect(workflow).toContain('addressError(form)');
    expect(workflow).toContain('driverError(form');
    expect(workflow).toContain("stage: 'PERSONAL_INFORMATION'");
    expect(workflow).toContain("stage: 'RESIDENTIAL_ADDRESS'");
    expect(workflow).toContain("stage: 'DRIVER_INFORMATION'");
  });

  it('removes in-content onboarding navigation without changing account verification navigation', () => {
    expect(workflow).toContain('hidden={Boolean(onboardingNavigation)}');
    expect(workflow).toContain('showNavigation={!onboardingNavigation}');
    expect(workflow).toContain('if (hidden) return null');
    expect(workflow).toContain('{showNavigation && (');
  });
});
