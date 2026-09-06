import { CameraView } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme/tokens';
import type { NativeCameraCaptureProperties } from './NativeCameraCapture';

export function NativeCameraCapture({
  facing,
  onCancel,
  onCapture,
  visible,
}: NativeCameraCaptureProperties) {
  const camera = useRef<CameraView>(null);
  const insets = useSafeAreaInsets();
  const [capturing, setCapturing] = useState(false);

  const capture = async () => {
    if (!camera.current || capturing) return;
    setCapturing(true);
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.85 });
      if (picture) onCapture(picture);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel} visible={visible}>
      <View style={styles.shell}>
        <CameraView facing={facing} ref={camera} style={StyleSheet.absoluteFill} />
        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={styles.control}>
            <Text style={styles.controlLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Take photo"
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
  control: { alignItems: 'center', minWidth: 72 },
  controlLabel: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  controls: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    paddingTop: spacing.lg,
    position: 'absolute',
    right: 0,
  },
  disabled: { opacity: 0.55 },
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
});
