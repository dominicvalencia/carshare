CREATE TYPE "ClaimResponseDecision" AS ENUM ('ACKNOWLEDGED', 'DISPUTED', 'NO_RESPONSE');
CREATE TYPE "ClaimAdjudicationOutcome" AS ENUM ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'REQUEST_MORE_EVIDENCE', 'ESCALATED_TO_DISPUTE');
CREATE TYPE "ClaimCalculationMethod" AS ENUM ('EXCESS_MILEAGE_V1', 'LATE_RETURN_V1', 'ADMIN_PLATFORM_VALUATION_V1');
CREATE TYPE "ClaimEvidenceType" AS ENUM ('PHOTO', 'RECEIPT', 'ESTIMATE', 'INVOICE', 'NOTE', 'OTHER');
CREATE TYPE "EvidenceParticipantRole" AS ENUM ('OWNER', 'RENTER', 'ADMIN');
CREATE TYPE "DisputeOriginType" AS ENUM ('CLAIM', 'INCIDENT', 'ADDITIONAL_CHARGE', 'REFUND', 'OTHER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW', 'RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED');
CREATE TYPE "AdditionalChargeStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAYMENT_PENDING', 'PROCESSING', 'PAID', 'PAYMENT_FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'CANCELLED');
CREATE TYPE "AdditionalChargeLineCategory" AS ENUM ('EXCESS_MILEAGE', 'FUEL_DEFICIENCY', 'EV_DEFICIENCY', 'LATE_RETURN', 'CLEANING', 'DAMAGE', 'ADMIN_ADJUSTMENT');
CREATE TYPE "AdditionalChargeCollectionStrategy" AS ENUM ('RENTER_AUTHORIZATION', 'OFF_SESSION', 'SECURITY_DEPOSIT');
CREATE TYPE "EarningHoldMode" AS ENUM ('PARTIAL', 'FULL');
CREATE TYPE "EarningHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');
CREATE TYPE "EarningHoldReason" AS ENUM ('CLAIM_EXPOSURE', 'DISPUTE', 'CRITICAL_INCIDENT', 'PAYMENT_RECONCILIATION', 'ADMIN_REVIEW');

ALTER TABLE "post_return_claims" DROP CONSTRAINT IF EXISTS "post_return_claim_resolution_check";
ALTER TABLE "post_return_claims" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "PostReturnClaimStatus" RENAME TO "PostReturnClaimStatus_phase7";
CREATE TYPE "PostReturnClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RENTER_REVIEW', 'UNDER_ADMIN_REVIEW', 'PAYMENT_PENDING', 'WITHDRAWN', 'RESOLVED');
ALTER TABLE "post_return_claims" ALTER COLUMN "status" TYPE "PostReturnClaimStatus"
  USING (CASE
    WHEN "status"::text = 'OPEN' THEN 'SUBMITTED'
    WHEN "status"::text = 'WITHDRAWN' THEN 'WITHDRAWN'
    ELSE 'RESOLVED'
  END)::"PostReturnClaimStatus";
DROP TYPE "PostReturnClaimStatus_phase7";
ALTER TABLE "post_return_claims" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';
ALTER TABLE "post_return_claims"
  ADD COLUMN "response_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "late_override_reason" VARCHAR(1000),
  ADD COLUMN "late_override_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE "post_return_claims" SET "response_deadline_at" = "submitted_at" + interval '24 hours'
WHERE "status" NOT IN ('WITHDRAWN', 'RESOLVED');
ALTER TABLE "post_return_claims" ADD CONSTRAINT "post_return_claim_resolution_check" CHECK (
  ("status" IN ('WITHDRAWN', 'RESOLVED') AND "resolved_at" IS NOT NULL) OR
  ("status" NOT IN ('WITHDRAWN', 'RESOLVED') AND "resolved_at" IS NULL)
);
CREATE UNIQUE INDEX "post_return_claims_active_formula_category_idx"
  ON "post_return_claims"("booking_id", "category")
  WHERE "category" IN ('EXCESS_MILEAGE', 'FUEL_DEFICIENCY', 'EV_BATTERY_DEFICIENCY', 'LATE_RETURN')
    AND "status" NOT IN ('WITHDRAWN', 'RESOLVED');
