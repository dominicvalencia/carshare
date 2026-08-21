CREATE OR REPLACE FUNCTION "open_due_pickup_windows"(early_minutes integer, grace_minutes integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; transitioned integer := 0;
BEGIN
  IF early_minutes < 0 OR grace_minutes < 0 THEN
    RAISE EXCEPTION 'Pickup window values cannot be negative';
  END IF;
  UPDATE "bookings" SET
    "pickup_window_start" = "rental_start" - make_interval(mins => early_minutes),
    "pickup_window_end" = "rental_start" + make_interval(mins => grace_minutes)
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

DROP FUNCTION "open_due_pickup_windows"();
