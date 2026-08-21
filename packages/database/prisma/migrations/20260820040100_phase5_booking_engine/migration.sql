-- Phase 5 authoritative booking and unified occupancy foundation.
CREATE TYPE "BookingStatus" AS ENUM ('HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER', 'CAPTURE_PENDING', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "VehicleOccupancyType" AS ENUM ('OWNER_BLOCK', 'BOOKING_RESERVATION', 'MAINTENANCE');
CREATE TYPE "BookingActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER');
CREATE TYPE "BookingOwnerDecisionType" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

ALTER TABLE "analytics_events" ADD COLUMN "booking_id" UUID;

CREATE TABLE "bookings" (
  "id" UUID NOT NULL,
  "public_reference" VARCHAR(32) NOT NULL,
  "renter_user_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "owner_profile_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "status" "BookingStatus" NOT NULL DEFAULT 'HOLD',
  "rental_start" TIMESTAMPTZ(3) NOT NULL,
  "rental_end" TIMESTAMPTZ(3) NOT NULL,
  "hold_expires_at" TIMESTAMPTZ(3),
  "owner_response_deadline_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bookings_period_check" CHECK ("rental_start" < "rental_end"),
  CONSTRAINT "bookings_hold_deadline_check" CHECK (
    "status" NOT IN ('HOLD', 'AWAITING_PAYMENT') OR "hold_expires_at" IS NOT NULL
  ),
  CONSTRAINT "bookings_owner_deadline_check" CHECK (
    "status" <> 'AWAITING_OWNER' OR "owner_response_deadline_at" IS NOT NULL
  )
);

CREATE TABLE "vehicle_occupancies" (
  "id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "booking_id" UUID,
  "type" "VehicleOccupancyType" NOT NULL,
  "occupied_start" TIMESTAMPTZ(3) NOT NULL,
  "occupied_end" TIMESTAMPTZ(3) NOT NULL,
  "occupied_period" TSTZRANGE GENERATED ALWAYS AS (
    tstzrange("occupied_start", "occupied_end", '[)')
  ) STORED,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "release_reason" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_occupancies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_occupancies_period_check" CHECK ("occupied_start" < "occupied_end"),
  CONSTRAINT "vehicle_occupancies_release_check" CHECK (
    ("active" AND "released_at" IS NULL) OR (NOT "active" AND "released_at" IS NOT NULL)
  ),
  CONSTRAINT "vehicle_occupancies_domain_check" CHECK (
    ("type" = 'BOOKING_RESERVATION' AND "booking_id" IS NOT NULL)
    OR ("type" <> 'BOOKING_RESERVATION' AND "booking_id" IS NULL)
  )
);

-- One constraint protects owner blocks and booking reservations in both race directions.
ALTER TABLE "vehicle_occupancies"
  ADD CONSTRAINT "vehicle_occupancies_no_overlap"
  EXCLUDE USING GIST ("vehicle_id" WITH =, "occupied_period" WITH &&)
  WHERE ("active");

ALTER TABLE "vehicle_blocked_periods" ADD COLUMN "occupancy_id" UUID;
INSERT INTO "vehicle_occupancies" (
  "id", "vehicle_id", "type", "occupied_start", "occupied_end", "active",
  "released_at", "release_reason", "created_at"
)
SELECT
  b."id", b."vehicle_id", 'OWNER_BLOCK', b."starts_at", b."ends_at",
  b."removed_at" IS NULL, b."removed_at",
  CASE WHEN b."removed_at" IS NULL THEN NULL ELSE 'OWNER_BLOCK_REMOVED' END,
  b."created_at"
FROM "vehicle_blocked_periods" b;
UPDATE "vehicle_blocked_periods" SET "occupancy_id" = "id";
ALTER TABLE "vehicle_blocked_periods" ALTER COLUMN "occupancy_id" SET NOT NULL;

CREATE TABLE "booking_pricing_snapshots" (
  "booking_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "pricing_engine_version" VARCHAR(100) NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "rental_start" TIMESTAMPTZ(3) NOT NULL,
  "rental_end" TIMESTAMPTZ(3) NOT NULL,
  "vehicle_timezone" VARCHAR(64) NOT NULL,
  "chargeable_days" INTEGER NOT NULL,
  "subtotal_minor" INTEGER NOT NULL,
  "total_minor" INTEGER NOT NULL,
  "unlimited_mileage" BOOLEAN NOT NULL,
  "included_mileage_km" INTEGER,
  "excess_kilometer_rate_minor" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_pricing_snapshots_pkey" PRIMARY KEY ("booking_id"),
  CONSTRAINT "booking_pricing_snapshots_values_check" CHECK (
    "rental_start" < "rental_end" AND "chargeable_days" > 0 AND
    "currency" = 'PHP' AND "subtotal_minor" >= 0 AND "total_minor" >= 0
  )
);

CREATE TABLE "booking_pricing_snapshot_lines" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "description" VARCHAR(255) NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_amount_minor" INTEGER NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "display_order" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_pricing_snapshot_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_pricing_snapshot_lines_values_check" CHECK (
    "quantity" > 0 AND "unit_amount_minor" >= 0 AND "amount_minor" >= 0 AND
    "amount_minor" = "quantity" * "unit_amount_minor"
  )
);

