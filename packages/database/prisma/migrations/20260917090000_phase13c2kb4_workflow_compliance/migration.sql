-- Migration 50. B4 workflow policy is version 1; NULL is legacy/unclassified.
-- No default and no historical backfill: only the server assigns new bookings.
ALTER TABLE "bookings" ADD COLUMN "handover_workflow_version" INTEGER;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_handover_workflow_version_check"
  CHECK ("handover_workflow_version" IS NULL OR "handover_workflow_version" > 0);

CREATE FUNCTION "protect_booking_handover_workflow_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."handover_workflow_version" IS DISTINCT FROM NEW."handover_workflow_version" THEN
    RAISE EXCEPTION 'booking handover workflow version is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION "complete_due_returned_bookings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; transitioned integer := 0; completion_time timestamptz;
BEGIN
  FOR item IN
    SELECT b."id" FROM "bookings" b
    WHERE b."status" = 'RETURNED' AND b."claim_deadline_at" < clock_timestamp() AND b."operational_hold" = false
      AND "booking_workflow_compliance_blocker"(b."id") IS NULL
      AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = b."id" AND c."blocking" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED'))
      AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'))
      AND NOT EXISTS (SELECT 1 FROM "booking_usage_summaries" u WHERE u."booking_id" = b."id" AND u."return_disputed"
        AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."status" IN ('RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED')))
      AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."blocks_completion" AND i."status" IN ('OPEN', 'ACKNOWLEDGED'))
    FOR UPDATE SKIP LOCKED
  LOOP
    completion_time := clock_timestamp();
    UPDATE "bookings" SET "status" = 'COMPLETED', "updated_at" = completion_time WHERE "id" = item."id";
    UPDATE "owner_earnings" SET "available_at" = GREATEST(
      completion_time + interval '24 hours',
      COALESCE("last_financial_resolution_at" + interval '24 hours', completion_time + interval '24 hours')
    ), "status" = CASE WHEN EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = "owner_earnings"."id" AND h."status" = 'ACTIVE') THEN 'HELD'::"OwnerEarningStatus" ELSE 'PENDING'::"OwnerEarningStatus" END
    WHERE "booking_id" = item."id";
    INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "occurred_at")
      VALUES (gen_random_uuid(), item."id", 'RETURNED', 'COMPLETED', 'WORKER', 'POST_RETURN_BLOCKERS_RESOLVED', completion_time);
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING', item."id", 'CLAIM_WINDOW_EXPIRED', jsonb_build_object('bookingId', item."id"), 'PENDING', completion_time, completion_time),
      (gen_random_uuid(), 'BOOKING', item."id", 'BOOKING_COMPLETED', jsonb_build_object('bookingId', item."id"), 'PENDING', completion_time, completion_time);
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at") VALUES
      (gen_random_uuid(), 'BOOKING_COMPLETED', item."id", '{}'::jsonb, completion_time);
    transitioned := transitioned + 1;
  END LOOP;
  RETURN transitioned;
END;
$$;

CREATE OR REPLACE FUNCTION "release_due_owner_earnings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; released integer := 0;
BEGIN
  FOR item IN
    SELECT e."id", e."booking_id" FROM "owner_earnings" e JOIN "bookings" b ON b."id" = e."booking_id"
    WHERE e."status" IN ('PENDING', 'HELD') AND e."available_at" <= clock_timestamp()
      AND b."status" = 'COMPLETED'
      AND "booking_workflow_compliance_blocker"(b."id") IS NULL
      AND NOT EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = e."id" AND h."status" = 'ACTIVE')
      AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = b."id" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED'))
      AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."status" NOT IN ('RESOLVED_FOR_RENTER', 'RESOLVED_FOR_OWNER', 'PARTIALLY_RESOLVED', 'CLOSED'))
      AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."severity" = 'CRITICAL' AND i."status" NOT IN ('RESOLVED', 'DISMISSED'))
      AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = b."id" AND (p."reconciliation_required" OR p."status" IN ('AUTHORIZING', 'CAPTURING', 'VOID_PENDING')))
      AND NOT EXISTS (SELECT 1 FROM "payout_items" pi WHERE pi."owner_earning_id" = e."id" AND pi."active_allocation")
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    UPDATE "owner_earnings" SET "status" = 'AVAILABLE' WHERE "id" = item."id";
    INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
      VALUES (gen_random_uuid(), 'OWNER_EARNING', item."id", 'EARNING_AVAILABLE', jsonb_build_object('bookingId', item."booking_id", 'earningId', item."id"), 'PENDING', clock_timestamp(), clock_timestamp());
    INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at")
      VALUES (gen_random_uuid(), 'EARNING_AVAILABLE', item."booking_id", jsonb_build_object('earningId', item."id"), clock_timestamp());
    released := released + 1;
  END LOOP;
  RETURN released;
