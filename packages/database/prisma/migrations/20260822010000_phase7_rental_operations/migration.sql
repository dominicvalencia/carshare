CREATE TYPE "InspectionType" AS ENUM ('PICKUP', 'RETURN');
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'FINALIZED');
CREATE TYPE "InspectionPerspective" AS ENUM ('FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'INTERIOR_DASHBOARD', 'ODOMETER', 'FUEL_OR_BATTERY_DISPLAY', 'ADDITIONAL');
CREATE TYPE "InspectionParticipantRole" AS ENUM ('RENTER', 'OWNER');
CREATE TYPE "InspectionConfirmationDecision" AS ENUM ('AGREED', 'DISAGREED');
CREATE TYPE "PostReturnClaimCategory" AS ENUM ('EXCESS_MILEAGE', 'FUEL_DEFICIENCY', 'EV_BATTERY_DEFICIENCY', 'LATE_RETURN', 'CLEANING', 'DAMAGE', 'OTHER');
CREATE TYPE "PostReturnClaimStatus" AS ENUM ('OPEN', 'RESOLVED_APPROVED', 'RESOLVED_REJECTED', 'WITHDRAWN');
CREATE TYPE "RentalIncidentCategory" AS ENUM ('BREAKDOWN', 'ACCIDENT', 'VEHICLE_ISSUE', 'RENTER_ISSUE', 'OWNER_ISSUE', 'RENTER_NO_SHOW', 'OWNER_NO_SHOW', 'VEHICLE_UNAVAILABLE', 'DOWNSTREAM_BOOKING_CONFLICT', 'OTHER');
CREATE TYPE "RentalIncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "RentalIncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

ALTER TABLE "bookings"
  ADD COLUMN "actual_pickup_at" TIMESTAMPTZ(3),
  ADD COLUMN "actual_return_at" TIMESTAMPTZ(3),
  ADD COLUMN "claim_deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN "operational_hold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pickup_window_end" TIMESTAMPTZ(3),
  ADD COLUMN "pickup_window_start" TIMESTAMPTZ(3);

CREATE TABLE "inspections" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "type" "InspectionType" NOT NULL,
  "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "submitted_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "odometer_meters" BIGINT,
  "fuel_basis_points" INTEGER,
  "battery_soc_basis_points" INTEGER,
  "notes" VARCHAR(3000),
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inspections_version_check" CHECK ("version" > 0),
  CONSTRAINT "inspections_odometer_check" CHECK ("odometer_meters" IS NULL OR "odometer_meters" >= 0),
  CONSTRAINT "inspections_fuel_check" CHECK ("fuel_basis_points" IS NULL OR "fuel_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "inspections_soc_check" CHECK ("battery_soc_basis_points" IS NULL OR "battery_soc_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "inspections_finalized_check" CHECK (("status" = 'DRAFT' AND "finalized_at" IS NULL) OR ("status" = 'FINALIZED' AND "finalized_at" IS NOT NULL)),
  UNIQUE ("booking_id", "type", "version")
);
CREATE INDEX "inspections_booking_id_type_status_idx" ON "inspections"("booking_id", "type", "status");
CREATE UNIQUE INDEX "inspections_one_finalized_type_per_booking_idx" ON "inspections"("booking_id", "type") WHERE "status" = 'FINALIZED';

CREATE TABLE "inspection_media" (
  "id" UUID PRIMARY KEY,
  "inspection_id" UUID NOT NULL REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "file_asset_id" UUID NOT NULL UNIQUE REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "perspective" "InspectionPerspective" NOT NULL,
  "evidence_sequence" INTEGER NOT NULL DEFAULT 1,
  "submitted_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "client_captured_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspection_media_sequence_check" CHECK ("evidence_sequence" > 0),
  UNIQUE ("inspection_id", "perspective", "evidence_sequence")
);
CREATE INDEX "inspection_media_inspection_id_perspective_idx" ON "inspection_media"("inspection_id", "perspective");

CREATE TABLE "inspection_confirmations" (
  "id" UUID PRIMARY KEY,
  "inspection_id" UUID NOT NULL REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "role" "InspectionParticipantRole" NOT NULL,
  "decision" "InspectionConfirmationDecision" NOT NULL,
  "reason" VARCHAR(1000),
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("inspection_id", "role")
);
CREATE INDEX "inspection_confirmations_user_id_confirmed_at_idx" ON "inspection_confirmations"("user_id", "confirmed_at");

CREATE TABLE "inspection_verification_challenges" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "issued_to_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "secret_hash" CHAR(64) NOT NULL,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "consumed_by_user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "superseded_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspection_challenge_attempt_check" CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 10 AND "attempt_count" <= "max_attempts"),
  CONSTRAINT "inspection_challenge_consumption_check" CHECK (("consumed_at" IS NULL AND "consumed_by_user_id" IS NULL) OR ("consumed_at" IS NOT NULL AND "consumed_by_user_id" IS NOT NULL))
);
CREATE INDEX "inspection_verification_challenges_booking_id_expires_at_idx" ON "inspection_verification_challenges"("booking_id", "expires_at");
CREATE UNIQUE INDEX "inspection_challenge_one_active_idx" ON "inspection_verification_challenges"("booking_id") WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL;

