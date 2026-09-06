export interface NativeCameraPicture {
  readonly format: 'jpg' | 'png';
  readonly height: number;
  readonly uri: string;
  readonly width: number;
}

export interface NativeCameraCaptureProperties {
  readonly facing: 'front' | 'back';
  readonly onCancel: () => void;
  readonly onCapture: (picture: NativeCameraPicture) => void;
  readonly visible: boolean;
}

// Android supplies the native implementation in NativeCameraCapture.android.tsx.
// iOS intentionally retains the physically accepted expo-image-picker camera path.
export function NativeCameraCapture(_properties: NativeCameraCaptureProperties) {
  return null;
}
