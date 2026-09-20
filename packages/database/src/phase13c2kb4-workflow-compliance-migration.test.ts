import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20260917090000_phase13c2kb4_workflow_compliance/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
describe('Migration 50 historical-safe workflow authority', () => {
  it('adds nullable immutable version without default or heuristic backfill', () => {
    expect(migration).toContain('ADD COLUMN "handover_workflow_version" INTEGER;');
    expect(migration).toContain(
      'OLD."handover_workflow_version" IS DISTINCT FROM NEW."handover_workflow_version"',
    );
    expect(migration).not.toMatch(
      /SET "handover_workflow_version"|handover_workflow_version" INTEGER.*DEFAULT/,
    );
  });
  it('preserves legacy, fails closed for unsupported versions and separates Migration 49', () => {
    expect(migration).toContain('IS NULL THEN RETURN NULL');
    expect(migration).toContain("<> 1 THEN RETURN 'UNSUPPORTED_HANDOVER_WORKFLOW'");
    expect(migration).toContain('"booking_cancellation_settlements"');
    expect(migration.indexOf('"booking_cancellation_settlements"')).toBeLessThan(
      migration.indexOf("<> 1 THEN RETURN 'UNSUPPORTED_HANDOVER_WORKFLOW'"),
    );
    expect(migration).toContain('OLD."status" <> \'APPROVED\' OR NEW."status" <> \'SUBMITTING\'');
    expect(migration).toContain(
      'OLD."submitted_at" IS NOT NULL OR OLD."provider_payout_id" IS NOT NULL',
    );
    expect(migration).not.toMatch(/UPDATE "payouts"|UPDATE "payout_items"/);
  });
  it('requires authoritative participant evidence and actual consumed verification', () => {
    for (const reason of [
      'OWNER_INSPECTION_REQUIRED',
      'RENTER_REVIEW_REQUIRED',
      'DISCREPANCY_RESOLUTION_REQUIRED',
      'PICKUP_VERIFICATION_REQUIRED',
      'RENTER_RETURN_INSPECTION_REQUIRED',
      'OWNER_RETURN_REVIEW_REQUIRED',
    ])
      expect(migration).toContain(reason);
    expect(migration).toContain('c."consumed_at" = b."actual_pickup_at"');
    expect(migration).toContain('FOR UPDATE OF e SKIP LOCKED');
    expect(migration).toContain('BEFORE INSERT ON "payout_items"');
    expect(migration).toContain('BEFORE UPDATE ON "payouts"');
  });
  it('includes ACTIVE return overdue without depending on an inspection', () => {
    expect(migration).toContain("b.\"status\" IN ('ACTIVE', 'RETURN_PENDING')");
    expect(migration).not.toContain('JOIN LATERAL');
    expect(migration).toContain('"rental_end" + make_interval');
  });
});
