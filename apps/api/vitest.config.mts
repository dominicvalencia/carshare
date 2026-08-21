import { defineConfig } from 'vitest/config';
import { baseVitestConfig } from '@carrental/test-config';

export default defineConfig({
  ...baseVitestConfig,
  test: {
    ...baseVitestConfig.test,
    env: {
      APP_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '3000',
      API_PUBLIC_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3001',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/test',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-thirty-two-characters',
      TOKEN_HASH_SECRET: 'test-token-hash-secret-at-least-thirty-two-characters',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
      REDIS_URL: 'redis://localhost:6379',
    },
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['test/**/*.integration.test.ts'],
  },
});
