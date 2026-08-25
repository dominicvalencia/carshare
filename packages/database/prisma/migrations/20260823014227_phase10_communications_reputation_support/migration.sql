-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('PRIMARY_BOOKING');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'READ_ONLY', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConversationParticipantContext" AS ENUM ('RENTER', 'OWNER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "MessageModerationStatus" AS ENUM ('VISIBLE', 'REPORTED', 'TOMBSTONED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('MESSAGES', 'BOOKING_UPDATES', 'RENTAL_REMINDERS', 'CLAIMS', 'EARNINGS', 'MARKETING', 'SECURITY', 'SUPPORT', 'REVIEWS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'PUSH', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PushProviderCode" AS ENUM ('EXPO', 'FAKE');

-- CreateEnum
CREATE TYPE "PushTokenStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('VEHICLE', 'OWNER', 'RENTER');

-- CreateEnum
CREATE TYPE "ReviewModerationStatus" AS ENUM ('PUBLISHED', 'UNDER_REVIEW', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCOUNT', 'BOOKING', 'PAYMENT', 'PAYOUT', 'VEHICLE', 'CLAIM', 'TECHNICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageVisibility" AS ENUM ('USER_VISIBLE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('USER', 'MESSAGE', 'REVIEW');

-- CreateEnum
CREATE TYPE "ModerationReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'ACTIONED', 'DISMISSED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "ConversationType" NOT NULL DEFAULT 'PRIMARY_BOOKING',
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "context" "ConversationParticipantContext" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),
    "last_read_message_id" UUID,
    "last_read_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "reply_to_message_id" UUID,
    "idempotency_key" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "moderation_status" "MessageModerationStatus" NOT NULL DEFAULT 'VISIBLE',
    "tombstoned_at" TIMESTAMPTZ(3),
    "tombstone_reason" VARCHAR(1000),
    "moderated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "template_key" VARCHAR(100) NOT NULL,
    "source_event_type" VARCHAR(100) NOT NULL,
    "source_type" VARCHAR(100) NOT NULL,
    "source_id" UUID NOT NULL,
    "stable_key" CHAR(64) NOT NULL,
    "variables" JSONB NOT NULL,
    "deep_link" VARCHAR(500),
    "read_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel")
);

