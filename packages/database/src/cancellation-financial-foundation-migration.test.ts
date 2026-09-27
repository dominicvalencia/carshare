import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readMigration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const migration60Sql = readMigration('20260926130000_phase_aware_overdue_handover_recovery');
const migration61Sql = readMigration('20260927130000_correct_overdue_handover_reconciliation');
const migration62Sql = readMigration('20260927170000_cancellation_financial_foundation');

describe('Migration 62 cancellation financial foundation', () => {
  it('leaves Migrations 60 and 61 immutable', () => {
    expect(createHash('sha256').update(migration60Sql).digest('hex')).toBe(
      'bd06a605087d8cb7ed3a8cec29f6a68cb81d9d2831d75a3e51fa974e20dea46f',
    );
    expect(createHash('sha256').update(migration61Sql).digest('hex')).toBe(
      '3b9bda06895d4e2ad3d5f764725f7e56efb21e64745ba805cb12baa192dca18a',
    );
  });

  it('represents only the approved renter policy codes and safe legacy context', () => {
    for (const code of [
      'PRE_CONFIRMATION_VOID',
      'ADVANCE_REFUNDABLE',
      'LAST_MINUTE_GRACE_REFUNDABLE',
      'ADVANCE_FINAL_72H_NON_REFUNDABLE',
      'LAST_MINUTE_GRACE_EXPIRED_NON_REFUNDABLE',
      'LEGACY_UNSPECIFIED',
    ]) {
      expect(migration62Sql).toContain(`'${code}'`);
    }
    expect(migration62Sql).not.toMatch(/FREE_CANCELLATION|ONE_HOUR|24H_CUTOFF/u);
    expect(migration62Sql).toContain(
      'ADD COLUMN "policy_code" "CancellationPolicyCode" NOT NULL DEFAULT \'LEGACY_UNSPECIFIED\'',
    );
  });

  it('adds independent actor, responsibility, reason, timing, and immutable money context', () => {
    expect(migration62Sql).toContain("'RENTER', 'OWNER', 'ADMIN', 'PLATFORM'");
    expect(migration62Sql).toContain("'RENTER', 'OWNER', 'PLATFORM', 'SHARED'");
    for (const column of [
      'structured_reason',
      'policy_version',
      'confirmed_at',
      'scheduled_pickup_at',
      'evaluated_at',
      'applicable_deadline_at',
      'cancellation_fee_minor',
      'refundable_rental_minor',
      'non_refundable_rental_minor',
      'owner_earning_forfeited_minor',
      'payment_disposition',
      'fulfillment_treatment',
      'preview_version',
      'correlation_id',
    ]) {
      expect(migration62Sql).toContain(`"${column}"`);
    }
    expect(migration62Sql).toContain(
      '"refundable_rental_minor" + "non_refundable_rental_minor" = "rental_component_minor"',
    );
  });

  it('preserves existing settlements without fabricating penalties or refunds', () => {
    expect(migration62Sql).not.toMatch(
      /INSERT INTO "owner_financial_obligations"|UPDATE "booking_cancellation_settlements"/u,
    );
    expect(migration62Sql).toContain('"cancellation_fee_minor" BIGINT NOT NULL DEFAULT 0');
    expect(migration62Sql).toContain('"refundable_rental_minor" BIGINT NOT NULL DEFAULT 0');
    expect(migration62Sql).toContain('"owner_earning_forfeited_minor" BIGINT NOT NULL DEFAULT 0');
  });

  it('creates one idempotent commission-snapshot-backed cancellation obligation', () => {
    expect(migration62Sql).toContain('CREATE TABLE "owner_financial_obligations"');
    expect(migration62Sql).toContain("'CANCELLATION_PENALTY'");
    expect(migration62Sql).toContain(
      'ON "owner_financial_obligations"("source_cancellation_id", "type")',
    );
    expect(migration62Sql).toContain(
      'NEW."original_amount_minor" <> snapshot."calculated_commission_minor"',
    );
    expect(migration62Sql).toContain(
      '"remaining_amount_minor" + "recovered_amount_minor" + "waived_amount_minor" = "original_amount_minor"',
    );
    expect(migration62Sql).toContain(
      'ON "owner_financial_obligations"("owner_profile_id", "status", "effective_at", "id")',
    );
  });

  it('records positive immutable recovery allocations with currency and retry safety', () => {
    expect(migration62Sql).toContain('CREATE TABLE "owner_obligation_recoveries"');
    expect(migration62Sql).toContain('CHECK ("amount_minor" > 0)');
    expect(migration62Sql).toContain(
      'CREATE UNIQUE INDEX "owner_obligation_recoveries_idempotency_key_key"',
    );
    expect(migration62Sql).toContain('Owner obligation recovery currency mismatch');
    expect(migration62Sql).toContain('NEW."amount_minor" > payout_row."gross_earning_minor"');
    expect(migration62Sql).toContain('"owner_obligation_recoveries_immutable"');
    expect(migration62Sql).toContain('\'PARTIALLY_RECOVERED\'::"OwnerFinancialObligationStatus"');
  });

  it('supports partial and full immutable Admin waivers without rewriting recovery history', () => {
    expect(migration62Sql).toContain('CREATE TABLE "owner_obligation_waivers"');
    expect(migration62Sql).toContain('"admin_actor_user_id" UUID NOT NULL');
    expect(migration62Sql).toContain('Waiver exceeds remaining obligation');
    expect(migration62Sql).toContain(
      '"waived_amount_minor" = "waived_amount_minor" + NEW."amount_minor"',
    );
    expect(migration62Sql).toContain('"owner_obligation_waivers_immutable"');
    expect(migration62Sql).not.toMatch(/UPDATE "owner_obligation_recoveries"/u);
  });

  it('extends the existing balanced ledger without conflating normal commission', () => {
    for (const authority of [
      'OWNER_PENALTY_RECEIVABLE',
      'PLATFORM_CANCELLATION_REVENUE',
      'OWNER_PENALTY_RECOGNITION',
      'OWNER_PENALTY_RECOVERY',
      'OWNER_PENALTY_WAIVER',
    ]) {
      expect(migration62Sql).toContain(`'${authority}'`);
    }
    expect(migration62Sql).toContain('PLATFORM_CANCELLATION_REVENUE');
    expect(migration62Sql).not.toMatch(
      /ALTER TYPE "FinancialAccountType" RENAME VALUE 'PLATFORM_COMMISSION_REVENUE'/u,
    );
  });

  it('does not implement cancellation execution or payout deduction', () => {
    expect(migration62Sql).not.toMatch(
      /CREATE.*cancellation_preview|CREATE.*cancel_booking|UPDATE "payouts" SET "amount_minor"/iu,
    );
  });
});