CREATE INDEX "post_return_claims_status_response_deadline_idx" ON "post_return_claims"("status", "response_deadline_at");

ALTER TABLE "post_return_claim_evidence"
  ADD COLUMN "submitted_by_user_id" UUID,
  ADD COLUMN "participant_role" "EvidenceParticipantRole" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN "evidence_type" "ClaimEvidenceType" NOT NULL DEFAULT 'PHOTO',
  ADD COLUMN "source_type" VARCHAR(100),
  ADD COLUMN "source_id" UUID,
  ADD COLUMN "note" VARCHAR(1000);
UPDATE "post_return_claim_evidence" e SET "submitted_by_user_id" = c."submitted_by_user_id"
FROM "post_return_claims" c WHERE c."id" = e."claim_id";
ALTER TABLE "post_return_claim_evidence" ALTER COLUMN "submitted_by_user_id" SET NOT NULL;
ALTER TABLE "post_return_claim_evidence" ADD CONSTRAINT "post_return_claim_evidence_submitter_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "claim_responses" (
  "id" UUID PRIMARY KEY,
  "claim_id" UUID NOT NULL UNIQUE REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "renter_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "decision" "ClaimResponseDecision" NOT NULL,
  "explanation" VARCHAR(3000),
  "responded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "claim_responses_renter_user_id_responded_at_idx" ON "claim_responses"("renter_user_id", "responded_at");

CREATE TABLE "claim_policies" (
  "id" UUID PRIMARY KEY,
  "category" "PostReturnClaimCategory" NOT NULL,
  "version" INTEGER NOT NULL,
  "calculation_method" "ClaimCalculationMethod" NOT NULL,
  "formula_version" VARCHAR(100) NOT NULL,
  "formula_based" BOOLEAN NOT NULL,
  "evidence_based" BOOLEAN NOT NULL,
  "admin_review_required" BOOLEAN NOT NULL DEFAULT true,
  "renter_acknowledgment_eligible" BOOLEAN NOT NULL DEFAULT true,
  "deposit_eligible" BOOLEAN NOT NULL DEFAULT false,
  "additional_payment_eligible" BOOLEAN NOT NULL DEFAULT true,
  "maximum_amount_minor" BIGINT NOT NULL,
  "platform_share_basis_points" INTEGER NOT NULL DEFAULT 0,
  "late_grace_minutes" INTEGER,
  "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
  "effective_from" TIMESTAMPTZ(3) NOT NULL,
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_policies_values_check" CHECK (
    "version" > 0 AND "maximum_amount_minor" >= 0 AND "platform_share_basis_points" BETWEEN 0 AND 10000
    AND ("late_grace_minutes" IS NULL OR "late_grace_minutes" >= 0) AND "currency" = 'PHP'
  ),
  UNIQUE ("category", "version")
);
CREATE INDEX "claim_policies_category_effective_from_disabled_at_idx" ON "claim_policies"("category", "effective_from", "disabled_at");
CREATE UNIQUE INDEX "claim_policies_one_active_category_idx" ON "claim_policies"("category") WHERE "disabled_at" IS NULL;

