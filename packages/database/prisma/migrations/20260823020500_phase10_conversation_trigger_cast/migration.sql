-- PostgreSQL resolves CASE branches independently of the target column. Keep the
-- booking-created conversation status expression explicitly enum-typed.
CREATE OR REPLACE FUNCTION "ensure_primary_booking_conversation"()
RETURNS trigger AS $$
DECLARE
  conversation_uuid uuid;
BEGIN
  IF NEW."status" IN ('AWAITING_OWNER', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED') THEN
    INSERT INTO "conversations" ("id", "booking_id", "type", "status", "created_at", "updated_at")
    VALUES (gen_random_uuid(), NEW."id", 'PRIMARY_BOOKING', 'ACTIVE', clock_timestamp(), clock_timestamp())
    ON CONFLICT ("booking_id") DO UPDATE SET
      "status" = CASE
        WHEN "conversations"."status" = 'CLOSED' THEN 'CLOSED'::"ConversationStatus"
        ELSE 'ACTIVE'::"ConversationStatus"
      END,
      "updated_at" = clock_timestamp()
    RETURNING "id" INTO conversation_uuid;

    INSERT INTO "conversation_participants" ("conversation_id", "user_id", "context", "joined_at")
    VALUES
      (conversation_uuid, NEW."renter_user_id", 'RENTER', clock_timestamp()),
      (conversation_uuid, NEW."owner_user_id", 'OWNER', clock_timestamp())
    ON CONFLICT ("conversation_id", "user_id") DO NOTHING;
  ELSIF NEW."status" IN ('CANCELLED', 'EXPIRED') THEN
    UPDATE "conversations"
    SET "status" = 'READ_ONLY', "updated_at" = clock_timestamp()
    WHERE "booking_id" = NEW."id" AND "status" <> 'CLOSED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
