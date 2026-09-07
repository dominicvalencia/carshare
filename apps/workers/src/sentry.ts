import * as Sentry from '@sentry/node';
import {
  scrubSentryEvent,
  sentryTransport,
  telemetryProvider,
  type TelemetryProvider,
} from '@carrental/provider-core';
import type { WorkerEnvironment } from '@carrental/config';

export function workerSentryOptions(environment: WorkerEnvironment) {
  return {
    dsn: environment.SENTRY_WORKERS_DSN,
    enabled: environment.SENTRY_ENABLED,
    environment: environment.APP_ENV,
    release: environment.RELEASE_VERSION,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    enableLogs: false,
    beforeSend: scrubSentryEvent,
    initialScope: { tags: { service: 'workers' } },
  } as const;
}

export function initializeWorkerSentry(environment: WorkerEnvironment): TelemetryProvider {
  const options = workerSentryOptions(environment);
  if (options.enabled) Sentry.init(options);
  const provider = telemetryProvider({
    enabled: options.enabled,
    environment: environment.APP_ENV,
    release: environment.RELEASE_VERSION,
    service: 'workers',
    transport: sentryTransport(Sentry),
  });
  if (
    process.env.SENTRY_TEST_EVENT_ENABLED === 'true' &&
    ['local', 'test'].includes(environment.APP_ENV)
  )
    provider.capture({
      name: 'CarShare workers local Sentry certification',
      environment: environment.APP_ENV,
      release: environment.RELEASE_VERSION,
      context: { queueName: 'certification' },
    });
  return provider;
}
