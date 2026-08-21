-- Idempotent database finalizers let API, webhook, and reconciliation workers apply
-- authoritative provider results through the same atomic boundary.
CREATE OR REPLACE FUNCTION "finalize_payment_authorization"(
  payment_id uuid,
  provider_payment_id text,
  provider_state text,
  owner_response_minutes integer,
  correlation_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  payment_row "payments"%ROWTYPE;
  booking_row "bookings"%ROWTYPE;
  response_deadline timestamptz;
BEGIN
  SELECT * INTO payment_row FROM "payments" WHERE "id" = payment_id FOR UPDATE;
  IF NOT FOUND OR payment_row."status" IN ('AUTHORIZED', 'CAPTURING', 'CAPTURED', 'VOID_PENDING', 'VOIDED') THEN RETURN; END IF;
  SELECT * INTO booking_row FROM "bookings" WHERE "id" = payment_row."booking_id" FOR UPDATE;

  UPDATE "payments" SET
    "authorized_amount_minor" = "amount_minor", "authorized_at" = clock_timestamp(),
    "external_payment_id" = provider_payment_id, "provider_state" = provider_state,
    "customer_action_url" = NULL, "reconciliation_required" = false,
    "reconcile_after" = NULL, "unknown_expires_at" = NULL,
    "status" = CASE WHEN booking_row."status" IN ('CANCELLED', 'EXPIRED') THEN 'VOID_PENDING'::"PaymentStatus" ELSE 'AUTHORIZED'::"PaymentStatus" END,
    "updated_at" = clock_timestamp()
  WHERE "id" = payment_id;

  IF booking_row."status" IN ('CANCELLED', 'EXPIRED') THEN
    INSERT INTO "payment_operations" (
      "id", "payment_id", "type", "status", "idempotency_key", "provider_request_reference", "amount_minor", "currency", "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid(), payment_id, 'VOID', 'PENDING', 'booking:' || booking_row."id" || ':void:v1', gen_random_uuid()::text,
      payment_row."amount_minor", payment_row."currency", clock_timestamp(), clock_timestamp()
    ) ON CONFLICT ("idempotency_key") DO NOTHING;
    RETURN;
  END IF;
  IF booking_row."status" <> 'AWAITING_PAYMENT' THEN RETURN; END IF;

  response_deadline := clock_timestamp() + make_interval(mins => owner_response_minutes);
  UPDATE "bookings" SET "status" = 'AWAITING_OWNER', "owner_response_deadline_at" = response_deadline, "updated_at" = clock_timestamp() WHERE "id" = booking_row."id";
  UPDATE "vehicle_occupancies" SET "expires_at" = response_deadline WHERE "booking_id" = booking_row."id" AND "active";
  INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "correlation_id", "occurred_at")
    VALUES (gen_random_uuid(), booking_row."id", booking_row."status", 'AWAITING_OWNER', 'WORKER', 'PAYMENT_AUTHORIZED_OWNER_REQUESTED', correlation_id, clock_timestamp());
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    VALUES (gen_random_uuid(), 'BOOKING', booking_row."id", 'PAYMENT_AUTHORIZED', jsonb_build_object('bookingId', booking_row."id", 'paymentId', payment_id), 'PENDING', clock_timestamp(), clock_timestamp());
END;
$$;

