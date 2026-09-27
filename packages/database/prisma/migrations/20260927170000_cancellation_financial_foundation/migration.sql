-- Migration 62: cancellation settlement context and durable Owner penalty authority.
CREATE TYPE "CancellationActorType" AS ENUM (
  'RENTER', 'OWNER', 'ADMIN', 'PLATFORM', 'LEGACY_UNSPECIFIED'
);
CREATE TYPE "CancellationResponsibility" AS ENUM (
  'RENTER', 'OWNER', 'PLATFORM', 'SHARED', 'LEGACY_UNSPECIFIED'
);
CREATE TYPE "CancellationReasonCode" AS ENUM (
  'CHANGE_OF_PLANS', 'BOOKED_ANOTHER_VEHICLE', 'TRIP_CANCELLED', 'SCHEDULE_CHANGED',
  'VEHICLE_OR_LISTING_CONCERN', 'VEHICLE_UNAVAILABLE', 'VEHICLE_MAINTENANCE',
  'OWNER_SCHEDULE_CONFLICT', 'RENTER_OR_TRIP_CONCERN', 'SAFETY_CONCERN', 'EMERGENCY',
  'PLATFORM_SYSTEM_FAULT', 'PAYMENT_OR_FRAUD_RISK', 'SAFETY_INTERVENTION',
  'POLICY_VIOLATION', 'IDENTITY_OR_ELIGIBILITY', 'LEGAL_OR_REGULATORY',
  'FORCE_MAJEURE', 'DUPLICATE_OR_INVALID_BOOKING', 'OTHER', 'OTHER_APPROVED',
  'LEGACY_UNSPECIFIED'
);
CREATE TYPE "CancellationPolicyCode" AS ENUM (
  'PRE_CONFIRMATION_VOID', 'ADVANCE_REFUNDABLE', 'LAST_MINUTE_GRACE_REFUNDABLE',
  'ADVANCE_FINAL_72H_NON_REFUNDABLE', 'LAST_MINUTE_GRACE_EXPIRED_NON_REFUNDABLE',
  'LEGACY_UNSPECIFIED'
);
CREATE TYPE "CancellationPaymentDisposition" AS ENUM (
  'VOID', 'FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND', 'LEGACY_UNSPECIFIED'
);
CREATE TYPE "OwnerFinancialObligationType" AS ENUM ('CANCELLATION_PENALTY');
CREATE TYPE "OwnerFinancialObligationStatus" AS ENUM (
  'OUTSTANDING', 'PARTIALLY_RECOVERED', 'SATISFIED', 'WAIVED'
);
CREATE TYPE "OwnerObligationWaiverReason" AS ENUM (
  'POLICY_EXCEPTION', 'PLATFORM_ERROR', 'EMERGENCY_HARDSHIP',
  'DISPUTE_RESOLUTION', 'OTHER_APPROVED'
);

ALTER TYPE "FinancialAccountType" ADD VALUE 'OWNER_PENALTY_RECEIVABLE';
ALTER TYPE "FinancialAccountType" ADD VALUE 'PLATFORM_CANCELLATION_REVENUE';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'OWNER_PENALTY_RECOGNITION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'OWNER_PENALTY_RECOVERY';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'OWNER_PENALTY_WAIVER';

ALTER TABLE "booking_cancellation_settlements"
  ADD COLUMN "actor_type" "CancellationActorType" NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "responsibility" "CancellationResponsibility" NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "structured_reason" "CancellationReasonCode" NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "policy_version" VARCHAR(100) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "policy_code" "CancellationPolicyCode" NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(3),
  ADD COLUMN "scheduled_pickup_at" TIMESTAMPTZ(3),
  ADD COLUMN "evaluated_at" TIMESTAMPTZ(3),
  ADD COLUMN "applicable_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "cancellation_fee_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "refundable_rental_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "non_refundable_rental_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "owner_earning_forfeited_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "payment_disposition" "CancellationPaymentDisposition" NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "fulfillment_treatment" JSONB NOT NULL DEFAULT '{"legacy":"unspecified"}'::jsonb,
  ADD COLUMN "preview_version" VARCHAR(100) NOT NULL DEFAULT 'LEGACY_UNSPECIFIED',
  ADD COLUMN "correlation_id" VARCHAR(100),
  ADD CONSTRAINT "booking_cancellation_settlements_policy_amounts_check" CHECK (
    "cancellation_fee_minor" >= 0 AND "refundable_rental_minor" >= 0 AND
    "non_refundable_rental_minor" >= 0 AND "owner_earning_forfeited_minor" >= 0 AND
    (
      "policy_code" = 'LEGACY_UNSPECIFIED' OR
      (
        "confirmed_at" IS NOT NULL AND "scheduled_pickup_at" IS NOT NULL AND
        "evaluated_at" IS NOT NULL AND
        "refundable_rental_minor" + "non_refundable_rental_minor" = "rental_component_minor" AND
        "cancellation_fee_minor" <= "non_refundable_rental_minor"
      )
    )
  );