INSERT INTO "claim_policies" ("id", "category", "version", "calculation_method", "formula_version", "formula_based", "evidence_based", "maximum_amount_minor", "late_grace_minutes", "effective_from") VALUES
  (gen_random_uuid(), 'EXCESS_MILEAGE', 1, 'EXCESS_MILEAGE_V1', 'EXCESS_MILEAGE_WHOLE_KM_V1', true, false, 10000000, NULL, clock_timestamp()),
  (gen_random_uuid(), 'FUEL_DEFICIENCY', 1, 'ADMIN_PLATFORM_VALUATION_V1', 'FUEL_ADMIN_PLATFORM_VALUATION_V1', true, true, 500000, NULL, clock_timestamp()),
  (gen_random_uuid(), 'EV_BATTERY_DEFICIENCY', 1, 'ADMIN_PLATFORM_VALUATION_V1', 'EV_ADMIN_PLATFORM_VALUATION_V1', true, true, 500000, NULL, clock_timestamp()),
  (gen_random_uuid(), 'LATE_RETURN', 1, 'LATE_RETURN_V1', 'LATE_HOURLY_DAILY_CAP_V1', true, false, 10000000, 30, clock_timestamp()),
  (gen_random_uuid(), 'CLEANING', 1, 'ADMIN_PLATFORM_VALUATION_V1', 'CLEANING_ADMIN_SCHEDULE_V1', false, true, 150000, NULL, clock_timestamp()),
  (gen_random_uuid(), 'DAMAGE', 1, 'ADMIN_PLATFORM_VALUATION_V1', 'DAMAGE_ADMIN_EVIDENCE_V1', false, true, 10000000, NULL, clock_timestamp()),
  (gen_random_uuid(), 'OTHER', 1, 'ADMIN_PLATFORM_VALUATION_V1', 'OTHER_ADMIN_EVIDENCE_V1', false, true, 1000000, NULL, clock_timestamp());

CREATE TABLE "claim_calculations" (
  "id" UUID PRIMARY KEY,
  "claim_id" UUID NOT NULL REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_policy_id" UUID NOT NULL REFERENCES "claim_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "method" "ClaimCalculationMethod" NOT NULL,
  "formula_version" VARCHAR(100) NOT NULL,
  "booking_policy_ref" VARCHAR(100) NOT NULL,
  "inputs" JSONB NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" VARCHAR(50) NOT NULL,
  "unit_rate_minor" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "rounding_rule" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_calculations_values_check" CHECK ("version" > 0 AND "quantity" >= 0 AND "unit_rate_minor" >= 0 AND "amount_minor" >= 0 AND "currency" = 'PHP'),
  UNIQUE ("claim_id", "version")
);
CREATE INDEX "claim_calculations_claim_policy_id_created_at_idx" ON "claim_calculations"("claim_policy_id", "created_at");

CREATE TABLE "claim_adjudications" (
  "id" UUID PRIMARY KEY,
  "claim_id" UUID NOT NULL REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "outcome" "ClaimAdjudicationOutcome" NOT NULL,
  "approved_amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(3000) NOT NULL,
  "decided_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "calculation_id" UUID REFERENCES "claim_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "claim_adjudications_values_check" CHECK ("version" > 0 AND "approved_amount_minor" >= 0 AND "currency" = 'PHP'),
  UNIQUE ("claim_id", "version")
);
CREATE INDEX "claim_adjudications_decided_by_user_id_created_at_idx" ON "claim_adjudications"("decided_by_user_id", "created_at");

ALTER TABLE "owner_earnings"
  ADD COLUMN "additional_compensation_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "adjustment_amount_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "available_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_financial_resolution_at" TIMESTAMPTZ(3);
ALTER TABLE "owner_earnings" ADD CONSTRAINT "owner_earnings_phase8_values_check" CHECK (
  "additional_compensation_minor" >= 0 AND
  "net_earning_amount_minor" + "additional_compensation_minor" + "adjustment_amount_minor" >= 0
);
CREATE INDEX "owner_earnings_status_available_at_idx" ON "owner_earnings"("status", "available_at");

CREATE TABLE "additional_charges" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_id" UUID NOT NULL UNIQUE REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "adjudication_id" UUID NOT NULL UNIQUE REFERENCES "claim_adjudications"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "owner_earning_id" UUID NOT NULL REFERENCES "owner_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" "AdditionalChargeStatus" NOT NULL DEFAULT 'DRAFT',
  "collection_strategy" "AdditionalChargeCollectionStrategy" NOT NULL DEFAULT 'RENTER_AUTHORIZATION',
  "approved_amount_minor" BIGINT NOT NULL,
  "collected_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0,
  "owner_compensation_minor" BIGINT NOT NULL,
  "platform_share_minor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "provider_idempotency_key" VARCHAR(200) NOT NULL UNIQUE,
  "approved_at" TIMESTAMPTZ(3) NOT NULL,
  "paid_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "additional_charges_values_check" CHECK (
    "approved_amount_minor" >= 0 AND "collected_amount_minor" >= 0 AND "refunded_amount_minor" >= 0
    AND "owner_compensation_minor" >= 0 AND "platform_share_minor" >= 0
    AND "approved_amount_minor" = "owner_compensation_minor" + "platform_share_minor"
    AND "collected_amount_minor" <= "approved_amount_minor" AND "refunded_amount_minor" <= "collected_amount_minor"
    AND "currency" = 'PHP'
  )
);
CREATE INDEX "additional_charges_booking_id_status_created_at_idx" ON "additional_charges"("booking_id", "status", "created_at");
CREATE INDEX "additional_charges_status_updated_at_idx" ON "additional_charges"("status", "updated_at");

