-- Migration 60: retain immutable recovery history while allowing one booking
-- to recover Pickup and Return independently.
ALTER TABLE "booking_overdue_handover_recoveries"
  DROP CONSTRAINT "booking_overdue_handover_recoveries_booking_id_key";
ALTER TABLE "booking_overdue_handover_recovery_responses"
  DROP CONSTRAINT "booking_overdue_handover_recovery_responses_booking_id_key";
ALTER TABLE "booking_overdue_handover_recovery_acceptances"
  DROP CONSTRAINT "booking_overdue_handover_recovery_acceptances_booking_id_key";

CREATE INDEX "booking_overdue_handover_recoveries_booking_id_reported_at_idx"
  ON "booking_overdue_handover_recoveries"("booking_id", "reported_at");

-- Existing scope is already authoritative: START=Pickup, RETURN=Return, and
-- BOTH is preserved as the legacy atomic report covering both phases.
CREATE FUNCTION "prevent_overlapping_overdue_handover_recovery"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "booking_overdue_handover_recoveries" r
    LEFT JOIN "booking_overdue_handover_recovery_responses" x ON x."recovery_id" = r."id"
    LEFT JOIN "booking_overdue_handover_recovery_acceptances" a ON a."recovery_id" = r."id"
    WHERE r."booking_id" = NEW."booking_id"
      AND x."id" IS NULL AND a."id" IS NULL
      AND (r."scope" = 'BOTH' OR NEW."scope" = 'BOTH' OR r."scope" = NEW."scope")
  ) THEN
    RAISE EXCEPTION 'an unresolved overdue handover recovery already owns this phase';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "overdue_handover_recovery_phase_authority"
  BEFORE INSERT ON "booking_overdue_handover_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "prevent_overlapping_overdue_handover_recovery"();

CREATE INDEX "booking_overdue_handover_recovery_responses_booking_id_responded_at_idx"
  ON "booking_overdue_handover_recovery_responses"("booking_id", "responded_at");
CREATE INDEX "booking_overdue_handover_recovery_acceptances_booking_id_accepted_at_idx"
  ON "booking_overdue_handover_recovery_acceptances"("booking_id", "accepted_at");

-- Keep explicit confirmation and timeout on one transactionally locked path,
-- while making the automatic source and authoritative deadline visible in the
-- durable event evidence.
CREATE OR REPLACE FUNCTION "accept_overdue_handover_recovery"(recovery_id uuid, acceptance_source text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r "booking_overdue_handover_recoveries"%ROWTYPE; b "bookings"%ROWTYPE; response_decision text;
  claim_hours integer; from_status "BookingStatus"; target_status "BookingStatus"; resolution_time timestamptz;
BEGIN
  SELECT * INTO r FROM "booking_overdue_handover_recoveries" WHERE "id" = recovery_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO b FROM "bookings" WHERE "id" = r."booking_id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "booking_overdue_handover_recovery_acceptances" a WHERE a."recovery_id" = r."id") THEN RETURN false; END IF;
  SELECT "decision" INTO response_decision FROM "booking_overdue_handover_recovery_responses" WHERE "recovery_id" = r."id";
  IF response_decision = 'DISPUTED' OR b."operational_hold" OR EXISTS (
    SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion"
      AND d."status" IN ('OPEN','EVIDENCE_COLLECTION','UNDER_REVIEW')
  ) THEN RETURN false; END IF;
  IF acceptance_source = 'RENTER_CONFIRMED' AND response_decision IS DISTINCT FROM 'CONFIRMED' THEN RETURN false; END IF;
  IF acceptance_source = 'NO_RESPONSE_24H' AND (response_decision IS NOT NULL OR clock_timestamp() < r."response_deadline_at") THEN RETURN false; END IF;
  resolution_time := clock_timestamp();
  from_status := b."status";
  target_status := CASE WHEN r."scope" = 'START' THEN 'ACTIVE'::"BookingStatus" ELSE 'RETURNED'::"BookingStatus" END;
  SELECT "claim_window_hours" INTO claim_hours FROM "booking_policy_snapshots" WHERE "booking_id" = b."id";
  UPDATE "bookings" SET
    "actual_pickup_at" = CASE WHEN r."scope" IN ('START','BOTH') THEN r."reported_pickup_at" ELSE b."actual_pickup_at" END,
    "actual_return_at" = CASE WHEN r."scope" IN ('RETURN','BOTH') THEN r."reported_return_at" ELSE b."actual_return_at" END,
    "claim_deadline_at" = CASE WHEN r."scope" IN ('RETURN','BOTH') THEN resolution_time + COALESCE(claim_hours,24) * interval '1 hour' ELSE b."claim_deadline_at" END,
    "status" = target_status, "updated_at" = resolution_time
  WHERE "id" = b."id";
  INSERT INTO "booking_overdue_handover_recovery_acceptances"("id","recovery_id","booking_id","accepted_at","acceptance_source")
    VALUES (gen_random_uuid(), r."id", b."id", resolution_time, acceptance_source);
  INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id","occurred_at")
    VALUES (gen_random_uuid(), b."id", from_status, target_status, 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id", resolution_time);
  INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload","occurred_at") VALUES
    (gen_random_uuid(), 'BOOKING', b."id", 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', jsonb_build_object(
      'bookingId',b."id",'recoveryId',r."id",'scope',r."scope",'responseDeadlineAt',r."response_deadline_at",
      'resolvedAt',resolution_time,'resolutionSource',acceptance_source), resolution_time);
  IF r."scope" IN ('START','BOTH') THEN
    INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload","occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING', b."id", 'RENTAL_STARTED', jsonb_build_object('bookingId',b."id",'actualPickupAt',r."reported_pickup_at"), resolution_time);
  END IF;
  IF r."scope" IN ('RETURN','BOTH') THEN
    INSERT INTO "outbox_events"("id","aggregate_type","aggregate_id","event_type","payload","occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING', b."id", 'RETURN_CONFIRMED', jsonb_build_object('bookingId',b."id",'actualReturnAt',r."reported_return_at"), resolution_time);
  END IF;
  RETURN true;
END $$;
