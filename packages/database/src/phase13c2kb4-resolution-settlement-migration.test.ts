import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const migration = readFileSync(
  resolve(
    root,
    '20260914150000_phase13c2kb4_continued_resolution_cancellation_settlement/migration.sql',
  ),
  'utf8',
);

describe('Phase 13C-2K-B4 Migration 49', () => {
  it('backfills round one and permits immutable ordered response rounds', () => {
    expect(migration).toContain('"round_number" INTEGER NOT NULL DEFAULT 1');
    expect(migration).not.toContain('UPDATE "pickup_discrepancy_responses"');
    expect(migration).toContain(
      'DROP INDEX IF EXISTS "pickup_discrepancy_responses_incident_id_key"',
    );
    expect(migration).toContain('("incident_id", "round_number")');
    expect(migration).toContain('"previous_response_id"');
    expect(migration).not.toContain('DROP TRIGGER "pickup_discrepancy_responses_immutable"');
  });

  it('adds one immutable, reconciled settlement without fabricating history', () => {
    expect(migration).toContain('CREATE TABLE "booking_cancellation_settlements"');
    expect(migration).toContain('"booking_id" UUID NOT NULL');
    expect(migration).toContain(
      '"refund_amount_minor" + "commission_retained_minor" + "delivery_retained_minor" = "captured_amount_minor"',
    );
    expect(migration).toContain('booking_cancellation_settlements_immutable');
    expect(migration).not.toMatch(/INSERT INTO "booking_cancellation_settlements"/);
  });

  it('does not alter accepted migrations 44 through 48', () => {
    const expected: Record<string, string> = {
      '20260913100000_phase13c2kb4_handover_travel':
        'dd7bea8d15ac3f8af1f8c401afa4a5a813933f546dbc10dff2aa8d17e394105b',
      '20260913160000_phase13c2kb4_condition_discrepancy':
        'af95593a15c6b4f416ea4e4212f5aa3e46c0fac003aa4f7fef9246a24403b313',
      '20260913190000_phase13c2kb4_operations_handover_resolution':
        'd8d70abee1a25d716780a9cf4975e7d472b9a216a1d3f05748365faebe6c1567',
      '20260913210000_phase13c2kb4_vehicle_known_issues':
        '862be54769738b69b3f18bd4e2d97b6347d65ce84e460053d4447d390cce7c83',
      '20260914120000_phase13c2kb4_known_issue_evidence_snapshots':
        '19cd364c0a8ac42b2fded29fb9f695fc75a0e6d3cc0532fea25cd071f07c9f40',
    };
    for (const [name, hash] of Object.entries(expected)) {
      const sql = readFileSync(resolve(root, name, 'migration.sql'));
      expect(createHash('sha256').update(sql).digest('hex')).toBe(hash);
    }
  });
});