-- CreateTable
CREATE TABLE "device_push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "provider" "PushProviderCode" NOT NULL,
    "platform" "SessionPlatform" NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "status" "PushTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "device_push_token_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider_reference" VARCHAR(255),
    "failure_category" VARCHAR(100),
    "safe_failure_message" VARCHAR(500),
    "next_attempt_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "type" "ReviewType" NOT NULL,
    "vehicle_id" UUID,
    "owner_profile_id" UUID,
    "subject_user_id" UUID,
    "rating" INTEGER NOT NULL,
    "category_ratings" JSONB NOT NULL,
    "text" VARCHAR(3000),
    "moderation_status" "ReviewModerationStatus" NOT NULL DEFAULT 'PUBLISHED',
    "moderation_reason" VARCHAR(1000),
    "moderated_by_user_id" UUID,
    "moderated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rating_projections" (
    "id" UUID NOT NULL,
    "subject_type" "ReviewType" NOT NULL,
    "subject_id" UUID NOT NULL,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "average_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "recalculated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(32) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "booking_id" UUID,
    "payment_id" UUID,
    "claim_id" UUID,
    "payout_id" UUID,
    "vehicle_id" UUID,
    "category" "SupportTicketCategory" NOT NULL,
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "subject" VARCHAR(200) NOT NULL,
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "visibility" "SupportMessageVisibility" NOT NULL DEFAULT 'USER_VISIBLE',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_reports" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "target_type" "ModerationTargetType" NOT NULL,
    "reported_user_id" UUID,
    "message_id" UUID,
    "review_id" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "details" VARCHAR(3000),
    "status" "ModerationReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by_user_id" UUID,
    "resolution_reason" VARCHAR(1000),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_booking_id_key" ON "conversations"("booking_id");

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_left_at_idx" ON "conversation_participants"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_id_idx" ON "messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "messages_moderation_status_created_at_idx" ON "messages"("moderation_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_sender_user_id_idempotency_key_key" ON "messages"("conversation_id", "sender_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_stable_key_key" ON "notifications"("stable_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_source_type_source_id_idx" ON "notifications"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_push_tokens_token_key" ON "device_push_tokens"("token");

-- CreateIndex
CREATE INDEX "device_push_tokens_user_id_status_last_seen_at_idx" ON "device_push_tokens"("user_id", "status", "last_seen_at");

-- CreateIndex
CREATE INDEX "device_push_tokens_session_id_status_idx" ON "device_push_tokens"("session_id", "status");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_created_at_idx" ON "notification_deliveries"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_provider_reference_status_idx" ON "notification_deliveries"("provider_reference", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_device_push_key" ON "notification_deliveries"("notification_id", "channel", "device_push_token_id", "attempt_number");

-- CreateIndex
CREATE INDEX "reviews_vehicle_id_moderation_status_created_at_idx" ON "reviews"("vehicle_id", "moderation_status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_owner_profile_id_moderation_status_created_at_idx" ON "reviews"("owner_profile_id", "moderation_status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_subject_user_id_moderation_status_created_at_idx" ON "reviews"("subject_user_id", "moderation_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_author_user_id_type_key" ON "reviews"("booking_id", "author_user_id", "type");

-- CreateIndex
CREATE INDEX "rating_projections_subject_type_average_rating_review_count_idx" ON "rating_projections"("subject_type", "average_rating", "review_count");

-- CreateIndex
CREATE UNIQUE INDEX "rating_projections_subject_type_subject_id_key" ON "rating_projections"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_public_reference_key" ON "support_tickets"("public_reference");

-- CreateIndex
CREATE INDEX "support_tickets_created_by_user_id_created_at_idx" ON "support_tickets"("created_by_user_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_last_activity_at_idx" ON "support_tickets"("status", "priority", "last_activity_at");

-- CreateIndex
CREATE INDEX "support_tickets_assigned_to_user_id_status_idx" ON "support_tickets"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "support_tickets_booking_id_idx" ON "support_tickets"("booking_id");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_messages_ticket_id_author_user_id_idempotenc_key" ON "support_ticket_messages"("ticket_id", "author_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "moderation_reports_status_target_type_created_at_idx" ON "moderation_reports"("status", "target_type", "created_at");

-- CreateIndex
CREATE INDEX "moderation_reports_reporter_user_id_created_at_idx" ON "moderation_reports"("reporter_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_last_read_message_id_fkey" FOREIGN KEY ("last_read_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_push_tokens" ADD CONSTRAINT "device_push_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_device_push_token_id_fkey" FOREIGN KEY ("device_push_token_id") REFERENCES "device_push_tokens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 10 authority constraints that Prisma cannot express.
CREATE OR REPLACE FUNCTION "ensure_primary_booking_conversation"()
RETURNS trigger AS $$
DECLARE
  conversation_uuid uuid;
BEGIN
  IF NEW."status" IN ('AWAITING_OWNER', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED') THEN
    INSERT INTO "conversations" ("id", "booking_id", "type", "status", "created_at", "updated_at")
    VALUES (gen_random_uuid(), NEW."id", 'PRIMARY_BOOKING', 'ACTIVE', clock_timestamp(), clock_timestamp())
    ON CONFLICT ("booking_id") DO UPDATE SET
      "status" = CASE WHEN "conversations"."status" = 'CLOSED' THEN 'CLOSED' ELSE 'ACTIVE' END,
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

CREATE TRIGGER "bookings_ensure_primary_conversation"
AFTER INSERT OR UPDATE OF "status" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION "ensure_primary_booking_conversation"();

CREATE OR REPLACE FUNCTION "validate_booking_message"()
RETURNS trigger AS $$
DECLARE
  booking_status "BookingStatus";
  conversation_status "ConversationStatus";
BEGIN
  IF length(btrim(NEW."body")) < 1 OR length(NEW."body") > 2000 THEN
    RAISE EXCEPTION 'MESSAGE_BODY_INVALID' USING ERRCODE = '23514';
  END IF;
  SELECT b."status", c."status" INTO booking_status, conversation_status
  FROM "conversations" c JOIN "bookings" b ON b."id" = c."booking_id"
  WHERE c."id" = NEW."conversation_id";
  IF conversation_status <> 'ACTIVE' OR booking_status NOT IN ('AWAITING_OWNER', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED') THEN
    RAISE EXCEPTION 'CONVERSATION_READ_ONLY' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "conversation_participants" p
    WHERE p."conversation_id" = NEW."conversation_id"
      AND p."user_id" = NEW."sender_user_id" AND p."left_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'MESSAGE_SENDER_NOT_PARTICIPANT' USING ERRCODE = '23514';
  END IF;
  IF NEW."reply_to_message_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."id" = NEW."reply_to_message_id" AND m."conversation_id" = NEW."conversation_id"
  ) THEN
    RAISE EXCEPTION 'MESSAGE_REPLY_WRONG_CONVERSATION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_validate_insert"
BEFORE INSERT ON "messages"
FOR EACH ROW EXECUTE FUNCTION "validate_booking_message"();

CREATE OR REPLACE FUNCTION "protect_message_history"()
RETURNS trigger AS $$
BEGIN
  IF OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id"
    OR OLD."sender_user_id" IS DISTINCT FROM NEW."sender_user_id"
    OR OLD."reply_to_message_id" IS DISTINCT FROM NEW."reply_to_message_id"
    OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
    OR OLD."body" IS DISTINCT FROM NEW."body"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'MESSAGE_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_protect_history"
BEFORE UPDATE ON "messages"
FOR EACH ROW EXECUTE FUNCTION "protect_message_history"();

CREATE OR REPLACE FUNCTION "message_update_conversation"()
RETURNS trigger AS $$
BEGIN
  UPDATE "conversations" SET "last_message_at" = NEW."created_at", "updated_at" = clock_timestamp()
  WHERE "id" = NEW."conversation_id";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "messages_update_conversation"
AFTER INSERT ON "messages"
FOR EACH ROW EXECUTE FUNCTION "message_update_conversation"();

CREATE OR REPLACE FUNCTION "validate_participant_read_marker"()
RETURNS trigger AS $$
BEGIN
  IF NEW."last_read_message_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."id" = NEW."last_read_message_id" AND m."conversation_id" = NEW."conversation_id"
  ) THEN
    RAISE EXCEPTION 'READ_MARKER_WRONG_CONVERSATION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "participants_validate_read_marker"
BEFORE INSERT OR UPDATE OF "last_read_message_id" ON "conversation_participants"
FOR EACH ROW EXECUTE FUNCTION "validate_participant_read_marker"();

CREATE OR REPLACE FUNCTION "validate_review"()
RETURNS trigger AS $$
DECLARE
  booking_row "bookings"%ROWTYPE;
  completed_at timestamptz;
BEGIN
  SELECT * INTO booking_row FROM "bookings" WHERE "id" = NEW."booking_id";
  IF booking_row."status" <> 'COMPLETED' THEN
    RAISE EXCEPTION 'REVIEW_BOOKING_NOT_COMPLETED' USING ERRCODE = '23514';
  END IF;
  SELECT max("occurred_at") INTO completed_at FROM "booking_status_history"
  WHERE "booking_id" = NEW."booking_id" AND "to_status" = 'COMPLETED';
  IF completed_at IS NULL OR NEW."created_at" > completed_at + interval '14 days' THEN
    RAISE EXCEPTION 'REVIEW_WINDOW_EXPIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW."rating" < 1 OR NEW."rating" > 5 THEN
    RAISE EXCEPTION 'REVIEW_RATING_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NEW."type" = 'VEHICLE' THEN
    IF NEW."author_user_id" <> booking_row."renter_user_id" OR NEW."vehicle_id" <> booking_row."vehicle_id"
      OR NEW."owner_profile_id" IS NOT NULL OR NEW."subject_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'REVIEW_TARGET_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."type" = 'OWNER' THEN
    IF NEW."author_user_id" <> booking_row."renter_user_id" OR NEW."owner_profile_id" <> booking_row."owner_profile_id"
      OR NEW."vehicle_id" IS NOT NULL OR NEW."subject_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'REVIEW_TARGET_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."type" = 'RENTER' THEN
    IF NEW."author_user_id" <> booking_row."owner_user_id" OR NEW."subject_user_id" <> booking_row."renter_user_id"
      OR NEW."vehicle_id" IS NOT NULL OR NEW."owner_profile_id" IS NOT NULL THEN
      RAISE EXCEPTION 'REVIEW_TARGET_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reviews_validate_insert"
BEFORE INSERT ON "reviews"
FOR EACH ROW EXECUTE FUNCTION "validate_review"();

CREATE OR REPLACE FUNCTION "protect_review_history"()
RETURNS trigger AS $$
BEGIN
  IF OLD."booking_id" IS DISTINCT FROM NEW."booking_id"
    OR OLD."author_user_id" IS DISTINCT FROM NEW."author_user_id"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."vehicle_id" IS DISTINCT FROM NEW."vehicle_id"
    OR OLD."owner_profile_id" IS DISTINCT FROM NEW."owner_profile_id"
    OR OLD."subject_user_id" IS DISTINCT FROM NEW."subject_user_id"
    OR OLD."rating" IS DISTINCT FROM NEW."rating"
    OR OLD."category_ratings" IS DISTINCT FROM NEW."category_ratings"
    OR OLD."text" IS DISTINCT FROM NEW."text"
    OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
    RAISE EXCEPTION 'REVIEW_HISTORY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reviews_protect_history"
BEFORE UPDATE ON "reviews"
FOR EACH ROW EXECUTE FUNCTION "protect_review_history"();

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "rating_projections" ADD CONSTRAINT "rating_projection_valid" CHECK (
  "review_count" >= 0 AND "rating_sum" >= 0 AND "average_rating" BETWEEN 0 AND 5
);

CREATE OR REPLACE FUNCTION "validate_moderation_target"()
RETURNS trigger AS $$
DECLARE target_count integer;
BEGIN
  target_count := (NEW."reported_user_id" IS NOT NULL)::integer
    + (NEW."message_id" IS NOT NULL)::integer
    + (NEW."review_id" IS NOT NULL)::integer;
  IF target_count <> 1
    OR (NEW."target_type" = 'USER' AND NEW."reported_user_id" IS NULL)
    OR (NEW."target_type" = 'MESSAGE' AND NEW."message_id" IS NULL)
    OR (NEW."target_type" = 'REVIEW' AND NEW."review_id" IS NULL) THEN
    RAISE EXCEPTION 'MODERATION_TARGET_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "moderation_reports_validate_target"
BEFORE INSERT OR UPDATE ON "moderation_reports"
FOR EACH ROW EXECUTE FUNCTION "validate_moderation_target"();

CREATE OR REPLACE FUNCTION "validate_support_internal_note"()
RETURNS trigger AS $$
BEGIN
  IF NEW."visibility" = 'INTERNAL' AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id"
    WHERE ur."user_id" = NEW."author_user_id" AND r."code" IN ('SUPPORT', 'ADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'SUPPORT_INTERNAL_NOTE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "support_messages_validate_internal"
BEFORE INSERT ON "support_ticket_messages"
FOR EACH ROW EXECUTE FUNCTION "validate_support_internal_note"();

CREATE OR REPLACE FUNCTION "validate_support_ticket_transition"()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'OPEN' AND NEW."status" IN ('IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('WAITING_FOR_USER', 'WAITING_FOR_INTERNAL', 'RESOLVED', 'CLOSED'))
    OR (OLD."status" IN ('WAITING_FOR_USER', 'WAITING_FOR_INTERNAL') AND NEW."status" IN ('IN_PROGRESS', 'RESOLVED', 'CLOSED'))
    OR (OLD."status" = 'RESOLVED' AND NEW."status" IN ('IN_PROGRESS', 'CLOSED'))
  ) THEN
    RAISE EXCEPTION 'SUPPORT_TICKET_TRANSITION_INVALID' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "support_tickets_validate_transition"
BEFORE UPDATE OF "status" ON "support_tickets"
FOR EACH ROW EXECUTE FUNCTION "validate_support_ticket_transition"();

-- Backfill conversations for existing legitimate relationships.
INSERT INTO "conversations" ("id", "booking_id", "type", "status", "created_at", "updated_at")
SELECT gen_random_uuid(), b."id", 'PRIMARY_BOOKING',
  CASE WHEN b."status" IN ('CANCELLED', 'EXPIRED') THEN 'READ_ONLY'::"ConversationStatus" ELSE 'ACTIVE'::"ConversationStatus" END,
  clock_timestamp(), clock_timestamp()
FROM "bookings" b
WHERE b."status" IN ('AWAITING_OWNER', 'CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED')
ON CONFLICT ("booking_id") DO NOTHING;

INSERT INTO "conversation_participants" ("conversation_id", "user_id", "context", "joined_at")
SELECT c."id", b."renter_user_id", 'RENTER', clock_timestamp()
FROM "conversations" c JOIN "bookings" b ON b."id" = c."booking_id"
ON CONFLICT ("conversation_id", "user_id") DO NOTHING;

INSERT INTO "conversation_participants" ("conversation_id", "user_id", "context", "joined_at")
SELECT c."id", b."owner_user_id", 'OWNER', clock_timestamp()
FROM "conversations" c JOIN "bookings" b ON b."id" = c."booking_id"
ON CONFLICT ("conversation_id", "user_id") DO NOTHING;
