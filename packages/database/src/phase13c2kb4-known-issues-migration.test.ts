import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');

describe('Phase 13C-2K-B4 vehicle known issues migration', () => {
  const migration47 = migration('20260913210000_phase13c2kb4_vehicle_known_issues');

  it('keeps migrations 44 through 46 unchanged', () => {
    expect(
      createHash('sha256')
        .update(migration('20260913100000_phase13c2kb4_handover_travel'))
        .digest('hex'),
    ).toBe('dd7bea8d15ac3f8af1f8c401afa4a5a813933f546dbc10dff2aa8d17e394105b');
    expect(
      createHash('sha256')
        .update(migration('20260913160000_phase13c2kb4_condition_discrepancy'))
        .digest('hex'),
    ).toBe('af95593a15c6b4f416ea4e4212f5aa3e46c0fac003aa4f7fef9246a24403b313');
    expect(
      createHash('sha256')
        .update(migration('20260913190000_phase13c2kb4_operations_handover_resolution'))
        .digest('hex'),
    ).toBe('d8d70abee1a25d716780a9cf4975e7d472b9a216a1d3f05748365faebe6c1567');
  });

  it('adds only the active/resolved registry and private evidence relationship', () => {
    expect(migration47).toContain(
      "CREATE TYPE \"VehicleKnownIssueStatus\" AS ENUM ('ACTIVE', 'RESOLVED')",
    );
    expect(migration47).toContain('CREATE TABLE "vehicle_known_issues"');
    expect(migration47).toContain('CREATE TABLE "vehicle_known_issue_evidence"');
    expect(migration47).toContain('vehicle_known_issues_resolution_state_check');
    expect(migration47).toContain('"file_asset_id" UUID NOT NULL');
    expect(migration47.match(/ON DELETE RESTRICT/g)?.length).toBe(6);
  });

  it('reuses the inspection taxonomy and performs no historical backfill', () => {
    expect(migration47).toContain('"InspectionConditionCategory"');
    expect(migration47).toContain('"InspectionConditionVehicleArea"');
    expect(migration47).toContain('"InspectionConditionClassification"');
    expect(migration47).not.toMatch(/CREATE TYPE "InspectionCondition/);
    expect(migration47).not.toMatch(/INSERT INTO/);
    expect(migration47).not.toMatch(/UPDATE\s+"inspection_condition_issues"/);
    expect(migration47).not.toMatch(/DELETE\s+FROM/);
  });
});
