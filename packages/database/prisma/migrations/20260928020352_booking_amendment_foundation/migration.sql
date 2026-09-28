-- CreateEnum
CREATE TYPE "BookingAmendmentScope" AS ENUM ('PRE_TRIP', 'ACTIVE_EXTENSION');

-- CreateEnum
CREATE TYPE "BookingAmendmentStatus" AS ENUM ('PENDING_OWNER', 'OWNER_ACCEPTED_PAYMENT_PENDING', 'APPLIED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingAmendmentHoldStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONVERTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingAmendmentSettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BookingAmendmentFinancialDirection" AS ENUM ('ADDITIONAL_PAYMENT', 'REFUND', 'NONE');

-- AlterEnum
ALTER TYPE "VehicleOccupancyType" ADD VALUE 'AMENDMENT_HOLD';

-- CreateTable
CREATE TABLE "booking_amendments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "scope" "BookingAmendmentScope" NOT NULL,
    "status" "BookingAmendmentStatus" NOT NULL DEFAULT 'PENDING_OWNER',
    "policy_version" VARCHAR(100) NOT NULL,
    "source_pricing_policy_version_id" UUID NOT NULL,
    "proposed_rental_start" TIMESTAMPTZ(3) NOT NULL,
    "proposed_rental_end" TIMESTAMPTZ(3) NOT NULL,
    "proposed_start_method" "StartFulfillmentMethod" NOT NULL,
    "proposed_end_method" "EndFulfillmentMethod" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_deadline_at" TIMESTAMPTZ(3),
    "payment_initiated_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "withdrawn_at" TIMESTAMPTZ(3),
    "expired_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "reason_code" VARCHAR(100),
    "failure_code" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "idempotency_key" VARCHAR(200) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_amendment_pricing_snapshots" (
    "amendment_id" UUID NOT NULL,
    "source_booking_policy_version_id" UUID NOT NULL,
    "pricing_engine_version" VARCHAR(100) NOT NULL,
    "commission_calculation_version" VARCHAR(100) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "current_total_minor" BIGINT NOT NULL,
    "proposed_base_rental_amount_minor" BIGINT NOT NULL,
    "proposed_daily_rate_minor" BIGINT NOT NULL,
    "proposed_chargeable_days" INTEGER NOT NULL,
    "duration_discount_tier" VARCHAR(30),
    "duration_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "duration_discount_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "proposed_rental_subtotal_minor" BIGINT NOT NULL,
    "proposed_fulfillment_total_minor" BIGINT NOT NULL DEFAULT 0,
    "proposed_total_minor" BIGINT NOT NULL,
    "renter_financial_delta_minor" BIGINT NOT NULL,
    "current_commission_minor" BIGINT NOT NULL,
    "proposed_commission_minor" BIGINT NOT NULL,
    "commission_delta_minor" BIGINT NOT NULL,
    "commission_rule_id" UUID NOT NULL,
    "commission_rule_version" INTEGER NOT NULL,
    "current_owner_earnings_minor" BIGINT NOT NULL,
    "proposed_owner_earnings_minor" BIGINT NOT NULL,
    "owner_earnings_delta_minor" BIGINT NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_amendment_pricing_snapshots_pkey" PRIMARY KEY ("amendment_id")
);

-- CreateTable
CREATE TABLE "booking_amendment_fulfillment_snapshots" (
    "amendment_id" UUID NOT NULL,
    "current_start_method" "StartFulfillmentMethod" NOT NULL,
    "current_end_method" "EndFulfillmentMethod" NOT NULL,
    "proposed_start_method" "StartFulfillmentMethod" NOT NULL,
    "proposed_end_method" "EndFulfillmentMethod" NOT NULL,
    "destination_snapshot" JSONB NOT NULL,
    "source_fulfillment_policy_version_id" UUID NOT NULL,
    "serviceability_snapshot" JSONB NOT NULL,
    "current_fulfillment_total_minor" BIGINT NOT NULL,
    "proposed_fulfillment_total_minor" BIGINT NOT NULL,
    "fulfillment_delta_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "calculation_version" VARCHAR(100) NOT NULL,
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_amendment_fulfillment_snapshots_pkey" PRIMARY KEY ("amendment_id")
);

