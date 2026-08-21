import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { defineConfig } from 'prisma/config';

loadEnvironment({ path: resolve(import.meta.dirname, '../../.env'), quiet: true });

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://configuration:required@localhost:5432/configuration';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
