import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'RenterVerificationWorkflow.tsx'),
  'utf8',
);
const selfieSource = source.slice(
  source.indexOf('function IdentityPhotosStage'),
  source.indexOf('function NavigationButtons'),
);
const documentSource = source.slice(
  source.indexOf('function DocumentCaptureRow'),
  source.indexOf('function documentGuidance'),
);

describe('renter selfie capture regression', () => {
  it('uses the shared front-camera guide and exposes no gallery or file picker path', () => {
    expect(selfieSource).toContain('ensureCameraPermission');
    expect(selfieSource).toContain('<NativeCameraCapture');
    expect(selfieSource).toContain('facing="front"');
    expect(selfieSource).toContain("type: 'PROFILE_PHOTO'");
    expect(selfieSource).toContain("type: 'SELFIE_WITH_ID'");
    expect(selfieSource).toContain(
      "Center your face in the oval and hold your driver's license inside the box.",
    );
    expect(selfieSource).toContain('Keep both fully visible and avoid glare.');
    expect(selfieSource).toContain('facing="front"');
    expect(selfieSource).not.toContain('launchCameraAsync');
    expect(selfieSource).not.toContain('launchImageLibraryAsync');
    expect(selfieSource).not.toContain('DocumentPicker');
  });

  it('handles denied camera permission without falling back to gallery', () => {
    expect(selfieSource).toContain('ensureCameraPermission');
  });

  it('does not misrepresent a camera selfie as certified liveness', () => {
    expect(selfieSource).toContain('do not prove certified liveness');
    expect(selfieSource).toContain('manually reviewed');
    expect(selfieSource).not.toContain('Face detected');
  });

  it('uses compact not-added and retained preview states without a duplicate title', () => {
    expect(selfieSource).toContain('code="PROFILE_PHOTO"');
    expect(selfieSource).toContain('code="SELFIE_WITH_LICENSE"');
    expect(selfieSource).toContain('{addedCount} of 2 photos added');
    expect(selfieSource).toContain("label={added ? 'Added' : 'Not added'}");
    expect(selfieSource).toContain('This photo will appear on your renter profile');
    expect(selfieSource).toContain('never be used as your profile photo');
    expect(selfieSource).toContain('fileAssetId={document.fileAsset.id}');
    expect(selfieSource).toContain('accessibilityLabel={`Retake ${title.toLowerCase()}`}');
    expect(selfieSource).not.toContain('title="Selfie verification"');
    expect(selfieSource).toContain('Gallery uploads aren’t allowed.');
    expect(selfieSource).toContain('Face the camera in good lighting');
    expect(selfieSource).toContain('Remove sunglasses or anything covering your face');
    expect(selfieSource).toContain(
      'These photos are manually reviewed and do not prove certified liveness.',
    );
    expect(source).toContain('selfiePreview: {\n    aspectRatio: 1,');
    expect(selfieSource).toContain('<View style={styles.documentAddedRow}>');
    expect(source).not.toContain('selfieAddedRow:');
  });
});

describe('renter document capture regression', () => {
  it('uses a new rear-camera image, attaches immediately, and retains retake preview', () => {
    expect(documentSource).toContain('<NativeCameraCapture');
    expect(documentSource).toContain('facing="back"');
    expect(documentSource).toContain('Retake');
    expect(documentSource).toContain('upload.mutate');
    expect(documentSource).not.toContain('Use photo');
  });

  it('contains no gallery or file-picker fallback', () => {
    expect(source).not.toContain('expo-document-picker');
    expect(documentSource).not.toContain('launchImageLibraryAsync');
    expect(documentSource).toContain('ensureCameraPermission');
  });
});
