-- Phase 9 payout invariants and append-only financial finalizers.
CREATE UNIQUE INDEX "owner_payout_accounts_one_active_default"
  ON "owner_payout_accounts" ("owner_profile_id", "currency")
  WHERE "is_default" AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "payout_items_one_active_allocation"
  ON "payout_items" ("owner_earning_id")
  WHERE "active_allocation";

ALTER TABLE "owner_payout_accounts" ADD CONSTRAINT "owner_payout_accounts_market_check"
  CHECK ("country" = 'PH' AND "currency" = 'PHP');
ALTER TABLE "owner_payout_accounts" ADD CONSTRAINT "owner_payout_accounts_state_check"
  CHECK (("status" = 'ACTIVE' AND "verified_at" IS NOT NULL AND "disabled_at" IS NULL)
    OR ("status" = 'DISABLED' AND "disabled_at" IS NOT NULL)
    OR "status" IN ('PENDING_VERIFICATION', 'REQUIRES_ACTION', 'REJECTED'));
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_currency_check" CHECK ("currency" = 'PHP');
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_values_check" CHECK (
  "amount_minor" > 0 AND "gross_earning_minor" > 0
  AND "withholding_amount_minor" = 0
  AND "provider_fee_amount_minor" >= 0
  AND "fee_policy" = 'PLATFORM_FUNDED'
  AND "currency" = 'PHP' AND "destination_currency" = 'PHP' AND "destination_country" = 'PH'
  AND "amount_minor" = "gross_earning_minor" + "adjustment_amount_minor" - "withholding_amount_minor"
);
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_values_check"
  CHECK ("amount_minor" > 0 AND "currency" = 'PHP'
    AND (("active_allocation" AND "released_at" IS NULL) OR (NOT "active_allocation" AND "released_at" IS NOT NULL)));

CREATE OR REPLACE FUNCTION "protect_payout_snapshot"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."owner_profile_id" IS DISTINCT FROM NEW."owner_profile_id"
    OR OLD."payout_account_id" IS DISTINCT FROM NEW."payout_account_id"
    OR OLD."provider" IS DISTINCT FROM NEW."provider"
    OR OLD."amount_minor" IS DISTINCT FROM NEW."amount_minor"
    OR OLD."gross_earning_minor" IS DISTINCT FROM NEW."gross_earning_minor"
    OR OLD."adjustment_amount_minor" IS DISTINCT FROM NEW."adjustment_amount_minor"
    OR OLD."withholding_amount_minor" IS DISTINCT FROM NEW."withholding_amount_minor"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."destination_type" IS DISTINCT FROM NEW."destination_type"
    OR OLD."destination_channel" IS DISTINCT FROM NEW."destination_channel"
    OR OLD."destination_masked" IS DISTINCT FROM NEW."destination_masked"
    OR OLD."destination_account_holder" IS DISTINCT FROM NEW."destination_account_holder"
    OR OLD."destination_country" IS DISTINCT FROM NEW."destination_country"
    OR OLD."destination_currency" IS DISTINCT FROM NEW."destination_currency" THEN
    RAISE EXCEPTION 'payout financial and destination snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_snapshot_immutable" BEFORE UPDATE ON "payouts"
  FOR EACH ROW EXECUTE FUNCTION "protect_payout_snapshot"();

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
CREATE TRIGGER "payout_item_authoritative_validation" BEFORE INSERT ON "payout_items"
  FOR EACH ROW EXECUTE FUNCTION "validate_payout_item"();

CREATE OR REPLACE FUNCTION "assert_payout_total"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid; expected bigint; actual bigint;
BEGIN
  target_id := COALESCE(NEW."payout_id", OLD."payout_id");
  SELECT "amount_minor" INTO expected FROM "payouts" WHERE "id" = target_id;
  SELECT COALESCE(sum("amount_minor"), 0) INTO actual FROM "payout_items"
    WHERE "payout_id" = target_id AND "active_allocation";
  IF expected <> actual AND EXISTS (SELECT 1 FROM "payouts" WHERE "id" = target_id AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'payout amount must equal active payout items';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "payout_total_from_item" AFTER INSERT OR UPDATE ON "payout_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_payout_total"();

CREATE OR REPLACE FUNCTION "protect_payout_item_history"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payout item history is append-only'; END IF;
  IF OLD."payout_id" IS DISTINCT FROM NEW."payout_id"
    OR OLD."owner_earning_id" IS DISTINCT FROM NEW."owner_earning_id"
    OR OLD."amount_minor" IS DISTINCT FROM NEW."amount_minor"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR (NOT OLD."active_allocation" AND NEW."active_allocation") THEN
    RAISE EXCEPTION 'payout item financial history is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_items_append_only" BEFORE UPDATE OR DELETE ON "payout_items"
  FOR EACH ROW EXECUTE FUNCTION "protect_payout_item_history"();

CREATE OR REPLACE FUNCTION "protect_payout_operation_identity"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payout operation history is append-only'; END IF;
  IF OLD."payout_id" IS DISTINCT FROM NEW."payout_id"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
    OR OLD."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
    OR OLD."correlation_id" IS DISTINCT FROM NEW."correlation_id" THEN
    RAISE EXCEPTION 'payout operation identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_operations_append_only" BEFORE UPDATE OR DELETE ON "payout_operations"
  FOR EACH ROW EXECUTE FUNCTION "protect_payout_operation_identity"();

CREATE OR REPLACE FUNCTION "protect_payout_account_secrets"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."owner_profile_id" IS DISTINCT FROM NEW."owner_profile_id"
    OR OLD."type" IS DISTINCT FROM NEW."type" OR OLD."provider" IS DISTINCT FROM NEW."provider"
    OR OLD."destination_channel" IS DISTINCT FROM NEW."destination_channel"
    OR OLD."account_holder_name" IS DISTINCT FROM NEW."account_holder_name"
    OR OLD."masked_account_identifier" IS DISTINCT FROM NEW."masked_account_identifier"
    OR OLD."identifier_fingerprint" IS DISTINCT FROM NEW."identifier_fingerprint"
    OR OLD."encrypted_account_identifier" IS DISTINCT FROM NEW."encrypted_account_identifier"
    OR OLD."encryption_iv" IS DISTINCT FROM NEW."encryption_iv"
    OR OLD."encryption_auth_tag" IS DISTINCT FROM NEW."encryption_auth_tag"
    OR OLD."encryption_key_version" IS DISTINCT FROM NEW."encryption_key_version" THEN
    RAISE EXCEPTION 'payout destination identity is immutable; add a replacement account';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payout_account_identity_immutable" BEFORE UPDATE ON "owner_payout_accounts"
  FOR EACH ROW EXECUTE FUNCTION "protect_payout_account_secrets"();

-- Do not let the Phase 8 availability sweep mutate allocated or settled earnings.
CREATE OR REPLACE FUNCTION "release_due_owner_earnings"()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE item record; released integer := 0;
BEGIN
  FOR item IN
    SELECT e."id", e."booking_id" FROM "owner_earnings" e JOIN "bookings" b ON b."id" = e."booking_id"
    WHERE e."status" IN ('PENDING', 'HELD') AND e."available_at" <= clock_timestamp()
      AND b."status" = 'COMPLETED'
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
