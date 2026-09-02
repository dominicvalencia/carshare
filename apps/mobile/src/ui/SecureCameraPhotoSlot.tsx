import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '../theme/tokens';
import { Button } from './primitives';

export function SecureCameraPhotoSlot({
  busy,
  guidance,
  name,
  onCapture,
  persistedPreview,
  previewUri,
  required = true,
  uploaded,
}: {
  readonly busy: boolean;
  readonly guidance: string;
  readonly name: string;
  readonly onCapture: () => void;
  readonly persistedPreview?: ReactNode;
  readonly previewUri?: string | undefined;
  readonly required?: boolean;
  readonly uploaded: boolean;
}) {
  const hasPreview = Boolean(previewUri || persistedPreview);
  return (
    <View style={styles.slot}>
      <Text style={styles.title}>
        {name}
        {required ? ' *' : ''}
      </Text>
      <Text style={styles.guidance}>{guidance}</Text>
      {uploaded && <Text style={styles.success}>✓ Captured and securely uploaded</Text>}
      {previewUri ? (
        <Image
          accessibilityLabel={`${name} camera preview`}
          contentFit="cover"
          source={{ uri: previewUri }}
          style={styles.preview}
        />
      ) : (
        persistedPreview
      )}
      <Button
        disabled={busy}
        icon={hasPreview ? undefined : 'camera-outline'}
        label={busy ? 'Uploading securely…' : hasPreview ? 'Retake' : 'Open camera'}
        onPress={onCapture}
        variant="secondary"
      />
    </View>
  );
}

export const securePhotoPreviewStyle = {
  aspectRatio: 1.58,
  backgroundColor: colors.muted,
  borderRadius: radius.md,
  width: '100%' as const,
};

const styles = StyleSheet.create({
  guidance: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  preview: securePhotoPreviewStyle,
  slot: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  success: { color: colors.primary, fontWeight: '800' },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
