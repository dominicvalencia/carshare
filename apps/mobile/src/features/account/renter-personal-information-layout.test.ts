import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Renter onboarding personal information layout', () => {
  const onboarding = source('features/account/RenterOnboardingPages.tsx');
  const workflow = source('features/account/RenterVerificationWorkflow.tsx');
  const validation = source('features/account/renter-verification-form.ts');

  it('uses one onboarding heading and renders the fields directly in a compact screen', () => {
    expect(onboarding).toContain('onboardingScreen={{');
    expect(onboarding).toContain("0: 'Personal information'");
    expect(onboarding).toContain("0: 'Enter the details shown on your government-issued ID.'");
    expect(workflow).toContain('{personalFields}');
    expect(workflow).toContain('personalFields: { gap: spacing.md }');
    expect(workflow).toContain('<Card style={styles.personalFormCard}>{personalFields}</Card>');
    expect(workflow).toContain('personalFormCard: { padding: spacing.md }');
  });

  it('keeps the existing personal-information field and validation authority', () => {
    for (const label of [
      'Legal first name *',
      'Legal middle name · Optional',
      'Legal last name *',
      'Date of birth *',
    ]) {
      expect(workflow).toContain(`label="${label}"`);
    }
    for (const placeholder of [
      'Enter your first name',
      'Enter your middle name',
      'Enter your last name',
    ]) {
      expect(workflow).toContain(`placeholder="${placeholder}"`);
    }
    expect(source('ui/DateOnlyField.tsx')).toContain(": 'Select date'");
    expect(validation).toContain('!form.legalFirstName.trim()');
    expect(validation).toContain('!form.legalLastName.trim()');
    expect(validation).toContain('!form.dateOfBirth');
    expect(validation).toContain('form.dateOfBirth > canonicalToday()');
  });

  it('keeps Back and Continue in the persistent screen footer', () => {
    expect(workflow).toContain('bottomAccessory={');
    expect(workflow).toContain('<RenterOnboardingFooter');
    expect(workflow).toContain('{...(step === 0 ? {} : { onBack: () => back(step - 1) })}');
    expect(workflow).toContain('if (step === 0) return advancePersonal()');
    expect(workflow).toContain("'Continue'");
  });

  it('preserves the personal-information save payload and onboarding navigation', () => {
    expect(workflow).toContain("stage: 'PERSONAL_INFORMATION'");
    expect(workflow).toContain('legalFirstName: form.legalFirstName.trim()');
    expect(workflow).toContain('legalLastName: form.legalLastName.trim()');
    expect(workflow).toContain('dateOfBirth: form.dateOfBirth');
    expect(workflow).toContain('onboardingNavigation.onNext()');
  });
});
