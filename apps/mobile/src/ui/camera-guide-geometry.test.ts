import { describe, expect, it } from 'vitest';
import { selfieWithIdGuideGeometry } from './camera-guide-geometry';

describe('selfie-with-license guide geometry', () => {
  it.each([
    { guideHeight: 378, guideWidth: 360, minimumGap: 16 },
    { guideHeight: 273, guideWidth: 260, minimumGap: 16 },
    { guideHeight: 168, guideWidth: 160, minimumGap: 16 },
  ])('keeps the face and license separated in a $guideWidth pt guide', (viewport) => {
    const geometry = selfieWithIdGuideGeometry({ ...viewport, guideX: 12, guideY: 100 });
    const ovalRight = geometry.face.cx + geometry.face.rx;

    expect(geometry.license.x - ovalRight).toBeGreaterThanOrEqual(viewport.minimumGap);
    expect(geometry.face.rx * 2).toBeGreaterThan(geometry.license.width);
    expect(geometry.license.x + geometry.license.width).toBeLessThanOrEqual(
      12 + viewport.guideWidth,
    );
    expect(geometry.face.rx * 2).toBeCloseTo(viewport.guideWidth * 0.5);
    expect(geometry.license.width).toBeCloseTo(viewport.guideWidth * 0.34);
  });

  it('scales both shapes together when the minimum gap constrains the width', () => {
    const geometry = selfieWithIdGuideGeometry({
      guideHeight: 80,
      guideWidth: 40,
      guideX: 0,
      guideY: 0,
      minimumGap: 16,
    });

    expect(geometry.scale).toBeLessThan(1);
    expect(geometry.license.x - (geometry.face.cx + geometry.face.rx)).toBeCloseTo(16);
    expect(geometry.license.x + geometry.license.width).toBeLessThanOrEqual(40);
  });
});
