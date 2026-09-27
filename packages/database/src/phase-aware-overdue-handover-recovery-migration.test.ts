import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration60Sql = readFileSync(
  new URL(
    '../prisma/migrations/20260926130000_phase_aware_overdue_handover_recovery/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const migration61Sql = readFileSync(
  new URL(
    '../prisma/migrations/20260927130000_correct_overdue_handover_reconciliation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 60 phase-aware overdue handover recovery', () => {
  it('keeps the originally applied Migration 60 bytes immutable', () => {
    expect(createHash('sha256').update(migration60Sql).digest('hex')).toBe(
      'bd06a605087d8cb7ed3a8cec29f6a68cb81d9d2831d75a3e51fa974e20dea46f',
    );
  });

  it('preserves records while removing booking-wide uniqueness', () => {
    expect(migration60Sql).toContain(
      'DROP CONSTRAINT "booking_overdue_handover_recoveries_booking_id_key"',
    );
    expect(migration60Sql).not.toMatch(/DELETE FROM|TRUNCATE/);
  });

  it('keeps response and acceptance ownership recovery-specific', () => {
    expect(migration60Sql).not.toContain(
      'DROP CONSTRAINT "booking_overdue_handover_recovery_responses_recovery_id_key"',
    );
    expect(migration60Sql).not.toContain(
      'DROP CONSTRAINT "booking_overdue_handover_recovery_acceptances_recovery_id_key"',
    );
  });

  it('prevents unresolved same-phase and legacy BOTH overlap', () => {
    expect(migration60Sql).toContain('x."id" IS NULL AND a."id" IS NULL');
    expect(migration60Sql).toContain('r."scope" = \'BOTH\' OR NEW."scope" = \'BOTH\'');
    expect(migration60Sql).toContain('r."scope" = NEW."scope"');
  });

  it('reconciles legacy expired rows without ambiguous identifiers', () => {
    expect(migration61Sql).toContain('WHERE "id" = $1 FOR UPDATE');
    expect(migration61Sql).toContain('x."recovery_id" = r."id"');
    expect(migration61Sql).toContain("acceptance_source = 'NO_RESPONSE_24H'");
  });

  it('uses the canonical booking transitions for Pickup and Return', () => {
    expect(migration61Sql).toContain("current_status = 'READY_FOR_PICKUP'");
    expect(migration61Sql).toContain('SET "status" = \'ACTIVE\'');
    expect(migration61Sql).toContain('SET "status" = \'RETURN_PENDING\'');
    expect(migration61Sql).toContain('SET "status" = \'RETURNED\'');
    expect(migration61Sql).not.toContain('SET "status" = target_status');
  });

  it('keeps the immutable Migration 60 artifact separate from corrections', () => {
    expect(migration60Sql).toContain('WHERE "id" = recovery_id FOR UPDATE');
    expect(migration60Sql).not.toContain('current_status "BookingStatus"');
    expect(migration61Sql).toContain('CREATE OR REPLACE FUNCTION');
    expect(migration61Sql).not.toMatch(/ALTER TABLE|DROP CONSTRAINT|DELETE FROM|TRUNCATE/);
  });
});
