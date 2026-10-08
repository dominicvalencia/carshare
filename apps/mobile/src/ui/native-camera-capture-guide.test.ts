import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'NativeCameraCapture.shared.tsx'),
  'utf8',
);

describe('native camera capture guide', () => {
  it('keeps capture output unchanged beneath a guidance-only overlay', () => {
    expect(source).toContain('takePictureAsync({ quality })');
    expect(source).toContain('if (picture) onCapture(picture)');
    expect(source).not.toContain('crop');
    expect(source).not.toContain('detect');
    expect(source).not.toContain('manipulate');
  });

  it('uses responsive ID-card and page-shaped frames with one continuous cutout mask', () => {
    expect(source).toContain("guide?.type === 'DOCUMENT'");
    expect(source).toContain('guideWidth / 1.59');
    expect(source).toContain('Math.min(width - spacing.xl * 2, 360)');
    expect(source).toContain('id="camera-guide-cutout"');
    expect(source).toContain('maskUnits="userSpaceOnUse"');
    expect(source).toContain('mask="url(#camera-guide-cutout)"');
    expect(source).toContain('fill="rgba(0, 0, 0, 0.42)"');
    expect(source).toContain('stroke="rgba(255, 255, 255, 0.92)"');
    expect(source).not.toContain('styles.dim');
    expect(source).not.toContain('styles.guideRow');
  });

  it('uses a responsive oval cutout for selfie guidance without changing document frames', () => {
    expect(source).toContain("guide?.type === 'PROFILE_PHOTO'");
    expect(source).toContain("guide.type === 'PROFILE_PHOTO'");
    expect(source).toContain('<Ellipse');
    expect(source).toContain('guideWidth * 1.25');
    expect(source).toContain('guideWidth / 1.59');
    expect(source).toContain('guideWidth * 1.3');
  });

  it('provides a static face-and-license guide in the same continuous mask', () => {
    expect(source).toContain("guide.type === 'SELFIE_WITH_ID'");
    expect(source).toContain("guide?.type === 'SELFIE_WITH_ID'");
    expect(source).toContain('selfieWithIdGuide.face.rx');
    expect(source).toContain('selfieWithIdGuide.license.x');
    expect(source).toContain('minimumGap: spacing.md');
    expect(source).not.toContain('faceDetection');
    expect(source).not.toContain('OCR');
  });

  it('keeps accessible Back, document guidance, and specific shutter labels', () => {
    expect(source).toContain('accessibilityLabel="Back"');
    expect(source).toContain('accessibilityLabel={`${guide.title}. ${guide.instructions.join');
    expect(source).toContain('accessibilityLabel={captureLabel}');
  });
});
