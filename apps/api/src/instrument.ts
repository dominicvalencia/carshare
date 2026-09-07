import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import * as Sentry from '@sentry/nestjs';
import {
  scrubSentryEvent,
  sentryTransport,
  telemetryProvider,
  type TelemetryProvider,
} from '@carrental/provider-core';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

export interface ApiSentryConfiguration {
  readonly APP_ENV?: string;
  readonly RELEASE_VERSION?: string;
  readonly SENTRY_API_DSN?: string;
  readonly SENTRY_ENABLED?: string;
  readonly SENTRY_TEST_EVENT_ENABLED?: string;
}

export function apiSentryOptions(configuration: ApiSentryConfiguration) {
  return {
    dsn: configuration.SENTRY_API_DSN,
    enabled: configuration.SENTRY_ENABLED === 'true',
    environment: configuration.APP_ENV ?? 'local',
    release: configuration.RELEASE_VERSION ?? 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    enableLogs: false,
    beforeSend: scrubSentryEvent,
    initialScope: { tags: { service: 'api' } },
  } as const;
}

export function initializeApiSentry(
  configuration: ApiSentryConfiguration = process.env,
): TelemetryProvider {
  const options = apiSentryOptions(configuration);
  if (options.enabled && !options.dsn)
    throw new Error('SENTRY_API_DSN is required when API Sentry is enabled.');
  if (options.enabled) Sentry.init(options);
  const provider = telemetryProvider({
    enabled: options.enabled,
    environment: options.environment,
    release: options.release,
    service: 'api',
    transport: sentryTransport(Sentry),
  });
  if (
    configuration.SENTRY_TEST_EVENT_ENABLED === 'true' &&
    ['local', 'test'].includes(options.environment)
  )
    provider.capture({
      name: 'CarShare API local Sentry certification',
      environment: options.environment,
      release: options.release,
      context: { route: 'certification' },
    });
  return provider;
}

export const apiTelemetry = initializeApiSentry();
