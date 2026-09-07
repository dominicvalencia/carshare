import { describe, expect, it, vi } from 'vitest';
import { resolveAdminEnvironment } from './components/admin-environment';
import { triggerAdminSentryCertification } from './sentry-certification';

function marker() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('Admin Sentry certification', () => {
  it('emits exactly once per browser session for an initialized local client', () => {
    const captureMessage = vi.fn();
    const environment = resolveAdminEnvironment({
      NEXT_PUBLIC_APP_ENV: 'local',
      NEXT_PUBLIC_RELEASE_VERSION: 'local-sentry-certification',
      NEXT_PUBLIC_SENTRY_ENABLED: 'true',
      NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED: 'true',
    });
    const input = {
      environment,
      clientSdkInitialized: true,
      captureMessage,
      marker: marker(),
    };

    expect(triggerAdminSentryCertification(input)).toBe(true);
    expect(triggerAdminSentryCertification(input)).toBe(false);
    expect(captureMessage).toHaveBeenCalledOnce();
    expect(captureMessage).toHaveBeenCalledWith('CarShare Admin local Sentry certification');
  });

  it('does not emit when disabled, uninitialized, or outside local/test', () => {
    const captureMessage = vi.fn();
    const disabled = resolveAdminEnvironment({});
    expect(
      triggerAdminSentryCertification({
        environment: disabled,
        clientSdkInitialized: true,
        captureMessage,
        marker: marker(),
      }),
    ).toBe(false);

    const enabled = resolveAdminEnvironment({
      NEXT_PUBLIC_SENTRY_ENABLED: 'true',
      NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
      NEXT_PUBLIC_SENTRY_TEST_EVENT_ENABLED: 'true',
    });
    expect(
      triggerAdminSentryCertification({
        environment: enabled,
        clientSdkInitialized: false,
        captureMessage,
        marker: marker(),
      }),
    ).toBe(false);
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
