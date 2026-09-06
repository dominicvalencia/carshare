import { NoopTelemetryProvider, type TelemetryEvent, type TelemetryProvider } from './telemetry';

export interface SentryTransport {
  captureException(error: unknown, context: TelemetryEvent): void;
  captureMessage(message: string, context: TelemetryEvent): void;
}

export class SentryTelemetryProvider implements TelemetryProvider {
  constructor(
    private readonly transport: SentryTransport,
    private readonly environment: string,
    private readonly release: string,
  ) {}

  capture(event: TelemetryEvent): void {
    const normalized = {
      ...event,
      environment: this.environment,
      release: this.release,
    };
    this.transport.captureMessage(event.name, normalized);
  }

  captureException(error: unknown, event: TelemetryEvent): void {
    this.transport.captureException(error, {
      ...event,
      environment: this.environment,
      release: this.release,
    });
  }
}

export function telemetryProvider(input: {
  readonly enabled: boolean;
  readonly environment: string;
  readonly release: string;
  readonly transport?: SentryTransport;
}): TelemetryProvider {
  return input.enabled && input.transport
    ? new SentryTelemetryProvider(input.transport, input.environment, input.release)
    : new NoopTelemetryProvider();
}
