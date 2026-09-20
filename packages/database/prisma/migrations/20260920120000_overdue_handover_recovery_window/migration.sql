CREATE TABLE "booking_overdue_handover_recoveries" (
  "id" uuid PRIMARY KEY,
  "booking_id" uuid NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "reported_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "scope" varchar(20) NOT NULL CHECK ("scope" IN ('START','RETURN','BOTH')),
  "reported_pickup_at" timestamptz(3),
  "reported_return_at" timestamptz(3),
  "acknowledgement_version" varchar(100) NOT NULL CHECK ("acknowledgement_version" = 'OVERDUE_HANDOVER_RECOVERY_V1'),
  "reported_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "response_deadline_at" timestamptz(3) NOT NULL,
  "correlation_id" varchar(100),
  CHECK (("scope" = 'START' AND "reported_pickup_at" IS NOT NULL AND "reported_return_at" IS NULL)
    OR ("scope" = 'RETURN' AND "reported_pickup_at" IS NULL AND "reported_return_at" IS NOT NULL)
    OR ("scope" = 'BOTH' AND "reported_pickup_at" IS NOT NULL AND "reported_return_at" IS NOT NULL)),
  CHECK ("reported_return_at" IS NULL OR "reported_pickup_at" IS NULL OR "reported_return_at" >= "reported_pickup_at"),
  CHECK ("response_deadline_at" = "reported_at" + interval '24 hours')
);
CREATE INDEX "booking_overdue_handover_recoveries_deadline_idx"
  ON "booking_overdue_handover_recoveries"("response_deadline_at", "reported_at");

CREATE TABLE "booking_overdue_handover_recovery_responses" (
  "id" uuid PRIMARY KEY,
  "recovery_id" uuid NOT NULL UNIQUE REFERENCES "booking_overdue_handover_recoveries"("id") ON DELETE RESTRICT,
  "booking_id" uuid NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "responded_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "decision" varchar(20) NOT NULL CHECK ("decision" IN ('CONFIRMED','DISPUTED')),
  "reason" varchar(1000),
  "responded_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "correlation_id" varchar(100),
  CHECK (("decision" = 'DISPUTED' AND length(trim("reason")) >= 3) OR ("decision" = 'CONFIRMED' AND "reason" IS NULL))
);

CREATE TABLE "booking_overdue_handover_recovery_acceptances" (
  "id" uuid PRIMARY KEY,
  "recovery_id" uuid NOT NULL UNIQUE REFERENCES "booking_overdue_handover_recoveries"("id") ON DELETE RESTRICT,
  "booking_id" uuid NOT NULL UNIQUE REFERENCES "bookings"("id") ON DELETE RESTRICT,
  "accepted_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "acceptance_source" varchar(30) NOT NULL CHECK ("acceptance_source" IN ('RENTER_CONFIRMED','NO_RESPONSE_24H'))
);

CREATE FUNCTION "prevent_overdue_handover_recovery_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'overdue handover recovery records are append-only'; END $$;
CREATE TRIGGER "overdue_handover_recovery_immutable" BEFORE UPDATE OR DELETE ON "booking_overdue_handover_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "prevent_overdue_handover_recovery_mutation"();
CREATE TRIGGER "overdue_handover_response_immutable" BEFORE UPDATE OR DELETE ON "booking_overdue_handover_recovery_responses"
  FOR EACH ROW EXECUTE FUNCTION "prevent_overdue_handover_recovery_mutation"();
CREATE TRIGGER "overdue_handover_acceptance_immutable" BEFORE UPDATE OR DELETE ON "booking_overdue_handover_recovery_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "prevent_overdue_handover_recovery_mutation"();

