import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Renter onboarding identity documents layout', () => {
  const workflow = source('features/account/RenterVerificationWorkflow.tsx');
  const onboarding = source('features/account/RenterOnboardingPages.tsx');
  const migration = source(
    '../../../packages/database/prisma/migrations/20260825094500_phase12_renter_verification/migration.sql',
  );
  const guided = source('onboarding/GuidedOnboarding.tsx');

  it('keeps all four server-defined required document types', () => {
    for (const title of [
      'Driver’s license front',
      'Driver’s license back',
      'Additional government-issued ID',
      'Proof of residential address',
    ]) {
      expect(migration).toContain(title);
    }
    expect(migration.match(/true, (10|20|30|40), CURRENT_TIMESTAMP/g)).toHaveLength(4);
    expect(workflow).toContain('definitions={snapshot.definitions.filter');
    expect(workflow).toContain("code !== 'SELFIE' &&");
    expect(workflow).toContain("code !== 'PROFILE_PHOTO' &&");
    expect(workflow).toContain("code !== 'SELFIE_WITH_LICENSE'");
  });

  it('presents individual compact checklist cards and an authoritative completion summary', () => {
    expect(onboarding).toContain("4: 'Identity documents'");
    expect(onboarding).toContain(
      "4: 'Capture clear photos of the documents required to verify your identity.'",
    );
    expect(workflow).toContain('<Card style={[styles.documentCard');
    expect(workflow).toContain("label={added ? 'Added' : 'Not added'}");
    expect(workflow).toContain('requiredDefinitions.filter(({ code }) => documents.has(code))');
    expect(workflow).toContain('required documents added');
    expect(workflow).toContain(
      'showRequirementLabel={requiredDefinitions.length !== definitions.length}',
    );
    expect(workflow).toContain("{definition.required ? 'Required' : 'Optional'}");
  });

  it('keeps rear-camera capture and immediate upload semantics without gallery input', () => {
    expect(workflow).toContain('ensureCameraPermission()');
    expect(workflow).toContain('facing="back"');
    expect(workflow).toContain('quality={0.9}');
    expect(workflow).toContain('upload.mutate({');
    expect(workflow).not.toContain('launchImageLibraryAsync');
    expect(workflow).not.toContain('DocumentPicker');
  });

  it('maps each document identifier to a static responsive capture guide', () => {
    expect(workflow).toContain("code === 'DRIVER_LICENSE_FRONT'");
    expect(workflow).toContain("code === 'DRIVER_LICENSE_BACK'");
    expect(workflow).toContain("code === 'PROOF_OF_ADDRESS'");
    expect(workflow).toContain("type: 'ID_CARD' as const");
    expect(workflow).toContain("type: 'DOCUMENT' as const");
    expect(workflow).toContain('guide={documentCaptureGuide(definition.code)}');
    expect(workflow).not.toContain('crop');
  });

  it('uses compact capture, thumbnail, and specific retake controls', () => {
    expect(workflow).toContain("label={upload.isPending ? 'Uploading…' : 'Capture'}");
    expect(workflow).toContain('style={styles.documentThumbnail}');
    expect(workflow).toContain(
      'accessibilityLabel={`Retake ${definition.name.toLocaleLowerCase()}`}',
    );
    expect(workflow).toContain("{upload.isPending ? 'Uploading…' : 'Retake'}");
    expect(workflow).toContain('<AuthorizedDocumentPreview compact');
    expect(workflow).toContain('documentCardAdded: { paddingVertical: spacing.xs }');
    expect(workflow).toContain('documentStage: { gap: spacing.xs }');
    expect(workflow).toContain('aspectRatio: 1.58');
    expect(workflow).toContain('height: 56');
    expect(workflow).toContain("alignItems: 'flex-end'");
  });

  it('preserves Continue, Back, and Skip onboarding behavior', () => {
    expect(workflow).toContain('onboardingNavigation ? onboardingNavigation.onNext()');
    expect(workflow).toContain('<RenterOnboardingFooter');
    expect(workflow).toContain('primaryLabel={onboardingPrimaryLabel}');
    expect(guided).toContain('<Button label="Skip onboarding" onPress={onSkip} variant="ghost" />');
  });
});
