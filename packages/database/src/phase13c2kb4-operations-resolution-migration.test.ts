import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');

describe('Phase 13C-2K-B4 Operations handover resolution migration', () => {
  const migration46 = migration('20260913190000_phase13c2kb4_operations_handover_resolution');

  it('keeps the applied B4 migrations unchanged', () => {
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
  });

  it('persists one explicit immutable Operations outcome per handover case', () => {
    expect(migration46).toContain('CREATE TYPE "PickupHandoverOperationsOutcome"');
    expect(migration46).toContain("'HANDOVER_MAY_RESUME'");
    expect(migration46).toContain("'BOOKING_CANCELLATION_REQUIRED'");
    expect(migration46).toContain("'MAINTENANCE_REQUIRED'");
    expect(migration46).toContain("'SUPPORT_FOLLOW_UP_REQUIRED'");
    expect(migration46).toContain('resolutions_incident_id_key');
    expect(migration46).toContain('resolutions_immutable');
  });

  it('is additive, restrictive, and performs no historical backfill', () => {
    expect(migration46).not.toMatch(/UPDATE\s+"/);
    expect(migration46).not.toMatch(/DELETE\s+FROM/);
    expect(migration46).not.toMatch(/ALTER TYPE "BookingStatus"/);
    expect(migration46.match(/ON DELETE RESTRICT/g)?.length).toBe(5);
  });
});