CREATE FUNCTION "validate_overdue_handover_recovery"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "bookings"%ROWTYPE; start_overdue boolean; return_overdue boolean;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  start_overdue := b."status" IN ('CONFIRMED','READY_FOR_PICKUP') AND b."actual_pickup_at" IS NULL
    AND b."pickup_window_end" IS NOT NULL AND clock_timestamp() > b."pickup_window_end";
  return_overdue := b."status" IN ('READY_FOR_PICKUP','ACTIVE','RETURN_PENDING') AND b."actual_return_at" IS NULL
    AND clock_timestamp() > b."rental_end" + interval '120 minutes';
  IF b."handover_workflow_version" IS DISTINCT FROM 1 OR b."owner_user_id" <> NEW."reported_by_user_id"
    OR b."operational_hold" THEN RAISE EXCEPTION 'invalid overdue handover recovery actor or booking'; END IF;
  IF NEW."scope" IS DISTINCT FROM (CASE WHEN start_overdue AND return_overdue THEN 'BOTH'
    WHEN start_overdue THEN 'START' WHEN return_overdue THEN 'RETURN' ELSE NULL END)
    THEN RAISE EXCEPTION 'recovery scope must match the overdue phases'; END IF;
  IF NEW."reported_pickup_at" IS NOT NULL AND (NEW."reported_pickup_at" < b."rental_start" OR NEW."reported_pickup_at" > clock_timestamp())
    THEN RAISE EXCEPTION 'reported Pickup is outside the allowed window'; END IF;
  IF NEW."reported_return_at" IS NOT NULL AND (NEW."reported_return_at" < COALESCE(NEW."reported_pickup_at", b."actual_pickup_at") OR NEW."reported_return_at" > clock_timestamp())
    THEN RAISE EXCEPTION 'reported Return is outside the allowed window'; END IF;
  IF EXISTS (SELECT 1 FROM "inspections" i WHERE i."booking_id" = b."id" AND i."status" = 'FINALIZED'
    AND ((NEW."scope" IN ('START','BOTH') AND i."type" = 'PICKUP') OR (NEW."scope" IN ('RETURN','BOTH') AND i."type" = 'RETURN')))
    THEN RAISE EXCEPTION 'finalized evidence cannot be replaced by overdue recovery'; END IF;
  NEW."reported_at" := clock_timestamp();
  NEW."response_deadline_at" := NEW."reported_at" + interval '24 hours';
  RETURN NEW;
END $$;
CREATE TRIGGER "overdue_handover_recovery_authority" BEFORE INSERT ON "booking_overdue_handover_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "validate_overdue_handover_recovery"();

CREATE FUNCTION "validate_overdue_handover_recovery_response"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "booking_overdue_handover_recoveries"%ROWTYPE; b "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "booking_overdue_handover_recoveries" WHERE "id" = NEW."recovery_id" FOR UPDATE;
  SELECT * INTO b FROM "bookings" WHERE "id" = r."booking_id" FOR UPDATE;
  IF NEW."booking_id" <> r."booking_id" OR NEW."responded_by_user_id" <> b."renter_user_id"
    OR clock_timestamp() >= r."response_deadline_at"
    OR EXISTS (SELECT 1 FROM "booking_overdue_handover_recovery_acceptances" a WHERE a."recovery_id" = r."id")
    THEN RAISE EXCEPTION 'invalid or late overdue handover response'; END IF;
  NEW."responded_at" := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "overdue_handover_response_authority" BEFORE INSERT ON "booking_overdue_handover_recovery_responses"
  FOR EACH ROW EXECUTE FUNCTION "validate_overdue_handover_recovery_response"();

