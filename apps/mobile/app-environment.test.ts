import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveMobileEnvironment } = require('./app-environment.config.js') as {
  resolveMobileEnvironment: (input: Record<string, string | undefined>) => {
    identifier: string;
    scheme: string;
    name: string;
    extra: Record<string, string | undefined>;
  };
};

describe('mobile environment', () => {
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
});
