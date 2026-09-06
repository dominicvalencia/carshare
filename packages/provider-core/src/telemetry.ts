const SENSITIVE_KEYS =
  /authorization|cookie|password|otp|token|secret|license|address|message|bank|wallet|card|kyc|selfie|signed.?url/i;

export type TelemetryPrimitive = string | number | boolean | null;
export type TelemetryContext = Readonly<Record<string, TelemetryPrimitive>>;

export interface TelemetryEvent {
  readonly name: string;
  readonly environment: string;
  readonly release: string;
  readonly correlationId?: string;
  readonly context: TelemetryContext;
}

export interface TelemetryProvider {
  capture(event: TelemetryEvent): void;
}

export class NoopTelemetryProvider implements TelemetryProvider {
  capture(_event: TelemetryEvent): void {}
}

export function scrubTelemetryContext(
  context: Readonly<Record<string, unknown>>,
  allowlist: readonly string[],
): TelemetryContext {
  return Object.fromEntries(
    allowlist.flatMap((key) => {
      if (SENSITIVE_KEYS.test(key)) return [];
      const value = context[key];
      return value === null || ['string', 'number', 'boolean'].includes(typeof value)
        ? [[key, value as TelemetryPrimitive]]
        : [];
    }),
  );
}
