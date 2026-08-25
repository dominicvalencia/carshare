import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'vitest/config';
import { baseVitestConfig } from '@carrental/test-config';

loadEnvironment({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

export default defineConfig({
  ...baseVitestConfig,
  test: {
    ...baseVitestConfig.test,
    env: {
      APP_ENV: 'test',
      PAYMENT_PROVIDER: 'fake',
      SECURITY_DEPOSIT_ENABLED: 'false',
      API_HOST: '127.0.0.1',
      API_PORT: '3000',
      API_PUBLIC_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3001',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
      JWT_ACCESS_SECRET: 'integration-access-secret-at-least-thirty-two-characters',
      LOG_LEVEL: process.env.INTEGRATION_LOG_LEVEL ?? 'silent',
      NODE_ENV: 'test',
      OBJECT_STORAGE_ROOT: '.data/integration-objects',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      TOKEN_HASH_SECRET: 'integration-token-secret-at-least-thirty-two-characters',
    },
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
  },
});
