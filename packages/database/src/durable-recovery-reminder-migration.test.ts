import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260920133000_durable_recovery_reminder_scheduling/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 58 durable recovery reminder scheduling', () => {
  it('creates one durable logical reminder per recovery recipient stage and channel', () => {
    expect(sql).toContain('UNIQUE ("recovery_id", "recipient_user_id", "stage", "channel")');
    expect(sql).toContain("'MIDPOINT','FINAL'");
    expect(sql).toContain('"scheduled_at"');
    expect(sql).toContain('"stable_key" char(64) NOT NULL UNIQUE');
  });

  it('derives schedules from the authoritative persisted deadline', () => {
    expect(sql).toContain('NEW."response_deadline_at" - interval \'12 hours\'');
    expect(sql).toContain('NEW."response_deadline_at" - interval \'2 hours\'');
    expect(sql).not.toContain("interval '24 hours'");
  });

  it('protects identity and schedule while permitting controlled delivery transitions', () => {
    expect(sql).toContain('recovery reminder identity and schedule are immutable');
    expect(sql).toContain('recovery reminder attempts cannot decrease');
    expect(sql).toContain('overdue_handover_recovery_reminder_no_delete');
  });
});
