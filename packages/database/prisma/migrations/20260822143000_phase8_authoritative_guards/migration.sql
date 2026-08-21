ALTER TABLE "disputes"
  ADD COLUMN "refund_id" UUID REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "disputes_refund_id_idx" ON "disputes"("refund_id");

CREATE OR REPLACE FUNCTION "guard_booking_phase8_completion"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'COMPLETED' OR OLD."status" = 'COMPLETED' THEN RETURN NEW; END IF;
  IF NEW."claim_deadline_at" IS NULL OR NEW."claim_deadline_at" >= clock_timestamp() THEN
    RAISE EXCEPTION 'Booking cannot complete before its stored claim window closes' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = NEW."id" AND c."blocking" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED')) OR
     EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = NEW."id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW')) OR
     EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = NEW."id" AND i."blocks_completion" AND i."status" IN ('OPEN', 'ACKNOWLEDGED')) THEN
    RAISE EXCEPTION 'Booking cannot complete with an unresolved post-return blocker' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "bookings_phase8_completion_guard"
BEFORE UPDATE OF "status" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION "guard_booking_phase8_completion"();

CREATE OR REPLACE FUNCTION "guard_phase8_record_consistency"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_booking_id uuid; linked_claim_id uuid; linked_amount bigint; linked_currency text;
BEGIN
  IF TG_TABLE_NAME = 'claim_responses' THEN
    SELECT c."booking_id" INTO linked_booking_id FROM "post_return_claims" c WHERE c."id" = NEW."claim_id";
    IF NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."id" = linked_booking_id AND b."renter_user_id" = NEW."renter_user_id") THEN
      RAISE EXCEPTION 'Claim response renter does not match the booking renter' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'additional_charges' THEN
    SELECT c."booking_id" INTO linked_booking_id FROM "post_return_claims" c WHERE c."id" = NEW."claim_id";
    SELECT a."claim_id", a."approved_amount_minor", a."currency" INTO linked_claim_id, linked_amount, linked_currency
      FROM "claim_adjudications" a WHERE a."id" = NEW."adjudication_id";
    IF linked_booking_id IS DISTINCT FROM NEW."booking_id" OR linked_claim_id IS DISTINCT FROM NEW."claim_id" OR
       linked_amount IS DISTINCT FROM NEW."approved_amount_minor" OR linked_currency IS DISTINCT FROM NEW."currency" OR
       NOT EXISTS (SELECT 1 FROM "owner_earnings" e WHERE e."id" = NEW."owner_earning_id" AND e."booking_id" = NEW."booking_id" AND e."currency" = NEW."currency") THEN
      RAISE EXCEPTION 'Additional charge does not match its claim, adjudication, or earning' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'disputes' THEN
    IF (NEW."origin_type" = 'CLAIM' AND NEW."claim_id" IS NULL) OR
       (NEW."origin_type" = 'INCIDENT' AND NEW."incident_id" IS NULL) OR
       (NEW."origin_type" = 'ADDITIONAL_CHARGE' AND NEW."additional_charge_id" IS NULL) OR
       (NEW."origin_type" = 'REFUND' AND NEW."refund_id" IS NULL) THEN
      RAISE EXCEPTION 'Dispute origin requires its source record' USING ERRCODE = '23514';
    END IF;
    IF (NEW."claim_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."id" = NEW."claim_id" AND c."booking_id" = NEW."booking_id")) OR
       (NEW."incident_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."id" = NEW."incident_id" AND i."booking_id" = NEW."booking_id")) OR
       (NEW."additional_charge_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "additional_charges" a WHERE a."id" = NEW."additional_charge_id" AND a."booking_id" = NEW."booking_id")) OR
       (NEW."refund_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "refunds" r JOIN "payments" p ON p."id" = r."payment_id" WHERE r."id" = NEW."refund_id" AND p."booking_id" = NEW."booking_id")) THEN
      RAISE EXCEPTION 'Dispute source does not belong to its booking' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'earning_holds' THEN
    SELECT e."booking_id" INTO linked_booking_id FROM "owner_earnings" e WHERE e."id" = NEW."owner_earning_id";
    IF (NEW."claim_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."id" = NEW."claim_id" AND c."booking_id" = linked_booking_id)) OR
       (NEW."dispute_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "disputes" d WHERE d."id" = NEW."dispute_id" AND d."booking_id" = linked_booking_id)) OR
       (NEW."incident_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."id" = NEW."incident_id" AND i."booking_id" = linked_booking_id)) THEN
      RAISE EXCEPTION 'Earning hold source does not belong to its earning booking' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "claim_responses_consistency_guard" BEFORE INSERT ON "claim_responses"
FOR EACH ROW EXECUTE FUNCTION "guard_phase8_record_consistency"();
CREATE TRIGGER "additional_charges_consistency_guard" BEFORE INSERT ON "additional_charges"
FOR EACH ROW EXECUTE FUNCTION "guard_phase8_record_consistency"();
CREATE TRIGGER "disputes_consistency_guard" BEFORE INSERT OR UPDATE ON "disputes"
FOR EACH ROW EXECUTE FUNCTION "guard_phase8_record_consistency"();
CREATE TRIGGER "earning_holds_consistency_guard" BEFORE INSERT ON "earning_holds"
FOR EACH ROW EXECUTE FUNCTION "guard_phase8_record_consistency"();

CREATE OR REPLACE FUNCTION "guard_earning_availability"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'AVAILABLE' AND OLD."status" <> 'AVAILABLE' THEN
    IF NEW."available_at" IS NULL OR NEW."available_at" > clock_timestamp() OR
       NOT EXISTS (SELECT 1 FROM "bookings" b WHERE b."id" = NEW."booking_id" AND b."status" = 'COMPLETED' AND b."operational_hold" = false) OR
       EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = NEW."id" AND h."status" = 'ACTIVE') OR
       EXISTS (SELECT 1 FROM "post_return_claims" c WHERE c."booking_id" = NEW."booking_id" AND c."blocking" AND c."status" NOT IN ('WITHDRAWN', 'RESOLVED')) OR
       EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = NEW."booking_id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW')) OR
       EXISTS (SELECT 1 FROM "payments" p WHERE p."booking_id" = NEW."booking_id" AND (p."reconciliation_required" OR p."status" IN ('AUTHORIZING', 'CAPTURING', 'VOID_PENDING'))) OR
       EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = NEW."booking_id" AND i."severity" = 'CRITICAL' AND i."status" IN ('OPEN', 'ACKNOWLEDGED')) THEN
      RAISE EXCEPTION 'Owner earning is not eligible to become available' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "emit_claim_financial_notifications"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE emitted integer := 0;
BEGIN
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
  SELECT gen_random_uuid(), 'POST_RETURN_CLAIM', c."id", 'CLAIM_RESPONSE_DEADLINE_PASSED', jsonb_build_object('bookingId', c."booking_id", 'claimId', c."id"), 'PENDING', clock_timestamp(), clock_timestamp()
  FROM "post_return_claims" c WHERE c."status" = 'RENTER_REVIEW' AND c."response_deadline_at" <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "outbox_events" o WHERE o."aggregate_id" = c."id" AND o."event_type" = 'CLAIM_RESPONSE_DEADLINE_PASSED');
  GET DIAGNOSTICS emitted = ROW_COUNT;
  INSERT INTO "claim_responses" ("id", "claim_id", "renter_user_id", "decision", "explanation", "responded_at")
  SELECT gen_random_uuid(), c."id", b."renter_user_id", 'NO_RESPONSE', 'The configured response window elapsed.', clock_timestamp()
  FROM "post_return_claims" c JOIN "bookings" b ON b."id" = c."booking_id"
  WHERE c."status" = 'RENTER_REVIEW' AND c."response_deadline_at" <= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "claim_responses" r WHERE r."claim_id" = c."id")
  ON CONFLICT ("claim_id") DO NOTHING;
  UPDATE "post_return_claims" c SET "status" = 'UNDER_ADMIN_REVIEW'
  WHERE c."status" = 'RENTER_REVIEW' AND c."response_deadline_at" <= clock_timestamp();
  RETURN emitted;
END;
$$;