END $$;

CREATE TRIGGER "booking_handover_workflow_version_immutable"
  BEFORE UPDATE ON "bookings" FOR EACH ROW
  EXECUTE FUNCTION "protect_booking_handover_workflow_version"();

-- One policy predicate shared by completion, release, allocation and diagnostics.
-- Version 1 is B4. Unknown future versions fail closed until explicitly supported.
CREATE FUNCTION "booking_workflow_compliance_blocker"(booking_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b "bookings"%ROWTYPE; pickup "inspections"%ROWTYPE; returned "inspections"%ROWTYPE;
  renter_review "inspection_confirmations"%ROWTYPE; latest_review record;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = booking_id;
  IF NOT FOUND THEN RETURN 'BOOKING_MISSING'; END IF;
  IF b."handover_workflow_version" IS NULL THEN RETURN NULL; END IF;
  -- Migration 49 settlement is not normal rental payout and retains its authority.
  IF b."status" = 'CANCELLED' AND EXISTS (
    SELECT 1 FROM "booking_cancellation_settlements" s WHERE s."booking_id" = b."id"
  ) THEN RETURN NULL; END IF;
  IF b."handover_workflow_version" <> 1 THEN RETURN 'UNSUPPORTED_HANDOVER_WORKFLOW'; END IF;
  IF b."operational_hold" THEN RETURN 'OPERATIONS_HOLD'; END IF;
  SELECT * INTO pickup FROM "inspections" WHERE "inspections"."booking_id" = b."id"
    AND "type" = 'PICKUP' AND "status" = 'FINALIZED'
    AND "submitted_by_user_id" = b."owner_user_id" ORDER BY "version" ASC LIMIT 1;
  IF pickup."id" IS NULL OR pickup."finalized_at" IS NULL OR
    pickup."condition_disclosure_state" IS NULL OR pickup."condition_disclosure_state" = 'NOT_REVIEWED'
    THEN RETURN 'OWNER_INSPECTION_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = pickup."id"
    AND c."role" = 'OWNER' AND c."user_id" = b."owner_user_id") THEN RETURN 'OWNER_INSPECTION_REQUIRED'; END IF;
  SELECT * INTO renter_review FROM "inspection_confirmations" c WHERE c."inspection_id" = pickup."id"
    AND c."role" = 'RENTER' AND c."user_id" = b."renter_user_id";
  IF renter_review."id" IS NULL THEN RETURN 'RENTER_REVIEW_REQUIRED'; END IF;
  IF renter_review."decision" = 'DISAGREED' THEN
    SELECT r."decision", o."outcome" INTO latest_review
      FROM "pickup_discrepancy_responses" p
      LEFT JOIN "pickup_discrepancy_resolution_reviews" r ON r."response_id" = p."id"
      LEFT JOIN "pickup_handover_operations_resolutions" o ON o."discrepancy_resolution_review_id" = r."id"
      WHERE p."original_confirmation_id" = renter_review."id" ORDER BY p."round_number" DESC LIMIT 1;
    IF NOT FOUND OR NOT COALESCE(latest_review."decision" = 'ACCEPTED' OR
      (latest_review."decision" = 'STILL_DISAGREES' AND latest_review."outcome" = 'HANDOVER_MAY_RESUME'), false)
      THEN RETURN 'DISCREPANCY_RESOLUTION_REQUIRED'; END IF;
  END IF;
  IF b."actual_pickup_at" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "inspection_verification_challenges" c WHERE c."booking_id" = b."id"
      AND c."issued_to_user_id" = b."renter_user_id" AND c."consumed_by_user_id" = b."owner_user_id"
      AND c."consumed_at" = b."actual_pickup_at"
  ) THEN RETURN 'PICKUP_VERIFICATION_REQUIRED'; END IF;
  SELECT * INTO returned FROM "inspections" WHERE "inspections"."booking_id" = b."id" AND "type" = 'RETURN'
    AND "status" = 'FINALIZED' AND "submitted_by_user_id" = b."renter_user_id" ORDER BY "version" ASC LIMIT 1;
  IF returned."id" IS NULL OR returned."finalized_at" IS NULL THEN RETURN 'RENTER_RETURN_INSPECTION_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id"
      AND c."role" = 'OWNER' AND c."user_id" = b."owner_user_id")
    OR NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id"
      AND c."role" = 'RENTER' AND c."user_id" = b."renter_user_id")
    THEN RETURN 'OWNER_RETURN_REVIEW_REQUIRED'; END IF;
  -- DISAGREED is legitimate physical return; financial dispute blockers stay separate.
  IF b."actual_return_at" IS NULL OR b."status" NOT IN ('RETURNED', 'COMPLETED')
    THEN RETURN 'RETURN_COMPLETION_REQUIRED'; END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION "enforce_payout_workflow_compliance"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE blocker text;