CREATE TABLE "additional_charge_lines" (
  "id" UUID PRIMARY KEY,
  "additional_charge_id" UUID NOT NULL REFERENCES "additional_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_calculation_id" UUID REFERENCES "claim_calculations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" "AdditionalChargeLineCategory" NOT NULL,
  "calculation_source" VARCHAR(100) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit" VARCHAR(50) NOT NULL,
  "unit_rate_minor" BIGINT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "formula_version" VARCHAR(100) NOT NULL,
  "evidence_references" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "additional_charge_lines_values_check" CHECK ("quantity" >= 0 AND "unit_rate_minor" >= 0 AND "amount_minor" >= 0 AND "currency" = 'PHP')
);
CREATE INDEX "additional_charge_lines_additional_charge_id_idx" ON "additional_charge_lines"("additional_charge_id");

DROP INDEX IF EXISTS "payments_booking_id_purpose_key";
ALTER TABLE "payments" ADD COLUMN "additional_charge_id" UUID UNIQUE REFERENCES "additional_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "payments_one_base_purpose_per_booking_idx" ON "payments"("booking_id", "purpose") WHERE "purpose" IN ('RENTAL', 'SECURITY_DEPOSIT');
CREATE UNIQUE INDEX "payments_additional_charge_link_idx" ON "payments"("additional_charge_id") WHERE "additional_charge_id" IS NOT NULL;

CREATE TABLE "disputes" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_id" UUID REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "incident_id" UUID REFERENCES "rental_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "additional_charge_id" UUID REFERENCES "additional_charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "origin_type" "DisputeOriginType" NOT NULL,
  "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "reason" VARCHAR(3000) NOT NULL,
  "blocks_completion" BOOLEAN NOT NULL DEFAULT true,
  "opened_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolved_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolution_reason" VARCHAR(3000),
  "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  CONSTRAINT "disputes_resolution_check" CHECK (
    ("status" IN ('RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED') AND "resolved_at" IS NOT NULL)
    OR ("status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW') AND "resolved_at" IS NULL)
  )
);
CREATE UNIQUE INDEX "disputes_one_active_claim_idx" ON "disputes"("claim_id") WHERE "claim_id" IS NOT NULL AND "status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW');
CREATE INDEX "disputes_booking_id_status_opened_at_idx" ON "disputes"("booking_id", "status", "opened_at");
CREATE INDEX "disputes_status_opened_at_idx" ON "disputes"("status", "opened_at");

