import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(
  resolve(root, 'features/account/RenterVerificationWorkflow.tsx'),
  'utf8',
);
const app = readFileSync(resolve(root, '../App.tsx'), 'utf8');
const review = workflow.slice(
  workflow.indexOf('{step === 6 && ('),
  workflow.indexOf('{(save.isError'),
);

describe('renter onboarding Review & finish', () => {
  it('uses compact summaries without the duplicate inner review header or raw field dump', () => {
    expect(review).not.toContain('Review your information before submitting.');
    expect(review).not.toContain('title="Review & submit"');
    expect(review).not.toContain('<ReviewRow');
    expect(review).not.toContain('Middle name');
    expect(review).not.toContain('Display name');
    expect(review).toContain('[form.legalFirstName, form.middleName, form.legalLastName]');
    expect(review).toContain('Born {formatReviewDate(form.dateOfBirth)}');
  });

  it('formats address, contact, license, and optional emergency contact concisely', () => {
    expect(review).toContain('title="Residential address"');
    expect(review).toContain('`Brgy. ${form.barangay}`');
    expect(review).toContain('title="Contact verification"');
    expect(review).toContain('complete={Boolean(snapshot.emailVerifiedAt)}');
    expect(review).toContain('complete={Boolean(snapshot.mobileVerifiedAt)}');
    expect(review).toContain('License number on file');
    expect(review).not.toContain('••••');
    expect(review).toContain('<Text style={styles.reviewBody}>Not provided</Text>');
  });

  it('projects document and identity-photo completion with explicit missing warnings', () => {
    expect(review).toContain('{requiredDocuments.length} required documents');
    expect(review).toContain('{name} is missing.');
    expect(review).toContain('label="Profile photo"');
    expect(review).toContain('label="Selfie with driver\'s license"');
    expect(review).toContain("complete={documents.has('PROFILE_PHOTO')}");
    expect(review).toContain("complete={documents.has('SELFIE_WITH_LICENSE')}");
  });

  it('maps Edit actions to the real onboarding pages', () => {
    expect(review).toContain('editReviewStep(0)');
    expect(review).toContain('editReviewStep(-1)');
    expect(review).toContain('editReviewStep(1)');
    expect(review).toContain('editReviewStep(2)');
    expect(review).toContain('editReviewStep(4)');
    expect(review).toContain('editReviewStep(5)');
    expect(app).toContain('renterOnboardingPageForKycStep(targetStep)');
  });

  it('preserves server submission and global skip behavior', () => {
    expect(workflow).toContain("apiClient.request('/renter-verification/submission'");
    expect(workflow).toContain('if (step === 6) return submit.mutate()');
    expect(app).toContain('onSkip={onSkip}');
    expect(app).toContain("definition.id === 'REVIEW' ? onSkip() : setStage(page + 1)");
  });
});
