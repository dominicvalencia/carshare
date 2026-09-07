import type { ReturnTypeOfResolveAdminEnvironment } from './components/admin-environment';

const CERTIFICATION_MARKER = 'carshare.admin.sentry-certification.sent';

interface CertificationMarker {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CertificationInput {
  readonly environment: ReturnTypeOfResolveAdminEnvironment;
  readonly clientSdkInitialized: boolean;
  readonly captureMessage: (message: string) => unknown;
  readonly marker: CertificationMarker;
}

export function triggerAdminSentryCertification(input: CertificationInput): boolean {
  const { environment } = input;
  if (
    !environment.sentryEnabled ||
    !environment.sentryDsn ||
    !environment.sentryTestEventEnabled ||
    !['local', 'test'].includes(environment.environment) ||
    !input.clientSdkInitialized ||
    input.marker.getItem(CERTIFICATION_MARKER) === environment.releaseVersion
  )
    return false;

  input.marker.setItem(CERTIFICATION_MARKER, environment.releaseVersion);
  input.captureMessage('CarShare Admin local Sentry certification');
  return true;
}

export function emitAdminSentryDiagnostic(
  environment: ReturnTypeOfResolveAdminEnvironment,
  clientSdkInitialized: boolean,
): void {
  if (!['local', 'test'].includes(environment.environment)) return;
  console.info('[CarShare Admin Sentry]', {
    enabled: environment.sentryEnabled,
    dsnConfigured: Boolean(environment.sentryDsn),
    environment: environment.environment,
    release: environment.releaseVersion,
    service: 'admin',
    certificationEnabled: environment.sentryTestEventEnabled,
    clientSdkInitialized,
  });
}