CREATE TABLE "dispute_evidence" (
  "id" UUID PRIMARY KEY,
  "dispute_id" UUID NOT NULL REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "file_asset_id" UUID NOT NULL UNIQUE REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submitted_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "participant_role" "EvidenceParticipantRole" NOT NULL,
  "evidence_type" "ClaimEvidenceType" NOT NULL DEFAULT 'PHOTO',
  "source_type" VARCHAR(100),
  "source_id" UUID,
  "note" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "dispute_evidence_dispute_id_created_at_idx" ON "dispute_evidence"("dispute_id", "created_at");

CREATE TABLE "earning_holds" (
  "id" UUID PRIMARY KEY,
  "owner_earning_id" UUID NOT NULL REFERENCES "owner_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "claim_id" UUID REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dispute_id" UUID REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "incident_id" UUID REFERENCES "rental_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "mode" "EarningHoldMode" NOT NULL,
  "status" "EarningHoldStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" "EarningHoldReason" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "rationale" VARCHAR(1000) NOT NULL,
  "created_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "released_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolution" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMPTZ(3),
  CONSTRAINT "earning_holds_values_check" CHECK ("amount_minor" > 0 AND "currency" = 'PHP'),
  CONSTRAINT "earning_holds_release_check" CHECK (
    ("status" = 'ACTIVE' AND "released_at" IS NULL) OR
    ("status" = 'RELEASED' AND "released_at" IS NOT NULL AND "resolution" IS NOT NULL)
  )
);
CREATE INDEX "earning_holds_owner_earning_id_status_created_at_idx" ON "earning_holds"("owner_earning_id", "status", "created_at");
CREATE INDEX "earning_holds_claim_id_status_idx" ON "earning_holds"("claim_id", "status");
CREATE UNIQUE INDEX "earning_holds_one_active_claim_idx" ON "earning_holds"("owner_earning_id", "claim_id") WHERE "claim_id" IS NOT NULL AND "status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION "protect_claim_workflow_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('SUBMITTED', 'WITHDRAWN')) OR
    (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('RENTER_REVIEW', 'UNDER_ADMIN_REVIEW', 'WITHDRAWN')) OR
    (OLD."status" = 'RENTER_REVIEW' AND NEW."status" IN ('UNDER_ADMIN_REVIEW', 'WITHDRAWN')) OR
    (OLD."status" = 'UNDER_ADMIN_REVIEW' AND NEW."status" IN ('RENTER_REVIEW', 'PAYMENT_PENDING', 'RESOLVED')) OR
    (OLD."status" = 'PAYMENT_PENDING' AND NEW."status" IN ('UNDER_ADMIN_REVIEW', 'RESOLVED'))
  ) THEN RAISE EXCEPTION 'Invalid claim transition: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "post_return_claim_transition_guard" BEFORE UPDATE OF "status" ON "post_return_claims"
FOR EACH ROW EXECUTE FUNCTION "protect_claim_workflow_transition"();

CREATE TRIGGER "claim_responses_append_only" BEFORE UPDATE OR DELETE ON "claim_responses"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "claim_calculations_append_only" BEFORE UPDATE OR DELETE ON "claim_calculations"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "claim_adjudications_append_only" BEFORE UPDATE OR DELETE ON "claim_adjudications"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "additional_charge_lines_append_only" BEFORE UPDATE OR DELETE ON "additional_charge_lines"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "dispute_evidence_append_only" BEFORE UPDATE OR DELETE ON "dispute_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "protect_claim_policy_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR to_jsonb(NEW) - 'disabled_at' <> to_jsonb(OLD) - 'disabled_at' THEN
    RAISE EXCEPTION 'Claim policy versions are immutable except for disabling';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "claim_policies_version_immutable" BEFORE UPDATE OR DELETE ON "claim_policies"
FOR EACH ROW EXECUTE FUNCTION "protect_claim_policy_version"();

CREATE OR REPLACE FUNCTION "protect_additional_charge_financials"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
     to_jsonb(NEW) - ARRAY['status', 'collected_amount_minor', 'refunded_amount_minor', 'paid_at', 'updated_at']
       <> to_jsonb(OLD) - ARRAY['status', 'collected_amount_minor', 'refunded_amount_minor', 'paid_at', 'updated_at'] THEN
    RAISE EXCEPTION 'Approved additional-charge financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "additional_charges_financial_immutable" BEFORE UPDATE OR DELETE ON "additional_charges"
FOR EACH ROW EXECUTE FUNCTION "protect_additional_charge_financials"();

CREATE OR REPLACE FUNCTION "protect_owner_earning_amounts"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
     to_jsonb(NEW) - ARRAY['status', 'available_at', 'last_financial_resolution_at', 'additional_compensation_minor', 'adjustment_amount_minor']
       <> to_jsonb(OLD) - ARRAY['status', 'available_at', 'last_financial_resolution_at', 'additional_compensation_minor', 'adjustment_amount_minor'] THEN
    RAISE EXCEPTION 'Owner earning rental financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "guard_earning_hold_insert"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE earning_row "owner_earnings"%ROWTYPE; exposure bigint;
