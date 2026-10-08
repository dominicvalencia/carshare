export interface SelfieWithIdGuideGeometry {
  readonly face: {
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
  };
  readonly license: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly gap: number;
  readonly scale: number;
}

export function selfieWithIdGuideGeometry({
  guideHeight,
  guideWidth,
  guideX,
  guideY,
  minimumGap,
}: {
  readonly guideHeight: number;
  readonly guideWidth: number;
  readonly guideX: number;
  readonly guideY: number;
  readonly minimumGap: number;
}): SelfieWithIdGuideGeometry {
  const desiredFaceWidth = guideWidth * 0.5;
  const desiredLicenseWidth = guideWidth * 0.34;
  const availableShapeWidth = Math.max(0, guideWidth - minimumGap);
  const scale = Math.min(1, availableShapeWidth / (desiredFaceWidth + desiredLicenseWidth));
  const faceWidth = desiredFaceWidth * scale;
  const licenseWidth = desiredLicenseWidth * scale;
  const faceHeight = Math.min(guideHeight * 0.72, faceWidth * 1.35);
  const licenseHeight = licenseWidth / 1.59;
  const groupWidth = faceWidth + minimumGap + licenseWidth;
  const groupX = guideX + (guideWidth - groupWidth) / 2;
  const faceCenterY = guideY + guideHeight * 0.44;
  const licenseCenterY = guideY + guideHeight * 0.57;

  return {
    face: {
      cx: groupX + faceWidth / 2,
      cy: faceCenterY,
      rx: faceWidth / 2,
      ry: faceHeight / 2,
    },
    gap: minimumGap,
    license: {
      height: licenseHeight,
      width: licenseWidth,
      x: groupX + faceWidth + minimumGap,
      y: licenseCenterY - licenseHeight / 2,
    },
    scale,
  };
}
