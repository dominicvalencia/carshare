import { describe, expect, it } from 'vitest';
import { mobileSentryOptions } from './sentry-options';

describe('mobile Sentry options', () => {
  it('initializes error monitoring with immutable tags and all performance capture disabled', () => {
    const options = mobileSentryOptions({
      environment: 'local',
      release: 'sha-123',
      sentryDsn: 'https://public@example.ingest.sentry.io/1',
      sentryEnabled: true,
      appVersion: '0.1.0',
      buildNumber: '42',
    });
    expect(options).toMatchObject({
      enabled: true,
      environment: 'local',
      release: 'sha-123',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      profilesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      initialScope: { tags: { service: 'mobile', appVersion: '0.1.0', buildNumber: '42' } },
    });
  });
});
