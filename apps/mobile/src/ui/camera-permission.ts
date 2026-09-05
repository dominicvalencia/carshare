import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { cameraPermissionAction } from './camera-permission-policy';

export { cameraPermissionAction } from './camera-permission-policy';

function showCameraSettingsAlert() {
  Alert.alert(
    'Camera access is required',
    'Enable Camera access in Settings to capture identity, vehicle, pickup, and return photos.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

export async function ensureCameraPermission(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  const action = cameraPermissionAction(current);
  if (action === 'allow') return true;
  if (action === 'settings') {
    showCameraSettingsAlert();
    return false;
  }
  const requested = await ImagePicker.requestCameraPermissionsAsync();
  if (requested.granted) return true;
  showCameraSettingsAlert();
  return false;
}
