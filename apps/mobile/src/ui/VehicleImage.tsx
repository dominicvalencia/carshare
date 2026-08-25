import { useState } from 'react';
import { Image } from 'expo-image';
import type { ImageStyle, StyleProp } from 'react-native';
import { apiClient } from '../auth/api-client';
import demoImage from '../../assets/demo-vehicle.png';

export function VehicleImage({
  contentPath,
  style,
  accessibilityLabel = 'Vehicle photo',
}: {
  readonly contentPath?: string | null | undefined;
  readonly style: StyleProp<ImageStyle>;
  readonly accessibilityLabel?: string | undefined;
}) {
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = Boolean(contentPath && failedPath === contentPath);
  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      contentFit="cover"
      onError={() => contentPath && setFailedPath(contentPath)}
      source={!failed && contentPath ? { uri: apiClient.assetUrl(contentPath) } : demoImage}
      style={style}
      transition={180}
    />
  );
}
