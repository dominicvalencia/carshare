import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260928020352_booking_amendment_foundation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const bookingEngineSql = readFileSync(
  new URL(
    '../prisma/migrations/20260820040100_phase5_booking_engine/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 65 booking amendment foundation', () => {
  it('creates durable snapshots, holds, history, and settlement authority', () => {
    expect(sql).toContain('CREATE TABLE "booking_amendments"');
    expect(sql).toContain('CREATE TABLE "booking_amendment_pricing_snapshots"');
    expect(sql).toContain('CREATE TABLE "booking_amendment_fulfillment_snapshots"');
    expect(sql).toContain('CREATE TABLE "booking_amendment_holds"');
    expect(sql).toContain('CREATE TABLE "booking_amendment_status_history"');
    expect(sql).toContain('CREATE TABLE "booking_amendment_settlements"');
    expect(sql).toContain('booking_amendments_one_unresolved_per_booking_idx');
  });

  it('uses the shared vehicle occupancy authority for race-safe holds', () => {
    expect(sql).toContain('ALTER TYPE "VehicleOccupancyType" ADD VALUE \'AMENDMENT_HOLD\'');
    expect(sql).toContain('validate_booking_amendment_hold_occupancy');
    expect(sql).toContain('release_booking_amendment_holds');
    expect(sql).toContain('convert_booking_amendment_holds');
    expect(bookingEngineSql).toContain('ADD CONSTRAINT "vehicle_occupancies_no_overlap"');
    expect(bookingEngineSql).toContain('WHERE ("active")');
  });

  it('makes only ACTIVE durable amendment holds block shared availability', () => {
    expect(sql).toContain('occupancy."active" <> (NEW."status" = \'ACTIVE\')');
    expect(sql).toContain('SET "active" = false, "updated_at" = CURRENT_TIMESTAMP');
    expect(sql).toContain("IF target_status = 'ACTIVE'");
    expect(sql).toContain('\'CONVERTED\'::"BookingAmendmentHoldStatus"');
    expect(sql).toContain(
      'PERFORM "release_booking_amendment_holds"(amendment_row."id", \'EXPIRED\'',
    );
  });

  it('keeps owner-response and renter-payment deadlines distinct', () => {
    expect(sql).toContain('"expires_at" TIMESTAMPTZ(3) NOT NULL');
    expect(sql).toContain('"payment_deadline_at" TIMESTAMPTZ(3)');
    expect(sql).toContain('"payment_initiated_at" IS NULL');
    expect(sql).toContain('RENTER_PAYMENT_DEADLINE_EXPIRED');
    expect(sql).toContain('OWNER_RESPONSE_DEADLINE_EXPIRED');
  });

  it('preserves initiated payments for provider reconciliation', () => {
    expect(sql).not.toContain('PAYMENT_UNKNOWN_GRACE_MINUTES');
    expect(sql.match(/"payment_initiated_at" IS NULL/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
  });

  it('does not include unrelated schema-history churn', () => {
    expect(sql).not.toContain('DROP INDEX');
    expect(sql).not.toContain('booking_handover_evidence_waivers');
    expect(sql).not.toContain('pickup_discrepancy_responses');
  });
});