-- CreateTable
CREATE TABLE "booking_amendment_holds" (
    "id" UUID NOT NULL,
    "amendment_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "occupancy_id" UUID NOT NULL,
    "protected_start" TIMESTAMPTZ(3) NOT NULL,
    "protected_end" TIMESTAMPTZ(3) NOT NULL,
    "status" "BookingAmendmentHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "release_reason" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "idempotency_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_amendment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_amendment_status_history" (
    "id" UUID NOT NULL,
    "amendment_id" UUID NOT NULL,
    "from_status" "BookingAmendmentStatus",
    "to_status" "BookingAmendmentStatus" NOT NULL,
    "actor_type" "BookingActorType" NOT NULL,
    "actor_user_id" UUID,
    "reason_code" VARCHAR(100),
    "correlation_id" VARCHAR(100),
    "idempotency_key" VARCHAR(200) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_amendment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_amendment_settlements" (
    "id" UUID NOT NULL,
    "amendment_id" UUID NOT NULL,
    "status" "BookingAmendmentSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "direction" "BookingAmendmentFinancialDirection" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "current_total_minor" BIGINT NOT NULL,
    "proposed_total_minor" BIGINT NOT NULL,
    "financial_delta_minor" BIGINT NOT NULL,
    "additional_payment_id" UUID,
    "refund_id" UUID,
    "ledger_transaction_id" UUID,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "reconciliation_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "booking_amendment_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_amendments_booking_id_created_at_idx" ON "booking_amendments"("booking_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_amendments_status_expires_at_idx" ON "booking_amendments"("status", "expires_at");

-- CreateIndex
CREATE INDEX "booking_amendments_status_payment_deadline_at_idx" ON "booking_amendments"("status", "payment_deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendments_requester_user_id_idempotency_key_key" ON "booking_amendments"("requester_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_holds_occupancy_id_key" ON "booking_amendment_holds"("occupancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_holds_idempotency_key_key" ON "booking_amendment_holds"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_amendment_holds_amendment_id_status_idx" ON "booking_amendment_holds"("amendment_id", "status");

-- CreateIndex
CREATE INDEX "booking_amendment_holds_status_expires_at_idx" ON "booking_amendment_holds"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_status_history_idempotency_key_key" ON "booking_amendment_status_history"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_amendment_status_history_amendment_id_occurred_at_idx" ON "booking_amendment_status_history"("amendment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_settlements_amendment_id_key" ON "booking_amendment_settlements"("amendment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_settlements_additional_payment_id_key" ON "booking_amendment_settlements"("additional_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_settlements_refund_id_key" ON "booking_amendment_settlements"("refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_settlements_ledger_transaction_id_key" ON "booking_amendment_settlements"("ledger_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_amendment_settlements_idempotency_key_key" ON "booking_amendment_settlements"("idempotency_key");

-- AddForeignKey
ALTER TABLE "booking_amendments" ADD CONSTRAINT "booking_amendments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendments" ADD CONSTRAINT "booking_amendments_requester_user_id_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendments" ADD CONSTRAINT "booking_amendments_source_pricing_policy_version_id_fkey" FOREIGN KEY ("source_pricing_policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_pricing_snapshots" ADD CONSTRAINT "booking_amendment_pricing_snapshots_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "booking_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_pricing_snapshots" ADD CONSTRAINT "booking_amendment_pricing_snapshots_source_booking_policy__fkey" FOREIGN KEY ("source_booking_policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_fulfillment_snapshots" ADD CONSTRAINT "booking_amendment_fulfillment_snapshots_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "booking_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_fulfillment_snapshots" ADD CONSTRAINT "booking_amendment_fulfillment_snapshots_source_fulfillment_fkey" FOREIGN KEY ("source_fulfillment_policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_holds" ADD CONSTRAINT "booking_amendment_holds_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "booking_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_holds" ADD CONSTRAINT "booking_amendment_holds_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_holds" ADD CONSTRAINT "booking_amendment_holds_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "vehicle_occupancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_status_history" ADD CONSTRAINT "booking_amendment_status_history_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "booking_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_status_history" ADD CONSTRAINT "booking_amendment_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_amendment_settlements" ADD CONSTRAINT "booking_amendment_settlements_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "booking_amendments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one unresolved amendment may control a booking at a time.
CREATE UNIQUE INDEX "booking_amendments_one_unresolved_per_booking_idx"
ON "booking_amendments"("booking_id")
WHERE "status" IN ('PENDING_OWNER', 'OWNER_ACCEPTED_PAYMENT_PENDING');

ALTER TABLE "booking_amendments"
  ADD CONSTRAINT "booking_amendments_proposed_period_check"
    CHECK ("proposed_rental_start" < "proposed_rental_end"),
  ADD CONSTRAINT "booking_amendments_payment_timing_check"
    CHECK (
      ("payment_deadline_at" IS NULL OR "accepted_at" IS NOT NULL)
      AND ("payment_initiated_at" IS NULL OR "accepted_at" IS NOT NULL)
      AND ("payment_deadline_at" IS NULL OR "payment_deadline_at" > "accepted_at")
    );

ALTER TABLE "booking_amendment_pricing_snapshots"
  ADD CONSTRAINT "booking_amendment_pricing_nonnegative_check" CHECK (
    "current_total_minor" >= 0
    AND "proposed_base_rental_amount_minor" >= 0
    AND "proposed_daily_rate_minor" >= 0
    AND "proposed_chargeable_days" > 0
    AND "duration_discount_bps" BETWEEN 0 AND 10000
    AND "duration_discount_amount_minor" >= 0
    AND "proposed_rental_subtotal_minor" >= 0
    AND "proposed_fulfillment_total_minor" >= 0
    AND "proposed_total_minor" >= 0
    AND "current_commission_minor" >= 0
    AND "proposed_commission_minor" >= 0
    AND "current_owner_earnings_minor" >= 0
    AND "proposed_owner_earnings_minor" >= 0
  ),
  ADD CONSTRAINT "booking_amendment_pricing_delta_check" CHECK (
    "renter_financial_delta_minor" = "proposed_total_minor" - "current_total_minor"
    AND "commission_delta_minor" = "proposed_commission_minor" - "current_commission_minor"
    AND "owner_earnings_delta_minor" = "proposed_owner_earnings_minor" - "current_owner_earnings_minor"
  );

ALTER TABLE "booking_amendment_fulfillment_snapshots"
  ADD CONSTRAINT "booking_amendment_fulfillment_nonnegative_check" CHECK (
    "current_fulfillment_total_minor" >= 0
    AND "proposed_fulfillment_total_minor" >= 0
  ),
  ADD CONSTRAINT "booking_amendment_fulfillment_delta_check" CHECK (
    "fulfillment_delta_minor" = "proposed_fulfillment_total_minor" - "current_fulfillment_total_minor"
  );

ALTER TABLE "booking_amendment_holds"
  ADD CONSTRAINT "booking_amendment_holds_period_check" CHECK ("protected_start" < "protected_end"),
  ADD CONSTRAINT "booking_amendment_holds_release_check" CHECK (
    ("status" = 'ACTIVE' AND "released_at" IS NULL)
    OR ("status" <> 'ACTIVE' AND "released_at" IS NOT NULL)
  );

ALTER TABLE "booking_amendment_settlements"
  ADD CONSTRAINT "booking_amendment_settlements_amount_check" CHECK (
    "current_total_minor" >= 0
    AND "proposed_total_minor" >= 0
    AND "financial_delta_minor" = "proposed_total_minor" - "current_total_minor"
  ),
  ADD CONSTRAINT "booking_amendment_settlements_direction_check" CHECK (
    ("direction" = 'ADDITIONAL_PAYMENT' AND "financial_delta_minor" > 0)
    OR ("direction" = 'REFUND' AND "financial_delta_minor" < 0)
    OR ("direction" = 'NONE' AND "financial_delta_minor" = 0)
  );

CREATE OR REPLACE FUNCTION "protect_finalized_booking_amendment_snapshot"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."finalized_at" IS NOT NULL THEN
    RAISE EXCEPTION 'finalized booking amendment snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_amendment_pricing_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "booking_amendment_pricing_snapshots"
FOR EACH ROW EXECUTE FUNCTION "protect_finalized_booking_amendment_snapshot"();

CREATE TRIGGER "booking_amendment_fulfillment_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "booking_amendment_fulfillment_snapshots"
FOR EACH ROW EXECUTE FUNCTION "protect_finalized_booking_amendment_snapshot"();

CREATE TRIGGER "booking_amendment_status_history_append_only"
BEFORE UPDATE OR DELETE ON "booking_amendment_status_history"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "validate_booking_amendment_hold_occupancy"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  occupancy "vehicle_occupancies"%ROWTYPE;
BEGIN
  SELECT * INTO occupancy FROM "vehicle_occupancies" WHERE "id" = NEW."occupancy_id";
  IF NOT FOUND
    OR occupancy."type" <> 'AMENDMENT_HOLD'
    OR occupancy."vehicle_id" <> NEW."vehicle_id"
    OR occupancy."occupied_start" <> NEW."protected_start"
    OR occupancy."occupied_end" <> NEW."protected_end"
    OR occupancy."expires_at" IS DISTINCT FROM NEW."expires_at"
    OR occupancy."active" <> (NEW."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'amendment hold occupancy does not match its durable hold';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_amendment_hold_occupancy_consistency"
BEFORE INSERT OR UPDATE ON "booking_amendment_holds"
FOR EACH ROW EXECUTE FUNCTION "validate_booking_amendment_hold_occupancy"();

CREATE OR REPLACE FUNCTION "release_booking_amendment_holds"(
  amendment_uuid uuid,
  target_status "BookingAmendmentHoldStatus",
  release_code text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  released_count integer;
BEGIN
  IF target_status = 'ACTIVE' THEN
    RAISE EXCEPTION 'release target must be terminal';
  END IF;

  UPDATE "vehicle_occupancies" occupancy
  SET "active" = false, "updated_at" = CURRENT_TIMESTAMP
  FROM "booking_amendment_holds" hold
  WHERE hold."amendment_id" = amendment_uuid
    AND hold."status" = 'ACTIVE'
    AND occupancy."id" = hold."occupancy_id"
    AND occupancy."active" = true;

  UPDATE "booking_amendment_holds"
  SET "status" = target_status,
      "released_at" = COALESCE("released_at", CURRENT_TIMESTAMP),
      "release_reason" = COALESCE("release_reason", release_code)
  WHERE "amendment_id" = amendment_uuid AND "status" = 'ACTIVE';
  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION "convert_booking_amendment_holds"(
  amendment_uuid uuid,
  conversion_code text DEFAULT 'AMENDMENT_APPLIED'
) RETURNS integer LANGUAGE sql AS $$
  SELECT "release_booking_amendment_holds"(
    amendment_uuid,
    'CONVERTED'::"BookingAmendmentHoldStatus",
    conversion_code
  );
$$;

CREATE OR REPLACE FUNCTION "expire_stale_booking_amendments"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  amendment_row "booking_amendments"%ROWTYPE;
  terminal_status "BookingAmendmentStatus";
  terminal_reason text;
  processed integer := 0;
BEGIN
  FOR amendment_row IN
    SELECT * FROM "booking_amendments"
    WHERE
      ("status" = 'PENDING_OWNER' AND "expires_at" <= CURRENT_TIMESTAMP)
      OR (
        "status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'
        AND "payment_deadline_at" <= CURRENT_TIMESTAMP
        AND "payment_initiated_at" IS NULL
      )
    ORDER BY COALESCE("payment_deadline_at", "expires_at"), "id"
    FOR UPDATE SKIP LOCKED
  LOOP
    IF amendment_row."status" = 'PENDING_OWNER' THEN
      terminal_status := 'EXPIRED';
      terminal_reason := 'OWNER_RESPONSE_DEADLINE_EXPIRED';
      UPDATE "booking_amendments"
      SET "status" = terminal_status, "expired_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = amendment_row."id" AND "status" = 'PENDING_OWNER';
    ELSE
      terminal_status := 'FAILED';
      terminal_reason := 'RENTER_PAYMENT_DEADLINE_EXPIRED';
      UPDATE "booking_amendments"
      SET "status" = terminal_status, "failed_at" = CURRENT_TIMESTAMP,
          "failure_code" = terminal_reason, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = amendment_row."id"
        AND "status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'
        AND "payment_initiated_at" IS NULL;
    END IF;

    IF FOUND THEN
      PERFORM "release_booking_amendment_holds"(amendment_row."id", 'EXPIRED', terminal_reason);
      INSERT INTO "booking_amendment_status_history" (
        "id", "amendment_id", "from_status", "to_status", "actor_type",
        "reason_code", "correlation_id", "idempotency_key", "occurred_at"
      ) VALUES (
        gen_random_uuid(), amendment_row."id", amendment_row."status", terminal_status, 'SYSTEM',
        terminal_reason, amendment_row."correlation_id",
        'booking-amendment-expiry:' || amendment_row."id"::text || ':' || terminal_status::text,
        CURRENT_TIMESTAMP
      ) ON CONFLICT ("idempotency_key") DO NOTHING;

      INSERT INTO "outbox_events" (
        "id", "aggregate_type", "aggregate_id", "event_type", "payload", "occurred_at"
      ) VALUES (
        gen_random_uuid(), 'BOOKING_AMENDMENT', amendment_row."id", 'BOOKING_AMENDMENT_TERMINATED',
        jsonb_build_object(
          'amendmentId', amendment_row."id",
          'bookingId', amendment_row."booking_id",
          'status', terminal_status,
          'reasonCode', terminal_reason
        ), CURRENT_TIMESTAMP
      );
      processed := processed + 1;
    END IF;
  END LOOP;
  RETURN processed;
END;
$$;