BEGIN
  SELECT * INTO earning_row FROM "owner_earnings" WHERE "id" = NEW."owner_earning_id" FOR UPDATE;
  exposure := earning_row."net_earning_amount_minor" + earning_row."additional_compensation_minor" + earning_row."adjustment_amount_minor";
  IF NEW."currency" <> earning_row."currency" OR NEW."amount_minor" > exposure THEN
    RAISE EXCEPTION 'Earning hold exceeds applicable earning exposure' USING ERRCODE = '23514';
  END IF;
  IF NEW."mode" = 'FULL' THEN NEW."amount_minor" := exposure; END IF;
  UPDATE "owner_earnings" SET "status" = 'HELD' WHERE "id" = earning_row."id";
  RETURN NEW;
END;
$$;
CREATE TRIGGER "earning_hold_insert_guard" BEFORE INSERT ON "earning_holds"
FOR EACH ROW EXECUTE FUNCTION "guard_earning_hold_insert"();

CREATE OR REPLACE FUNCTION "guard_earning_availability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'AVAILABLE' THEN
    PERFORM 1 FROM "earning_holds" WHERE "owner_earning_id" = NEW."id" AND "status" = 'ACTIVE';
    IF FOUND THEN RAISE EXCEPTION 'Owner earning cannot become available with an active hold' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "owner_earning_availability_guard" BEFORE UPDATE OF "status" ON "owner_earnings"
FOR EACH ROW EXECUTE FUNCTION "guard_earning_availability"();

CREATE OR REPLACE FUNCTION "complete_due_returned_bookings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; transitioned integer := 0; completion_time timestamptz;
BEGIN
  FOR item IN
    SELECT b."id" FROM "bookings" b
    WHERE b."status" = 'RETURNED' AND b."claim_deadline_at" < clock_timestamp() AND b."operational_hold" = false
      AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = b."id" AND c."blocking" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED'))
      AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'))
      AND NOT EXISTS (SELECT 1 FROM "booking_usage_summaries" u WHERE u."booking_id" = b."id" AND u."return_disputed"
        AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."status" IN ('RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED')))
      AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."blocks_completion" AND i."status" IN ('OPEN', 'ACKNOWLEDGED'))
    FOR UPDATE SKIP LOCKED
  LOOP
    completion_time := clock_timestamp();
    UPDATE "bookings" SET "status" = 'COMPLETED', "updated_at" = completion_time WHERE "id" = item."id";
    UPDATE "owner_earnings" SET "available_at" = GREATEST(
      completion_time + interval '24 hours',
      COALESCE("last_financial_resolution_at" + interval '24 hours', completion_time + interval '24 hours')
    ), "status" = CASE WHEN EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = "owner_earnings"."id" AND h."status" = 'ACTIVE') THEN 'HELD'::"OwnerEarningStatus" ELSE 'PENDING'::"OwnerEarningStatus" END
    WHERE "booking_id" = item."id";
    INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "occurred_at")
      VALUES (gen_random_uuid(), item."id", 'RETURNED', 'COMPLETED', 'WORKER', 'POST_RETURN_BLOCKERS_RESOLVED', completion_time);
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING', item."id", 'CLAIM_WINDOW_EXPIRED', jsonb_build_object('bookingId', item."id"), 'PENDING', completion_time, completion_time),
      (gen_random_uuid(), 'BOOKING', item."id", 'BOOKING_COMPLETED', jsonb_build_object('bookingId', item."id"), 'PENDING', completion_time, completion_time);
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING_COMPLETED', item."id", '{}'::jsonb, completion_time);
    transitioned := transitioned + 1;
  END LOOP;
  RETURN transitioned;
END;
$$;

