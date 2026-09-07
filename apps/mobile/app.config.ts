import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import type { ConfigContext, ExpoConfig } from 'expo/config';
// Expo evaluates imported config plugins as CommonJS in both local and EAS builds.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveMobileEnvironment } = require('./app-environment.config.js') as {
  resolveMobileEnvironment: (input: NodeJS.ProcessEnv) => {
    name: string;
    identifier: string;
    scheme: string;
    extra: Record<string, boolean | string | undefined>;
  };
};

loadEnvironment({ path: resolve(__dirname, '../../.env'), quiet: true });

export default ({ config }: ConfigContext): ExpoConfig => {
  const mobile = resolveMobileEnvironment(process.env);
  return {
    ...config,
    name: mobile.name,
    slug: 'carrental-mobile',
    icon: './assets/carshare-app-icon.png',
    scheme: mobile.scheme,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: mobile.identifier,
      supportsTablet: true,
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#0C4E39',
        foregroundImage: './assets/carshare-android-adaptive-foreground.png',
      },
      icon: './assets/carshare-app-icon.png',
      package: mobile.identifier,
    },
    plugins: [
      ['@sentry/react-native/expo', { disableAutoUpload: true }],
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
    extra: mobile.extra,
  };
};
