import { describe, expect, it } from 'vitest';
import { adminSentryOptions } from './sentry-options';

describe('Admin Sentry initialization', () => {
  it('resolves enabled error-only monitoring tags without PII or replay', () => {
    expect(
      adminSentryOptions({
        dsn: 'https://public@example.ingest.sentry.io/1',
        enabled: true,
        environment: 'production',
        release: 'sha-123',
      }),
    ).toMatchObject({
      enabled: true,
      environment: 'production',
      release: 'sha-123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      initialScope: { tags: { service: 'admin' } },
    });
  });
});
