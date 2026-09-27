-- General net-payout adjustment authority. Gross payout items remain immutable.
CREATE TYPE "PayoutAdjustmentType" AS ENUM ('OWNER_CANCELLATION_PENALTY_RECOVERY');
CREATE TYPE "PayoutAdjustmentStatus" AS ENUM ('RESERVED', 'APPLIED', 'RELEASED');

INSERT INTO "financial_accounts" ("id", "code", "type", "currency", "name") VALUES
  (gen_random_uuid(), 'OWNER_PENALTY_RECEIVABLE', 'OWNER_PENALTY_RECEIVABLE', 'PHP', 'Owner cancellation penalty receivable'),
  (gen_random_uuid(), 'PLATFORM_CANCELLATION_REVENUE', 'PLATFORM_CANCELLATION_REVENUE', 'PHP', 'Platform cancellation revenue')
ON CONFLICT ("code", "currency") DO NOTHING;

CREATE TABLE "payout_adjustments" (
  "id" UUID NOT NULL,
  "payout_id" UUID NOT NULL,
  "type" "PayoutAdjustmentType" NOT NULL,
  "status" "PayoutAdjustmentStatus" NOT NULL DEFAULT 'RESERVED',
  "signed_amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "source_type" VARCHAR(100) NOT NULL,
  "source_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "ledger_transaction_id" UUID,
  "correlation_id" VARCHAR(100),
  "audit_metadata" JSONB,
  "applied_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payout_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_adjustments_sign_state_check" CHECK (
    "signed_amount_minor" < 0 AND
    (("status" = 'RESERVED' AND "ledger_transaction_id" IS NULL AND "applied_at" IS NULL AND "released_at" IS NULL) OR
     ("status" = 'APPLIED' AND "ledger_transaction_id" IS NOT NULL AND "applied_at" IS NOT NULL AND "released_at" IS NULL) OR
     ("status" = 'RELEASED' AND "ledger_transaction_id" IS NULL AND "applied_at" IS NULL AND "released_at" IS NOT NULL))
  )
);

CREATE UNIQUE INDEX "payout_adjustments_idempotency_key_key" ON "payout_adjustments"("idempotency_key");
CREATE UNIQUE INDEX "payout_adjustments_ledger_transaction_id_key" ON "payout_adjustments"("ledger_transaction_id");
CREATE UNIQUE INDEX "payout_adjustments_payout_id_type_source_type_source_id_key"
  ON "payout_adjustments"("payout_id", "type", "source_type", "source_id");
CREATE INDEX "payout_adjustments_payout_id_status_created_at_idx"
  ON "payout_adjustments"("payout_id", "status", "created_at");
CREATE INDEX "payout_adjustments_source_type_source_id_status_idx"
  ON "payout_adjustments"("source_type", "source_id", "status");

ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_payout_id_fkey"
  FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_adjustments" ADD CONSTRAINT "payout_adjustments_ledger_transaction_id_fkey"
  FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payouts" DROP CONSTRAINT "payouts_values_check";
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_values_check" CHECK (
  "amount_minor" >= 0 AND "gross_earning_minor" > 0
  AND "withholding_amount_minor" = 0
  AND "provider_fee_amount_minor" >= 0
  AND "fee_policy" = 'PLATFORM_FUNDED'
  AND "currency" = 'PHP' AND "destination_currency" = 'PHP' AND "destination_country" = 'PH'
  AND "amount_minor" = "gross_earning_minor" + "adjustment_amount_minor" - "withholding_amount_minor"
);

CREATE OR REPLACE FUNCTION "assert_payout_total"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; expected bigint; gross_items bigint; signed_adjustments bigint; payout_status "PayoutStatus";
BEGIN
  target_id := COALESCE(NEW."payout_id", OLD."payout_id");
  SELECT "amount_minor", "status" INTO expected, payout_status FROM "payouts" WHERE "id" = target_id;
  SELECT COALESCE(sum("amount_minor"), 0) INTO gross_items FROM "payout_items"
    WHERE "payout_id" = target_id AND "active_allocation";
  SELECT COALESCE(sum("signed_amount_minor"), 0) INTO signed_adjustments FROM "payout_adjustments"
    WHERE "payout_id" = target_id AND "status" IN ('RESERVED', 'APPLIED');
  IF payout_status NOT IN ('DRAFT', 'FAILED', 'CANCELLED', 'REVERSED')
    AND (gross_items <= 0 OR expected <> gross_items + signed_adjustments OR expected < 0) THEN
    RAISE EXCEPTION 'payout amount must equal gross active payout items plus active signed adjustments';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "payout_total_from_adjustment"
  AFTER INSERT OR UPDATE ON "payout_adjustments"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_payout_total"();

