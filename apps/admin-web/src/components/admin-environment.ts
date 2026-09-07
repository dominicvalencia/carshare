export type AdminEnvironment = 'local' | 'test' | 'staging' | 'production';

export function resolveAdminEnvironment(input: Readonly<Record<string, string | undefined>>) {
  const environment = (input.NEXT_PUBLIC_APP_ENV ?? 'local') as AdminEnvironment;
  if (!['local', 'test', 'staging', 'production'].includes(environment))
    throw new Error(`Unsupported NEXT_PUBLIC_APP_ENV: ${environment}`);
  const apiEnvironment = input.NEXT_PUBLIC_API_ENV ?? environment;
  if (apiEnvironment !== environment)
    throw new Error('NEXT_PUBLIC_API_ENV must match NEXT_PUBLIC_APP_ENV.');
  const apiUrl =
    input.NEXT_PUBLIC_API_URL ??
    (environment === 'local' ? 'http://localhost:3000/api/v1' : undefined);
  if (!apiUrl) throw new Error('NEXT_PUBLIC_API_URL is required outside local development.');
  const host = new URL(apiUrl).hostname.toLowerCase();
  const privateHost =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (
    (environment === 'staging' || environment === 'production') &&
    (!apiUrl.startsWith('https://') || privateHost)
  )
    throw new Error('Staging and production Admin builds require a public HTTPS API origin.');
  const sentryEnabled = input.NEXT_PUBLIC_SENTRY_ENABLED === 'true';
  const sentryDsn = input.NEXT_PUBLIC_SENTRY_DSN;
  if (sentryEnabled && !sentryDsn)
    throw new Error('NEXT_PUBLIC_SENTRY_DSN is required when Admin Sentry is enabled.');
  const sentryTestEventEnabled = input.NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED === 'true';
  if (sentryTestEventEnabled && !['local', 'test'].includes(environment))
    throw new Error('Admin Sentry certification events are restricted to local/test.');
  return {
    serviceName: 'carshare-admin',
    environment,
    apiEnvironment,
    apiUrl,
    releaseVersion: input.NEXT_PUBLIC_RELEASE_VERSION ?? 'development',
    sentryDsn,
    sentryEnabled,
    sentryTestEventEnabled,
    label:
      environment === 'production'
        ? 'Production'
        : environment === 'staging'
          ? 'Staging'
          : environment === 'test'
            ? 'Test'
            : 'Local',
  };
}

export const adminEnvironment = resolveAdminEnvironment(process.env);
export const API_URL = adminEnvironment.apiUrl;
export type ReturnTypeOfResolveAdminEnvironment = ReturnType<typeof resolveAdminEnvironment>;