CREATE TABLE "owner_financial_obligations" (
  "id" UUID NOT NULL,
  "owner_profile_id" UUID NOT NULL,
  "source_cancellation_id" UUID NOT NULL,
  "cancellation_settlement_id" UUID NOT NULL,
  "commission_snapshot_id" UUID NOT NULL,
  "type" "OwnerFinancialObligationType" NOT NULL,
  "status" "OwnerFinancialObligationStatus" NOT NULL DEFAULT 'OUTSTANDING',
  "original_amount_minor" BIGINT NOT NULL,
  "remaining_amount_minor" BIGINT NOT NULL,
  "recovered_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "waived_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "policy_version" VARCHAR(100) NOT NULL,
  "reason_code" "CancellationReasonCode" NOT NULL,
  "effective_at" TIMESTAMPTZ(3) NOT NULL,
  "correlation_id" VARCHAR(100),
  "audit_metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "owner_financial_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_financial_obligations_amounts_check" CHECK (
    "original_amount_minor" >= 0 AND "remaining_amount_minor" >= 0 AND
    "recovered_amount_minor" >= 0 AND "waived_amount_minor" >= 0 AND
    "remaining_amount_minor" + "recovered_amount_minor" + "waived_amount_minor" = "original_amount_minor"
  ),
  CONSTRAINT "owner_financial_obligations_status_check" CHECK (
    ("status" = 'OUTSTANDING' AND "remaining_amount_minor" > 0 AND "recovered_amount_minor" = 0) OR
    ("status" = 'PARTIALLY_RECOVERED' AND "remaining_amount_minor" > 0 AND "recovered_amount_minor" > 0) OR
    ("status" = 'SATISFIED' AND "remaining_amount_minor" = 0 AND "recovered_amount_minor" > 0) OR
    ("status" = 'WAIVED' AND "remaining_amount_minor" = 0 AND "waived_amount_minor" = "original_amount_minor")
  )
);

CREATE UNIQUE INDEX "owner_financial_obligations_source_type_key"
  ON "owner_financial_obligations"("source_cancellation_id", "type");
CREATE INDEX "owner_financial_obligations_owner_status_effective_idx"
  ON "owner_financial_obligations"("owner_profile_id", "status", "effective_at", "id");

