-- Migration 52: immutable participant reports for a handover completed outside the app.
-- This records participant assertions without backdating authoritative custody timestamps.
CREATE TABLE "booking_pickup_handover_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" uuid NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "reported_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "reported_physical_handover_at" timestamptz(3) NOT NULL,
  "reported_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "correlation_id" varchar(100)
);

CREATE TABLE "booking_pickup_handover_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "report_id" uuid NOT NULL UNIQUE REFERENCES "booking_pickup_handover_reports"("id") ON DELETE RESTRICT,
  "booking_id" uuid NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "responded_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decision" varchar(30) NOT NULL CHECK ("decision" IN ('CONFIRMED', 'DISPUTED', 'NOT_RECEIVED')),
  "proposed_physical_handover_at" timestamptz(3),
  "responded_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "correlation_id" varchar(100),
  CHECK (("decision" = 'DISPUTED') = ("proposed_physical_handover_at" IS NOT NULL))
);

CREATE TRIGGER "pickup_handover_reports_append_only" BEFORE UPDATE OR DELETE
  ON "booking_pickup_handover_reports" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "pickup_handover_responses_append_only" BEFORE UPDATE OR DELETE
  ON "booking_pickup_handover_responses" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE FUNCTION "validate_pickup_handover_report"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b "bookings"%ROWTYPE;
  earliest_allowed timestamptz;
  delivery_arrived_at timestamptz;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  IF NOT FOUND OR b."handover_workflow_version" IS DISTINCT FROM 1
    OR b."status" <> 'READY_FOR_PICKUP' OR b."actual_pickup_at" IS NOT NULL
    OR NEW."reported_by_user_id" <> b."owner_user_id"
    OR NOT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w
      WHERE w."booking_id" = b."id" AND w."phase" = 'START')
    THEN RAISE EXCEPTION 'invalid historical pickup handover report';
  END IF;

  earliest_allowed := COALESCE(b."pickup_window_start", b."rental_start");
  IF EXISTS (SELECT 1 FROM "booking_fulfillment_snapshots" f
      WHERE f."booking_id" = b."id" AND f."start_method" = 'OWNER_DELIVERY') THEN
    SELECT e."occurred_at" INTO delivery_arrived_at
      FROM "booking_handover_travel_events" e
      WHERE e."booking_id" = b."id" AND e."phase" = 'START' AND e."status" = 'ARRIVED';
    IF delivery_arrived_at IS NULL THEN RAISE EXCEPTION 'delivery arrival is required'; END IF;
    earliest_allowed := GREATEST(earliest_allowed, delivery_arrived_at);
  END IF;

  IF NEW."reported_physical_handover_at" < earliest_allowed
    OR NEW."reported_physical_handover_at" > clock_timestamp()
    OR NEW."reported_physical_handover_at" >= b."rental_end"
    THEN RAISE EXCEPTION 'reported handover time is outside the allowed booking window';
  END IF;
  NEW."reported_at" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "pickup_handover_report_authority" BEFORE INSERT ON "booking_pickup_handover_reports"
  FOR EACH ROW EXECUTE FUNCTION "validate_pickup_handover_report"();

CREATE FUNCTION "validate_pickup_handover_response"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  b "bookings"%ROWTYPE;
  r "booking_pickup_handover_reports"%ROWTYPE;
  earliest_allowed timestamptz;
  delivery_arrived_at timestamptz;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  SELECT * INTO r FROM "booking_pickup_handover_reports" WHERE "id" = NEW."report_id";
  earliest_allowed := COALESCE(b."pickup_window_start", b."rental_start");
  IF NOT FOUND OR r."booking_id" <> b."id" OR b."handover_workflow_version" IS DISTINCT FROM 1
    OR b."status" <> 'READY_FOR_PICKUP' OR b."actual_pickup_at" IS NOT NULL
    OR NEW."responded_by_user_id" <> b."renter_user_id"
    THEN RAISE EXCEPTION 'invalid renter handover response';
  END IF;
  IF EXISTS (SELECT 1 FROM "booking_fulfillment_snapshots" f
      WHERE f."booking_id" = b."id" AND f."start_method" = 'OWNER_DELIVERY') THEN
    SELECT e."occurred_at" INTO delivery_arrived_at
      FROM "booking_handover_travel_events" e
      WHERE e."booking_id" = b."id" AND e."phase" = 'START' AND e."status" = 'ARRIVED';
    IF delivery_arrived_at IS NULL THEN RAISE EXCEPTION 'delivery arrival is required'; END IF;
    earliest_allowed := GREATEST(earliest_allowed, delivery_arrived_at);
  END IF;
  IF NEW."decision" = 'DISPUTED' AND (
      NEW."proposed_physical_handover_at" < earliest_allowed
      OR NEW."proposed_physical_handover_at" > clock_timestamp()
      OR NEW."proposed_physical_handover_at" >= b."rental_end")
    THEN RAISE EXCEPTION 'proposed handover time is outside the allowed booking window';
  END IF;
  NEW."responded_at" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "pickup_handover_response_authority" BEFORE INSERT ON "booking_pickup_handover_responses"
  FOR EACH ROW EXECUTE FUNCTION "validate_pickup_handover_response"();

-- Keep the shared financial authority fail-closed for waived Start handovers until the
-- Renter has immutably confirmed the Owner-reported physical handover time.
ALTER FUNCTION "booking_workflow_compliance_blocker"(uuid)
  RENAME TO "booking_pre_historical_report_workflow_compliance_blocker";
CREATE FUNCTION "booking_workflow_compliance_blocker"(booking_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE
  b "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = booking_id;
  IF b."handover_workflow_version" = 1
    AND EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w
      WHERE w."booking_id" = b."id" AND w."phase" = 'START')
    AND NOT EXISTS (SELECT 1 FROM "booking_pickup_handover_responses" r
      WHERE r."booking_id" = b."id" AND r."responded_by_user_id" = b."renter_user_id"
        AND r."decision" = 'CONFIRMED')
    THEN RETURN 'PICKUP_HANDOVER_TIME_CONFIRMATION_REQUIRED';
  END IF;
  RETURN "booking_pre_historical_report_workflow_compliance_blocker"(booking_id);
END $$;
