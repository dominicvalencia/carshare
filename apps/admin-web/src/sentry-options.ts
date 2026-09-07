import { scrubSentryEvent } from '@carrental/provider-core/telemetry';

export interface AdminSentryConfiguration {
  readonly dsn?: string | undefined;
  readonly enabled: boolean;
  readonly environment: string;
  readonly release: string;
}

export function adminSentryOptions(configuration: AdminSentryConfiguration) {
  return {
    dsn: configuration.dsn,
    enabled: configuration.enabled,
    environment: configuration.environment,
    release: configuration.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableLogs: false,
    beforeSend: scrubSentryEvent,
    initialScope: { tags: { service: 'admin' } },
  } as const;
}
