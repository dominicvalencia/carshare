import { scrubSentryEvent } from '@carrental/provider-core/telemetry';

export interface MobileSentryConfiguration {
  readonly appVersion?: string | undefined;
  readonly buildNumber?: string | undefined;
  readonly environment: string;
  readonly release: string;
  readonly sentryDsn?: string | undefined;
  readonly sentryEnabled: boolean;
  readonly sentryTestEventEnabled?: boolean;
}

export function mobileSentryOptions(configuration: MobileSentryConfiguration) {
  return {
    dsn: configuration.sentryDsn,
    enabled: configuration.sentryEnabled,
    environment: configuration.environment,
    release: configuration.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    enableLogs: false,
    beforeSend: scrubSentryEvent,
    initialScope: {
      tags: {
        service: 'mobile',
        ...(configuration.appVersion ? { appVersion: configuration.appVersion } : {}),
        ...(configuration.buildNumber ? { buildNumber: configuration.buildNumber } : {}),
      },
    },
  } as const;
}
