CREATE OR REPLACE FUNCTION "finalize_additional_charge_payment"(
  payment_id uuid, operation_id uuid, provider_state text, external_operation_id text, correlation_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  payment_row "payments"%ROWTYPE; charge_row "additional_charges"%ROWTYPE; earning_row "owner_earnings"%ROWTYPE;
  provider_account uuid; held_account uuid; owner_account uuid; commission_account uuid;
  recognition_id uuid := gen_random_uuid(); allocation_id uuid := gen_random_uuid(); now_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO payment_row FROM "payments" WHERE "id" = payment_id FOR UPDATE;
  IF NOT FOUND OR payment_row."status" = 'CAPTURED' THEN RETURN; END IF;
  IF payment_row."purpose" <> 'ADDITIONAL_CHARGE' OR payment_row."additional_charge_id" IS NULL THEN RAISE EXCEPTION 'Payment is not linked to an additional charge'; END IF;
  SELECT * INTO charge_row FROM "additional_charges" WHERE "id" = payment_row."additional_charge_id" FOR UPDATE;
  SELECT * INTO earning_row FROM "owner_earnings" WHERE "id" = charge_row."owner_earning_id" FOR UPDATE;
  IF payment_row."amount_minor" <> charge_row."approved_amount_minor" THEN RAISE EXCEPTION 'Payment exceeds approved adjudication'; END IF;
  IF operation_id IS NOT NULL THEN UPDATE "payment_operations" SET "status" = 'SUCCEEDED', "completed_at" = now_at,
    "external_operation_id" = external_operation_id, "failure_category" = NULL, "updated_at" = now_at WHERE "id" = operation_id AND "status" <> 'SUCCEEDED'; END IF;
  UPDATE "payments" SET "status" = 'CAPTURED', "captured_amount_minor" = "amount_minor", "captured_at" = now_at,
    "provider_state" = provider_state, "reconciliation_required" = false, "reconcile_after" = NULL, "unknown_expires_at" = NULL, "updated_at" = now_at WHERE "id" = payment_id;
  UPDATE "additional_charges" SET "status" = 'PAID', "collected_amount_minor" = "approved_amount_minor", "paid_at" = now_at, "updated_at" = now_at WHERE "id" = charge_row."id";
  UPDATE "post_return_claims" SET "status" = 'RESOLVED', "resolved_at" = now_at WHERE "id" = charge_row."claim_id" AND "status" = 'PAYMENT_PENDING';
  UPDATE "earning_holds" SET "status" = 'RELEASED', "released_at" = now_at, "resolution" = 'Approved additional charge collected'
    WHERE "claim_id" = charge_row."claim_id" AND "status" = 'ACTIVE';
  UPDATE "owner_earnings" SET "additional_compensation_minor" = "additional_compensation_minor" + charge_row."owner_compensation_minor",
    "last_financial_resolution_at" = now_at,
    "status" = CASE WHEN EXISTS (SELECT 1 FROM "earning_holds" h WHERE h."owner_earning_id" = earning_row."id" AND h."status" = 'ACTIVE' AND h."claim_id" IS DISTINCT FROM charge_row."claim_id") THEN 'HELD'::"OwnerEarningStatus" ELSE 'PENDING'::"OwnerEarningStatus" END,
    "available_at" = CASE WHEN "available_at" IS NULL THEN NULL ELSE GREATEST("available_at", now_at + interval '24 hours') END
    WHERE "id" = earning_row."id";

  SELECT "id" INTO provider_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PAYMENT_PROVIDER_RECEIVABLE' AND "active" LIMIT 1;
  SELECT "id" INTO held_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'CUSTOMER_FUNDS_HELD' AND "active" LIMIT 1;
  SELECT "id" INTO owner_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'OWNER_PAYABLE' AND "active" LIMIT 1;
  SELECT "id" INTO commission_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PLATFORM_COMMISSION_REVENUE' AND "active" LIMIT 1;
  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (recognition_id, 'CAPTURE_RECOGNITION', 'ADDITIONAL_CHARGE_PAYMENT', payment_id, payment_row."currency", 'Additional charge payment recognized', correlation_id, now_at);
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), recognition_id, provider_account, charge_row."approved_amount_minor", payment_row."currency", 'Provider receivable', now_at),
    (gen_random_uuid(), recognition_id, held_account, -charge_row."approved_amount_minor", payment_row."currency", 'Additional renter funds held', now_at);
  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (allocation_id, 'CAPTURE_ALLOCATION', 'ADDITIONAL_CHARGE_PAYMENT', payment_id, payment_row."currency", 'Additional charge allocated by category policy', correlation_id, now_at);
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), allocation_id, held_account, charge_row."approved_amount_minor", payment_row."currency", 'Allocate additional renter funds', now_at),
    (gen_random_uuid(), allocation_id, owner_account, -charge_row."owner_compensation_minor", payment_row."currency", 'Owner additional compensation', now_at);
  IF charge_row."platform_share_minor" > 0 THEN
    INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
      (gen_random_uuid(), allocation_id, commission_account, -charge_row."platform_share_minor", payment_row."currency", 'Configured platform share', now_at);
  END IF;
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at") VALUES
    (gen_random_uuid(), 'ADDITIONAL_CHARGE', charge_row."id", 'ADDITIONAL_CHARGE_PAID', jsonb_build_object('bookingId', charge_row."booking_id", 'chargeId', charge_row."id"), 'PENDING', now_at, now_at),
    (gen_random_uuid(), 'EARNING_HOLD', earning_row."id", 'EARNING_HOLD_RELEASED', jsonb_build_object('bookingId', charge_row."booking_id", 'claimId', charge_row."claim_id"), 'PENDING', now_at, now_at);
  INSERT INTO "analytics_events" ("id", "event_type", "booking_id", "metadata", "occurred_at") VALUES
    (gen_random_uuid(), 'ADDITIONAL_CHARGE_PAID', charge_row."booking_id", jsonb_build_object('chargeId', charge_row."id"), now_at),
    (gen_random_uuid(), 'EARNING_RELEASED', charge_row."booking_id", jsonb_build_object('claimId', charge_row."claim_id"), now_at);
END;
$$;
