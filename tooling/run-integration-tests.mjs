import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL is required so integration fixtures never pollute development data.',
  );
}

await ensureTestDatabase(databaseUrl);

run(['--filter', '@carrental/database', 'exec', 'prisma', 'migrate', 'deploy'], {
  DATABASE_URL: databaseUrl,
});
run(['--filter', '@carrental/database', 'prisma:seed'], {
  APP_ENV: 'test',
  DATABASE_URL: databaseUrl,
  SEED_DEMO_DATA: 'false',
});
run(
  [
    '--filter',
    '@carrental/api',
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.mts',
  ],
  {
    TEST_DATABASE_URL: databaseUrl,
  },
);

function run(arguments_, additions) {
  const result = spawnSync('pnpm', arguments_, {
    cwd: repositoryRoot,
    env: { ...process.env, ...additions },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function ensureTestDatabase(value) {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(databaseName)) {
    throw new Error('TEST_DATABASE_URL must target a database whose name ends in _test.');
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const requireFromDatabase = createRequire(
    resolve(repositoryRoot, 'packages/database/package.json'),
  );
  const { Client } = requireFromDatabase('pg');
  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      databaseName,
    ]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}
