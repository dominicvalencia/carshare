import { z } from 'zod';

const runtimeEnvironmentSchema = z.enum(['development', 'test', 'production']);
const applicationEnvironmentSchema = z.enum(['local', 'test', 'staging', 'production']);
const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

const commonSchema = z.object({
  NODE_ENV: runtimeEnvironmentSchema.default('development'),
  APP_ENV: applicationEnvironmentSchema.default('local'),
  LOG_LEVEL: logLevelSchema.default('info'),
});

const paymentSchema = z.object({
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
  RENTAL_OPERATIONS_SWEEP_SECONDS: z.coerce.number().int().min(5).max(300).default(15),
  CLAIM_RESPONSE_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
});

const communicationsSchema = z.object({
  PUSH_PROVIDER: z.enum(['fake', 'expo', 'in_app']).default('fake'),
  EXPO_PUSH_ACCESS_TOKEN: z.string().min(1).optional(),
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
  return validateCommunicationsEnvironment(
    validateFinancialEnvironment(apiEnvironmentSchema.parse(environment)),
  );
}

export function parseWorkerEnvironment(environment: EnvironmentInput): WorkerEnvironment {
  assertProductionPayoutInputs(environment);
  return validateCommunicationsEnvironment(
    validateFinancialEnvironment(workerEnvironmentSchema.parse(environment)),
  );
}

function validateCommunicationsEnvironment<
  T extends z.infer<typeof communicationsSchema> & z.infer<typeof commonSchema>,
>(environment: T): T {
  if (environment.APP_ENV === 'production' && environment.PUSH_PROVIDER === 'fake') {
    throw new Error('PUSH_PROVIDER must not be fake in production.');
  }
  return environment;
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
  if (environment.PAYMENT_PROVIDER === 'maya') {
    if (!environment.MAYA_PUBLIC_KEY || !environment.MAYA_SECRET_KEY) {
      throw new Error('MAYA_PUBLIC_KEY and MAYA_SECRET_KEY are required for Maya payments.');
    }
    if (!environment.MAYA_AUTH_CAPTURE_ENABLED) {
      throw new Error(
        'MAYA_AUTH_CAPTURE_ENABLED must reflect an enabled Maya merchant capability.',
      );
    }
  }
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
  if (environment.APP_ENV === 'production' && environment.PAYOUT_PROVIDER !== 'xendit') {
    throw new Error('PAYOUT_PROVIDER must be xendit in production.');
  }
  if (environment.PAYOUT_PROVIDER === 'xendit') {
    if (!environment.XENDIT_SECRET_KEY || !environment.XENDIT_WEBHOOK_TOKEN) {
      throw new Error(
        'XENDIT_SECRET_KEY and XENDIT_WEBHOOK_TOKEN are required for Xendit payouts.',
      );
    }
  }
  if (environment.PAYOUT_AUTO_CREATE) {
    throw new Error('PAYOUT_AUTO_CREATE must remain false for the admin-controlled MVP.');
  }
  if (environment.PAYOUT_WITHHOLDING_ENABLED) {
    throw new Error('Payout withholding remains disabled pending accounting and legal review.');
  }
  return environment;
}
