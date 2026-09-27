-- Migration 61: keep Migration 60 immutable and apply the post-deployment
-- reconciliation corrections through a forward-only function replacement.
CREATE OR REPLACE FUNCTION "accept_overdue_handover_recovery"(recovery_id uuid, acceptance_source text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r "booking_overdue_handover_recoveries"%ROWTYPE; b "bookings"%ROWTYPE; response_decision text;
  claim_hours integer; from_status "BookingStatus"; current_status "BookingStatus"; target_status "BookingStatus"; resolution_time timestamptz;
BEGIN
  SELECT * INTO r FROM "booking_overdue_handover_recoveries" WHERE "id" = $1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO b FROM "bookings" WHERE "id" = r."booking_id" FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "booking_overdue_handover_recovery_acceptances" a WHERE a."recovery_id" = r."id") THEN RETURN false; END IF;
  SELECT x."decision" INTO response_decision FROM "booking_overdue_handover_recovery_responses" x WHERE x."recovery_id" = r."id";
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
    "updated_at" = resolution_time
  WHERE "id" = b."id";
  current_status := from_status;
  IF r."scope" IN ('START','BOTH') AND current_status = 'CONFIRMED' THEN
    UPDATE "bookings" SET "status" = 'READY_FOR_PICKUP', "updated_at" = resolution_time WHERE "id" = b."id";
    INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id","occurred_at")
      VALUES (gen_random_uuid(), b."id", 'CONFIRMED', 'READY_FOR_PICKUP', 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id", resolution_time);
    current_status := 'READY_FOR_PICKUP';
  END IF;
  IF r."scope" IN ('START','BOTH') AND current_status = 'READY_FOR_PICKUP' THEN
    UPDATE "bookings" SET "status" = 'ACTIVE', "updated_at" = resolution_time WHERE "id" = b."id";
    INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id","occurred_at")
      VALUES (gen_random_uuid(), b."id", current_status, 'ACTIVE', 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id", resolution_time);
    current_status := 'ACTIVE';
  END IF;
  IF r."scope" IN ('RETURN','BOTH') AND current_status = 'ACTIVE' THEN
    UPDATE "bookings" SET "status" = 'RETURN_PENDING', "updated_at" = resolution_time WHERE "id" = b."id";
    INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id","occurred_at")
      VALUES (gen_random_uuid(), b."id", 'ACTIVE', 'RETURN_PENDING', 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id", resolution_time);
    current_status := 'RETURN_PENDING';
  END IF;
  IF r."scope" IN ('RETURN','BOTH') AND current_status = 'RETURN_PENDING' THEN
    UPDATE "bookings" SET "status" = 'RETURNED', "updated_at" = resolution_time WHERE "id" = b."id";
    INSERT INTO "booking_status_history"("id","booking_id","from_status","to_status","actor_type","reason_code","correlation_id","occurred_at")
      VALUES (gen_random_uuid(), b."id", 'RETURN_PENDING', 'RETURNED', 'WORKER', 'OVERDUE_HANDOVER_RECOVERY_ACCEPTED', r."correlation_id", resolution_time);
    current_status := 'RETURNED';
  END IF;
  IF current_status IS DISTINCT FROM target_status THEN RETURN false; END IF;
  INSERT INTO "booking_overdue_handover_recovery_acceptances"("id","recovery_id","booking_id","accepted_at","acceptance_source")
    VALUES (gen_random_uuid(), r."id", b."id", resolution_time, acceptance_source);
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
