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
    VALUES
      (gen_random_uuid(), 'BOOKING', item."id", 'CLAIM_WINDOW_EXPIRED', jsonb_build_object('bookingId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp()),
      (gen_random_uuid(), 'BOOKING', item."id", 'BOOKING_COMPLETED', jsonb_build_object('bookingId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp());
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at")
    VALUES
      (gen_random_uuid(), 'CLAIM_WINDOW_EXPIRED', item."id", '{}'::jsonb, clock_timestamp()),
      (gen_random_uuid(), 'BOOKING_COMPLETED', item."id", '{}'::jsonb, clock_timestamp());
    transitioned := transitioned + 1;
  END LOOP;
  RETURN transitioned;
END;
$$;
