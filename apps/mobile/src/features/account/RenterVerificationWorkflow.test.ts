import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'RenterVerificationWorkflow.tsx'),
  'utf8',
);
const selfieSource = source.slice(
  source.indexOf('function SelfieStage'),
  source.indexOf('function NavigationButtons'),
);
const documentSource = source.slice(
  source.indexOf('function DocumentCaptureRow'),
  source.indexOf('function documentGuidance'),
);

describe('renter selfie capture regression', () => {
  it('uses a new front-camera capture and exposes no gallery or file picker path', () => {
    expect(selfieSource).toContain('requestCameraPermissionsAsync');
    expect(selfieSource).toContain('launchCameraAsync');
    expect(selfieSource).toContain('CameraType.front');
    expect(selfieSource).not.toContain('launchImageLibraryAsync');
    expect(selfieSource).not.toContain('DocumentPicker');
  });

  it('handles denied camera permission without falling back to gallery', () => {
    expect(selfieSource).toContain('Camera access required');
    expect(selfieSource).toContain('Linking.openSettings');
    expect(selfieSource).toContain('Gallery upload is not available');
  });

  it('does not misrepresent a camera selfie as certified liveness', () => {
    expect(selfieSource).toContain('does not prove certified liveness');
    expect(selfieSource).toContain('Selfie submitted for manual review');
  });
});

describe('renter document capture regression', () => {
  it('uses a new rear-camera image, attaches immediately, and retains retake preview', () => {
    expect(documentSource).toContain('launchCameraAsync');
    expect(documentSource).toContain('CameraType.back');
    expect(documentSource).toContain('Retake');
    expect(documentSource).toContain('upload.mutate');
    expect(documentSource).not.toContain('Use photo');
  });

  it('contains no gallery or file-picker fallback', () => {
    expect(source).not.toContain('expo-document-picker');
    expect(documentSource).not.toContain('launchImageLibraryAsync');
    expect(documentSource).toContain('Gallery and file uploads are not available');
  });
});
