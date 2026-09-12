const { existsSync } = require('node:fs');
const { isAbsolute, resolve } = require('node:path');

const identities = {
  local: { name: 'CarShare', identifier: 'ph.carshare.mobile', scheme: 'carrental' },
  test: { name: 'CarShare Test', identifier: 'ph.carshare.mobile.test', scheme: 'carshare-test' },
  staging: {
    name: 'CarShare Staging',
    identifier: 'ph.carshare.mobile.staging',
    scheme: 'carshare-staging',
  },
  production: { name: 'CarShare', identifier: 'ph.carshare.mobile', scheme: 'carshare' },
};

function isPrivateOrigin(value) {
  const host = new URL(value).hostname.toLowerCase();
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function resolveMobileEnvironment(input) {
  const environment = input.EXPO_PUBLIC_APP_ENV ?? 'local';
  if (!(environment in identities))
    throw new Error(`Unsupported EXPO_PUBLIC_APP_ENV: ${environment}`);
  const apiEnvironment = input.EXPO_PUBLIC_API_ENV ?? environment;
  if (apiEnvironment !== environment)
    throw new Error('EXPO_PUBLIC_API_ENV must match EXPO_PUBLIC_APP_ENV.');
  const apiUrl =
    input.EXPO_PUBLIC_API_URL ??
    (environment === 'local' ? 'http://localhost:3000/api/v1' : undefined);
  if (!apiUrl) throw new Error('EXPO_PUBLIC_API_URL is required outside local development.');
  if (
    (environment === 'staging' || environment === 'production') &&
    (!apiUrl.startsWith('https://') || isPrivateOrigin(apiUrl))
  )
    throw new Error('Staging and production mobile builds require a public HTTPS API origin.');
  const identity = identities[environment];
  const sentryEnabled = input.SENTRY_ENABLED === 'true';
  const sentryDsn = input.EXPO_PUBLIC_SENTRY_DSN;
  if (sentryEnabled && !sentryDsn)
    throw new Error('EXPO_PUBLIC_SENTRY_DSN is required when mobile Sentry is enabled.');
  const sentryTestEventEnabled = input.EXPO_PUBLIC_SENTRY_TEST_EVENT_ENABLED === 'true';
  if (sentryTestEventEnabled && !['local', 'test'].includes(environment))
    throw new Error('Mobile Sentry certification events are restricted to local/test.');
  const googleServicesFile = input.EXPO_ANDROID_GOOGLE_SERVICES_FILE;
  const firebaseEnvironment = input.EXPO_ANDROID_FIREBASE_ENV;
  if (googleServicesFile && firebaseEnvironment !== environment)
    throw new Error('EXPO_ANDROID_FIREBASE_ENV must match EXPO_PUBLIC_APP_ENV.');
  const projectId = input.EXPO_PUBLIC_PROJECT_ID;
  const androidGoogleMapsKey = input.EXPO_ANDROID_GOOGLE_MAPS_KEY;
  const iosGoogleMapsKey = input.EXPO_IOS_GOOGLE_MAPS_KEY;
  const mapsEnvironment =
    input.EXPO_GOOGLE_MAPS_ENV ?? (environment === 'local' ? 'local' : undefined);
  if ((androidGoogleMapsKey || iosGoogleMapsKey) && mapsEnvironment !== environment)
    throw new Error('EXPO_GOOGLE_MAPS_ENV must match EXPO_PUBLIC_APP_ENV.');
  const projectEnvironment =
    input.EXPO_PUBLIC_PROJECT_ENV ?? (environment === 'local' ? 'local' : undefined);
  if (googleServicesFile && !projectId)
    throw new Error('EXPO_PUBLIC_PROJECT_ID is required with Android Firebase configuration.');
  if (projectId && projectEnvironment !== environment)
    throw new Error('EXPO_PUBLIC_PROJECT_ENV must match EXPO_PUBLIC_APP_ENV.');
  return {
    environment,
    ...identity,
    googleServicesFile,
    projectId,
    androidGoogleMapsKey,
    iosGoogleMapsKey,
    extra: {
      serviceName: 'carshare-mobile',
      appEnvironment: environment,
      appIdentifier: identity.identifier,
      appScheme: identity.scheme,
      apiEnvironment,
      apiUrl,
      projectId,
      releaseVersion: input.EXPO_PUBLIC_RELEASE_VERSION ?? 'development',
      sentryDsn,
      sentryEnabled,
      sentryTestEventEnabled,
      paymentPublicKey: input.EXPO_PUBLIC_PAYMENT_KEY,
    },
  };
}

function resolveGoogleServicesFile(configuredPath, repositoryRoot, fileExists = existsSync) {
  if (!configuredPath) return undefined;
  const resolvedPath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(repositoryRoot, configuredPath);
  if (!fileExists(resolvedPath)) {
    throw new Error(
      `EXPO_ANDROID_GOOGLE_SERVICES_FILE does not exist at the resolved repository path: ${resolvedPath}`,
    );
  }
  return resolvedPath;
}

module.exports = { resolveGoogleServicesFile, resolveMobileEnvironment };
