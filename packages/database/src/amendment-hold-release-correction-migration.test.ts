import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration65 = readFileSync(
  new URL(
    '../prisma/migrations/20260928020352_booking_amendment_foundation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration66 = readFileSync(
  new URL(
    '../prisma/migrations/20260928043000_correct_amendment_hold_release/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration67 = readFileSync(
  new URL(
    '../prisma/migrations/20260928050000_complete_amendment_hold_release/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 66 amendment-hold release correction', () => {
  it('preserves the accepted Migration 65 checksum', () => {
    expect(createHash('sha256').update(migration65).digest('hex')).toBe(
      '90951f91a420bfbf5b9796432a5795497638122648e731dae3f8e1402eaa7a1b',
    );
  });

  it('preserves the applied Migration 66 checksum', () => {
    expect(createHash('sha256').update(migration66).digest('hex')).toBe(
      '8931abe78d19e1664eae030fffe35ea93507fb9159d4ea672ce11fda1ac9473e',
    );
  });

  it('replaces only the broken release function without the invalid column', () => {
    expect(migration66).toContain('CREATE OR REPLACE FUNCTION "release_booking_amendment_holds"');
    expect(migration66).toContain('UPDATE "vehicle_occupancies" occupancy');
    expect(migration66).toContain('SET "active" = false');
    expect(migration66).not.toContain('"updated_at"');
    expect(migration66).not.toContain('pickup_discrepancy_responses');
    expect(migration66).not.toContain('round_number');
    expect(migration66).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP /u);
  });

  it('preserves terminal status, release evidence, idempotency, and return semantics', () => {
    expect(migration66).toContain("IF target_status = 'ACTIVE'");
    expect(migration66).toContain('AND hold."status" = \'ACTIVE\'');
    expect(migration66).toContain('AND occupancy."active" = true');
    expect(migration66).toContain('"released_at" = COALESCE("released_at", CURRENT_TIMESTAMP)');
    expect(migration66).toContain('"release_reason" = COALESCE("release_reason", release_code)');
    expect(migration66).toContain(
      'WHERE "amendment_id" = amendment_uuid AND "status" = \'ACTIVE\'',
    );
    expect(migration66).toContain('GET DIAGNOSTICS released_count = ROW_COUNT');
    expect(migration66).toContain('RETURN released_count');
  });

  it('completes release evidence using only real occupancy columns', () => {
    expect(migration67).toContain('CREATE OR REPLACE FUNCTION "release_booking_amendment_holds"');
    expect(migration67).toContain('SET "active" = false');
    expect(migration67).toContain(
      '"released_at" = COALESCE(occupancy."released_at", CURRENT_TIMESTAMP)',
    );
    expect(migration67).toContain(
      '"release_reason" = COALESCE(occupancy."release_reason", release_code)',
    );
    expect(migration67).not.toContain('"updated_at"');
    expect(migration67).not.toContain('pickup_discrepancy_responses');
    expect(migration67).not.toContain('round_number');
    expect(migration67).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP /u);
  });

  it('keeps release, conversion, expiry, and retry semantics convergent', () => {
    expect(migration67).toContain("IF target_status = 'ACTIVE'");
    expect(migration67).toContain('AND hold."status" = \'ACTIVE\'');
    expect(migration67).toContain('AND occupancy."active" = true');
    expect(migration67).toContain(
      'WHERE "amendment_id" = amendment_uuid AND "status" = \'ACTIVE\'',
    );
    expect(migration67).toContain('GET DIAGNOSTICS released_count = ROW_COUNT');
    expect(migration67).toContain('RETURN released_count');
  });
});
