import { describe, expect, it } from 'vitest';
import { parseApiEnvironment, parseWorkerEnvironment } from './index';

describe('environment configuration', () => {
  it('parses and normalizes API configuration', () => {
    const environment = parseApiEnvironment({
      DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: 'http://localhost:3001, http://localhost:8081',
    });

    expect(environment.API_PORT).toBe(3000);
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:3001', 'http://localhost:8081']);
  });

  it('rejects an invalid worker Redis URL', () => {
    expect(() => parseWorkerEnvironment({ REDIS_URL: 'not-a-url' })).toThrow();
  });

  it('rejects the fake payment provider in production', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'production',
        PAYMENTS_ENABLED: 'true',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'production',
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/database',
        PAYMENT_PROVIDER: 'fake',
        MAYA_ENVIRONMENT: 'production',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYOUT_PROVIDER: 'xendit',
        XENDIT_ENVIRONMENT: 'production',
        PAYOUT_DATA_ENCRYPTION_KEY_BASE64: Buffer.from('a'.repeat(32)).toString('base64'),
        PAYOUT_IDENTIFIER_HASH_SECRET: 'production-identifier-hash-secret-unique-value',
        PUSH_PROVIDER: 'in_app',
        REDIS_URL: 'rediss://redis.example.com:6379',
        XENDIT_SECRET_KEY: 'xnd_development_test_secret',
        XENDIT_WEBHOOK_TOKEN: 'test-callback-token',
      }),
    ).toThrow('PAYMENT_PROVIDER must be maya');
  });

  it('rejects the fake payout provider in production', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'production',
        PAYOUTS_ENABLED: 'true',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'production',
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/database',
        MAYA_AUTH_CAPTURE_ENABLED: 'true',
        MAYA_PUBLIC_KEY: 'maya-public',
        MAYA_SECRET_KEY: 'maya-secret',
        MAYA_ENVIRONMENT: 'production',
        PAYMENT_PROVIDER: 'maya',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYOUT_PROVIDER: 'fake',
        XENDIT_ENVIRONMENT: 'production',
        REDIS_URL: 'rediss://redis.example.com:6379',
        PAYOUT_DATA_ENCRYPTION_KEY_BASE64: Buffer.from('b'.repeat(32)).toString('base64'),
        PAYOUT_IDENTIFIER_HASH_SECRET: 'production-identifier-hash-secret-unique-value',
      }),
    ).toThrow('PAYOUT_PROVIDER must be xendit');
  });

  it('rejects the development authentication delivery provider in production', () => {
    expect(() =>
      parseApiEnvironment({
        APP_ENV: 'production',
        AUTH_DELIVERY_ENABLED: 'true',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'production',
        ADMIN_PUBLIC_URL: 'https://admin.example.com',
        API_PUBLIC_URL: 'https://api.example.com',
        AUTH_DELIVERY_PROVIDER: 'development',
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/database',
        JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
        MAYA_AUTH_CAPTURE_ENABLED: 'true',
        MAYA_PUBLIC_KEY: 'maya-public',
        MAYA_SECRET_KEY: 'maya-secret',
        MAYA_ENVIRONMENT: 'production',
        PAYMENT_PROVIDER: 'maya',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYOUT_PROVIDER: 'xendit',
        XENDIT_ENVIRONMENT: 'production',
        PUSH_PROVIDER: 'in_app',
        REDIS_URL: 'rediss://redis.example.com:6379',
        TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
        XENDIT_SECRET_KEY: 'xnd-production-secret',
        XENDIT_WEBHOOK_TOKEN: 'production-callback-token',
        PAYOUT_DATA_ENCRYPTION_KEY_BASE64: Buffer.from('c'.repeat(32)).toString('base64'),
        PAYOUT_IDENTIFIER_HASH_SECRET: 'production-identifier-hash-secret-unique-value',
      }),
    ).toThrow('AUTH_DELIVERY_PROVIDER must not be development in production');
  });

  it('permits disabled production integrations without provider credentials', () => {
    expect(
      parseWorkerEnvironment({
        APP_ENV: 'production',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'production',
        DATABASE_URL: 'postgresql://user:password@db.example.com:5432/database',
        REDIS_URL: 'rediss://redis.example.com:6379',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYMENT_PROVIDER: 'maya',
        PAYOUT_PROVIDER: 'xendit',
        PUSH_PROVIDER: 'in_app',
        MAYA_ENVIRONMENT: 'production',
        XENDIT_ENVIRONMENT: 'production',
        PAYOUT_DATA_ENCRYPTION_KEY_BASE64: Buffer.from('d'.repeat(32)).toString('base64'),
        PAYOUT_IDENTIFIER_HASH_SECRET: 'production-identifier-hash-secret-unique-value',
      }).PAYMENTS_ENABLED,
    ).toBe(false);
  });

  it('rejects production fake adapters even when integrations are disabled', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'production',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'production',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_URL: 'rediss://redis.example.com',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
      }),
    ).toThrow('PAYMENT_PROVIDER must be maya');
  });

  it('rejects cross-environment infrastructure markers', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'staging',
        DATABASE_ENVIRONMENT: 'production',
        REDIS_ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_URL: 'rediss://redis.example.com',
      }),
    ).toThrow('DATABASE_ENVIRONMENT must match');
  });

  it('requires concrete provider configuration only when enabled', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
    };
    expect(() =>
      parseApiEnvironment({ ...base, EMAIL_ENABLED: 'true', EMAIL_PROVIDER: 'postmark' }),
    ).toThrow('POSTMARK_SERVER_TOKEN');
    expect(() =>
      parseApiEnvironment({ ...base, SMS_OTP_ENABLED: 'true', SMS_PROVIDER: 'semaphore' }),
    ).toThrow('SEMAPHORE_API_KEY');
    expect(() =>
      parseApiEnvironment({ ...base, AUTOMATED_KYC_ENABLED: 'true', KYC_PROVIDER: 'sumsub' }),
    ).toThrow('SUMSUB_APP_TOKEN');
    expect(() => parseApiEnvironment({ ...base, SENTRY_ENABLED: 'true' })).toThrow(
      'SENTRY_API_DSN',
    );
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: base.DATABASE_URL,
        REDIS_URL: base.REDIS_URL,
        SENTRY_ENABLED: 'true',
      }),
    ).toThrow('SENTRY_WORKERS_DSN');
    expect(
      parseWorkerEnvironment({
        DATABASE_URL: base.DATABASE_URL,
        REDIS_URL: base.REDIS_URL,
        SENTRY_ENABLED: 'true',
        SENTRY_WORKERS_DSN: 'https://public@example.ingest.sentry.io/1',
      }).SENTRY_ENABLED,
    ).toBe(true);
  });
  it('forbids certification events outside local/test', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'staging',
        DATABASE_ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_ENVIRONMENT: 'staging',
        REDIS_URL: 'rediss://redis.example.com',
        SENTRY_TEST_EVENT_ENABLED: 'true',
      }),
    ).toThrow('local/test');
  });

  it('requires explicit safe inputs for local push certification', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
    };
    expect(() => parseApiEnvironment({ ...base, PUSH_CERTIFICATION_ENABLED: 'true' })).toThrow(
      'PUSH_ENABLED',
    );
    expect(() =>
      parseApiEnvironment({
        ...base,
        PUSH_ENABLED: 'true',
        PUSH_PROVIDER: 'expo',
        PUSH_CERTIFICATION_ENABLED: 'true',
      }),
    ).toThrow('PUSH_CERTIFICATION_EXPO_TOKEN');
    expect(
      parseApiEnvironment({
        ...base,
        PUSH_ENABLED: 'true',
        PUSH_PROVIDER: 'expo',
        PUSH_CERTIFICATION_ENABLED: 'true',
        PUSH_CERTIFICATION_EXPO_TOKEN: 'ExponentPushToken[controlled-device]',
      }).PUSH_CERTIFICATION_ENABLED,
    ).toBe(true);
    expect(() =>
      parseApiEnvironment({
        ...base,
        APP_ENV: 'staging',
        DATABASE_ENVIRONMENT: 'staging',
        REDIS_ENVIRONMENT: 'staging',
        API_PUBLIC_URL: 'https://api.staging.example.com',
        ADMIN_PUBLIC_URL: 'https://admin.staging.example.com',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_URL: 'rediss://redis.example.com',
        PUSH_ENABLED: 'true',
        PUSH_PROVIDER: 'expo',
        PUSH_CERTIFICATION_ENABLED: 'true',
        PUSH_CERTIFICATION_EXPO_TOKEN: 'ExponentPushToken[controlled-device]',
      }),
    ).toThrow('local/test');
  });
  it('requires complete local-only Postmark certification configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
      EMAIL_ENABLED: 'true',
      EMAIL_PROVIDER: 'postmark',
      POSTMARK_SERVER_TOKEN: 'server-token',
      POSTMARK_FROM_EMAIL: 'sender@example.test',
      POSTMARK_CERTIFICATION_RECIPIENT: 'recipient@example.test',
      POSTMARK_CERTIFICATION_ENABLED: 'true',
    };
    expect(parseApiEnvironment(base).POSTMARK_CERTIFICATION_ENABLED).toBe(true);
    expect(() =>
      parseApiEnvironment({ ...base, POSTMARK_CERTIFICATION_RECIPIENT: undefined }),
    ).toThrow('sender, and recipient');
    expect(() =>
      parseApiEnvironment({
        ...base,
        APP_ENV: 'staging',
        DATABASE_ENVIRONMENT: 'staging',
        REDIS_ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_URL: 'rediss://redis.example.com',
        API_PUBLIC_URL: 'https://api.example.com',
        ADMIN_PUBLIC_URL: 'https://admin.example.com',
      }),
    ).toThrow('restricted to local/test');
  });
  it('requires complete local-only Semaphore certification configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
      SMS_OTP_ENABLED: 'true',
      SMS_PROVIDER: 'semaphore',
      SEMAPHORE_API_KEY: 'api-key',
      SEMAPHORE_CERTIFICATION_ENABLED: 'true',
      SEMAPHORE_CERTIFICATION_RECIPIENT: '09171234567',
    };
    expect(parseApiEnvironment(base).SEMAPHORE_CERTIFICATION_ENABLED).toBe(true);
    expect(() =>
      parseApiEnvironment({ ...base, SEMAPHORE_CERTIFICATION_RECIPIENT: undefined }),
    ).toThrow('API key, and a recipient');
    expect(() =>
      parseApiEnvironment({
        ...base,
        APP_ENV: 'staging',
        DATABASE_ENVIRONMENT: 'staging',
        REDIS_ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_URL: 'rediss://redis.example.com',
        API_PUBLIC_URL: 'https://api.example.com',
        ADMIN_PUBLIC_URL: 'https://admin.example.com',
      }),
    ).toThrow('restricted to local/test');
  });
  it('requires an isolated local Maya sandbox certification configuration', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost/db',
      REDIS_URL: 'redis://localhost',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-secret-at-least-thirty-two-characters',
      PAYMENT_PROVIDER: 'maya',
      MAYA_ENVIRONMENT: 'sandbox',
      MAYA_PUBLIC_KEY: 'sandbox-public-key',
      MAYA_CERTIFICATION_ENABLED: 'true',
    };
    expect(parseApiEnvironment(base).MAYA_CERTIFICATION_ENABLED).toBe(true);
    expect(() => parseApiEnvironment({ ...base, MAYA_PUBLIC_KEY: undefined })).toThrow(
      'MAYA_PUBLIC_KEY',
    );
    expect(() => parseApiEnvironment({ ...base, PAYMENTS_ENABLED: 'true' })).toThrow(
      'must remain disabled',
    );
    expect(() =>
      parseApiEnvironment({
        ...base,
        APP_ENV: 'staging',
        API_PUBLIC_URL: 'https://api.staging.example.com',
        ADMIN_PUBLIC_URL: 'https://admin.staging.example.com',
        DATABASE_ENVIRONMENT: 'staging',
        DATABASE_URL: 'postgresql://u:p@db.example.com/db',
        REDIS_ENVIRONMENT: 'staging',
        REDIS_URL: 'rediss://redis.example.com',
      }),
    ).toThrow('restricted to local or test');
  });
});
