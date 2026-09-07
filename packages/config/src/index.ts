import { z } from 'zod';

const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const applicationEnvironmentSchema = z.enum(['local', 'test', 'staging', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const commonSchema = z.object({
  NODE_ENV: runtimeEnvironmentSchema.default('development'),
  APP_ENV: applicationEnvironmentSchema.default('local'),
  LOG_LEVEL: logLevelSchema.default('info'),
  RELEASE_VERSION: z.string().min(1).default('development'),
  SERVICE_NAME: z.string().min(1).default('carshare'),
  SENTRY_TEST_EVENT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DATABASE_ENVIRONMENT: applicationEnvironmentSchema.optional(),
  REDIS_ENVIRONMENT: applicationEnvironmentSchema.optional(),
});

const paymentSchema = z.object({
  PAYMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYMENT_PROVIDER: z.enum(['fake', 'maya']).default('fake'),
  PAYMENT_UNKNOWN_GRACE_MINUTES: z.coerce.number().int().min(1).max(30).default(5),
  PAYMENT_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
  SECURITY_DEPOSIT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MAYA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  MAYA_PUBLIC_KEY: z.string().min(1).optional(),
  MAYA_SECRET_KEY: z.string().min(1).optional(),
  MAYA_AUTH_CAPTURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MAYA_VOID_REFUND_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MAYA_SUCCESS_URL: z.url().default('http://localhost:8081/payment/success'),
  MAYA_FAILURE_URL: z.url().default('http://localhost:8081/payment/failure'),
  MAYA_CANCEL_URL: z.url().default('http://localhost:8081/payment/cancel'),
});

const payoutSchema = z.object({
  PAYOUTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYOUT_PROVIDER: z.enum(['fake', 'xendit']).default('fake'),
  PAYOUT_MINIMUM_AMOUNT_MINOR: z.coerce.number().int().positive().default(10000),
  PAYOUT_AUTO_CREATE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYOUT_AUTO_SUBMIT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYOUT_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  PAYOUT_SUBMITTING_STALE_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  PAYOUT_PROCESSING_STALE_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  PAYOUT_FOUR_EYES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYOUT_WITHHOLDING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PAYOUT_DATA_ENCRYPTION_KEY_BASE64: z
    .string()
    .min(43)
    .default('bG9jYWwtcGF5b3V0LWVuY3J5cHRpb24ta2V5LTMyISE='),
  PAYOUT_IDENTIFIER_HASH_SECRET: z
    .string()
    .min(32)
    .default('local-payout-identifier-hash-secret-change-me'),
  XENDIT_ENVIRONMENT: z.enum(['test', 'production']).default('test'),
  XENDIT_SECRET_KEY: z.string().min(1).optional(),
  XENDIT_WEBHOOK_TOKEN: z.string().min(1).optional(),
});

const rentalOperationsSchema = z.object({
  PICKUP_WINDOW_EARLY_MINUTES: z.coerce.number().int().min(0).max(120).default(30),
  PICKUP_WINDOW_GRACE_MINUTES: z.coerce.number().int().min(15).max(240).default(60),
  PICKUP_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
  PICKUP_VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
  RETURN_CONFIRMATION_GRACE_MINUTES: z.coerce.number().int().min(15).max(1440).default(120),
  RENTAL_OPERATIONS_SWEEP_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
  CLAIM_RESPONSE_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
});

const communicationsSchema = z.object({
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  PUSH_PROVIDER: z.enum(['fake', 'expo', 'in_app']).default('fake'),
  EXPO_PUSH_ACCESS_TOKEN: z.string().min(1).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).optional(),
  FIREBASE_ANDROID_APP_ID: z.string().min(1).optional(),
  FCM_CREDENTIALS_BASE64: z.string().min(1).optional(),
  NOTIFICATION_DELIVERY_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(10),
  PUSH_RECEIPT_DELAY_SECONDS: z.coerce.number().int().min(5).max(3600).default(900),
  REVIEW_WINDOW_DAYS: z.coerce.number().int().min(1).max(14).default(14),
  POST_RENTAL_MESSAGING_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  MESSAGE_MAX_LENGTH: z.coerce.number().int().min(100).max(2000).default(2000),
  MESSAGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
});

const apiEnvironmentSchema = commonSchema
  .extend({
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
    API_PUBLIC_URL: z.url().default('http://localhost:3000'),
    ADMIN_PUBLIC_URL: z.url().default('http://localhost:3001'),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32),
    TOKEN_HASH_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('carrental-api'),
    JWT_AUDIENCE: z.string().min(1).default('carrental-clients'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    EMAIL_VERIFICATION_TTL_MINUTES: z.coerce.number().int().min(10).max(2880).default(1440),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
    OTP_TTL_MINUTES: z.coerce.number().int().min(2).max(30).default(10),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(30).max(600).default(60),
    QUOTE_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
    BOOKING_HOLD_TTL_MINUTES: z.coerce.number().int().min(1).max(30).default(10),
    OWNER_RESPONSE_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
    AUTH_DELIVERY_PROVIDER: z.enum(['development', 'external']).default('development'),
    AUTH_DELIVERY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EMAIL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SMS_OTP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    AUTOMATED_KYC_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    EMAIL_PROVIDER: z.enum(['disabled', 'development', 'postmark']).default('disabled'),
    POSTMARK_SERVER_TOKEN: z.string().min(1).optional(),
    POSTMARK_FROM_EMAIL: z.string().email().optional(),
    POSTMARK_MESSAGE_STREAM: z.string().min(1).default('outbound'),
    POSTMARK_WEBHOOK_SECRET: z.string().min(16).optional(),
    SMS_PROVIDER: z.enum(['disabled', 'development', 'semaphore']).default('disabled'),
    SEMAPHORE_API_KEY: z.string().min(1).optional(),
    SEMAPHORE_SENDER_NAME: z.string().min(1).max(11).optional(),
    SEMAPHORE_API_URL: z.url().default('https://api.semaphore.co/api/v4/messages'),
    KYC_PROVIDER: z.enum(['manual', 'fake', 'sumsub']).default('manual'),
    SUMSUB_APP_TOKEN: z.string().min(1).optional(),
    SUMSUB_SECRET_KEY: z.string().min(1).optional(),
    GEOCODING_PROVIDER: z.enum(['disabled', 'external']).default('disabled'),
    OBSERVABILITY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SENTRY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SENTRY_API_DSN: z.string().url().optional(),
    OBJECT_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    OBJECT_STORAGE_ENVIRONMENT: applicationEnvironmentSchema.optional(),
    OBJECT_STORAGE_ROOT: z.string().min(1).default('.data/objects'),
    ADMIN_REFRESH_COOKIE_NAME: z.string().min(1).default('carrental_admin_refresh'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  .and(paymentSchema)
  .and(payoutSchema)
  .and(rentalOperationsSchema)
  .and(communicationsSchema);

const workerEnvironmentSchema = commonSchema
  .extend({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    OWNER_RESPONSE_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(60),
    SENTRY_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SENTRY_WORKERS_DSN: z.string().url().optional(),
  })
  .and(paymentSchema)
  .and(payoutSchema)
  .and(rentalOperationsSchema)
  .and(communicationsSchema);

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export function parseApiEnvironment(environment: EnvironmentInput): ApiEnvironment {
  assertProductionPayoutInputs(environment);
  return validateTelemetryTestEnvironment(
    validateAuthDeliveryEnvironment(
      validateCommunicationsEnvironment(
        validateInfrastructureEnvironment(
          validateFinancialEnvironment(apiEnvironmentSchema.parse(environment)),
        ),
      ),
    ),
  );
}

export function parseWorkerEnvironment(environment: EnvironmentInput): WorkerEnvironment {
  assertProductionPayoutInputs(environment);
  return validateTelemetryTestEnvironment(
    validateWorkerTelemetryEnvironment(
      validateCommunicationsEnvironment(
        validateInfrastructureEnvironment(
          validateFinancialEnvironment(workerEnvironmentSchema.parse(environment)),
        ),
      ),
    ),
  );
}

function validateTelemetryTestEnvironment<T extends z.infer<typeof commonSchema>>(
  environment: T,
): T {
  if (environment.SENTRY_TEST_EVENT_ENABLED && !['local', 'test'].includes(environment.APP_ENV))
    throw new Error('Sentry certification events are restricted to local/test.');
  return environment;
}

function validateWorkerTelemetryEnvironment<T extends WorkerEnvironment>(environment: T): T {
  if (environment.SENTRY_ENABLED && !environment.SENTRY_WORKERS_DSN)
    throw new Error('SENTRY_WORKERS_DSN is required when worker Sentry is enabled.');
  return environment;
}

function validateCommunicationsEnvironment<
  T extends z.infer<typeof communicationsSchema> & z.infer<typeof commonSchema>,
>(environment: T): T {
  if (environment.APP_ENV === 'production' && environment.PUSH_PROVIDER === 'fake') {
    throw new Error('PUSH_PROVIDER must not be fake in production.');
  }
  return environment;
}

function validateAuthDeliveryEnvironment<T extends ApiEnvironment>(environment: T): T {
  if (
    environment.APP_ENV === 'production' &&
    environment.AUTH_DELIVERY_PROVIDER === 'development'
  ) {
    throw new Error('AUTH_DELIVERY_PROVIDER must not be development in production.');
  }
  if (
    environment.APP_ENV !== 'local' &&
    environment.APP_ENV !== 'test' &&
    !environment.API_PUBLIC_URL.startsWith('https://')
  )
    throw new Error('API_PUBLIC_URL must use HTTPS outside local/test.');
  if (
    environment.APP_ENV !== 'local' &&
    environment.APP_ENV !== 'test' &&
    !environment.ADMIN_PUBLIC_URL.startsWith('https://')
  )
    throw new Error('ADMIN_PUBLIC_URL must use HTTPS outside local/test.');
  if (
    environment.APP_ENV !== 'local' &&
    environment.APP_ENV !== 'test' &&
    (hasPrivateHost(environment.API_PUBLIC_URL) || hasPrivateHost(environment.ADMIN_PUBLIC_URL))
  )
    throw new Error('Public API/Admin origins must not use local or private hosts.');
  if (
    (environment.OBSERVABILITY_ENABLED || environment.SENTRY_ENABLED) &&
    !environment.SENTRY_API_DSN
  )
    throw new Error('SENTRY_API_DSN is required when API observability is enabled.');
  if (environment.EMAIL_ENABLED) {
    if (environment.EMAIL_PROVIDER === 'disabled')
      throw new Error('EMAIL_PROVIDER must be configured when email is enabled.');
    if (
      environment.EMAIL_PROVIDER === 'postmark' &&
      (!environment.POSTMARK_SERVER_TOKEN || !environment.POSTMARK_FROM_EMAIL)
    )
      throw new Error(
        'POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL are required for Postmark email.',
      );
  }
  if (environment.SMS_OTP_ENABLED) {
    if (environment.SMS_PROVIDER === 'disabled')
      throw new Error('SMS_PROVIDER must be configured when SMS OTP is enabled.');
    if (environment.SMS_PROVIDER === 'semaphore' && !environment.SEMAPHORE_API_KEY)
      throw new Error('SEMAPHORE_API_KEY is required for Semaphore SMS.');
  }
  if (environment.AUTOMATED_KYC_ENABLED) {
    if (environment.KYC_PROVIDER === 'manual')
      throw new Error('KYC_PROVIDER must be configured when automated KYC is enabled.');
    if (
      environment.KYC_PROVIDER === 'sumsub' &&
      (!environment.SUMSUB_APP_TOKEN || !environment.SUMSUB_SECRET_KEY)
    )
      throw new Error('SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY are required for Sumsub KYC.');
  }
  if (
    environment.APP_ENV === 'production' &&
    [environment.EMAIL_PROVIDER, environment.SMS_PROVIDER, environment.KYC_PROVIDER].some(
      (provider) => provider === 'development' || provider === 'fake',
    )
  )
    throw new Error(
      'Development/fake communications or KYC providers are forbidden in production.',
    );
  if (
    environment.OBJECT_STORAGE_PROVIDER === 's3' &&
    environment.OBJECT_STORAGE_ENVIRONMENT !== environment.APP_ENV
  )
    throw new Error('OBJECT_STORAGE_ENVIRONMENT must match APP_ENV for S3 storage.');
  if (
    environment.APP_ENV === 'production' &&
    [environment.JWT_ACCESS_SECRET, environment.TOKEN_HASH_SECRET].some((value) =>
      /local|test|staging|development|change.?me/i.test(value),
    )
  )
    throw new Error('Production authentication secrets must not contain non-production markers.');
  return environment;
}

function hasPrivateHost(value: string): boolean {
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

function assertProductionPayoutInputs(environment: EnvironmentInput): void {
  if (environment.APP_ENV === 'production' && !environment.PAYOUT_MINIMUM_AMOUNT_MINOR) {
    throw new Error('PAYOUT_MINIMUM_AMOUNT_MINOR must be explicitly configured in production.');
  }
}

function validatePaymentEnvironment<
  T extends z.infer<typeof paymentSchema> & z.infer<typeof commonSchema>,
>(environment: T): T {
  if (environment.APP_ENV === 'production' && environment.PAYMENT_PROVIDER !== 'maya') {
    throw new Error('PAYMENT_PROVIDER must be maya in production.');
  }
  if (environment.PAYMENTS_ENABLED && environment.PAYMENT_PROVIDER === 'maya') {
    if (!environment.MAYA_PUBLIC_KEY || !environment.MAYA_SECRET_KEY) {
      throw new Error('MAYA_PUBLIC_KEY and MAYA_SECRET_KEY are required for Maya payments.');
    }
    if (!environment.MAYA_AUTH_CAPTURE_ENABLED) {
      throw new Error(
        'MAYA_AUTH_CAPTURE_ENABLED must reflect an enabled Maya merchant capability.',
      );
    }
  }
  if (
    environment.APP_ENV === 'staging' &&
    environment.PAYMENTS_ENABLED &&
    environment.MAYA_ENVIRONMENT !== 'sandbox'
  )
    throw new Error('Staging payments must use the Maya sandbox environment.');
  if (environment.APP_ENV === 'production' && environment.MAYA_ENVIRONMENT !== 'production')
    throw new Error('Production payment configuration must select Maya production.');
  if (environment.SECURITY_DEPOSIT_ENABLED) {
    throw new Error('Security deposits remain disabled until provider capability is approved.');
  }
  return environment;
}

function validateFinancialEnvironment<
  T extends z.infer<typeof paymentSchema> &
    z.infer<typeof payoutSchema> &
    z.infer<typeof commonSchema>,
>(environment: T): T {
  validatePaymentEnvironment(environment);
  const encryptionKey = Buffer.from(environment.PAYOUT_DATA_ENCRYPTION_KEY_BASE64, 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error('PAYOUT_DATA_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.');
  }
  if (
    environment.APP_ENV === 'production' &&
    (/local|test|staging|development|change.?me/i.test(environment.PAYOUT_IDENTIFIER_HASH_SECRET) ||
      environment.PAYOUT_DATA_ENCRYPTION_KEY_BASE64 ===
        'bG9jYWwtcGF5b3V0LWVuY3J5cHRpb24ta2V5LTMyISE=')
  )
    throw new Error('Production encryption/hash secrets must not use local or test values.');
  if (environment.APP_ENV === 'production' && environment.PAYOUT_PROVIDER !== 'xendit') {
    throw new Error('PAYOUT_PROVIDER must be xendit in production.');
  }
  if (environment.PAYOUTS_ENABLED && environment.PAYOUT_PROVIDER === 'xendit') {
    if (!environment.XENDIT_SECRET_KEY || !environment.XENDIT_WEBHOOK_TOKEN) {
      throw new Error(
        'XENDIT_SECRET_KEY and XENDIT_WEBHOOK_TOKEN are required for Xendit payouts.',
      );
    }
  }
  if (
    environment.APP_ENV === 'staging' &&
    environment.PAYOUTS_ENABLED &&
    environment.XENDIT_ENVIRONMENT !== 'test'
  )
    throw new Error('Staging payouts must use the Xendit test environment.');
  if (environment.APP_ENV === 'production' && environment.XENDIT_ENVIRONMENT !== 'production')
    throw new Error('Production payout configuration must select Xendit production.');
  if (environment.PAYOUT_AUTO_CREATE) {
    throw new Error('PAYOUT_AUTO_CREATE must remain false for the admin-controlled MVP.');
  }
  if (environment.PAYOUT_WITHHOLDING_ENABLED) {
    throw new Error('Payout withholding remains disabled pending accounting and legal review.');
  }
  return environment;
}

function validateInfrastructureEnvironment<
  T extends z.infer<typeof commonSchema> & { DATABASE_URL: string; REDIS_URL: string },
>(environment: T): T {
  if (environment.APP_ENV === 'local' || environment.APP_ENV === 'test') return environment;
  if (environment.DATABASE_ENVIRONMENT !== environment.APP_ENV)
    throw new Error('DATABASE_ENVIRONMENT must match APP_ENV outside local/test.');
  if (environment.REDIS_ENVIRONMENT !== environment.APP_ENV)
    throw new Error('REDIS_ENVIRONMENT must match APP_ENV outside local/test.');
  const forbiddenHost = (value: string) => {
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
  };
  if (forbiddenHost(environment.DATABASE_URL) || forbiddenHost(environment.REDIS_URL))
    throw new Error('Non-local environments must not use local or private database/Redis hosts.');
  if (!environment.REDIS_URL.startsWith('rediss://'))
    throw new Error('REDIS_URL must use TLS (rediss://) outside local/test.');
  return environment;
}