CREATE OR REPLACE FUNCTION "finalize_payment_void"(
  payment_id uuid,
  operation_id uuid,
  provider_state text,
  external_operation_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE payment_row "payments"%ROWTYPE;
BEGIN
  SELECT * INTO payment_row FROM "payments" WHERE "id" = payment_id FOR UPDATE;
  IF NOT FOUND OR payment_row."status" = 'VOIDED' THEN RETURN; END IF;
  IF operation_id IS NOT NULL THEN
    UPDATE "payment_operations" SET "status" = 'SUCCEEDED', "completed_at" = clock_timestamp(),
      "external_operation_id" = external_operation_id, "failure_category" = NULL, "updated_at" = clock_timestamp()
    WHERE "id" = operation_id AND "status" NOT IN ('SUCCEEDED', 'FAILED');
  END IF;
  UPDATE "payments" SET "status" = 'VOIDED', "provider_state" = provider_state,
    "voided_at" = clock_timestamp(), "reconciliation_required" = false, "reconcile_after" = NULL, "updated_at" = clock_timestamp()
  WHERE "id" = payment_id;
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at")
    VALUES (gen_random_uuid(), 'BOOKING', payment_row."booking_id", 'PAYMENT_AUTHORIZATION_VOIDED', jsonb_build_object('bookingId', payment_row."booking_id", 'paymentId', payment_id), 'PENDING', clock_timestamp(), clock_timestamp());
END;
$$;

CREATE OR REPLACE FUNCTION "finalize_payment_capture"(
  payment_id uuid,
  operation_id uuid,
  provider_state text,
  external_operation_id text,
  correlation_id text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  payment_row "payments"%ROWTYPE;
  booking_row "bookings"%ROWTYPE;
  rule_row "commission_rules"%ROWTYPE;
  category_id uuid;
  gross bigint;
  commission bigint;
  net bigint;
  provider_account uuid;
  held_account uuid;
  owner_account uuid;
  commission_account uuid;
  recognition_id uuid := gen_random_uuid();
  allocation_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO payment_row FROM "payments" WHERE "id" = payment_id FOR UPDATE;
  IF NOT FOUND OR payment_row."status" = 'CAPTURED' THEN RETURN; END IF;
  SELECT * INTO booking_row FROM "bookings" WHERE "id" = payment_row."booking_id" FOR UPDATE;
  IF booking_row."status" <> 'CAPTURE_PENDING' THEN RAISE EXCEPTION 'Captured payment cannot apply to booking state %', booking_row."status"; END IF;
  SELECT ps."subtotal_minor", v."category_id" INTO gross, category_id
  FROM "booking_pricing_snapshots" ps JOIN "vehicles" v ON v."id" = booking_row."vehicle_id"
  WHERE ps."booking_id" = booking_row."id";
  IF gross IS NULL OR gross <> payment_row."amount_minor" THEN RAISE EXCEPTION 'MVP rental total must equal rental subtotal'; END IF;

  SELECT * INTO rule_row FROM "commission_rules" r
  WHERE r."effective_from" <= clock_timestamp() AND (r."disabled_at" IS NULL OR r."disabled_at" > clock_timestamp())
    AND ((r."scope" = 'OWNER' AND r."owner_profile_id" = booking_row."owner_profile_id")
      OR (r."scope" = 'VEHICLE_CATEGORY' AND r."vehicle_category_id" = category_id)
      OR r."scope" = 'PLATFORM_DEFAULT')
  ORDER BY CASE r."scope" WHEN 'OWNER' THEN 1 WHEN 'VEHICLE_CATEGORY' THEN 2 ELSE 3 END, r."version" DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active commission rule is required'; END IF;
  commission := (gross * rule_row."rate_basis_points") / 10000 + rule_row."fixed_amount_minor";
  IF rule_row."minimum_amount_minor" IS NOT NULL THEN commission := GREATEST(commission, rule_row."minimum_amount_minor"); END IF;
  IF rule_row."maximum_amount_minor" IS NOT NULL THEN commission := LEAST(commission, rule_row."maximum_amount_minor"); END IF;
  commission := LEAST(commission, gross);
  net := gross - commission;

  SELECT "id" INTO provider_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PAYMENT_PROVIDER_RECEIVABLE' AND "active" LIMIT 1;
  SELECT "id" INTO held_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'CUSTOMER_FUNDS_HELD' AND "active" LIMIT 1;
  SELECT "id" INTO owner_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'OWNER_PAYABLE' AND "active" LIMIT 1;
  SELECT "id" INTO commission_account FROM "financial_accounts" WHERE "currency" = payment_row."currency" AND "type" = 'PLATFORM_COMMISSION_REVENUE' AND "active" LIMIT 1;
  IF provider_account IS NULL OR held_account IS NULL OR owner_account IS NULL OR commission_account IS NULL THEN RAISE EXCEPTION 'Financial chart of accounts is incomplete'; END IF;

  IF operation_id IS NOT NULL THEN
    UPDATE "payment_operations" SET "status" = 'SUCCEEDED', "completed_at" = clock_timestamp(),
      "external_operation_id" = external_operation_id, "failure_category" = NULL, "updated_at" = clock_timestamp()
    WHERE "id" = operation_id AND "status" NOT IN ('SUCCEEDED', 'FAILED');
  END IF;
  UPDATE "payments" SET "status" = 'CAPTURED', "captured_amount_minor" = "amount_minor", "captured_at" = clock_timestamp(),
    "provider_state" = provider_state, "reconciliation_required" = false, "reconcile_after" = NULL, "unknown_expires_at" = NULL, "updated_at" = clock_timestamp()
  WHERE "id" = payment_id;
  UPDATE "bookings" SET "status" = 'CONFIRMED', "updated_at" = clock_timestamp() WHERE "id" = booking_row."id";

  INSERT INTO "commission_snapshots" ("id", "booking_id", "payment_id", "rule_id", "rule_version", "scope", "rate_basis_points", "fixed_amount_minor", "minimum_amount_minor", "maximum_amount_minor", "commissionable_base_minor", "calculated_commission_minor", "currency", "calculation_version", "created_at")
    VALUES (gen_random_uuid(), booking_row."id", payment_id, rule_row."id", rule_row."version", rule_row."scope", rule_row."rate_basis_points", rule_row."fixed_amount_minor", rule_row."minimum_amount_minor", rule_row."maximum_amount_minor", gross, commission, payment_row."currency", rule_row."calculation_version", clock_timestamp());
  INSERT INTO "owner_earnings" ("id", "booking_id", "payment_id", "owner_profile_id", "gross_rental_amount_minor", "commission_amount_minor", "net_earning_amount_minor", "currency", "status", "created_at")
    VALUES (gen_random_uuid(), booking_row."id", payment_id, booking_row."owner_profile_id", gross, commission, net, payment_row."currency", 'PENDING', clock_timestamp());

  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (recognition_id, 'CAPTURE_RECOGNITION', 'PAYMENT', payment_id, payment_row."currency", 'Rental payment capture recognized', correlation_id, clock_timestamp());
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), recognition_id, provider_account, gross, payment_row."currency", 'Provider receivable', clock_timestamp()),
    (gen_random_uuid(), recognition_id, held_account, -gross, payment_row."currency", 'Customer funds held', clock_timestamp());
  INSERT INTO "ledger_transactions" ("id", "type", "source_type", "source_id", "currency", "description", "correlation_id", "posted_at")
    VALUES (allocation_id, 'CAPTURE_ALLOCATION', 'PAYMENT', payment_id, payment_row."currency", 'Captured rental allocated to owner and platform', correlation_id, clock_timestamp());
  INSERT INTO "ledger_entries" ("id", "transaction_id", "account_id", "amount_minor", "currency", "memo", "created_at") VALUES
    (gen_random_uuid(), allocation_id, held_account, gross, payment_row."currency", 'Allocate held customer funds', clock_timestamp()),
    (gen_random_uuid(), allocation_id, owner_account, -net, payment_row."currency", 'Pending owner earning', clock_timestamp()),
    (gen_random_uuid(), allocation_id, commission_account, -commission, payment_row."currency", 'Platform commission', clock_timestamp());

  INSERT INTO "booking_status_history" ("id", "booking_id", "from_status", "to_status", "actor_type", "reason_code", "correlation_id", "occurred_at")
    VALUES (gen_random_uuid(), booking_row."id", booking_row."status", 'CONFIRMED', 'WORKER', 'PAYMENT_CAPTURED_BOOKING_CONFIRMED', correlation_id, clock_timestamp());
  INSERT INTO "outbox_events" ("id", "aggregate_type", "aggregate_id", "event_type", "payload", "status", "available_at", "occurred_at") VALUES
    (gen_random_uuid(), 'BOOKING', booking_row."id", 'PAYMENT_CAPTURED', jsonb_build_object('bookingId', booking_row."id", 'paymentId', payment_id), 'PENDING', clock_timestamp(), clock_timestamp()),
    (gen_random_uuid(), 'BOOKING', booking_row."id", 'OWNER_EARNING_PENDING', jsonb_build_object('bookingId', booking_row."id", 'paymentId', payment_id), 'PENDING', clock_timestamp(), clock_timestamp());
END;
$$;
