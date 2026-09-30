ALTER TYPE "BookingAmendmentStatus" ADD VALUE 'FINANCIAL_RECOVERY_PENDING';

CREATE TYPE "AmendmentRefundEvidenceType" AS ENUM (
  'PROVIDER_RESPONSE',
  'PROVIDER_SUPPORT_CONFIRMATION',
  'PROVIDER_SETTLEMENT_EXPORT',
  'MANUAL_REVIEW'
);

CREATE TYPE "AmendmentRefundEvidenceOutcome" AS ENUM (
  'SUCCEEDED',
  'DEFINITIVE_FAILURE',
  'UNRESOLVED'
);

ALTER TABLE "booking_amendments"
  ADD COLUMN "operationally_expired_at" TIMESTAMPTZ(3);

CREATE TABLE "booking_amendment_refund_resolution_evidence" (
  "id" UUID NOT NULL,
  "amendment_settlement_id" UUID NOT NULL,
  "provider" "PaymentProviderCode" NOT NULL,
  "external_reference" VARCHAR(255) NOT NULL,
  "evidence_type" "AmendmentRefundEvidenceType" NOT NULL,
  "evidence_at" TIMESTAMPTZ(3) NOT NULL,
  "resolved_amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "actor_type" "BookingActorType" NOT NULL,
  "actor_user_id" UUID,
  "resolution_note" VARCHAR(1000) NOT NULL,
  "outcome" "AmendmentRefundEvidenceOutcome" NOT NULL,
  "evidence_hash" CHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_amendment_refund_resolution_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_amendment_refund_resolution_evidence_settlement_fkey"
    FOREIGN KEY ("amendment_settlement_id")
    REFERENCES "booking_amendment_settlements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "booking_amendment_refund_resolution_evidence_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "booking_amendment_refund_resolution_evidence_amount_check"
    CHECK ("resolved_amount_minor" >= 0),
  CONSTRAINT "booking_amendment_refund_resolution_evidence_note_check"
    CHECK (length(trim("resolution_note")) > 0)
);

CREATE UNIQUE INDEX "booking_amendment_refund_resolution_evidence_idempotency_key_key"
  ON "booking_amendment_refund_resolution_evidence"("idempotency_key");
CREATE INDEX "booking_amendment_refund_resolution_evidence_settlement_evidence_idx"
  ON "booking_amendment_refund_resolution_evidence"("amendment_settlement_id", "evidence_at");
CREATE INDEX "booking_amendment_refund_resolution_evidence_provider_reference_idx"
  ON "booking_amendment_refund_resolution_evidence"("provider", "external_reference");
