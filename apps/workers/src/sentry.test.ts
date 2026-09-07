import { describe, expect, it } from 'vitest';
import { parseWorkerEnvironment } from '@carrental/config';
import { workerSentryOptions } from './sentry';

describe('worker Sentry initialization', () => {
  it('resolves enabled error-only monitoring tags without PII', () => {
    const environment = parseWorkerEnvironment({
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      RELEASE_VERSION: 'sha-123',
      SENTRY_ENABLED: 'true',
      SENTRY_WORKERS_DSN: 'https://public@example.ingest.sentry.io/1',
    });
    expect(workerSentryOptions(environment)).toMatchObject({
      enabled: true,
      environment: 'test',
      release: 'sha-123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      initialScope: { tags: { service: 'workers' } },
    });
  });
});
