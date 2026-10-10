import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, spacing } from '../theme/tokens';
import { Button, Icon } from './primitives';

export function SecureCameraPhotoSlot({
  busy,
  captureLabel,
  checklist = false,
  compactRemoveOverlay = false,
  guidance,
  hideHeader = false,
  name,
  onCapture,
  onRemove,
  persistedPreview,
  previewUri,
  required = true,
  uploaded,
}: {
  readonly busy: boolean;
  readonly captureLabel?: string | undefined;
  readonly checklist?: boolean | undefined;
  readonly compactRemoveOverlay?: boolean | undefined;
  readonly guidance: string;
  readonly hideHeader?: boolean | undefined;
  readonly name: string;
  readonly onCapture: () => void;
  readonly onRemove?: (() => void) | undefined;
  readonly persistedPreview?: ReactNode;
  readonly previewUri?: string | undefined;
  readonly required?: boolean;
  readonly uploaded: boolean;
}) {
  const hasPreview = Boolean(previewUri || persistedPreview);
  return (
    <View style={[styles.slot, checklist && styles.checklistSlot]}>
      {!hideHeader ? (
        <>
          <View style={styles.titleRow}>
            <Text style={styles.title}>
              {name}
              {required ? ' *' : ''}
            </Text>
            {checklist ? (
              <Text
                accessibilityLabel={`${name}, ${hasPreview ? 'Added' : 'Not added'}`}
                style={[styles.status, hasPreview && styles.statusAdded]}
              >
                {hasPreview ? 'Added' : 'Not added'}
              </Text>
            ) : null}
          </View>
          <Text style={styles.guidance}>{guidance}</Text>
        </>
      ) : null}
      {uploaded && !checklist ? (
        <Text style={styles.success}>✓ Captured and securely uploaded</Text>
      ) : null}
      {hasPreview && !checklist ? (
        <View style={styles.previewFrame}>
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
          {compactRemoveOverlay && onRemove ? (
            <Pressable
              accessibilityLabel={`Remove ${name.toLocaleLowerCase()}`}
              accessibilityRole="button"
              disabled={busy}
              hitSlop={8}
              onPress={onRemove}
              style={styles.removeOverlay}
            >
              <Icon color={colors.onPrimary} name="close" size={18} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {checklist ? (
        <View style={hasPreview ? styles.checklistCompleted : undefined}>
          {hasPreview ? (
            <View style={styles.checklistPreviewFrame}>
              {previewUri ? (
                <Image
                  accessibilityLabel={`${name} camera preview`}
                  contentFit="cover"
                  source={{ uri: previewUri }}
                  style={styles.checklistPreview}
                />
              ) : (
                persistedPreview
              )}
            </View>
          ) : null}
          <Button
            compact
            disabled={busy}
            icon="camera-outline"
            label={
              busy ? 'Uploading securely…' : hasPreview ? 'Retake' : (captureLabel ?? 'Capture')
            }
            onPress={onCapture}
            variant="secondary"
          />
        </View>
      ) : !hasPreview || !compactRemoveOverlay ? (
        <Button
          disabled={busy}
          icon={hasPreview ? undefined : 'camera-outline'}
          label={
            busy ? 'Uploading securely…' : hasPreview ? 'Retake' : (captureLabel ?? 'Open camera')
          }
          onPress={onCapture}
          variant="secondary"
        />
      ) : null}
      {hasPreview && onRemove && !compactRemoveOverlay && !checklist ? (
        <Button disabled={busy} label="Remove photo" onPress={onRemove} variant="danger" />
      ) : null}
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
  checklistCompleted: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  checklistPreview: { borderRadius: radius.sm, height: 72, width: 96 },
  checklistPreviewFrame: { overflow: 'hidden' },
  checklistSlot: { paddingBottom: spacing.sm, paddingTop: spacing.sm },
  guidance: { color: colors.subtleText, fontSize: 13, lineHeight: 19 },
  preview: securePhotoPreviewStyle,
  previewFrame: { position: 'relative' },
  removeOverlay: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderColor: colors.onPrimary,
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 34,
  },
  slot: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  success: { color: colors.primary, fontWeight: '800' },
  status: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    color: colors.subtleText,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  statusAdded: { backgroundColor: colors.primarySoft, color: colors.primaryDark },
  title: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});
