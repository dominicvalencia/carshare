-- CreateEnum
CREATE TYPE "PayoutProviderCode" AS ENUM ('XENDIT', 'FAKE');

-- CreateEnum
CREATE TYPE "PayoutDestinationType" AS ENUM ('BANK_ACCOUNT', 'E_WALLET');

-- CreateEnum
CREATE TYPE "PayoutAccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'REQUIRES_ACTION', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PayoutEligibilityStatus" AS ENUM ('NOT_READY', 'PENDING', 'ELIGIBLE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SUBMITTING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PayoutOperationType" AS ENUM ('CREATE', 'APPROVE', 'SUBMIT', 'RETRIEVE', 'RECONCILE', 'CANCEL', 'FINALIZE', 'REVERSE');

-- CreateEnum
CREATE TYPE "PayoutOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PayoutFailureCategory" AS ENUM ('RETRYABLE', 'INVALID_DESTINATION', 'ACCOUNT_CLOSED', 'PROVIDER_TEMPORARY', 'COMPLIANCE_REJECTED', 'LIMIT_EXCEEDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PayoutWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "PayoutFeePolicy" AS ENUM ('PLATFORM_FUNDED', 'OWNER_FUNDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinancialAccountType" ADD VALUE 'PAYOUT_PROVIDER_CLEARING';
ALTER TYPE "FinancialAccountType" ADD VALUE 'PAYOUT_CASH';
ALTER TYPE "FinancialAccountType" ADD VALUE 'PAYOUT_PROVIDER_FEE_EXPENSE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerTransactionType" ADD VALUE 'PAYOUT_SUBMISSION';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'PAYOUT_SETTLEMENT';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'PAYOUT_FAILURE_REVERSAL';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'PAYOUT_REVERSAL';
ALTER TYPE "LedgerTransactionType" ADD VALUE 'PAYOUT_PROVIDER_FEE';

-- CreateTable
CREATE TABLE "payout_eligibilities" (
    "id" UUID NOT NULL,
    "owner_profile_id" UUID NOT NULL,
    "status" "PayoutEligibilityStatus" NOT NULL DEFAULT 'NOT_READY',
    "reason" VARCHAR(1000),
    "requirements" JSONB,
    "last_evaluated_at" TIMESTAMPTZ(3),
    "changed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_payout_accounts" (
    "id" UUID NOT NULL,
    "owner_profile_id" UUID NOT NULL,
    "type" "PayoutDestinationType" NOT NULL,
    "provider" "PayoutProviderCode" NOT NULL,
    "destination_channel" VARCHAR(100) NOT NULL,
    "account_holder_name" VARCHAR(255) NOT NULL,
    "masked_account_identifier" VARCHAR(64) NOT NULL,
    "identifier_fingerprint" CHAR(64) NOT NULL,
    "encrypted_account_identifier" TEXT NOT NULL,
    "encryption_iv" VARCHAR(64) NOT NULL,
    "encryption_auth_tag" VARCHAR(64) NOT NULL,
    "encryption_key_version" INTEGER NOT NULL DEFAULT 1,
    "country" CHAR(2) NOT NULL DEFAULT 'PH',
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "validation_level" VARCHAR(100),
    "safe_validation_reference" VARCHAR(255),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "owner_payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(32) NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "note" VARCHAR(1000),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "public_reference" VARCHAR(32) NOT NULL,
    "batch_id" UUID NOT NULL,
    "owner_profile_id" UUID NOT NULL,
    "payout_account_id" UUID NOT NULL,
    "provider" "PayoutProviderCode" NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "amount_minor" BIGINT NOT NULL,
    "gross_earning_minor" BIGINT NOT NULL,
    "adjustment_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "withholding_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "provider_fee_amount_minor" BIGINT NOT NULL DEFAULT 0,
    "fee_policy" "PayoutFeePolicy" NOT NULL DEFAULT 'PLATFORM_FUNDED',
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "destination_type" "PayoutDestinationType" NOT NULL,
    "destination_channel" VARCHAR(100) NOT NULL,
    "destination_masked" VARCHAR(64) NOT NULL,
    "destination_account_holder" VARCHAR(255) NOT NULL,
    "destination_country" CHAR(2) NOT NULL DEFAULT 'PH',
    "destination_currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "provider_payout_id" VARCHAR(255),
    "provider_state" VARCHAR(100),
    "failure_category" "PayoutFailureCategory",
    "safe_failure_code" VARCHAR(100),
    "safe_failure_message" VARCHAR(500),
    "reconciliation_required" BOOLEAN NOT NULL DEFAULT false,
    "reconcile_after" TIMESTAMPTZ(3),
    "last_provider_retrieved_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "approval_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_items" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "owner_earning_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "active_allocation" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_operations" (
    "id" UUID NOT NULL,
    "payout_id" UUID NOT NULL,
    "type" "PayoutOperationType" NOT NULL,
    "status" "PayoutOperationStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "provider_request_reference" VARCHAR(100),
    "provider_operation_reference" VARCHAR(255),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" "PayoutFailureCategory",
    "safe_failure_code" VARCHAR(100),
    "safe_failure_message" VARCHAR(500),
    "safe_provider_metadata" JSONB,
    "actor_user_id" UUID,
    "correlation_id" VARCHAR(100),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payout_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_webhook_events" (
    "id" UUID NOT NULL,
    "payout_id" UUID,
    "provider" "PayoutProviderCode" NOT NULL,
    "external_event_id" CHAR(64) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "provider_payout_id" VARCHAR(255) NOT NULL,
    "status" "PayoutWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload_digest" CHAR(64) NOT NULL,
    "redacted_payload" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" VARCHAR(500),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_eligibilities_owner_profile_id_key" ON "payout_eligibilities"("owner_profile_id");

-- CreateIndex
CREATE INDEX "payout_eligibilities_status_updated_at_idx" ON "payout_eligibilities"("status", "updated_at");

-- CreateIndex
CREATE INDEX "owner_payout_accounts_owner_profile_id_status_created_at_idx" ON "owner_payout_accounts"("owner_profile_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "owner_payout_accounts_owner_profile_id_provider_destination_key" ON "owner_payout_accounts"("owner_profile_id", "provider", "destination_channel", "identifier_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "payout_batches_public_reference_key" ON "payout_batches"("public_reference");

-- CreateIndex
CREATE INDEX "payout_batches_status_created_at_idx" ON "payout_batches"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_public_reference_key" ON "payouts"("public_reference");

-- CreateIndex
CREATE INDEX "payouts_owner_profile_id_status_created_at_idx" ON "payouts"("owner_profile_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_reconciliation_required_reconcile_after_idx" ON "payouts"("status", "reconciliation_required", "reconcile_after");

-- CreateIndex
CREATE INDEX "payouts_batch_id_status_idx" ON "payouts"("batch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_provider_provider_payout_id_key" ON "payouts"("provider", "provider_payout_id");

-- CreateIndex
CREATE INDEX "payout_items_owner_earning_id_active_allocation_idx" ON "payout_items"("owner_earning_id", "active_allocation");

-- CreateIndex
CREATE UNIQUE INDEX "payout_items_payout_id_owner_earning_id_key" ON "payout_items"("payout_id", "owner_earning_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_operations_idempotency_key_key" ON "payout_operations"("idempotency_key");

-- CreateIndex
CREATE INDEX "payout_operations_payout_id_created_at_idx" ON "payout_operations"("payout_id", "created_at");

-- CreateIndex
CREATE INDEX "payout_operations_status_created_at_idx" ON "payout_operations"("status", "created_at");

-- CreateIndex
CREATE INDEX "payout_webhook_events_status_received_at_idx" ON "payout_webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "payout_webhook_events_provider_provider_payout_id_idx" ON "payout_webhook_events"("provider", "provider_payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_webhook_events_provider_external_event_id_key" ON "payout_webhook_events"("provider", "external_event_id");

-- AddForeignKey
ALTER TABLE "payout_eligibilities" ADD CONSTRAINT "payout_eligibilities_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_eligibilities" ADD CONSTRAINT "payout_eligibilities_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_payout_accounts" ADD CONSTRAINT "owner_payout_accounts_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_payout_accounts" ADD CONSTRAINT "owner_payout_accounts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_payout_account_id_fkey" FOREIGN KEY ("payout_account_id") REFERENCES "owner_payout_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_items" ADD CONSTRAINT "payout_items_owner_earning_id_fkey" FOREIGN KEY ("owner_earning_id") REFERENCES "owner_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_operations" ADD CONSTRAINT "payout_operations_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_operations" ADD CONSTRAINT "payout_operations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_webhook_events" ADD CONSTRAINT "payout_webhook_events_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
