import * as Sentry from '@sentry/nextjs';
import { resolveAdminEnvironment } from './components/admin-environment';
import { adminSentryOptions } from './sentry-options';

const environment = resolveAdminEnvironment(process.env);
const options = adminSentryOptions({
  dsn: environment.sentryDsn,
  enabled: environment.sentryEnabled,
  environment: environment.environment,
  release: environment.releaseVersion,
});
if (options.enabled) Sentry.init(options);
