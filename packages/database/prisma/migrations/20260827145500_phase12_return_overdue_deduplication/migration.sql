CREATE OR REPLACE FUNCTION "emit_rental_operational_notifications"("return_confirmation_grace_minutes" integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE emitted integer := 0;
BEGIN
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
  SELECT gen_random_uuid(), 'BOOKING', b."id", 'PICKUP_REMINDER', jsonb_build_object('bookingId', b."id", 'rentalStart', b."rental_start"), 'PENDING', clock_timestamp(), clock_timestamp()
  FROM "bookings" b
  WHERE b."status" IN ('CONFIRMED', 'READY_FOR_PICKUP')
    AND b."rental_start" BETWEEN clock_timestamp() AND clock_timestamp() + interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = b."id" AND o."event_type" = 'PICKUP_REMINDER');
  GET DIAGNOSTICS emitted = ROW_COUNT;

  WITH inserted AS (
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    SELECT gen_random_uuid(), 'BOOKING', b."id", 'PICKUP_HANDOVER_OVERDUE', jsonb_build_object('bookingId', b."id", 'pickupWindowEnd', b."pickup_window_end"), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "bookings" b
    WHERE b."status" = 'READY_FOR_PICKUP' AND b."pickup_window_end" < clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = b."id" AND o."event_type" = 'PICKUP_HANDOVER_OVERDUE')
    RETURNING 1
  ) SELECT emitted + count(*) INTO emitted FROM inserted;

  WITH inserted AS (
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    SELECT gen_random_uuid(), 'BOOKING', b."id", 'RETURN_REMINDER', jsonb_build_object('bookingId', b."id", 'rentalEnd', b."rental_end"), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "bookings" b
    WHERE b."status" = 'ACTIVE'
      AND b."rental_end" BETWEEN clock_timestamp() AND clock_timestamp() + interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = b."id" AND o."event_type" = 'RETURN_REMINDER')
    RETURNING 1
  ) SELECT emitted + count(*) INTO emitted FROM inserted;

  WITH inserted AS (
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    SELECT gen_random_uuid(), 'BOOKING', b."id", 'RETURN_CONFIRMATION_OVERDUE', jsonb_build_object('bookingId', b."id", 'returnInspectionFinalizedAt', i."finalized_at"), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "bookings" b
    JOIN LATERAL (
      SELECT min("finalized_at") AS "finalized_at"
      FROM "inspections"
      WHERE "booking_id" = b."id" AND "type" = 'RETURN' AND "status" = 'FINALIZED'
    ) i ON i."finalized_at" IS NOT NULL
    WHERE b."status" = 'RETURN_PENDING'
      AND i."finalized_at" + make_interval(mins => "return_confirmation_grace_minutes") < clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = b."id" AND o."event_type" = 'RETURN_CONFIRMATION_OVERDUE')
    RETURNING 1
  ) SELECT emitted + count(*) INTO emitted FROM inserted;

  WITH inserted AS (
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    SELECT gen_random_uuid(), 'BOOKING', b."id", 'CLAIM_WINDOW_CLOSING', jsonb_build_object('bookingId', b."id", 'claimDeadlineAt', b."claim_deadline_at"), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "bookings" b
    WHERE b."status" = 'RETURNED'
      AND b."claim_deadline_at" BETWEEN clock_timestamp() AND clock_timestamp() + interval '2 hours'
      AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = b."id" AND o."event_type" = 'CLAIM_WINDOW_CLOSING')
    RETURNING 1
  ) SELECT emitted + count(*) INTO emitted FROM inserted;

  WITH inserted AS (
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    SELECT gen_random_uuid(), 'RENTAL_INCIDENT', i."id", 'CRITICAL_INCIDENT_ESCALATED', jsonb_build_object('bookingId', i."booking_id", 'incidentId', i."id"), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "rental_incidents" i
    WHERE i."severity" = 'CRITICAL' AND i."status" IN ('OPEN', 'ACKNOWLEDGED')
      AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = i."id" AND o."event_type" = 'CRITICAL_INCIDENT_ESCALATED')
    RETURNING 1
  ) SELECT emitted + count(*) INTO emitted FROM inserted;
  RETURN emitted;
END;
$$;