CREATE TABLE "booking_policy_snapshots" (
  "booking_id" UUID NOT NULL,
  "policy_version_id" UUID NOT NULL,
  "mileage_policy" "MileagePolicyType" NOT NULL,
  "included_kilometers_per_day" INTEGER,
  "excess_kilometer_rate_minor" INTEGER,
  "fuel_return_policy" "FuelReturnPolicyType",
  "fuel_tolerance_percent" INTEGER,
  "fuel_calculation_policy_ref" VARCHAR(100),
  "ev_return_policy" "EvReturnPolicyType",
  "ev_required_percentage" INTEGER,
  "ev_tolerance_percent" INTEGER,
  "ev_calculation_policy_ref" VARCHAR(100),
  "turnaround_minutes" INTEGER NOT NULL,
  "availability_policy" "AvailabilityPolicyType" NOT NULL,
  "monday" BOOLEAN NOT NULL,
  "tuesday" BOOLEAN NOT NULL,
  "wednesday" BOOLEAN NOT NULL,
  "thursday" BOOLEAN NOT NULL,
  "friday" BOOLEAN NOT NULL,
  "saturday" BOOLEAN NOT NULL,
  "sunday" BOOLEAN NOT NULL,
  "claim_window_hours" INTEGER NOT NULL DEFAULT 24,
  "cancellation_policy_ref" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_policy_snapshots_pkey" PRIMARY KEY ("booking_id"),
  CONSTRAINT "booking_policy_snapshots_values_check" CHECK (
    "turnaround_minutes" >= 0 AND "claim_window_hours" > 0
  )
);

CREATE TABLE "booking_status_history" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "from_status" "BookingStatus",
  "to_status" "BookingStatus" NOT NULL,
  "actor_type" "BookingActorType" NOT NULL,
  "actor_user_id" UUID,
  "reason_code" VARCHAR(100),
  "reason_text" VARCHAR(1000),
  "correlation_id" VARCHAR(100),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_status_history_actor_check" CHECK (
    ("actor_type" = 'USER' AND "actor_user_id" IS NOT NULL) OR
    ("actor_type" <> 'USER' AND "actor_user_id" IS NULL)
  )
);

CREATE TABLE "booking_cancellations" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "actor_type" "BookingActorType" NOT NULL,
  "actor_user_id" UUID,
  "reason_code" VARCHAR(100) NOT NULL,
  "reason_text" VARCHAR(1000),
  "correlation_id" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_owner_decisions" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "decision" "BookingOwnerDecisionType" NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "reason_text" VARCHAR(1000),
  "correlation_id" VARCHAR(100),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_owner_decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_idempotency_records" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "scope" VARCHAR(100) NOT NULL,
  "key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "booking_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bookings_public_reference_key" ON "bookings"("public_reference");
CREATE UNIQUE INDEX "bookings_quote_id_key" ON "bookings"("quote_id");
CREATE INDEX "bookings_renter_user_id_created_at_idx" ON "bookings"("renter_user_id", "created_at");
CREATE INDEX "bookings_owner_user_id_status_created_at_idx" ON "bookings"("owner_user_id", "status", "created_at");
CREATE INDEX "bookings_vehicle_id_rental_start_rental_end_idx" ON "bookings"("vehicle_id", "rental_start", "rental_end");
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");
CREATE INDEX "bookings_status_owner_response_deadline_at_idx" ON "bookings"("status", "owner_response_deadline_at");
CREATE UNIQUE INDEX "vehicle_occupancies_booking_id_key" ON "vehicle_occupancies"("booking_id");
CREATE INDEX "vehicle_occupancies_vehicle_active_period_idx" ON "vehicle_occupancies"("vehicle_id", "active", "occupied_start", "occupied_end");
CREATE INDEX "vehicle_occupancies_active_expires_at_idx" ON "vehicle_occupancies"("active", "expires_at");
CREATE INDEX "booking_pricing_snapshots_quote_id_idx" ON "booking_pricing_snapshots"("quote_id");
CREATE INDEX "booking_pricing_snapshot_lines_booking_id_display_order_idx" ON "booking_pricing_snapshot_lines"("booking_id", "display_order");
CREATE INDEX "booking_status_history_booking_id_occurred_at_idx" ON "booking_status_history"("booking_id", "occurred_at");
CREATE UNIQUE INDEX "booking_cancellations_booking_id_key" ON "booking_cancellations"("booking_id");
CREATE UNIQUE INDEX "booking_owner_decisions_booking_id_key" ON "booking_owner_decisions"("booking_id");
CREATE UNIQUE INDEX "booking_idempotency_records_booking_id_key" ON "booking_idempotency_records"("booking_id");
CREATE UNIQUE INDEX "booking_idempotency_actor_scope_key" ON "booking_idempotency_records"("actor_user_id", "scope", "key");
CREATE INDEX "booking_idempotency_records_expires_at_idx" ON "booking_idempotency_records"("expires_at");
CREATE INDEX "outbox_events_status_available_at_occurred_at_idx" ON "outbox_events"("status", "available_at", "occurred_at");
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_occurred_at_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "occurred_at");
CREATE INDEX "analytics_events_booking_id_occurred_at_idx" ON "analytics_events"("booking_id", "occurred_at");
CREATE UNIQUE INDEX "vehicle_blocked_periods_occupancy_id_key" ON "vehicle_blocked_periods"("occupancy_id");

