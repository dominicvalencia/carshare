import * as Sentry from '@sentry/nextjs';
import { emitAdminSentryDiagnostic, triggerAdminSentryCertification } from './sentry-certification';
import { resolveAdminEnvironment } from './components/admin-environment';
import { adminSentryOptions } from './sentry-options';

// NEXT_PUBLIC values must be referenced directly for Next.js to inline them in the browser bundle.
const environment = resolveAdminEnvironment({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_ENV: process.env.NEXT_PUBLIC_API_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_RELEASE_VERSION: process.env.NEXT_PUBLIC_RELEASE_VERSION,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENABLED: process.env.NEXT_PUBLIC_SENTRY_ENABLED,
  NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED: process.env.NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED,
});
const options = adminSentryOptions({
  dsn: environment.sentryDsn,
  enabled: environment.sentryEnabled,
  environment: environment.environment,
  release: environment.releaseVersion,
});
if (options.enabled) Sentry.init(options);
const clientSdkInitialized = Sentry.getClient() !== undefined;
emitAdminSentryDiagnostic(environment, clientSdkInitialized);
triggerAdminSentryCertification({
  environment,
  clientSdkInitialized,
  captureMessage: Sentry.captureMessage,
  marker: window.sessionStorage,
});