CREATE TABLE "owner_obligation_recoveries" (
  "id" UUID NOT NULL,
  "obligation_id" UUID NOT NULL,
  "payout_id" UUID NOT NULL,
  "payout_item_id" UUID,
  "owner_earning_id" UUID,
  "ledger_transaction_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "recovered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_obligation_recoveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_obligation_recoveries_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "owner_obligation_recoveries_ledger_transaction_id_key"
  ON "owner_obligation_recoveries"("ledger_transaction_id");
CREATE UNIQUE INDEX "owner_obligation_recoveries_idempotency_key_key"
  ON "owner_obligation_recoveries"("idempotency_key");
CREATE INDEX "owner_obligation_recoveries_obligation_recovered_idx"
  ON "owner_obligation_recoveries"("obligation_id", "recovered_at", "id");
CREATE INDEX "owner_obligation_recoveries_payout_recovered_idx"
  ON "owner_obligation_recoveries"("payout_id", "recovered_at");

CREATE TABLE "owner_obligation_waivers" (
  "id" UUID NOT NULL,
  "obligation_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "admin_actor_user_id" UUID NOT NULL,
  "reason_code" "OwnerObligationWaiverReason" NOT NULL,
  "internal_detail" VARCHAR(2000),
  "evidence_reference" VARCHAR(255),
  "correlation_id" VARCHAR(100),
  "audit_metadata" JSONB,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "ledger_transaction_id" UUID NOT NULL,
  "waived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_obligation_waivers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_obligation_waivers_amount_check" CHECK ("amount_minor" > 0)
);
CREATE UNIQUE INDEX "owner_obligation_waivers_idempotency_key_key"
  ON "owner_obligation_waivers"("idempotency_key");
CREATE UNIQUE INDEX "owner_obligation_waivers_ledger_transaction_id_key"
  ON "owner_obligation_waivers"("ledger_transaction_id");
CREATE INDEX "owner_obligation_waivers_obligation_waived_idx"
  ON "owner_obligation_waivers"("obligation_id", "waived_at", "id");

ALTER TABLE "owner_financial_obligations" ADD CONSTRAINT "owner_financial_obligations_owner_profile_id_fkey"
  FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_financial_obligations" ADD CONSTRAINT "owner_financial_obligations_source_cancellation_id_fkey"
  FOREIGN KEY ("source_cancellation_id") REFERENCES "booking_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_financial_obligations" ADD CONSTRAINT "owner_financial_obligations_cancellation_settlement_id_fkey"
  FOREIGN KEY ("cancellation_settlement_id") REFERENCES "booking_cancellation_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_financial_obligations" ADD CONSTRAINT "owner_financial_obligations_commission_snapshot_id_fkey"
  FOREIGN KEY ("commission_snapshot_id") REFERENCES "commission_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_recoveries" ADD CONSTRAINT "owner_obligation_recoveries_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "owner_financial_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_recoveries" ADD CONSTRAINT "owner_obligation_recoveries_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_recoveries" ADD CONSTRAINT "owner_obligation_recoveries_payout_item_id_fkey"
  FOREIGN KEY ("payout_item_id") REFERENCES "payout_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_recoveries" ADD CONSTRAINT "owner_obligation_recoveries_owner_earning_id_fkey"
  FOREIGN KEY ("owner_earning_id") REFERENCES "owner_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_recoveries" ADD CONSTRAINT "owner_obligation_recoveries_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_waivers" ADD CONSTRAINT "owner_obligation_waivers_obligation_id_fkey"
  FOREIGN KEY ("obligation_id") REFERENCES "owner_financial_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_waivers" ADD CONSTRAINT "owner_obligation_waivers_admin_actor_user_id_fkey"
  FOREIGN KEY ("admin_actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_obligation_waivers" ADD CONSTRAINT "owner_obligation_waivers_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_owner_financial_obligation_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot "commission_snapshots"%ROWTYPE; settlement "booking_cancellation_settlements"%ROWTYPE; booking_owner uuid;
BEGIN
  SELECT * INTO snapshot FROM "commission_snapshots" WHERE "id" = NEW."commission_snapshot_id";
  SELECT * INTO settlement FROM "booking_cancellation_settlements" WHERE "id" = NEW."cancellation_settlement_id";
  SELECT "owner_profile_id" INTO booking_owner FROM "bookings" WHERE "id" = settlement."booking_id";
  IF settlement."booking_cancellation_id" <> NEW."source_cancellation_id" OR
     settlement."commission_snapshot_id" <> NEW."commission_snapshot_id" OR
     booking_owner <> NEW."owner_profile_id" THEN
    RAISE EXCEPTION 'Owner obligation source authorities do not match';
  END IF;
  IF NEW."currency" <> snapshot."currency" OR NEW."original_amount_minor" <> snapshot."calculated_commission_minor" THEN
    RAISE EXCEPTION 'Owner cancellation penalty must equal the immutable commission snapshot';
  END IF;
  IF NEW."remaining_amount_minor" <> NEW."original_amount_minor" OR NEW."recovered_amount_minor" <> 0 OR
     NEW."waived_amount_minor" <> 0 OR NEW."status" <> 'OUTSTANDING' THEN
    RAISE EXCEPTION 'New Owner obligation must begin fully outstanding';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "owner_financial_obligations_validate_insert"
  BEFORE INSERT ON "owner_financial_obligations"
  FOR EACH ROW EXECUTE FUNCTION "validate_owner_financial_obligation_insert"();

CREATE FUNCTION "validate_owner_obligation_recovery_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obligation "owner_financial_obligations"%ROWTYPE; payout_row "payouts"%ROWTYPE;
  ledger_row "ledger_transactions"%ROWTYPE; item_payout uuid; item_earning uuid; earning_owner uuid;
BEGIN
  SELECT * INTO obligation FROM "owner_financial_obligations" WHERE "id" = NEW."obligation_id" FOR UPDATE;
  SELECT * INTO payout_row FROM "payouts" WHERE "id" = NEW."payout_id";
  SELECT * INTO ledger_row FROM "ledger_transactions" WHERE "id" = NEW."ledger_transaction_id";
  IF NEW."currency" <> obligation."currency" OR NEW."currency" <> payout_row."currency" OR
     NEW."currency" <> ledger_row."currency" THEN RAISE EXCEPTION 'Owner obligation recovery currency mismatch'; END IF;
  IF payout_row."owner_profile_id" <> obligation."owner_profile_id" THEN RAISE EXCEPTION 'Recovery payout owner mismatch'; END IF;
  IF NEW."amount_minor" > obligation."remaining_amount_minor" OR NEW."amount_minor" > payout_row."gross_earning_minor" THEN
    RAISE EXCEPTION 'Owner obligation recovery exceeds available authority';
  END IF;
  IF ledger_row."type" <> 'OWNER_PENALTY_RECOVERY' THEN RAISE EXCEPTION 'Recovery ledger transaction type mismatch'; END IF;
  IF NEW."payout_item_id" IS NOT NULL THEN
    SELECT "payout_id", "owner_earning_id" INTO item_payout, item_earning FROM "payout_items" WHERE "id" = NEW."payout_item_id";
    IF item_payout <> NEW."payout_id" THEN RAISE EXCEPTION 'Recovery payout item mismatch'; END IF;
    IF NEW."owner_earning_id" IS NOT NULL AND item_earning <> NEW."owner_earning_id" THEN RAISE EXCEPTION 'Recovery earning mismatch'; END IF;
  END IF;
  IF NEW."owner_earning_id" IS NOT NULL THEN
    SELECT "owner_profile_id" INTO earning_owner FROM "owner_earnings" WHERE "id" = NEW."owner_earning_id";
    IF earning_owner <> obligation."owner_profile_id" THEN RAISE EXCEPTION 'Recovery earning owner mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "owner_obligation_recoveries_validate_insert"
  BEFORE INSERT ON "owner_obligation_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "validate_owner_obligation_recovery_insert"();

CREATE FUNCTION "apply_owner_obligation_recovery"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "owner_financial_obligations" SET
    "recovered_amount_minor" = "recovered_amount_minor" + NEW."amount_minor",
    "remaining_amount_minor" = "remaining_amount_minor" - NEW."amount_minor",
    "status" = CASE WHEN "remaining_amount_minor" = NEW."amount_minor" THEN 'SATISFIED'::"OwnerFinancialObligationStatus"
                    ELSE 'PARTIALLY_RECOVERED'::"OwnerFinancialObligationStatus" END,
    "updated_at" = clock_timestamp()
  WHERE "id" = NEW."obligation_id";
  RETURN NEW;
END $$;
CREATE TRIGGER "owner_obligation_recoveries_apply"
  AFTER INSERT ON "owner_obligation_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "apply_owner_obligation_recovery"();

CREATE FUNCTION "validate_owner_obligation_waiver_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obligation "owner_financial_obligations"%ROWTYPE; ledger_row "ledger_transactions"%ROWTYPE;
BEGIN
  SELECT * INTO obligation FROM "owner_financial_obligations" WHERE "id" = NEW."obligation_id" FOR UPDATE;
  SELECT * INTO ledger_row FROM "ledger_transactions" WHERE "id" = NEW."ledger_transaction_id";
  IF NEW."currency" <> obligation."currency" OR NEW."currency" <> ledger_row."currency" THEN
    RAISE EXCEPTION 'Owner obligation waiver currency mismatch';
  END IF;
  IF NEW."amount_minor" > obligation."remaining_amount_minor" THEN RAISE EXCEPTION 'Waiver exceeds remaining obligation'; END IF;
  IF ledger_row."type" <> 'OWNER_PENALTY_WAIVER' THEN RAISE EXCEPTION 'Waiver ledger transaction type mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "owner_obligation_waivers_validate_insert"
  BEFORE INSERT ON "owner_obligation_waivers"
  FOR EACH ROW EXECUTE FUNCTION "validate_owner_obligation_waiver_insert"();

CREATE FUNCTION "apply_owner_obligation_waiver"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "owner_financial_obligations" SET
    "waived_amount_minor" = "waived_amount_minor" + NEW."amount_minor",
    "remaining_amount_minor" = "remaining_amount_minor" - NEW."amount_minor",
    "status" = CASE
      WHEN "remaining_amount_minor" = NEW."amount_minor" AND "recovered_amount_minor" = 0 THEN 'WAIVED'::"OwnerFinancialObligationStatus"
      WHEN "remaining_amount_minor" = NEW."amount_minor" THEN 'SATISFIED'::"OwnerFinancialObligationStatus"
      WHEN "recovered_amount_minor" > 0 THEN 'PARTIALLY_RECOVERED'::"OwnerFinancialObligationStatus"
      ELSE 'OUTSTANDING'::"OwnerFinancialObligationStatus" END,
    "updated_at" = clock_timestamp()
  WHERE "id" = NEW."obligation_id";
  RETURN NEW;
END $$;
CREATE TRIGGER "owner_obligation_waivers_apply"
  AFTER INSERT ON "owner_obligation_waivers"
  FOR EACH ROW EXECUTE FUNCTION "apply_owner_obligation_waiver"();

CREATE TRIGGER "owner_obligation_recoveries_immutable"
  BEFORE UPDATE OR DELETE ON "owner_obligation_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "owner_obligation_waivers_immutable"
  BEFORE UPDATE OR DELETE ON "owner_obligation_waivers"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
