ALTER TYPE "NotificationDeliveryStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

CREATE TABLE "booking_overdue_handover_recovery_reminders" (
  "id" uuid PRIMARY KEY,
  "recovery_id" uuid NOT NULL REFERENCES "booking_overdue_handover_recoveries"("id") ON DELETE RESTRICT,
  "recipient_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "stage" varchar(20) NOT NULL CHECK ("stage" IN ('MIDPOINT','FINAL')),
  "channel" "NotificationChannel" NOT NULL CHECK ("channel" IN ('PUSH','EMAIL','SMS')),
  "scheduled_at" timestamptz(3) NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "provider" varchar(50),
  "provider_reference" varchar(255),
  "failure_category" varchar(100),
  "safe_failure_message" varchar(500),
  "next_attempt_at" timestamptz(3),
  "submitted_at" timestamptz(3),
  "delivered_at" timestamptz(3),
  "stable_key" char(64) NOT NULL UNIQUE,
  "created_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  "updated_at" timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE ("recovery_id", "recipient_user_id", "stage", "channel"),
  CHECK (("stage" = 'MIDPOINT' AND "channel" IN ('PUSH','EMAIL')) OR "stage" = 'FINAL')
);
CREATE INDEX "overdue_recovery_reminders_due_idx"
  ON "booking_overdue_handover_recovery_reminders"("status", "scheduled_at", "next_attempt_at");

CREATE FUNCTION "schedule_overdue_handover_recovery_reminders"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE renter_id uuid; stage text; channel "NotificationChannel"; scheduled_at timestamptz; stable_key text;
BEGIN
  SELECT "renter_user_id" INTO renter_id FROM "bookings" WHERE "id" = NEW."booking_id";
  FOREACH stage IN ARRAY ARRAY['MIDPOINT','FINAL'] LOOP
    scheduled_at := CASE WHEN stage = 'MIDPOINT' THEN NEW."response_deadline_at" - interval '12 hours'
                         ELSE NEW."response_deadline_at" - interval '2 hours' END;
    FOREACH channel IN ARRAY ARRAY['PUSH'::"NotificationChannel",'EMAIL'::"NotificationChannel",'SMS'::"NotificationChannel"] LOOP
      IF stage = 'MIDPOINT' AND channel = 'SMS' THEN CONTINUE; END IF;
      stable_key := encode(sha256(convert_to(NEW."id"::text || ':' || renter_id::text || ':' || stage || ':' || channel::text, 'UTF8')),'hex');
      INSERT INTO "booking_overdue_handover_recovery_reminders"
        ("id","recovery_id","recipient_user_id","stage","channel","scheduled_at","stable_key")
      VALUES (gen_random_uuid(),NEW."id",renter_id,stage,channel,scheduled_at,stable_key);
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "schedule_overdue_handover_recovery_reminders_after_report"
  AFTER INSERT ON "booking_overdue_handover_recoveries"
  FOR EACH ROW EXECUTE FUNCTION "schedule_overdue_handover_recovery_reminders"();

-- Preserve pending Migration 57 reports without firing stale stages immediately.
INSERT INTO "booking_overdue_handover_recovery_reminders"
  ("id","recovery_id","recipient_user_id","stage","channel","scheduled_at","stable_key")
SELECT gen_random_uuid(), r."id", b."renter_user_id", stage.value, channel.value::"NotificationChannel",
  CASE WHEN stage.value = 'MIDPOINT' THEN r."response_deadline_at" - interval '12 hours'
       ELSE r."response_deadline_at" - interval '2 hours' END,
  encode(sha256(convert_to(r."id"::text || ':' || b."renter_user_id"::text || ':' || stage.value || ':' || channel.value, 'UTF8')),'hex')
FROM "booking_overdue_handover_recoveries" r
JOIN "bookings" b ON b."id" = r."booking_id"
CROSS JOIN (VALUES ('MIDPOINT'),('FINAL')) stage(value)
CROSS JOIN (VALUES ('PUSH'),('EMAIL'),('SMS')) channel(value)
LEFT JOIN "booking_overdue_handover_recovery_responses" x ON x."recovery_id" = r."id"
LEFT JOIN "booking_overdue_handover_recovery_acceptances" a ON a."recovery_id" = r."id"
WHERE x."id" IS NULL AND a."id" IS NULL
  AND NOT (stage.value = 'MIDPOINT' AND channel.value = 'SMS')
  AND (CASE WHEN stage.value = 'MIDPOINT' THEN r."response_deadline_at" - interval '12 hours'
            ELSE r."response_deadline_at" - interval '2 hours' END) > clock_timestamp();

CREATE FUNCTION "guard_overdue_handover_recovery_reminder"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."recovery_id" <> NEW."recovery_id" OR OLD."recipient_user_id" <> NEW."recipient_user_id"
    OR OLD."stage" <> NEW."stage" OR OLD."channel" <> NEW."channel"
    OR OLD."scheduled_at" <> NEW."scheduled_at" OR OLD."stable_key" <> NEW."stable_key"
    OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'recovery reminder identity and schedule are immutable';
  END IF;
  IF NEW."attempt_count" < OLD."attempt_count" THEN RAISE EXCEPTION 'recovery reminder attempts cannot decrease'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "overdue_handover_recovery_reminder_guard"
  BEFORE UPDATE ON "booking_overdue_handover_recovery_reminders"
  FOR EACH ROW EXECUTE FUNCTION "guard_overdue_handover_recovery_reminder"();
CREATE TRIGGER "overdue_handover_recovery_reminder_no_delete"
  BEFORE DELETE ON "booking_overdue_handover_recovery_reminders"
  FOR EACH ROW EXECUTE FUNCTION "prevent_overdue_handover_recovery_mutation"();
