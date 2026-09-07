import {
  NoopTelemetryProvider,
  scrubTelemetryContext,
  type TelemetryEvent,
  type TelemetryProvider,
} from './telemetry';

export interface SentryTransport {
  captureException(error: unknown, context: TelemetryEvent): void;
  captureMessage(message: string, context: TelemetryEvent): void;
}

export interface SentrySdkBoundary {
  captureException(error: unknown): unknown;
  captureMessage(message: string): unknown;
  withScope(callback: (scope: SentryScopeBoundary) => void): void;
}

interface SentryScopeBoundary {
  setContext(name: string, context: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
}

const SAFE_CONTEXT_KEYS = [
  'appVersion',
  'buildNumber',
  'errorCode',
  'jobId',
  'jobType',
  'queueName',
  'route',
  'service',
] as const;

export function sentryTransport(sdk: SentrySdkBoundary): SentryTransport {
  const capture = (event: TelemetryEvent, operation: () => void) =>
    sdk.withScope((scope) => {
      scope.setTag('environment', event.environment);
      scope.setTag('release', event.release);
      const context = scrubTelemetryContext(event.context, SAFE_CONTEXT_KEYS);
      if (typeof context.service === 'string') scope.setTag('service', context.service);
      if (event.correlationId) scope.setTag('correlationId', event.correlationId);
      scope.setContext('carshare', {
        ...context,
        ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      });
      operation();
    });
  return {
    captureException: (error, event) => capture(event, () => void sdk.captureException(error)),
    captureMessage: (message, event) => capture(event, () => void sdk.captureMessage(message)),
  };
}

export class SentryTelemetryProvider implements TelemetryProvider {
  constructor(
    private readonly transport: SentryTransport,
    private readonly environment: string,
    private readonly release: string,
    private readonly service: string,
  ) {}

  capture(event: TelemetryEvent): void {
    const normalized = {
      ...event,
      environment: this.environment,
      release: this.release,
      context: { ...event.context, service: this.service },
    };
    this.transport.captureMessage(event.name, normalized);
  }

  captureException(error: unknown, event: TelemetryEvent): void {
    this.transport.captureException(error, {
      ...event,
      environment: this.environment,
      release: this.release,
      context: { ...event.context, service: this.service },
    });
  }
}

export function telemetryProvider(input: {
  readonly enabled: boolean;
  readonly environment: string;
  readonly release: string;
  readonly service: string;
  readonly transport?: SentryTransport;
}): TelemetryProvider {
  return input.enabled && input.transport
    ? new SentryTelemetryProvider(input.transport, input.environment, input.release, input.service)
    : new NoopTelemetryProvider();
}
