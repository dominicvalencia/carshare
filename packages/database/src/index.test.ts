import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from './index';

describe('database client factory', () => {
  it('creates a Prisma client without opening a connection eagerly', async () => {
    const client = createDatabaseClient('postgresql://user:password@localhost:5432/database');
    expect(client).toBeDefined();
    await client.$disconnect();
  });
});
