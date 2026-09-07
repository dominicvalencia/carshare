import { describe, expect, it } from 'vitest';
import { apiSentryOptions } from './instrument';

describe('API Sentry initialization', () => {
  it('resolves enabled error-only monitoring tags without PII', () => {
    expect(
      apiSentryOptions({
        APP_ENV: 'staging',
        RELEASE_VERSION: 'sha-123',
        SENTRY_ENABLED: 'true',
        SENTRY_API_DSN: 'https://public@example.ingest.sentry.io/1',
      }),
    ).toMatchObject({
      enabled: true,
      environment: 'staging',
      release: 'sha-123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      initialScope: { tags: { service: 'api' } },
    });
  });
});
