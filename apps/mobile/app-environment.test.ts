import { describe, expect, it } from 'vitest';
/* eslint-disable @typescript-eslint/no-require-imports */
const { resolveGoogleServicesFile, resolveMobileEnvironment } =
  require('./app-environment.config.js') as {
    resolveGoogleServicesFile: (
      configuredPath: string | undefined,
      repositoryRoot: string,
      fileExists?: (path: string) => boolean,
    ) => string | undefined;
    resolveMobileEnvironment: (input: Record<string, string | undefined>) => {
      identifier: string;
      scheme: string;
      name: string;
      googleServicesFile?: string;
      projectId?: string;
      extra: Record<string, boolean | string | undefined>;
    };
  };
/* eslint-enable @typescript-eslint/no-require-imports */

describe('mobile environment', () => {
  it('resolves ignored Firebase configuration from the repository root', () => {
    const seen: string[] = [];
    expect(
      resolveGoogleServicesFile(
        '.data/firebase/local/google-services.json',
        '/workspace/carshare',
        (path) => {
          seen.push(path);
          return true;
        },
      ),
    ).toBe('/workspace/carshare/.data/firebase/local/google-services.json');
    expect(seen).toEqual(['/workspace/carshare/.data/firebase/local/google-services.json']);
  });

  it('fails clearly when configured Firebase credentials are absent', () => {
    expect(() =>
      resolveGoogleServicesFile(
        '.data/firebase/local/google-services.json',
        '/workspace/carshare',
        () => false,
      ),
    ).toThrow('does not exist at the resolved repository path');
  });

  it('preserves the accepted local identity', () => {
    expect(resolveMobileEnvironment({})).toMatchObject({
      identifier: 'ph.carshare.mobile',
      scheme: 'carrental',
      name: 'CarShare',
    });
  });
  it('resolves the isolated staging identity', () => {
    expect(
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.staging.example.com/api/v1',
      }),
    ).toMatchObject({
      identifier: 'ph.carshare.mobile.staging',
      scheme: 'carshare-staging',
      name: 'CarShare Staging',
    });
  });
  it('preserves the production identity and scheme', () => {
    expect(
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.com/api/v1',
      }),
    ).toMatchObject({ identifier: 'ph.carshare.mobile', scheme: 'carshare', name: 'CarShare' });
  });
  it('exposes only the public mobile allowlist', () => {
    const resolved = resolveMobileEnvironment({
      DATABASE_URL: 'must-not-leak',
      JWT_ACCESS_SECRET: 'must-not-leak',
    });
    expect(resolved.extra).not.toHaveProperty('DATABASE_URL');
    expect(resolved.extra).not.toHaveProperty('JWT_ACCESS_SECRET');
  });
  it('rejects cross-environment and local staging origins', () => {
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
      }),
    ).toThrow('must match');
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'http://192.168.1.2:3000',
      }),
    ).toThrow('public HTTPS');
  });
  it('validates Sentry enablement and restricts certification events', () => {
    expect(() => resolveMobileEnvironment({ SENTRY_ENABLED: 'true' })).toThrow(
      'EXPO_PUBLIC_SENTRY_DSN',
    );
    expect(
      resolveMobileEnvironment({
        SENTRY_ENABLED: 'true',
        EXPO_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      }).extra,
    ).toMatchObject({ sentryEnabled: true });
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
        EXPO_PUBLIC_SENTRY_TEST_EVENT_ENABLED: 'true',
      }),
    ).toThrow('local/test');
  });
  it('requires Firebase native configuration to match the mobile environment', () => {
    expect(
      resolveMobileEnvironment({
        EXPO_ANDROID_GOOGLE_SERVICES_FILE: '.data/firebase/local/google-services.json',
        EXPO_ANDROID_FIREBASE_ENV: 'local',
        EXPO_PUBLIC_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
      }).googleServicesFile,
    ).toBe('.data/firebase/local/google-services.json');
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.staging.example.com',
        EXPO_ANDROID_GOOGLE_SERVICES_FILE: '.data/firebase/local/google-services.json',
        EXPO_ANDROID_FIREBASE_ENV: 'local',
      }),
    ).toThrow('must match');
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'production',
        EXPO_PUBLIC_API_ENV: 'production',
        EXPO_PUBLIC_API_URL: 'https://api.example.com',
        EXPO_ANDROID_GOOGLE_SERVICES_FILE: '.data/firebase/staging/google-services.json',
        EXPO_ANDROID_FIREBASE_ENV: 'staging',
      }),
    ).toThrow('must match');
  });
  it('keeps native Google Maps credentials environment-bound and outside public extras', () => {
    const resolved = resolveMobileEnvironment({
      EXPO_ANDROID_GOOGLE_MAPS_KEY: 'android-development-key',
      EXPO_IOS_GOOGLE_MAPS_KEY: 'ios-development-key',
      EXPO_GOOGLE_MAPS_ENV: 'local',
    });
    expect(resolved).toMatchObject({
      androidGoogleMapsKey: 'android-development-key',
      iosGoogleMapsKey: 'ios-development-key',
    });
    expect(resolved.extra).not.toHaveProperty('androidGoogleMapsKey');
    expect(resolved.extra).not.toHaveProperty('iosGoogleMapsKey');
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.staging.example.com',
        EXPO_ANDROID_GOOGLE_MAPS_KEY: 'local-key',
        EXPO_GOOGLE_MAPS_ENV: 'local',
      }),
    ).toThrow('must match');
  });
  it('resolves the EAS project ID and fails safely when its environment is ambiguous', () => {
    expect(
      resolveMobileEnvironment({
        EXPO_PUBLIC_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
      }),
    ).toMatchObject({
      projectId: '11111111-1111-4111-8111-111111111111',
      identifier: 'ph.carshare.mobile',
    });
    expect(() =>
      resolveMobileEnvironment({
        EXPO_ANDROID_GOOGLE_SERVICES_FILE: '.data/firebase/local/google-services.json',
        EXPO_ANDROID_FIREBASE_ENV: 'local',
      }),
    ).toThrow('EXPO_PUBLIC_PROJECT_ID');
    expect(() =>
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.staging.example.com',
        EXPO_PUBLIC_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
      }),
    ).toThrow('EXPO_PUBLIC_PROJECT_ENV');
    expect(
      resolveMobileEnvironment({
        EXPO_PUBLIC_APP_ENV: 'staging',
        EXPO_PUBLIC_API_ENV: 'staging',
        EXPO_PUBLIC_API_URL: 'https://api.staging.example.com',
        EXPO_PUBLIC_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
        EXPO_PUBLIC_PROJECT_ENV: 'staging',
      }),
    ).toMatchObject({ identifier: 'ph.carshare.mobile.staging' });
  });
});