CREATE TABLE "inspection_amendments" (
  "id" UUID PRIMARY KEY,
  "inspection_id" UUID NOT NULL REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" VARCHAR(1000) NOT NULL,
  "evidence" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "inspection_amendments_inspection_id_created_at_idx" ON "inspection_amendments"("inspection_id", "created_at");

CREATE TABLE "booking_usage_summaries" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "pickup_odometer_meters" BIGINT NOT NULL,
  "return_odometer_meters" BIGINT NOT NULL,
  "distance_travelled_meters" BIGINT NOT NULL,
  "distance_travelled_km" INTEGER NOT NULL,
  "included_distance_km" INTEGER,
  "excess_distance_km" INTEGER NOT NULL,
  "pickup_fuel_basis_points" INTEGER,
  "return_fuel_basis_points" INTEGER,
  "required_fuel_basis_points" INTEGER,
  "fuel_deficiency_basis_points" INTEGER,
  "pickup_soc_basis_points" INTEGER,
  "return_soc_basis_points" INTEGER,
  "required_soc_basis_points" INTEGER,
  "soc_deficiency_basis_points" INTEGER,
  "scheduled_return_at" TIMESTAMPTZ(3) NOT NULL,
  "actual_return_at" TIMESTAMPTZ(3) NOT NULL,
  "late_duration_seconds" INTEGER NOT NULL,
  "return_disputed" BOOLEAN NOT NULL DEFAULT false,
  "calculation_version" VARCHAR(50) NOT NULL DEFAULT 'usage-v1',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_usage_odometer_check" CHECK ("return_odometer_meters" >= "pickup_odometer_meters" AND "distance_travelled_meters" = "return_odometer_meters" - "pickup_odometer_meters"),
  CONSTRAINT "booking_usage_distance_check" CHECK ("distance_travelled_km" >= 0 AND "excess_distance_km" >= 0 AND ("included_distance_km" IS NULL OR "included_distance_km" >= 0)),
  CONSTRAINT "booking_usage_late_check" CHECK ("late_duration_seconds" >= 0),
  CONSTRAINT "booking_usage_fuel_check" CHECK ("fuel_deficiency_basis_points" IS NULL OR "fuel_deficiency_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "booking_usage_soc_check" CHECK ("soc_deficiency_basis_points" IS NULL OR "soc_deficiency_basis_points" BETWEEN 0 AND 10000)
);

CREATE TABLE "post_return_claims" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submitted_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" "PostReturnClaimCategory" NOT NULL,
  "description" VARCHAR(3000) NOT NULL,
  "status" "PostReturnClaimStatus" NOT NULL DEFAULT 'OPEN',
  "blocking" BOOLEAN NOT NULL DEFAULT true,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "post_return_claim_resolution_check" CHECK (("status" = 'OPEN' AND "resolved_at" IS NULL) OR ("status" <> 'OPEN' AND "resolved_at" IS NOT NULL))
);
CREATE INDEX "post_return_claims_booking_id_status_submitted_at_idx" ON "post_return_claims"("booking_id", "status", "submitted_at");

