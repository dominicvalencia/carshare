import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260920120000_overdue_handover_recovery_window/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 57 overdue handover recovery', () => {
  it('supports start, return, or one atomic combined Owner report', () => {
    expect(sql).toContain("CHECK (\"scope\" IN ('START','RETURN','BOTH'))");
    expect(sql).toContain("start_overdue AND return_overdue THEN 'BOTH'");
    expect(sql).toContain('recovery scope must match the overdue phases');
    expect(sql).toContain('UNIQUE REFERENCES "bookings"("id")');
  });

  it('provides one immutable 24-hour Renter response window', () => {
    expect(sql).toContain('"response_deadline_at" = "reported_at" + interval \'24 hours\'');
    expect(sql.match(/overdue_handover_.*_immutable/g)).toHaveLength(3);
    expect(sql).toContain("CHECK (\"decision\" IN ('CONFIRMED','DISPUTED'))");
    expect(sql).toContain('clock_timestamp() >= r."response_deadline_at"');
  });

  it('accepts confirmation or silence but never a disagreement or Operations hold', () => {
    expect(sql).toContain("response_decision = 'DISPUTED'");
    expect(sql).toContain("acceptance_source = 'RENTER_CONFIRMED'");
    expect(sql).toContain("acceptance_source = 'NO_RESPONSE_24H'");
    expect(sql).toContain('b."operational_hold"');
    expect(sql).toContain('accept_due_overdue_handover_recoveries');
  });

  it('records reduced-evidence custody without fabricating inspection measurements', () => {
    expect(sql).toContain('booking_overdue_handover_recovery_acceptances');
    expect(sql).toContain('booking_pre_historical_report_workflow_compliance_blocker');
    expect(sql).toContain('start_recovered');
    expect(sql).toContain('return_recovered');
    expect(sql).not.toMatch(/INSERT INTO "inspections"|odometer|fuel_basis_points|battery_soc/);
  });
});
