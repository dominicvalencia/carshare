-- CreateEnum
CREATE TYPE "PaymentProviderCode" AS ENUM ('MAYA', 'FAKE');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('RENTAL', 'SECURITY_DEPOSIT', 'ADDITIONAL_CHARGE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZING', 'AUTHORIZED', 'CAPTURING', 'CAPTURED', 'VOID_PENDING', 'VOIDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentOperationType" AS ENUM ('AUTHORIZE', 'CAPTURE', 'VOID', 'REFUND', 'RETRIEVE');

-- CreateEnum
CREATE TYPE "PaymentOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PaymentFailureCategory" AS ENUM ('DEFINITIVE', 'UNKNOWN', 'PROVIDER_UNAVAILABLE', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('PLATFORM_DEFAULT', 'VEHICLE_CATEGORY', 'OWNER');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('PAYMENT_PROVIDER_RECEIVABLE', 'CUSTOMER_FUNDS_HELD', 'OWNER_PAYABLE', 'PLATFORM_COMMISSION_REVENUE', 'REFUND_PAYABLE');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('CAPTURE_RECOGNITION', 'CAPTURE_ALLOCATION', 'REFUND', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OwnerEarningStatus" AS ENUM ('PENDING', 'HELD', 'AVAILABLE', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SecurityDepositStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'AUTHORIZING', 'AUTHORIZED', 'CLAIM_HELD', 'RELEASING', 'RELEASED', 'CHARGE_PROCESSING', 'PARTIALLY_USED', 'USED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "provider" "PaymentProviderCode" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "authorized_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "captured_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "refunded_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "external_payment_id" VARCHAR(255),
    "provider_request_reference" VARCHAR(100) NOT NULL,
    "provider_state" VARCHAR(100),
    "customer_action_url" VARCHAR(2000),
    "reconciliation_required" BOOLEAN NOT NULL DEFAULT false,
    "reconcile_after" TIMESTAMPTZ(3),
    "unknown_expires_at" TIMESTAMPTZ(3),
    "authorized_at" TIMESTAMPTZ(3),
    "captured_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_operations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" "PaymentOperationType" NOT NULL,
    "status" "PaymentOperationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "provider_request_reference" VARCHAR(100) NOT NULL,
    "external_operation_id" VARCHAR(255),
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" "PaymentFailureCategory",
    "failure_code" VARCHAR(100),
    "failure_message" VARCHAR(500),
    "safe_provider_metadata" JSONB,
    "next_attempt_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "payment_id" UUID,
    "provider" "PaymentProviderCode" NOT NULL,
    "external_event_id" CHAR(64) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "provider_payment_id" VARCHAR(255) NOT NULL,
    "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "source_ip" INET,
    "payload_digest" CHAR(64) NOT NULL,
    "redacted_payload" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" VARCHAR(500),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "owner_profile_id" UUID,
    "vehicle_category_id" UUID,
    "version" INTEGER NOT NULL,
    "rate_basis_points" INTEGER NOT NULL,
    "fixed_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "minimum_amount_minor" BIGINT,
    "maximum_amount_minor" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "calculation_version" VARCHAR(100) NOT NULL DEFAULT 'COMMISSION_BPS_V1',
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "disabled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_snapshots" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "rate_basis_points" INTEGER NOT NULL,
    "fixed_amount_minor" BIGINT NOT NULL,
    "minimum_amount_minor" BIGINT,
    "maximum_amount_minor" BIGINT,
    "commissionable_base_minor" BIGINT NOT NULL,
    "calculated_commission_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "calculation_version" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "type" "FinancialAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "source_type" VARCHAR(100) NOT NULL,
    "source_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "correlation_id" VARCHAR(100),
    "posted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "memo" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_earnings" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "owner_profile_id" UUID NOT NULL,
    "gross_rental_amount_minor" BIGINT NOT NULL,
    "commission_amount_minor" BIGINT NOT NULL,
    "net_earning_amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "OwnerEarningStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "operation_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(1000) NOT NULL,
    "external_refund_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_deposit_authorizations" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID,
    "status" "SecurityDepositStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "required_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "authorized_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "used_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "security_deposit_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_status_reconciliation_required_reconcile_after_idx" ON "payments"("status", "reconciliation_required", "reconcile_after");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_purpose_key" ON "payments"("booking_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_external_payment_id_key" ON "payments"("provider", "external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_request_reference_key" ON "payments"("provider", "provider_request_reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_operations_idempotency_key_key" ON "payment_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_operations_status_next_attempt_at_idx" ON "payment_operations"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "payment_operations_payment_id_created_at_idx" ON "payment_operations"("payment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_operations_payment_id_type_provider_request_referen_key" ON "payment_operations"("payment_id", "type", "provider_request_reference");

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_received_at_idx" ON "payment_webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_provider_payment_id_idx" ON "payment_webhook_events"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_external_event_id_key" ON "payment_webhook_events"("provider", "external_event_id");

-- CreateIndex
CREATE INDEX "commission_rules_scope_effective_from_disabled_at_idx" ON "commission_rules"("scope", "effective_from", "disabled_at");

-- CreateIndex
CREATE INDEX "commission_rules_owner_profile_id_effective_from_idx" ON "commission_rules"("owner_profile_id", "effective_from");

-- CreateIndex
CREATE INDEX "commission_rules_vehicle_category_id_effective_from_idx" ON "commission_rules"("vehicle_category_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "commission_snapshots_booking_id_key" ON "commission_snapshots"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_snapshots_payment_id_key" ON "commission_snapshots"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_code_currency_key" ON "financial_accounts"("code", "currency");

-- CreateIndex
CREATE INDEX "ledger_transactions_posted_at_idx" ON "ledger_transactions"("posted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_source_type_source_id_type_currency_key" ON "ledger_transactions"("source_type", "source_id", "type", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "owner_earnings_booking_id_key" ON "owner_earnings"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "owner_earnings_payment_id_key" ON "owner_earnings"("payment_id");

-- CreateIndex
CREATE INDEX "owner_earnings_owner_profile_id_status_created_at_idx" ON "owner_earnings"("owner_profile_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_operation_id_key" ON "refunds"("operation_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_status_idx" ON "refunds"("payment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "security_deposit_authorizations_booking_id_key" ON "security_deposit_authorizations"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "security_deposit_authorizations_payment_id_key" ON "security_deposit_authorizations"("payment_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_vehicle_category_id_fkey" FOREIGN KEY ("vehicle_category_id") REFERENCES "vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_snapshots" ADD CONSTRAINT "commission_snapshots_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_snapshots" ADD CONSTRAINT "commission_snapshots_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_snapshots" ADD CONSTRAINT "commission_snapshots_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "commission_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_earnings" ADD CONSTRAINT "owner_earnings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_earnings" ADD CONSTRAINT "owner_earnings_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_earnings" ADD CONSTRAINT "owner_earnings_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "payment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_deposit_authorizations" ADD CONSTRAINT "security_deposit_authorizations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_deposit_authorizations" ADD CONSTRAINT "security_deposit_authorizations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial values and cross-field state invariants.
ALTER TABLE "payments" ADD CONSTRAINT "payments_money_check" CHECK (
  "currency" = 'PHP' AND "amount_minor" > 0 AND
  "authorized_amount_minor" >= 0 AND "authorized_amount_minor" <= "amount_minor" AND
  "captured_amount_minor" >= 0 AND "captured_amount_minor" <= "authorized_amount_minor" AND
  "refunded_amount_minor" >= 0 AND "refunded_amount_minor" <= "captured_amount_minor"
);
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_money_check" CHECK (
  "currency" = 'PHP' AND "amount_minor" > 0
);
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_values_check" CHECK (
  "currency" = 'PHP' AND "version" > 0 AND
  "rate_basis_points" BETWEEN 0 AND 10000 AND "fixed_amount_minor" >= 0 AND
  ("minimum_amount_minor" IS NULL OR "minimum_amount_minor" >= 0) AND
  ("maximum_amount_minor" IS NULL OR "maximum_amount_minor" >= 0) AND
  ("minimum_amount_minor" IS NULL OR "maximum_amount_minor" IS NULL OR "minimum_amount_minor" <= "maximum_amount_minor") AND
  ("disabled_at" IS NULL OR "disabled_at" > "effective_from") AND
  (("scope" = 'PLATFORM_DEFAULT' AND "owner_profile_id" IS NULL AND "vehicle_category_id" IS NULL) OR
   ("scope" = 'OWNER' AND "owner_profile_id" IS NOT NULL AND "vehicle_category_id" IS NULL) OR
   ("scope" = 'VEHICLE_CATEGORY' AND "owner_profile_id" IS NULL AND "vehicle_category_id" IS NOT NULL))
);
ALTER TABLE "commission_snapshots" ADD CONSTRAINT "commission_snapshots_values_check" CHECK (
  "currency" = 'PHP' AND "rule_version" > 0 AND
  "rate_basis_points" BETWEEN 0 AND 10000 AND
  "fixed_amount_minor" >= 0 AND "commissionable_base_minor" > 0 AND
  "calculated_commission_minor" >= 0 AND
  "calculated_commission_minor" <= "commissionable_base_minor"
);
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_currency_check" CHECK ("currency" = 'PHP');
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_currency_check" CHECK ("currency" = 'PHP');
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_values_check" CHECK (
  "currency" = 'PHP' AND "amount_minor" <> 0
);
ALTER TABLE "owner_earnings" ADD CONSTRAINT "owner_earnings_values_check" CHECK (
  "currency" = 'PHP' AND "gross_rental_amount_minor" > 0 AND
  "commission_amount_minor" >= 0 AND "net_earning_amount_minor" >= 0 AND
  "gross_rental_amount_minor" = "commission_amount_minor" + "net_earning_amount_minor"
);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_values_check" CHECK (
  "currency" = 'PHP' AND "amount_minor" > 0
);
ALTER TABLE "security_deposit_authorizations" ADD CONSTRAINT "security_deposits_values_check" CHECK (
  "currency" = 'PHP' AND "required_amount_minor" >= 0 AND
  "authorized_amount_minor" >= 0 AND "authorized_amount_minor" <= "required_amount_minor" AND
  "used_amount_minor" >= 0 AND "used_amount_minor" <= "authorized_amount_minor" AND
  ("status" <> 'NOT_REQUIRED' OR
   ("required_amount_minor" = 0 AND "authorized_amount_minor" = 0 AND "used_amount_minor" = 0))
);

CREATE UNIQUE INDEX "payment_operations_provider_external_operation_key"
  ON "payment_operations"("external_operation_id") WHERE "external_operation_id" IS NOT NULL;
CREATE UNIQUE INDEX "commission_rules_scope_version_unique"
  ON "commission_rules"(
    "scope",
    COALESCE("owner_profile_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("vehicle_category_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "version"
  );

-- Seed the compact PHP chart of accounts and configurable MVP commission version.
INSERT INTO "financial_accounts" ("id", "code", "type", "currency", "name") VALUES
  (gen_random_uuid(), 'MAYA_RECEIVABLE', 'PAYMENT_PROVIDER_RECEIVABLE', 'PHP', 'Maya payment provider receivable'),
  (gen_random_uuid(), 'CUSTOMER_FUNDS_HELD', 'CUSTOMER_FUNDS_HELD', 'PHP', 'Captured customer funds awaiting allocation'),
  (gen_random_uuid(), 'OWNER_PAYABLE', 'OWNER_PAYABLE', 'PHP', 'Amounts payable to vehicle owners'),
  (gen_random_uuid(), 'PLATFORM_COMMISSION', 'PLATFORM_COMMISSION_REVENUE', 'PHP', 'Platform commission revenue'),
  (gen_random_uuid(), 'REFUND_PAYABLE', 'REFUND_PAYABLE', 'PHP', 'Approved customer refunds payable')
ON CONFLICT ("code", "currency") DO NOTHING;

INSERT INTO "commission_rules" (
  "id", "scope", "version", "rate_basis_points", "fixed_amount_minor", "currency",
  "calculation_version", "effective_from", "reason"
) VALUES (
  '00000000-0000-4000-8000-000000001500', 'PLATFORM_DEFAULT', 1, 1500, 0, 'PHP',
  'COMMISSION_BPS_V1', '2026-01-01T00:00:00Z', 'Configurable MVP platform default seed'
) ON CONFLICT DO NOTHING;

-- Terminal operation evidence and posted accounting records cannot be rewritten.
CREATE OR REPLACE FUNCTION "protect_terminal_payment_operation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."status" IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'terminal payment operations are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_operations_terminal_immutable"
  BEFORE UPDATE OR DELETE ON "payment_operations"
  FOR EACH ROW EXECUTE FUNCTION "protect_terminal_payment_operation"();

CREATE TRIGGER "commission_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "commission_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "ledger_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE OR REPLACE FUNCTION "protect_owner_earning_amounts"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
     to_jsonb(NEW) - 'status' <> to_jsonb(OLD) - 'status' THEN
    RAISE EXCEPTION 'owner earning financial evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "owner_earnings_amounts_immutable"
  BEFORE UPDATE OR DELETE ON "owner_earnings"
  FOR EACH ROW EXECUTE FUNCTION "protect_owner_earning_amounts"();

CREATE OR REPLACE FUNCTION "protect_commission_rule_version"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR
     to_jsonb(NEW) - 'disabled_at' <> to_jsonb(OLD) - 'disabled_at' THEN
    RAISE EXCEPTION 'commission rule versions are immutable except for disabling';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "commission_rules_version_immutable"
  BEFORE UPDATE OR DELETE ON "commission_rules"
  FOR EACH ROW EXECUTE FUNCTION "protect_commission_rule_version"();

-- Deferred balance validation allows entries to be inserted one-by-one inside one transaction.
CREATE OR REPLACE FUNCTION "assert_ledger_transaction_balanced"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_id UUID;
  transaction_currency CHAR(3);
  entry_count INTEGER;
  entry_total BIGINT;
  mismatched INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    target_id := NEW."id";
  ELSE
    target_id := NEW."transaction_id";
  END IF;
  SELECT "currency" INTO transaction_currency FROM "ledger_transactions" WHERE "id" = target_id;
  SELECT COUNT(*), COALESCE(SUM(e."amount_minor"), 0),
         COUNT(*) FILTER (WHERE e."currency" <> transaction_currency OR a."currency" <> transaction_currency)
    INTO entry_count, entry_total, mismatched
    FROM "ledger_entries" e
    JOIN "financial_accounts" a ON a."id" = e."account_id"
    WHERE e."transaction_id" = target_id;
  IF entry_count < 2 OR entry_total <> 0 OR mismatched <> 0 THEN
    RAISE EXCEPTION 'ledger transaction must have at least two balanced same-currency entries';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ledger_transaction_balance_from_transaction"
  AFTER INSERT ON "ledger_transactions" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_ledger_transaction_balanced"();
CREATE CONSTRAINT TRIGGER "ledger_transaction_balance_from_entries"
  AFTER INSERT ON "ledger_entries" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "assert_ledger_transaction_balanced"();

-- Serialize refund reservations on the payment row and cap all in-flight plus completed refunds.
CREATE OR REPLACE FUNCTION "enforce_refund_limit"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  captured BIGINT;
  payment_currency CHAR(3);
  reserved BIGINT;
BEGIN
  SELECT "captured_amount_minor", "currency" INTO captured, payment_currency
    FROM "payments" WHERE "id" = NEW."payment_id" FOR UPDATE;
  SELECT COALESCE(SUM("amount_minor"), 0) INTO reserved
    FROM "refunds"
    WHERE "payment_id" = NEW."payment_id"
      AND "status" IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED')
      AND "id" <> NEW."id";
  IF NEW."currency" <> payment_currency OR reserved + NEW."amount_minor" > captured THEN
    RAISE EXCEPTION 'refund total exceeds captured payment or currency differs';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "refunds_limit_before_write"
  BEFORE INSERT OR UPDATE OF "amount_minor", "currency", "status" ON "refunds"
  FOR EACH ROW WHEN (NEW."status" IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED'))
  EXECUTE FUNCTION "enforce_refund_limit"();

-- Booking transitions create recoverable financial work in the same transaction.
CREATE OR REPLACE FUNCTION "schedule_booking_payment_operation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_payment "payments"%ROWTYPE;
  operation_type "PaymentOperationType";
  operation_key TEXT;
  event_type TEXT;
BEGIN
  IF NEW."status" = 'CAPTURE_PENDING' AND OLD."status" = 'AWAITING_OWNER' THEN
    SELECT * INTO target_payment FROM "payments"
      WHERE "booking_id" = NEW."id" AND "purpose" = 'RENTAL' FOR UPDATE;
    IF NOT FOUND OR target_payment."status" <> 'AUTHORIZED' THEN
      RAISE EXCEPTION 'capture requires an authorized rental payment';
    END IF;
    UPDATE "payments" SET "status" = 'CAPTURING', "reconciliation_required" = false,
      "updated_at" = clock_timestamp() WHERE "id" = target_payment."id";
    operation_type := 'CAPTURE';
    operation_key := 'booking:' || NEW."id" || ':capture:v1';
    event_type := 'PAYMENT_CAPTURE_REQUESTED';
  ELSIF NEW."status" IN ('CANCELLED', 'EXPIRED') AND OLD."status" <> NEW."status" THEN
    SELECT * INTO target_payment FROM "payments"
      WHERE "booking_id" = NEW."id" AND "purpose" = 'RENTAL' AND "status" = 'AUTHORIZED'
      FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    UPDATE "payments" SET "status" = 'VOID_PENDING', "reconciliation_required" = true,
      "reconcile_after" = clock_timestamp(), "updated_at" = clock_timestamp()
      WHERE "id" = target_payment."id";
    operation_type := 'VOID';
    operation_key := 'booking:' || NEW."id" || ':void:v1';
    event_type := 'PAYMENT_VOID_REQUESTED';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO "payment_operations" (
    "id", "payment_id", "type", "status", "idempotency_key",
    "provider_request_reference", "amount_minor", "currency", "updated_at"
  ) VALUES (
    gen_random_uuid(), target_payment."id", operation_type, 'PENDING', operation_key,
    gen_random_uuid()::text, target_payment."amount_minor", target_payment."currency", clock_timestamp()
  ) ON CONFLICT ("idempotency_key") DO NOTHING;
  INSERT INTO "outbox_events" (
    "id", "aggregate_type", "aggregate_id", "event_type", "payload"
  ) VALUES (
    gen_random_uuid(), 'PAYMENT', target_payment."id", event_type,
    jsonb_build_object('paymentId', target_payment."id", 'bookingId', NEW."id")
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "bookings_schedule_payment_operation"
  AFTER UPDATE OF "status" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "schedule_booking_payment_operation"();
