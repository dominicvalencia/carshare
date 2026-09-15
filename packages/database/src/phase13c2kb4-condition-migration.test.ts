import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration45 = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260913160000_phase13c2kb4_condition_discrepancy/migration.sql',
  ),
  'utf8',
);
const migration44 = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260913100000_phase13c2kb4_handover_travel/migration.sql',
  ),
);

describe('Phase 13C-2K-B4 condition and discrepancy migration', () => {
  it('keeps Migration 44 unchanged and introduces no destructive backfill', () => {
    expect(createHash('sha256').update(migration44).digest('hex')).toBe(
      'dd7bea8d15ac3f8af1f8c401afa4a5a813933f546dbc10dff2aa8d17e394105b',
    );
    expect(migration45).not.toMatch(/UPDATE "inspections"/);
    expect(migration45).not.toMatch(/INSERT INTO "inspection_condition_issues"/);
    expect(migration45).not.toMatch(/ALTER TYPE "BookingStatus"/);
  });

  it('persists nullable legacy-safe disclosure and structured classifications', () => {
    expect(migration45).toContain('ADD COLUMN "condition_disclosure_state"');
    expect(migration45).not.toContain(
      'condition_disclosure_state" "InspectionConditionDisclosureState" NOT NULL',
    );
    expect(migration45).toContain("'COSMETIC', 'OPERATIONAL', 'SAFETY_CRITICAL'");
    expect(migration45).toContain('CREATE TABLE "inspection_condition_issues"');
    expect(migration45).toContain('CREATE TABLE "inspection_condition_issue_evidence"');
  });

  it('stores separate immutable owner responses and renter reviews', () => {
    expect(migration45).toContain('CREATE TABLE "pickup_discrepancy_responses"');
    expect(migration45).toContain('CREATE TABLE "pickup_discrepancy_resolution_reviews"');
    expect(migration45).toContain('pickup_discrepancy_responses_immutable');
    expect(migration45).toContain('pickup_discrepancy_resolution_reviews_immutable');
    expect(migration45.match(/ON DELETE RESTRICT/g)?.length).toBeGreaterThanOrEqual(9);
  });
});
