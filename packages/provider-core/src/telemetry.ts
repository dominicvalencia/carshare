const SENSITIVE_KEYS =
  /authorization|cookie|password|passcode|otp|token|secret|api.?key|jwt|license|government.?id|address|email|mobile|phone|message|bank|wallet|card|payment|kyc|selfie|document|evidence|signed.?url|storage.?grant|webhook.?signature/i;

const SAFE_SENTRY_KEYS = new Set([
  'appVersion',
  'buildNumber',
  'correlationId',
  'environment',
  'errorCode',
  'jobId',
  'jobType',
  'queueName',
  'release',
  'route',
  'service',
]);

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const SIGNED_QUERY_PATTERN = /([?&](?:token|signature|sig|key|credential|expires)=)[^&#]*/gi;

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
  captureException(error: unknown, event: TelemetryEvent): void;
}

export class NoopTelemetryProvider implements TelemetryProvider {
  capture(_event: TelemetryEvent): void {}
  captureException(_error: unknown, _event: TelemetryEvent): void {}
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

export function redactTelemetryString(value: string): string {
  return value
    .replace(BEARER_PATTERN, 'Bearer [Redacted]')
    .replace(JWT_PATTERN, '[Redacted JWT]')
    .replace(EMAIL_PATTERN, '[Redacted email]')
    .replace(SIGNED_QUERY_PATTERN, '$1[Redacted]');
}

type SentryValue = string | number | boolean | null | undefined;

interface SentryEventLike {
  breadcrumbs?: Array<Record<string, unknown>>;
  contexts?: Record<string, Record<string, unknown>>;
  exception?: { values?: Array<{ value?: string; [key: string]: unknown }> };
  extra?: Record<string, unknown>;
  message?: string;
  request?: Record<string, unknown>;
  tags?: Record<string, SentryValue>;
  transaction?: string;
  user?: Record<string, unknown>;
  [key: string]: unknown;
}

function safeRecord(input: Record<string, unknown> | undefined): Record<string, SentryValue> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      SAFE_SENTRY_KEYS.has(key) &&
      !SENSITIVE_KEYS.test(key) &&
      (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        ? [[key, typeof value === 'string' ? redactTelemetryString(value) : (value as SentryValue)]]
        : [],
    ),
  );
}

/** Removes user identity and payload data while retaining allowlisted operational metadata. */
export function scrubSentryEvent<T>(event: T): T {
  const source = event as SentryEventLike;
  const request = source.request;
  const safeUrl =
    typeof request?.url === 'string'
      ? redactTelemetryString(request.url).replace(/[?#].*$/, '')
      : undefined;
  const safeRequest = request
    ? {
        ...(typeof request.method === 'string' ? { method: request.method } : {}),
        ...(safeUrl ? { url: safeUrl } : {}),
      }
    : undefined;
  const safeContexts = source.contexts
    ? Object.fromEntries(
        ['app', 'os', 'runtime'].flatMap((name) => {
          const value = source.contexts?.[name];
          if (!value) return [];
          const cleaned = Object.fromEntries(
            Object.entries(value).flatMap(([key, item]) =>
              !SENSITIVE_KEYS.test(key) &&
              (item === null || ['string', 'number', 'boolean'].includes(typeof item))
                ? [[key, typeof item === 'string' ? redactTelemetryString(item) : item]]
                : [],
            ),
          );
          return [[name, cleaned]];
        }),
      )
    : undefined;

  return {
    ...source,
    user: undefined,
    request: safeRequest,
    extra: safeRecord(source.extra),
    tags: safeRecord(source.tags),
    contexts: safeContexts,
    breadcrumbs: source.breadcrumbs?.map(({ category, level, type }) => ({
      ...(typeof category === 'string' ? { category: redactTelemetryString(category) } : {}),
      ...(typeof level === 'string' ? { level } : {}),
      ...(typeof type === 'string' ? { type } : {}),
    })),
    ...(typeof source.message === 'string'
      ? { message: redactTelemetryString(source.message) }
      : {}),
    ...(typeof source.transaction === 'string'
      ? { transaction: redactTelemetryString(source.transaction).replace(/[?#].*$/, '') }
      : {}),
    ...(source.exception
      ? {
          exception: {
            ...source.exception,
            values: source.exception.values?.map((value) => ({
              ...value,
              ...(typeof value.value === 'string'
                ? { value: redactTelemetryString(value.value) }
                : {}),
            })),
          },
        }
      : {}),
  } as T;
}