CREATE TABLE "post_return_claim_evidence" (
  "id" UUID PRIMARY KEY,
  "claim_id" UUID NOT NULL REFERENCES "post_return_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "file_asset_id" UUID NOT NULL UNIQUE REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "post_return_claim_evidence_claim_id_idx" ON "post_return_claim_evidence"("claim_id");

CREATE TABLE "rental_incidents" (
  "id" UUID PRIMARY KEY,
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reported_by_user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "category" "RentalIncidentCategory" NOT NULL,
  "severity" "RentalIncidentSeverity" NOT NULL,
  "status" "RentalIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "description" VARCHAR(3000) NOT NULL,
  "blocks_completion" BOOLEAN NOT NULL DEFAULT false,
  "reported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  CONSTRAINT "rental_incident_resolution_check" CHECK (("status" IN ('OPEN', 'ACKNOWLEDGED') AND "resolved_at" IS NULL) OR ("status" IN ('RESOLVED', 'DISMISSED') AND "resolved_at" IS NOT NULL)),
  CONSTRAINT "rental_incident_critical_block_check" CHECK ("severity" <> 'CRITICAL' OR "blocks_completion")
);
CREATE INDEX "rental_incidents_booking_id_status_severity_idx" ON "rental_incidents"("booking_id", "status", "severity");
CREATE INDEX "rental_incidents_status_severity_reported_at_idx" ON "rental_incidents"("status", "severity", "reported_at");

CREATE TABLE "rental_incident_evidence" (
  "id" UUID PRIMARY KEY,
  "incident_id" UUID NOT NULL REFERENCES "rental_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "file_asset_id" UUID NOT NULL UNIQUE REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "rental_incident_evidence_incident_id_idx" ON "rental_incident_evidence"("incident_id");

CREATE INDEX "bookings_status_pickup_window_start_idx" ON "bookings"("status", "pickup_window_start");
CREATE INDEX "bookings_status_claim_deadline_at_idx" ON "bookings"("status", "claim_deadline_at");

CREATE OR REPLACE FUNCTION "validate_booking_lifecycle_transition"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'HOLD' AND NEW."status" IN ('AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED')) OR
    (OLD."status" = 'AWAITING_PAYMENT' AND NEW."status" IN ('AWAITING_OWNER', 'CANCELLED', 'EXPIRED')) OR
    (OLD."status" = 'AWAITING_OWNER' AND NEW."status" IN ('CAPTURE_PENDING', 'CANCELLED', 'EXPIRED')) OR
    (OLD."status" = 'CAPTURE_PENDING' AND NEW."status" IN ('CONFIRMED', 'CANCELLED')) OR
    (OLD."status" = 'CONFIRMED' AND NEW."status" IN ('READY_FOR_PICKUP', 'CANCELLED')) OR
    (OLD."status" = 'READY_FOR_PICKUP' AND NEW."status" IN ('ACTIVE', 'CANCELLED')) OR
    (OLD."status" = 'ACTIVE' AND NEW."status" = 'RETURN_PENDING') OR
    (OLD."status" = 'RETURN_PENDING' AND NEW."status" = 'RETURNED') OR
    (OLD."status" = 'RETURNED' AND NEW."status" = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'Invalid booking transition: % -> %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "bookings_lifecycle_transition_guard"
BEFORE UPDATE OF "status" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION "validate_booking_lifecycle_transition"();

CREATE OR REPLACE FUNCTION "validate_inspection_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  powertrain "VehiclePowertrain";
  required_count integer;
BEGIN
  IF OLD."status" = 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized inspection evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" <> 'FINALIZED' THEN RETURN NEW; END IF;
  SELECT v."powertrain" INTO powertrain
  FROM "bookings" b JOIN "vehicles" v ON v."id" = b."vehicle_id"
  WHERE b."id" = NEW."booking_id";
  IF NEW."odometer_meters" IS NULL THEN RAISE EXCEPTION 'Odometer is required'; END IF;
  IF powertrain IN ('ICE', 'HYBRID', 'PLUG_IN_HYBRID') AND NEW."fuel_basis_points" IS NULL THEN
    RAISE EXCEPTION 'Fuel measurement is required for this powertrain';
  END IF;
  IF powertrain IN ('BATTERY_ELECTRIC', 'PLUG_IN_HYBRID') AND NEW."battery_soc_basis_points" IS NULL THEN
    RAISE EXCEPTION 'Battery SOC is required for this powertrain';
  END IF;
  IF powertrain = 'BATTERY_ELECTRIC' AND NEW."fuel_basis_points" IS NOT NULL THEN
    RAISE EXCEPTION 'Fuel measurement is not applicable to battery electric vehicles';
  END IF;
  SELECT count(DISTINCT "perspective") INTO required_count FROM "inspection_media"
  WHERE "inspection_id" = NEW."id" AND "perspective" <> 'ADDITIONAL';
  IF required_count <> 7 THEN RAISE EXCEPTION 'Seven required inspection perspectives are required'; END IF;
  NEW."finalized_at" := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER "inspections_finalization_guard"
BEFORE UPDATE ON "inspections"
FOR EACH ROW EXECUTE FUNCTION "validate_inspection_finalization"();
CREATE TRIGGER "inspections_delete_guard"
BEFORE DELETE ON "inspections"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "protect_finalized_inspection_child"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inspection_status "InspectionStatus";
BEGIN
  SELECT "status" INTO inspection_status FROM "inspections" WHERE "id" = OLD."inspection_id";
  IF inspection_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized inspection evidence is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "inspection_media_immutability"
BEFORE UPDATE OR DELETE ON "inspection_media"
FOR EACH ROW EXECUTE FUNCTION "protect_finalized_inspection_child"();
CREATE TRIGGER "inspection_confirmations_append_only"
BEFORE UPDATE OR DELETE ON "inspection_confirmations"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "inspection_amendments_append_only"
BEFORE UPDATE OR DELETE ON "inspection_amendments"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "booking_usage_summaries_append_only"
BEFORE UPDATE OR DELETE ON "booking_usage_summaries"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "post_return_claim_evidence_append_only"
BEFORE UPDATE OR DELETE ON "post_return_claim_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "rental_incident_evidence_append_only"
BEFORE UPDATE OR DELETE ON "rental_incident_evidence"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "guard_post_return_claim_submission"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE booking_row "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO booking_row FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  NEW."submitted_at" := clock_timestamp();
  IF booking_row."status" <> 'RETURNED' OR booking_row."claim_deadline_at" IS NULL THEN
    RAISE EXCEPTION 'Claims require a returned booking with an active claim window' USING ERRCODE = '23514';
  END IF;
  IF NEW."submitted_at" > booking_row."claim_deadline_at" THEN
    RAISE EXCEPTION 'Claim deadline has passed' USING ERRCODE = '23514';
  END IF;
  IF NEW."submitted_by_user_id" <> booking_row."owner_user_id" THEN
    RAISE EXCEPTION 'Only the booking owner may submit a post-return claim' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "post_return_claim_submission_guard"
BEFORE INSERT ON "post_return_claims"
FOR EACH ROW EXECUTE FUNCTION "guard_post_return_claim_submission"();

CREATE OR REPLACE FUNCTION "open_due_pickup_windows"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; transitioned integer := 0;
BEGIN
  UPDATE "bookings" SET
    "pickup_window_start" = "rental_start" - interval '30 minutes',
    "pickup_window_end" = "rental_start" + interval '60 minutes'
  WHERE "status" = 'CONFIRMED' AND "pickup_window_start" IS NULL;
  FOR item IN
    SELECT "id" FROM "bookings"
    WHERE "status" = 'CONFIRMED' AND "pickup_window_start" <= clock_timestamp()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE "bookings" SET "status" = 'READY_FOR_PICKUP', "updated_at" = clock_timestamp() WHERE "id" = item."id";
    INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "occurred_at")
    VALUES (gen_random_uuid(), item."id", 'CONFIRMED', 'READY_FOR_PICKUP', 'WORKER', 'PICKUP_WINDOW_OPENED', clock_timestamp());
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    VALUES (gen_random_uuid(), 'BOOKING', item."id", 'PICKUP_WINDOW_OPENED', jsonb_build_object('bookingId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp());
    transitioned := transitioned + 1;
  END LOOP;
  RETURN transitioned;
END;
$$;

CREATE OR REPLACE FUNCTION "complete_due_returned_bookings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; transitioned integer := 0;
BEGIN
  FOR item IN
    SELECT b."id" FROM "bookings" b
    WHERE b."status" = 'RETURNED'
      AND b."claim_deadline_at" < clock_timestamp()
      AND b."operational_hold" = false
      AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = b."id" AND c."blocking" AND c."status" = 'OPEN')
      AND NOT EXISTS (SELECT 1 FROM "booking_usage_summaries" u WHERE u."booking_id" = b."id" AND u."return_disputed")
      AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."blocks_completion" AND i."status" IN ('OPEN', 'ACKNOWLEDGED'))
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE "bookings" SET "status" = 'COMPLETED', "updated_at" = clock_timestamp() WHERE "id" = item."id";
    INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "occurred_at")
    VALUES (gen_random_uuid(), item."id", 'RETURNED', 'COMPLETED', 'WORKER', 'CLAIM_WINDOW_EXPIRED', clock_timestamp());
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    VALUES (gen_random_uuid(), 'BOOKING', item."id", 'BOOKING_COMPLETED', jsonb_build_object('bookingId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp());
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at")
    VALUES (gen_random_uuid(), 'BOOKING_COMPLETED', item."id", '{}'::jsonb, clock_timestamp());
    transitioned := transitioned + 1;
  END LOOP;
  RETURN transitioned;
END;
$$;
