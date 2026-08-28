import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import type { ConfigContext, ExpoConfig } from 'expo/config';

loadEnvironment({ path: resolve(__dirname, '../../.env'), quiet: true });

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Car Rental',
  slug: 'carrental-mobile',
  scheme: 'carrental',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'ph.com.carrental.mobile',
    supportsTablet: true,
  },
  android: {
    package: 'ph.com.carrental.mobile',
  },
  plugins: [
    '@react-native-community/datetimepicker',
    'expo-notifications',
    'expo-secure-store',
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Allow Car Rental to use Face ID to unlock protected app content.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Allow Car Rental to use your location to find nearby cars and set private pickup points.',
      },
    ],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  },
});
