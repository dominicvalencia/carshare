import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260917130000_phase13c2kb4_handover_evidence_waiver/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
describe('Migration 51 participant-owned waiver authority', () => {
  it('is phase-specific, unique, append-only and acknowledgement-versioned', () => {
    expect(sql).toContain('UNIQUE ("booking_id", "phase")');
    expect(sql).toContain('HANDOVER_EVIDENCE_WAIVER_V1');
    expect(sql.match(/reject_append_only_mutation/g)).toHaveLength(2);
    expect(sql).toContain('inspection_waiver_conflict');
    expect(sql).not.toMatch(
      /DISABLE TRIGGER|UPDATE "bookings"|UPDATE "payouts"|UPDATE "owner_earnings"/,
    );
  });
  it('requires B4, phase owner, legitimate lifecycle and arrival without bypassing safety', () => {
    for (const value of [
      'IS DISTINCT FROM 1',
      'b."owner_user_id"',
      'b."renter_user_id"',
      'SAFETY_CRITICAL',
      'operational_hold',
      'OWNER_DELIVERY',
      'OWNER_COLLECTION',
      'ARRIVED',
      'FOR UPDATE',
    ])
      expect(sql).toContain(value);
  });
  it('keeps one layered financial authority and requires real custody for both paths', () => {
    expect(sql).toContain('RENAME TO "booking_verified_workflow_compliance_blocker"');
    expect(sql).toContain('c."consumed_at" = b."actual_pickup_at"');
    expect(sql).toContain('r."confirmed_at" = b."actual_return_at"');
    expect(sql).toContain('OWNER_RETURN_RECEIPT_REQUIRED');
    expect(sql).toContain('booking_cancellation_settlements');
    expect(sql).toContain('UNSUPPORTED_HANDOVER_WORKFLOW');
  });
});
