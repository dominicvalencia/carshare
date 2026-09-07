import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { sentryTransport, telemetryProvider } from '@carrental/provider-core/sentry';
import type { TelemetryProvider } from '@carrental/provider-core/telemetry';
import { mobileSentryOptions, type MobileSentryConfiguration } from './sentry-options';

export function initializeMobileSentry(
  configuration: MobileSentryConfiguration,
): TelemetryProvider {
  const options = mobileSentryOptions(configuration);
  const dsn = configuration.sentryDsn;
  if (options.enabled && !dsn)
    throw new Error('EXPO_PUBLIC_SENTRY_DSN is required when mobile Sentry is enabled.');
  if (options.enabled && dsn) Sentry.init({ ...options, dsn });
  const provider = telemetryProvider({
    enabled: options.enabled,
    environment: configuration.environment,
    release: configuration.release,
    service: 'mobile',
    transport: sentryTransport(Sentry),
  });
  if (configuration.sentryTestEventEnabled && ['local', 'test'].includes(configuration.environment))
    provider.capture({
      name: 'CarShare mobile local Sentry certification',
      environment: configuration.environment,
      release: configuration.release,
      context: {
        ...(configuration.appVersion ? { appVersion: configuration.appVersion } : {}),
        ...(configuration.buildNumber ? { buildNumber: configuration.buildNumber } : {}),
      },
    });
  return provider;
}

const extra = Constants.expoConfig?.extra ?? {};
export const mobileTelemetry = initializeMobileSentry({
  appVersion: Constants.expoConfig?.version,
  buildNumber:
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString(),
  environment: typeof extra.appEnvironment === 'string' ? extra.appEnvironment : 'local',
  release: typeof extra.releaseVersion === 'string' ? extra.releaseVersion : 'development',
  sentryDsn: typeof extra.sentryDsn === 'string' ? extra.sentryDsn : undefined,
  sentryEnabled: extra.sentryEnabled === true,
  sentryTestEventEnabled: extra.sentryTestEventEnabled === true,
});
