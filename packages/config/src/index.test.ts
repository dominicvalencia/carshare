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
        DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
        PAYMENT_PROVIDER: 'fake',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYOUT_PROVIDER: 'xendit',
        REDIS_URL: 'redis://localhost:6379',
        XENDIT_SECRET_KEY: 'xnd_development_test_secret',
        XENDIT_WEBHOOK_TOKEN: 'test-callback-token',
      }),
    ).toThrow('PAYMENT_PROVIDER must be maya');
  });

  it('rejects the fake payout provider in production', () => {
    expect(() =>
      parseWorkerEnvironment({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/database',
        MAYA_AUTH_CAPTURE_ENABLED: 'true',
        MAYA_PUBLIC_KEY: 'maya-public',
        MAYA_SECRET_KEY: 'maya-secret',
        PAYMENT_PROVIDER: 'maya',
        PAYOUT_MINIMUM_AMOUNT_MINOR: '10000',
        PAYOUT_PROVIDER: 'fake',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toThrow('PAYOUT_PROVIDER must be xendit');
  });
});
