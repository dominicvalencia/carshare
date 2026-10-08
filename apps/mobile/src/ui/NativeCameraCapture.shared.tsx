import { CameraView } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg';
import { colors, radius, spacing } from '../theme/tokens';
import { selfieWithIdGuideGeometry } from './camera-guide-geometry';

export interface NativeCameraPicture {
  readonly format: 'jpg' | 'png';
  readonly height: number;
  readonly uri: string;
  readonly width: number;
}

export type CameraCaptureGuide = {
  readonly instructions: readonly string[];
  readonly title: string;
  readonly type: 'ID_CARD' | 'DOCUMENT' | 'PROFILE_PHOTO' | 'SELFIE_WITH_ID';
};

export interface NativeCameraCaptureProperties {
  readonly captureLabel?: string;
  readonly facing: 'front' | 'back';
  readonly guide?: CameraCaptureGuide;
  readonly onCancel: () => void;
  readonly onCapture: (picture: NativeCameraPicture) => void;
  readonly quality?: number;
  readonly visible: boolean;
}

export function NativeCameraCaptureView({
  captureLabel = 'Take photo',
  facing,
  guide,
  onCancel,
  onCapture,
  quality = 0.85,
  visible,
}: NativeCameraCaptureProperties) {
  const camera = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [capturing, setCapturing] = useState(false);
  const guideWidth =
    guide?.type === 'PROFILE_PHOTO'
      ? Math.min(width - spacing.xl * 2, 280)
      : Math.min(width - spacing.xl * 2, 360);
  const availableGuideHeight = Math.max(180, height - insets.top - insets.bottom - 300);
  const guideHeight =
    guide?.type === 'PROFILE_PHOTO'
      ? Math.min(availableGuideHeight, guideWidth * 1.25)
      : guide?.type === 'SELFIE_WITH_ID'
        ? Math.min(availableGuideHeight, guideWidth * 1.05)
        : guide?.type === 'DOCUMENT'
          ? Math.min(availableGuideHeight, guideWidth * 1.3)
          : guideWidth / 1.59;
  const guideAreaTop = insets.top + 92;
  const guideAreaBottom = 142 + insets.bottom;
  const guideAreaHeight = Math.max(0, height - guideAreaTop - guideAreaBottom);
  const guideX = (width - guideWidth) / 2;
  const guideY = guideAreaTop + (guideAreaHeight - guideHeight) / 2;
  const guideRadius = guide?.type === 'DOCUMENT' ? radius.md : radius.lg;
  const selfieWithIdGuide = selfieWithIdGuideGeometry({
    guideHeight,
    guideWidth,
    guideX,
    guideY,
    minimumGap: spacing.md,
  });

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality });
      if (picture) onCapture(picture);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <View style={styles.shell}>
        <CameraView facing={facing} ref={camera} style={StyleSheet.absoluteFill} />
        {guide && (
          <Svg
            accessibilityLabel={`${guide.title}. ${guide.instructions.join(' ')}`}
            accessible
            height={height}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            width={width}
          >
            <Defs>
              <Mask
                height={height}
                id="camera-guide-cutout"
                maskUnits="userSpaceOnUse"
                width={width}
                x={0}
                y={0}
              >
                <Rect fill="#fff" height={height} width={width} x={0} y={0} />
                {guide.type === 'PROFILE_PHOTO' ? (
                  <Ellipse
                    cx={guideX + guideWidth / 2}
                    cy={guideY + guideHeight / 2}
                    fill="#000"
                    rx={guideWidth / 2}
                    ry={guideHeight / 2}
                  />
                ) : guide.type === 'SELFIE_WITH_ID' ? (
                  <>
                    <Ellipse
                      cx={selfieWithIdGuide.face.cx}
                      cy={selfieWithIdGuide.face.cy}
                      fill="#000"
                      rx={selfieWithIdGuide.face.rx}
                      ry={selfieWithIdGuide.face.ry}
                    />
                    <Rect
                      fill="#000"
                      height={selfieWithIdGuide.license.height}
                      rx={radius.sm}
                      width={selfieWithIdGuide.license.width}
                      x={selfieWithIdGuide.license.x}
                      y={selfieWithIdGuide.license.y}
                    />
                  </>
                ) : (
                  <Rect
                    fill="#000"
                    height={guideHeight}
                    rx={guideRadius}
                    width={guideWidth}
                    x={guideX}
                    y={guideY}
                  />
                )}
              </Mask>
            </Defs>
            <Rect
              fill="rgba(0, 0, 0, 0.42)"
              height={height}
              mask="url(#camera-guide-cutout)"
              width={width}
              x={0}
              y={0}
            />
            {guide.type === 'PROFILE_PHOTO' ? (
              <Ellipse
                cx={guideX + guideWidth / 2}
                cy={guideY + guideHeight / 2}
                fill="none"
                rx={guideWidth / 2}
                ry={guideHeight / 2}
                stroke="rgba(255, 255, 255, 0.92)"
                strokeWidth={3}
              />
            ) : guide.type === 'SELFIE_WITH_ID' ? (
              <>
                <Ellipse
                  cx={selfieWithIdGuide.face.cx}
                  cy={selfieWithIdGuide.face.cy}
                  fill="none"
                  rx={selfieWithIdGuide.face.rx}
                  ry={selfieWithIdGuide.face.ry}
                  stroke="rgba(255, 255, 255, 0.92)"
                  strokeWidth={3}
                />
                <Rect
                  fill="none"
                  height={selfieWithIdGuide.license.height}
                  rx={radius.sm}
                  stroke="rgba(255, 255, 255, 0.92)"
                  strokeWidth={3}
                  width={selfieWithIdGuide.license.width}
                  x={selfieWithIdGuide.license.x}
                  y={selfieWithIdGuide.license.y}
                />
              </>
            ) : (
              <Rect
                fill="none"
                height={guideHeight}
                rx={guideRadius}
                stroke="rgba(255, 255, 255, 0.92)"
                strokeWidth={3}
                width={guideWidth}
                x={guideX}
                y={guideY}
              />
            )}
          </Svg>
        )}
        <View style={[styles.header, { paddingTop: Math.max(insets.top, spacing.md) }]}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onCancel}
            style={styles.back}
          >
            <Text style={styles.backLabel}>← Back</Text>
          </Pressable>
          {guide && (
            <Text accessibilityRole="header" style={styles.title}>
              {guide.title}
            </Text>
          )}
        </View>
        {guide && (
          <View style={[styles.instructions, { bottom: 116 + insets.bottom }]}>
            {guide.instructions.map((instruction) => (
              <Text key={instruction} style={styles.instructionText}>
                {instruction}
              </Text>
            ))}
          </View>
        )}
        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.control} />
          <Pressable
            accessibilityLabel={captureLabel}
            accessibilityRole="button"
            disabled={capturing}
            onPress={() => void capture()}
            style={[styles.shutter, capturing && styles.disabled]}
          >
            <View style={styles.shutterCenter} />
          </Pressable>
          <View style={styles.control} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { justifyContent: 'center', minHeight: 44, minWidth: 80 },
  backLabel: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  control: { minWidth: 72 },
  controls: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    paddingTop: spacing.md,
    position: 'absolute',
    right: 0,
  },
  disabled: { opacity: 0.55 },
  header: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flexDirection: 'row',
    gap: spacing.sm,
    left: 0,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  instructions: {
    alignItems: 'center',
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
  },
  instructionText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowRadius: 3,
  },
  shell: { backgroundColor: '#000', flex: 1 },
  shutter: {
    alignItems: 'center',
    borderColor: '#fff',
    borderRadius: 36,
    borderWidth: 4,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  shutterCenter: { backgroundColor: '#fff', borderRadius: 28, height: 56, width: 56 },
  title: {
    color: colors.onPrimary,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    paddingRight: 80,
    textAlign: 'center',
  },
});
