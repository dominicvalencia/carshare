import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260911090000_phase13c2kb1_fulfillment_foundation/migration.sql',
  ),
  'utf8',
);

describe('Phase 13C-2K-B1 migration', () => {
  it('adds explicit start/end methods and guarded policy configuration', () => {
    expect(migration).toContain('CREATE TYPE "StartFulfillmentMethod"');
    expect(migration).toContain('CREATE TYPE "EndFulfillmentMethod"');
    expect(migration).toContain('vehicle_policy_versions_fulfillment_start_check');
    expect(migration).toContain('vehicle_policy_versions_fulfillment_end_check');
    expect(migration).toContain('BETWEEN 1 AND 50000');
  });

  it('creates one immutable structured fulfillment snapshot per booking', () => {
    expect(migration).toContain('CREATE TABLE "booking_fulfillment_snapshots"');
    expect(migration).toContain('PRIMARY KEY ("booking_id")');
    expect(migration).toContain('booking_fulfillment_snapshots_append_only');
    expect(migration).toContain('reject_append_only_mutation');
  });

  it('does not fabricate fulfillment evidence for existing bookings', () => {
    expect(migration).not.toMatch(/INSERT INTO "booking_fulfillment_snapshots"/);
  });
});