ALTER TABLE "vehicle_blocked_periods" ADD CONSTRAINT "vehicle_blocked_periods_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "vehicle_occupancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_renter_user_id_fkey" FOREIGN KEY ("renter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_occupancies" ADD CONSTRAINT "vehicle_occupancies_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_occupancies" ADD CONSTRAINT "vehicle_occupancies_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_pricing_snapshots" ADD CONSTRAINT "booking_pricing_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_pricing_snapshot_lines" ADD CONSTRAINT "booking_pricing_snapshot_lines_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking_pricing_snapshots"("booking_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_policy_snapshots" ADD CONSTRAINT "booking_policy_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellations" ADD CONSTRAINT "booking_cancellations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_owner_decisions" ADD CONSTRAINT "booking_owner_decisions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_owner_decisions" ADD CONSTRAINT "booking_owner_decisions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_idempotency_records" ADD CONSTRAINT "booking_idempotency_records_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_idempotency_records" ADD CONSTRAINT "booking_idempotency_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable booking evidence can only be appended.
CREATE TRIGGER "booking_pricing_snapshots_append_only" BEFORE UPDATE OR DELETE ON "booking_pricing_snapshots" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_pricing_snapshot_lines_append_only" BEFORE UPDATE OR DELETE ON "booking_pricing_snapshot_lines" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_policy_snapshots_append_only" BEFORE UPDATE OR DELETE ON "booking_policy_snapshots" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_status_history_append_only" BEFORE UPDATE OR DELETE ON "booking_status_history" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_cancellations_append_only" BEFORE UPDATE OR DELETE ON "booking_cancellations" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_owner_decisions_append_only" BEFORE UPDATE OR DELETE ON "booking_owner_decisions" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

-- Database-authoritative expiration. Row locks and status predicates make this
-- safe against cancellation/funding/owner-decision races.
CREATE OR REPLACE FUNCTION "expire_stale_bookings"()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  candidate RECORD;
  expired_count INTEGER := 0;
  expiration_reason TEXT;
  expiration_event TEXT;
BEGIN
  FOR candidate IN
    SELECT b."id", b."status"
    FROM "bookings" b
    WHERE (
      (b."status" IN ('HOLD', 'AWAITING_PAYMENT') AND b."hold_expires_at" <= clock_timestamp())
      OR
      (b."status" = 'AWAITING_OWNER' AND b."owner_response_deadline_at" <= clock_timestamp())
    )
    FOR UPDATE SKIP LOCKED
  LOOP
    IF candidate."status" = 'AWAITING_OWNER' THEN
      expiration_reason := 'OWNER_RESPONSE_EXPIRED';
      expiration_event := 'BOOKING_OWNER_RESPONSE_EXPIRED';
    ELSE
      expiration_reason := 'HOLD_EXPIRED';
      expiration_event := 'BOOKING_HOLD_EXPIRED';
    END IF;

    UPDATE "bookings"
      SET "status" = 'EXPIRED', "updated_at" = clock_timestamp()
      WHERE "id" = candidate."id" AND "status" = candidate."status";
    IF FOUND THEN
      UPDATE "vehicle_occupancies"
        SET "active" = false, "released_at" = clock_timestamp(), "release_reason" = expiration_reason
        WHERE "booking_id" = candidate."id" AND "active";
      INSERT INTO "booking_status_history" (
        "id", "booking_id", "from_status", "to_status", "actor_type", "reason_code"
      ) VALUES (
        gen_random_uuid(), candidate."id", candidate."status", 'EXPIRED', 'WORKER', expiration_reason
      );
      INSERT INTO "outbox_events" (
        "id", "aggregate_type", "aggregate_id", "event_type", "payload"
      ) VALUES (
        gen_random_uuid(), 'BOOKING', candidate."id", expiration_event,
        jsonb_build_object('bookingId', candidate."id", 'reasonCode', expiration_reason)
      );
      expired_count := expired_count + 1;
    END IF;
  END LOOP;
  RETURN expired_count;
END;
$$;
