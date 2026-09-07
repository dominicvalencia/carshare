import { describe, expect, it } from 'vitest';
import { resolveAdminEnvironment } from './admin-environment';

describe('Admin environment', () => {
  it('defaults to the local API', () =>
    expect(resolveAdminEnvironment({}).apiUrl).toBe('http://localhost:3000/api/v1'));
  it('accepts an isolated staging origin', () =>
    expect(
      resolveAdminEnvironment({
        NEXT_PUBLIC_APP_ENV: 'staging',
        NEXT_PUBLIC_API_ENV: 'staging',
        NEXT_PUBLIC_API_URL: 'https://admin-api.staging.example.com/api/v1',
      }).label,
    ).toBe('Staging'));
  it('rejects a production-to-staging mismatch', () =>
    expect(() =>
      resolveAdminEnvironment({
        NEXT_PUBLIC_APP_ENV: 'production',
        NEXT_PUBLIC_API_ENV: 'staging',
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
      }),
    ).toThrow('must match'));
  it('validates Sentry enablement and local-only certification', () => {
    expect(() => resolveAdminEnvironment({ NEXT_PUBLIC_SENTRY_ENABLED: 'true' })).toThrow(
      'NEXT_PUBLIC_SENTRY_DSN',
    );
    expect(
      resolveAdminEnvironment({
        NEXT_PUBLIC_SENTRY_ENABLED: 'true',
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      }).sentryEnabled,
    ).toBe(true);
    expect(() =>
      resolveAdminEnvironment({
        NEXT_PUBLIC_APP_ENV: 'staging',
        NEXT_PUBLIC_API_ENV: 'staging',
        NEXT_PUBLIC_API_URL: 'https://api.staging.example.com',
        NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED: 'true',
      }),
    ).toThrow('local/test');
  });
});