CREATE FUNCTION "validate_payout_adjustment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payout_row "payouts"%ROWTYPE; obligation_row "owner_financial_obligations"%ROWTYPE; reserved bigint;
BEGIN
  SELECT * INTO payout_row FROM "payouts" WHERE "id" = NEW."payout_id" FOR UPDATE;
  IF payout_row."id" IS NULL OR NEW."currency" <> payout_row."currency" THEN
    RAISE EXCEPTION 'Payout adjustment currency or payout mismatch';
  END IF;
  IF NEW."type" = 'OWNER_CANCELLATION_PENALTY_RECOVERY' THEN
    IF NEW."source_type" <> 'OWNER_FINANCIAL_OBLIGATION' THEN
      RAISE EXCEPTION 'Cancellation recovery adjustment source type mismatch';
    END IF;
    SELECT * INTO obligation_row FROM "owner_financial_obligations" WHERE "id" = NEW."source_id" FOR UPDATE;
    IF obligation_row."id" IS NULL OR obligation_row."owner_profile_id" <> payout_row."owner_profile_id"
      OR obligation_row."currency" <> NEW."currency" OR obligation_row."remaining_amount_minor" < -NEW."signed_amount_minor" THEN
      RAISE EXCEPTION 'Cancellation recovery adjustment source authority mismatch';
    END IF;
    SELECT COALESCE(-sum("signed_amount_minor"), 0) INTO reserved FROM "payout_adjustments"
      WHERE "source_type" = 'OWNER_FINANCIAL_OBLIGATION' AND "source_id" = NEW."source_id" AND "status" = 'RESERVED';
    IF reserved + -NEW."signed_amount_minor" > obligation_row."remaining_amount_minor" THEN
      RAISE EXCEPTION 'Cancellation recovery adjustment exceeds unreserved obligation balance';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_adjustments_validate" BEFORE INSERT ON "payout_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "validate_payout_adjustment"();

CREATE FUNCTION "protect_payout_adjustment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ledger_row "ledger_transactions"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payout adjustment history is append-only'; END IF;
  IF OLD."payout_id" IS DISTINCT FROM NEW."payout_id" OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."signed_amount_minor" IS DISTINCT FROM NEW."signed_amount_minor" OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."source_type" IS DISTINCT FROM NEW."source_type" OR OLD."source_id" IS DISTINCT FROM NEW."source_id"
    OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."correlation_id" IS DISTINCT FROM NEW."correlation_id"
    OR OLD."audit_metadata" IS DISTINCT FROM NEW."audit_metadata"
    OR OLD."status" <> 'RESERVED' OR NEW."status" NOT IN ('APPLIED', 'RELEASED') THEN
    RAISE EXCEPTION 'payout adjustment identity and final state are immutable';
  END IF;
  IF NEW."status" = 'APPLIED' THEN
    SELECT * INTO ledger_row FROM "ledger_transactions" WHERE "id" = NEW."ledger_transaction_id";
    IF ledger_row."id" IS NULL OR ledger_row."type" <> 'OWNER_PENALTY_RECOVERY'
      OR ledger_row."currency" <> NEW."currency" OR ledger_row."source_type" <> 'PAYOUT_ADJUSTMENT'
      OR ledger_row."source_id" <> NEW."id" THEN
      RAISE EXCEPTION 'Applied payout adjustment ledger authority mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_adjustments_immutable" BEFORE UPDATE OR DELETE ON "payout_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "protect_payout_adjustment"();

CREATE OR REPLACE FUNCTION "validate_owner_obligation_waiver_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obligation "owner_financial_obligations"%ROWTYPE; ledger_row "ledger_transactions"%ROWTYPE; reserved bigint;
BEGIN
  SELECT * INTO obligation FROM "owner_financial_obligations" WHERE "id" = NEW."obligation_id" FOR UPDATE;
  SELECT * INTO ledger_row FROM "ledger_transactions" WHERE "id" = NEW."ledger_transaction_id";
  SELECT COALESCE(-sum("signed_amount_minor"), 0) INTO reserved FROM "payout_adjustments"
    WHERE "source_type" = 'OWNER_FINANCIAL_OBLIGATION' AND "source_id" = NEW."obligation_id" AND "status" = 'RESERVED';
  IF NEW."currency" <> obligation."currency" OR NEW."currency" <> ledger_row."currency" THEN
    RAISE EXCEPTION 'Owner obligation waiver currency mismatch';
  END IF;
  IF NEW."amount_minor" > obligation."remaining_amount_minor" - reserved THEN
    RAISE EXCEPTION 'Waiver exceeds unreserved remaining obligation';
  END IF;
  IF ledger_row."type" <> 'OWNER_PENALTY_WAIVER' THEN RAISE EXCEPTION 'Waiver ledger transaction type mismatch'; END IF;
  RETURN NEW;
END $$;

-- Zero-net cycles are internal settlements: they may move directly from
-- SUBMITTING to PAID without fabricating a provider identity.
CREATE OR REPLACE FUNCTION "enforce_payout_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('PENDING_APPROVAL', 'CANCELLED'))
    OR (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('APPROVED', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('SUBMITTING', 'CANCELLED'))
    OR (OLD."status" = 'SUBMITTING' AND NEW."status" IN ('PROCESSING', 'FAILED'))
    OR (OLD."status" = 'SUBMITTING' AND NEW."status" = 'PAID' AND NEW."amount_minor" = 0)
    OR (OLD."status" = 'PROCESSING' AND NEW."status" IN ('PAID', 'FAILED', 'REVERSED'))
    OR (OLD."status" = 'PAID' AND NEW."status" = 'REVERSED')
  ) THEN
    RAISE EXCEPTION 'invalid payout state transition % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."status" = 'PAID' AND
    (NEW."paid_at" IS NULL OR (NEW."amount_minor" > 0 AND NEW."provider_payout_id" IS NULL)) THEN
    RAISE EXCEPTION 'PAID external payout requires provider identity and authoritative paid timestamp';
  END IF;
  RETURN NEW;
END $$;
