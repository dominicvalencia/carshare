CREATE TYPE "PaymentOperationEvidenceSource" AS ENUM (
  'SYNCHRONOUS_RESPONSE',
  'RETRIEVAL',
  'WEBHOOK',
  'REQUEST_REFERENCE_LOOKUP',
  'ADMIN_EVIDENCE'
);

CREATE TYPE "PaymentEvidenceAttribution" AS ENUM (
  'EXACT',
  'UNAMBIGUOUS_AGGREGATE',
  'AMBIGUOUS',
  'CONFLICTING',
  'INSUFFICIENT'
);

ALTER TABLE "payment_operations"
  ADD COLUMN "last_reconciled_at" TIMESTAMPTZ(3),
  ADD COLUMN "next_reconcile_at" TIMESTAMPTZ(3),
  ADD COLUMN "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliation_reason" VARCHAR(1000),
  ADD COLUMN "manual_review_required_at" TIMESTAMPTZ(3);

ALTER TABLE "payment_webhook_events"
  ADD COLUMN "mapped_at" TIMESTAMPTZ(3),
  ADD COLUMN "next_remap_at" TIMESTAMPTZ(3),
  ADD COLUMN "remap_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "permanently_unmappable_at" TIMESTAMPTZ(3);

CREATE TABLE "payment_operation_evidence" (
  "id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "payment_operation_id" UUID,
  "webhook_event_id" UUID,
  "source" "PaymentOperationEvidenceSource" NOT NULL,
  "attribution" "PaymentEvidenceAttribution" NOT NULL,
  "provider_payment_id" VARCHAR(255),
  "provider_operation_id" VARCHAR(255),
  "request_reference" VARCHAR(100),
  "provider_status" VARCHAR(100) NOT NULL,
  "amount_minor" BIGINT,
  "currency" CHAR(3),
  "provider_occurred_at" TIMESTAMPTZ(3),
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidence_key" VARCHAR(200) NOT NULL,
  "sanitized_metadata" JSONB,
  "reason" VARCHAR(1000),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_operation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_operation_evidence_amount_nonnegative" CHECK (
    "amount_minor" IS NULL OR "amount_minor" >= 0
  )
);

CREATE UNIQUE INDEX "payment_operation_evidence_payment_id_evidence_key_key"
  ON "payment_operation_evidence"("payment_id", "evidence_key");
CREATE INDEX "payment_operation_evidence_payment_operation_id_created_at_idx"
  ON "payment_operation_evidence"("payment_operation_id", "created_at");
CREATE INDEX "payment_operation_evidence_payment_id_attribution_created_at_idx"
  ON "payment_operation_evidence"("payment_id", "attribution", "created_at");
CREATE INDEX "payment_operation_evidence_provider_payment_id_created_at_idx"
  ON "payment_operation_evidence"("provider_payment_id", "created_at");
CREATE INDEX "payment_operations_status_next_reconcile_at_idx"
  ON "payment_operations"("status", "next_reconcile_at");
CREATE INDEX "payment_webhook_events_payment_id_permanently_unmappable_at_next_remap_at_idx"
  ON "payment_webhook_events"("payment_id", "permanently_unmappable_at", "next_remap_at");

ALTER TABLE "payment_operation_evidence"
  ADD CONSTRAINT "payment_operation_evidence_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_operation_evidence"
  ADD CONSTRAINT "payment_operation_evidence_payment_operation_id_fkey"
  FOREIGN KEY ("payment_operation_id") REFERENCES "payment_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_operation_evidence"
  ADD CONSTRAINT "payment_operation_evidence_webhook_event_id_fkey"
  FOREIGN KEY ("webhook_event_id") REFERENCES "payment_webhook_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_operation_evidence"
  ADD CONSTRAINT "payment_operation_evidence_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