BEGIN
  IF TG_TABLE_NAME = 'payout_items' THEN
    SELECT "booking_workflow_compliance_blocker"(e."booking_id") INTO blocker
      FROM "owner_earnings" e WHERE e."id" = NEW."owner_earning_id" FOR UPDATE;
  ELSE
    -- Only the first pre-provider transition. Submitted payouts retain reconciliation authority.
    IF OLD."status" <> 'APPROVED' OR NEW."status" <> 'SUBMITTING'
      OR OLD."submitted_at" IS NOT NULL OR OLD."provider_payout_id" IS NOT NULL THEN RETURN NEW; END IF;
    SELECT "booking_workflow_compliance_blocker"(e."booking_id") INTO blocker
      FROM "payout_items" p JOIN "owner_earnings" e ON e."id" = p."owner_earning_id"
      WHERE p."payout_id" = NEW."id" AND p."active_allocation"
        AND "booking_workflow_compliance_blocker"(e."booking_id") IS NOT NULL LIMIT 1 FOR UPDATE OF e;
  END IF;
  IF blocker IS NOT NULL THEN RAISE EXCEPTION 'payout workflow incomplete: %', blocker; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_item_workflow_compliance" BEFORE INSERT ON "payout_items"
  FOR EACH ROW EXECUTE FUNCTION "enforce_payout_workflow_compliance"();
CREATE TRIGGER "payout_submission_workflow_compliance" BEFORE UPDATE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION "enforce_payout_workflow_compliance"();
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
    SELECT gen_random_uuid(), 'BOOKING', b."id", 'RETURN_CONFIRMATION_OVERDUE', jsonb_build_object('bookingId', b."id", 'returnGraceBoundary', b."rental_end" + make_interval(mins => "return_confirmation_grace_minutes")), 'PENDING', clock_timestamp(), clock_timestamp()
    FROM "bookings" b
    WHERE b."status" IN ('ACTIVE', 'RETURN_PENDING')
      AND b."actual_return_at" IS NULL
      AND b."rental_end" + make_interval(mins => "return_confirmation_grace_minutes") < clock_timestamp()
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

-- Preserve full existing B3/B4 fulfillment earnings (including Migration 49
-- completed Delivery) in the partial-allocation guard. No amounts are repriced.
CREATE OR REPLACE FUNCTION "validate_payout_item"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payout_row "payouts"%ROWTYPE; earning_row "owner_earnings"%ROWTYPE;
BEGIN
  SELECT * INTO payout_row FROM "payouts" WHERE "id" = NEW."payout_id" FOR UPDATE;
  SELECT * INTO earning_row FROM "owner_earnings" WHERE "id" = NEW."owner_earning_id" FOR UPDATE;
  IF payout_row."id" IS NULL OR earning_row."id" IS NULL THEN RAISE EXCEPTION 'payout or earning missing'; END IF;
  IF NEW."active_allocation" AND earning_row."status" <> 'AVAILABLE' THEN
    RAISE EXCEPTION 'only AVAILABLE earnings may be allocated';
  END IF;
  IF payout_row."owner_profile_id" <> earning_row."owner_profile_id"
    OR payout_row."currency" <> earning_row."currency" OR NEW."currency" <> payout_row."currency" THEN
    RAISE EXCEPTION 'payout item owner or currency mismatch';
  END IF;
  IF NEW."amount_minor" <> earning_row."net_earning_amount_minor"
      + earning_row."delivery_earning_minor" + earning_row."collection_earning_minor"
      + earning_row."additional_compensation_minor" + earning_row."adjustment_amount_minor" THEN
    RAISE EXCEPTION 'partial earning payouts are not supported';
  END IF;
  IF EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = earning_row."id" AND h."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'earning has an active hold';
  END IF;
  IF EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = earning_row."booking_id"
      AND (p."reconciliation_required" OR p."status" IN ('AUTHORIZING', 'CAPTURING', 'VOID_PENDING'))) THEN
    RAISE EXCEPTION 'earning has a payment reconciliation blocker';
  END IF;
  RETURN NEW;
END $$;