CREATE FUNCTION "accept_overdue_handover_recovery"(recovery_id uuid, acceptance_source text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r "booking_overdue_handover_recoveries"%ROWTYPE; b "bookings"%ROWTYPE; response_decision text;
  claim_hours integer; from_status "BookingStatus"; target_status "BookingStatus";
BEGIN
  SELECT * INTO r FROM "booking_overdue_handover_recoveries" WHERE "id" = recovery_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO b FROM "bookings" WHERE "id" = r."booking_id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "booking_overdue_handover_recovery_acceptances" a WHERE a."recovery_id" = r."id") THEN RETURN false; END IF;
  SELECT "decision" INTO response_decision FROM "booking_overdue_handover_recovery_responses" WHERE "recovery_id" = r."id";
  IF response_decision = 'DISPUTED' OR b."operational_hold" OR EXISTS (
    SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion" AND d."status" IN ('OPEN','EVIDENCE_COLLECTION','UNDER_REVIEW')
  ) THEN RETURN false; END IF;
  IF acceptance_source = 'RENTER_CONFIRMED' AND response_decision IS DISTINCT FROM 'CONFIRMED' THEN RETURN false; END IF;
  IF acceptance_source = 'NO_RESPONSE_24H' AND (response_decision IS NOT NULL OR clock_timestamp() < r."response_deadline_at") THEN RETURN false; END IF;
  from_status := b."status";
  target_status := CASE WHEN r."scope" = 'START' THEN 'ACTIVE'::"BookingStatus" ELSE 'RETURNED'::"BookingStatus" END;
  SELECT "claim_window_hours" INTO claim_hours FROM "booking_policy_snapshots" WHERE "booking_id" = b."id";
  UPDATE "bookings" SET
    "actual_pickup_at" = CASE WHEN r."scope" IN ('START','BOTH') THEN r."reported_pickup_at" ELSE b."actual_pickup_at" END,
    "actual_return_at" = CASE WHEN r."scope" IN ('RETURN','BOTH') THEN r."reported_return_at" ELSE b."actual_return_at" END,
    "claim_deadline_at" = CASE WHEN r."scope" IN ('RETURN','BOTH') THEN clock_timestamp() + COALESCE(claim_hours,24) * interval '1 hour' ELSE b."claim_deadline_at" END,
    "status" = target_status
  WHERE "id" = b."id";
  INSERT INTO "booking_overdue_handover_recovery_acceptances"("id","recovery_id","booking_id","acceptance_source")
    VALUES (gen_random_uuid(), r."id", b."id", acceptance_source);
  INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id")
    VALUES (gen_random_uuid(), b."id", from_status, target_status, 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id");
  INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload") VALUES
    (gen_random_uuid(), 'BOOKING', b."id", 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', jsonb_build_object('bookingId',b."id",'recoveryId',r."id",'scope',r."scope"));
  IF r."scope" IN ('START','BOTH') THEN
    INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload") VALUES
      (gen_random_uuid(), 'BOOKING', b."id", 'RENTAL_STARTED', jsonb_build_object('bookingId',b."id",'actualPickupAt',to_jsonb(r)->'reported_pickup_at'));
  END IF;
  IF r."scope" IN ('RETURN','BOTH') THEN
    INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload") VALUES
      (gen_random_uuid(), 'BOOKING', b."id", 'RETURN_CONFIRMED', jsonb_build_object('bookingId',b."id",'actualReturnAt',to_jsonb(r)->'reported_return_at'));
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION "accept_due_overdue_handover_recoveries"() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; accepted integer := 0;
BEGIN
  FOR item IN SELECT r."id" FROM "booking_overdue_handover_recoveries" r
    LEFT JOIN "booking_overdue_handover_recovery_responses" x ON x."recovery_id" = r."id"
    LEFT JOIN "booking_overdue_handover_recovery_acceptances" a ON a."recovery_id" = r."id"
    WHERE a."id" IS NULL AND x."id" IS NULL AND r."response_deadline_at" <= clock_timestamp()
    ORDER BY r."response_deadline_at" FOR UPDATE OF r SKIP LOCKED
  LOOP
    IF "accept_overdue_handover_recovery"(item."id", 'NO_RESPONSE_24H') THEN accepted := accepted + 1; END IF;
  END LOOP;
  RETURN accepted;
END $$;

-- Compose accepted overdue recovery with the existing shared financial predicate.
CREATE OR REPLACE FUNCTION "booking_pre_historical_report_workflow_compliance_blocker"(booking_id uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b "bookings"%ROWTYPE; returned "inspections"%ROWTYPE;
  start_waived boolean; return_waived boolean; start_recovered boolean; return_recovered boolean; blocker text;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = booking_id;
  IF NOT FOUND THEN RETURN 'BOOKING_MISSING'; END IF;
  IF b."handover_workflow_version" IS NULL THEN RETURN NULL; END IF;
  IF b."status" = 'CANCELLED' AND EXISTS (SELECT 1 FROM "booking_cancellation_settlements" s WHERE s."booking_id" = b."id") THEN RETURN NULL; END IF;
  IF b."handover_workflow_version" <> 1 THEN RETURN 'UNSUPPORTED_HANDOVER_WORKFLOW'; END IF;
  IF b."operational_hold" THEN RETURN 'OPERATIONS_HOLD'; END IF;
  SELECT EXISTS (SELECT 1 FROM "booking_overdue_handover_recoveries" r JOIN "booking_overdue_handover_recovery_acceptances" a ON a."recovery_id" = r."id"
    WHERE r."booking_id" = b."id" AND r."scope" IN ('START','BOTH')) INTO start_recovered;
  SELECT EXISTS (SELECT 1 FROM "booking_overdue_handover_recoveries" r JOIN "booking_overdue_handover_recovery_acceptances" a ON a."recovery_id" = r."id"
    WHERE r."booking_id" = b."id" AND r."scope" IN ('RETURN','BOTH')) INTO return_recovered;
  SELECT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'START'
    AND w."waived_by_user_id" = b."owner_user_id" AND w."acknowledgement_version" = 'HANDOVER_EVIDENCE_WAIVER_V1') INTO start_waived;
  SELECT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'RETURN'
    AND w."acknowledgement_version" = 'HANDOVER_EVIDENCE_WAIVER_V1'
    AND (w."waived_by_user_id" = b."renter_user_id" OR w."waived_by_user_id" = b."owner_user_id")) INTO return_waived;
  IF NOT start_waived AND NOT start_recovered THEN
    blocker := "booking_verified_workflow_compliance_blocker"(b."id");
    IF blocker IN ('OWNER_INSPECTION_REQUIRED','RENTER_REVIEW_REQUIRED','DISCREPANCY_RESOLUTION_REQUIRED','PICKUP_VERIFICATION_REQUIRED') THEN RETURN blocker; END IF;
  END IF;
  IF b."actual_pickup_at" IS NULL THEN RETURN 'PICKUP_VERIFICATION_REQUIRED'; END IF;
  IF NOT start_recovered AND NOT EXISTS (SELECT 1 FROM "inspection_verification_challenges" c WHERE c."booking_id" = b."id"
      AND c."issued_to_user_id" = b."renter_user_id" AND c."consumed_by_user_id" = b."owner_user_id" AND c."consumed_at" = b."actual_pickup_at")
    THEN RETURN 'PICKUP_VERIFICATION_REQUIRED'; END IF;
  IF return_recovered THEN NULL;
  ELSIF return_waived THEN
    IF NOT EXISTS (SELECT 1 FROM "booking_handover_return_receipts" r WHERE r."booking_id" = b."id" AND r."confirmed_by_user_id" = b."owner_user_id"
      AND r."confirmed_at" = b."actual_return_at") THEN RETURN 'OWNER_RETURN_RECEIPT_REQUIRED'; END IF;
  ELSE
    SELECT * INTO returned FROM "inspections" i WHERE i."booking_id" = b."id" AND i."type" = 'RETURN' AND i."status" = 'FINALIZED'
      AND i."submitted_by_user_id" = b."renter_user_id" ORDER BY i."version" ASC LIMIT 1;
    IF returned."id" IS NULL OR returned."finalized_at" IS NULL THEN RETURN 'RENTER_RETURN_INSPECTION_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id" AND c."role" = 'RENTER' AND c."user_id" = b."renter_user_id")
      OR NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id" AND c."role" = 'OWNER' AND c."user_id" = b."owner_user_id")
      THEN RETURN 'OWNER_RETURN_REVIEW_REQUIRED'; END IF;
  END IF;
  IF b."actual_return_at" IS NULL OR b."status" NOT IN ('RETURNED','COMPLETED') THEN RETURN 'RETURN_COMPLETION_REQUIRED'; END IF;
  RETURN NULL;
END $$;
