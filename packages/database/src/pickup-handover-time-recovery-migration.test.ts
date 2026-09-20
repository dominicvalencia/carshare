import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260919183000_pickup_handover_time_recovery/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 52 historical pickup handover reporting', () => {
  it('keeps Owner reports and Renter responses unique and append-only', () => {
    expect(sql).toContain('booking_pickup_handover_reports');
    expect(sql).toContain('booking_pickup_handover_responses');
    expect(sql.match(/reject_append_only_mutation/g)).toHaveLength(2);
    expect(sql).toContain("'CONFIRMED', 'DISPUTED', 'NOT_RECEIVED'");
    expect(sql).not.toMatch(/UPDATE "bookings"|UPDATE "payouts"|UPDATE "owner_earnings"/);
  });

  it('rejects times before the handover boundary, Delivery arrival, now, or rental end', () => {
    expect(sql).toContain('COALESCE(b."pickup_window_start", b."rental_start")');
    expect(sql).toContain('GREATEST(earliest_allowed, delivery_arrived_at)');
    expect(sql).toContain('clock_timestamp()');
    expect(sql).toContain('>= b."rental_end"');
    expect(sql).toContain('e."status" = \'ARRIVED\'');
  });

  it('requires the Renter confirmation in the shared financial authority', () => {
    expect(sql).toContain('PICKUP_HANDOVER_TIME_CONFIRMATION_REQUIRED');
    expect(sql).toContain('booking_pre_historical_report_workflow_compliance_blocker');
    expect(sql).toContain('r."decision" = \'CONFIRMED\'');
  });
});
