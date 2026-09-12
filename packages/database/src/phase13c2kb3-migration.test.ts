import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260912130000_phase13c2kb3_quote_fulfillment/migration.sql',
  ),
  'utf8',
);

describe('Phase 13C-2K-B3 migration', () => {
  it('creates one immutable structured fulfillment record per quote', () => {
    expect(migration).toContain('CREATE TABLE "pricing_quote_fulfillments"');
    expect(migration).toContain('PRIMARY KEY ("quote_id")');
    expect(migration).toContain('pricing_quote_fulfillments_append_only');
    expect(migration).toContain('reject_append_only_mutation');
  });

  it('constrains coordinates, method-specific fees, and source policy', () => {
    expect(migration).toContain('pricing_quote_fulfillments_coordinates_check');
    expect(migration).toContain('pricing_quote_fulfillments_delivery_check');
    expect(migration).toContain('pricing_quote_fulfillments_collection_check');
    expect(migration).toContain('pricing_quote_fulfillments_source_policy_version_id_fkey');
  });

  it('adds explicit nonnegative owner delivery and collection attribution', () => {
    expect(migration).toContain('delivery_earning_minor');
    expect(migration).toContain('collection_earning_minor');
    expect(migration).toContain('owner_earnings_fulfillment_nonnegative_check');
  });
});