CREATE OR REPLACE FUNCTION "release_due_owner_earnings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; released integer := 0;
BEGIN
  FOR item IN
    SELECT e."id", e."booking_id" FROM "owner_earnings" e JOIN "bookings" b ON b."id" = e."booking_id"
    WHERE e."status" IN ('PENDING', 'HELD') AND e."available_at" IS NOT NULL AND e."available_at" <= clock_timestamp()
      AND b."status" = 'COMPLETED' AND b."operational_hold" = false
      AND NOT EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = e."id" AND h."status" = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = b."id" AND c."blocking" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED'))
      AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'))
      AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = b."id" AND (p."reconciliation_required" OR p."status" IN ('AUTHORIZING', 'CAPTURING', 'VOID_PENDING')))
      AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."severity" = 'CRITICAL' AND i."status" IN ('OPEN', 'ACKNOWLEDGED'))
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    UPDATE "owner_earnings" SET "status" = 'AVAILABLE' WHERE "id" = item."id";
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
      VALUES (gen_random_uuid(), 'OWNER_EARNING', item."id", 'EARNING_AVAILABLE', jsonb_build_object('bookingId', item."booking_id", 'earningId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp());
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at")
      VALUES (gen_random_uuid(), 'EARNING_AVAILABLE', item."booking_id", jsonb_build_object('earningId', item."id"), clock_timestamp());
    released := released + 1;
  END LOOP;
  RETURN released;
END;
$$;

CREATE OR REPLACE FUNCTION "finalize_additional_charge_payment"(
  payment_id uuid, operation_id uuid, provider_state text, external_operation_id text, correlation_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  payment_row "payments"%ROWTYPE; charge_row "additional_charges"%ROWTYPE; earning_row "owner_earnings"%ROWTYPE;
  provider_account uuid; held_account uuid; owner_account uuid; commission_account uuid;
  recognition_id uuid := gen_random_uuid(); allocation_id uuid := gen_random_uuid(); now_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO payment_row FROM "payments" WHERE "id" = payment_id FOR UPDATE;
  IF NOT FOUND OR payment_row."status" = 'CAPTURED' THEN RETURN; END IF;
  IF payment_row."purpose" <> 'ADDITIONAL_CHARGE' OR payment_row."additional_charge_id" IS NULL THEN RAISE EXCEPTION 'Payment is not linked to an additional charge'; END IF;
  SELECT * INTO charge_row FROM "additional_charges" WHERE "id" = payment_row."additional_charge_id" FOR UPDATE;
  SELECT * INTO earning_row FROM "owner_earnings" WHERE "id" = charge_row."owner_earning_id" FOR UPDATE;
  IF payment_row."amount_minor" <> charge_row."approved_amount_minor" THEN RAISE EXCEPTION 'Payment exceeds approved adjudication'; END IF;
  IF operation_id IS NOT NULL THEN UPDATE "payment_operations" SET "status" = 'SUCCEEDED', "completed_at" = now_at,
    "external_operation_id" = external_operation_id, "failure_category" = NULL, "updated_at" = now_at WHERE "id" = operation_id AND "status" <> 'SUCCEEDED'; END IF;
  UPDATE "payments" SET "status" = 'CAPTURED', "captured_amount_minor" = "amount_minor", "captured_at" = now_at,
    "provider_state" = provider_state, "reconciliation_required" = false, "reconcile_after" = NULL, "unknown_expires_at" = NULL, "updated_at" = now_at WHERE "id" = payment_id;
  UPDATE "additional_charges" SET "status" = 'PAID', "collected_amount_minor" = "approved_amount_minor", "paid_at" = now_at, "updated_at" = now_at WHERE "id" = charge_row."id";
  UPDATE "post_return_claims" SET "status" = 'RESOLVED', "resolved_at" = now_at WHERE "id" = charge_row."claim_id" AND "status" = 'PAYMENT_PENDING';
  UPDATE "earning_holds" SET "status" = 'RELEASED', "released_at" = now_at, "resolution" = 'Approved additional charge collected'
    WHERE "claim_id" = charge_row."claim_id" AND "status" = 'ACTIVE';
  UPDATE "owner_earnings" SET "additional_compensation_minor" = "additional_compensation_minor" + charge_row."owner_compensation_minor",
    "last_financial_resolution_at" = now_at,
    "status" = CASE WHEN EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = earning_row."id" AND h."status" = 'ACTIVE' AND h."claim_id" IS DISTINCT FROM charge_row."claim_id") THEN 'HELD'::"OwnerEarningStatus" ELSE 'PENDING'::"OwnerEarningStatus" END,
    "available_at" = CASE WHEN "available_at" IS NULL THEN NULL ELSE GREATEST("available_at", now_at + interval '24 hours') END
    WHERE "id" = earning_row."id";

  SELECT "id" INTO provider_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PAYMENT_PROVIDER_RECEIVABLE' AND "active" LIMIT 1;
  SELECT "id" INTO held_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'CUSTOMER_FUNDS_HELD' AND "active" LIMIT 1;
  SELECT "id" INTO owner_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'OWNER_PAYABLE' AND "active" LIMIT 1;
  SELECT "id" INTO commission_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PLATFORM_COMMISSION_REVENUE' AND "active" LIMIT 1;
  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (recognition_id, 'CAPTURE_RECOGNITION', 'ADDITIONAL_CHARGE_PAYMENT', payment_id, payment_row."currency", 'Additional charge payment recognized', correlation_id, now_at);
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), recognition_id, provider_account, charge_row."approved_amount_minor", payment_row."currency", 'Provider receivable', now_at),
    (gen_random_uuid(), recognition_id, held_account, -charge_row."approved_amount_minor", payment_row."currency", 'Additional renter funds held', now_at);
  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (allocation_id, 'CAPTURE_ALLOCATION', 'ADDITIONAL_CHARGE_PAYMENT', payment_id, payment_row."currency", 'Additional charge allocated by category policy', correlation_id, now_at);
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), allocation_id, held_account, charge_row."approved_amount_minor", payment_row."currency", 'Allocate additional renter funds', now_at),
    (gen_random_uuid(), allocation_id, owner_account, -charge_row."owner_compensation_minor", payment_row."currency", 'Owner additional compensation', now_at),
    (gen_random_uuid(), allocation_id, commission_account, -charge_row."platform_share_minor", payment_row."currency", 'Configured platform share', now_at);
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at") VALUES
    (gen_random_uuid(), 'ADDITIONAL_CHARGE', charge_row."id", 'ADDITIONAL_CHARGE_PAID', jsonb_build_object('bookingId', charge_row."booking_id", 'chargeId', charge_row."id"), 'PENDING', now_at, now_at),
    (gen_random_uuid(), 'EARNING_HOLD', earning_row."id", 'EARNING_HOLD_RELEASED', jsonb_build_object('bookingId', charge_row."booking_id", 'claimId', charge_row."claim_id"), 'PENDING', now_at, now_at);
  INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at") VALUES
    (gen_random_uuid(), 'ADDITIONAL_CHARGE_PAID', charge_row."booking_id", jsonb_build_object('chargeId', charge_row."id"), now_at),
    (gen_random_uuid(), 'EARNING_RELEASED', charge_row."booking_id", jsonb_build_object('claimId', charge_row."claim_id"), now_at);
END;
$$;

CREATE OR REPLACE FUNCTION "emit_claim_financial_notifications"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE emitted integer := 0;
BEGIN
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
  SELECT gen_random_uuid(), 'POST_RETURN_CLAIM', c."id", 'CLAIM_RESPONSE_DEADLINE_PASSED', jsonb_build_object('bookingId', c."booking_id", 'claimId', c."id"), 'PENDING', clock_timestamp(), clock_timestamp()
  FROM "post_return_claims" c WHERE c."status" = 'RENTER_REVIEW' AND c."response_deadline_at" <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = c."id" AND o."event_type" = 'CLAIM_RESPONSE_DEADLINE_PASSED');
  GET DIAGNOSTICS emitted = ROW_COUNT;
  UPDATE "post_return_claims" c SET "status" = 'UNDER_ADMIN_REVIEW'
  WHERE c."status" = 'RENTER_REVIEW' AND c."response_deadline_at" <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "claim_responses" r WHERE r."claim_id" = c."id");
  RETURN emitted;
END;
$$;
