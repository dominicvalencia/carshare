import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import type { ConfigContext, ExpoConfig } from 'expo/config';

loadEnvironment({ path: resolve(__dirname, '../../.env'), quiet: true });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'CarShare',
  slug: 'carrental-mobile',
  icon: './assets/carshare-app-icon.png',
  scheme: 'carrental',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'ph.carshare.mobile',
    supportsTablet: true,
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#0C4E39',
      foregroundImage: './assets/carshare-android-adaptive-foreground.png',
    },
    icon: './assets/carshare-app-icon.png',
    package: 'ph.carshare.mobile',
  },
  plugins: [
    'expo-font',
    '@react-native-community/datetimepicker',
    [
      'expo-image-picker',
      {
        cameraPermission:
          'Allow CarShare to use your camera for identity, vehicle, pickup, and return evidence.',
        photosPermission:
          'Allow CarShare to access selected photos for vehicle and rental evidence.',
        microphonePermission: false,
      },
    ],
    'expo-notifications',
    './plugins/personal-team-ios-notifications.config',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Allow CarShare to use Face ID to unlock protected app content.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow CarShare to use your location to find nearby cars and set private pickup points.',
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  },
});
