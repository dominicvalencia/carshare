ALTER TABLE "refunds"
  ADD COLUMN "amendment_settlement_id" UUID,
  ADD COLUMN "amendment_allocation_index" INTEGER;

ALTER TABLE "booking_amendment_refund_resolution_evidence"
  ADD COLUMN "refund_id" UUID;

UPDATE "refunds" AS refund
SET
  "amendment_settlement_id" = settlement."id",
  "amendment_allocation_index" = 0
FROM "booking_amendment_settlements" AS settlement
WHERE settlement."refund_id" = refund."id";

UPDATE "booking_amendment_refund_resolution_evidence" AS evidence
SET "refund_id" = settlement."refund_id"
FROM "booking_amendment_settlements" AS settlement
WHERE evidence."amendment_settlement_id" = settlement."id"
  AND settlement."refund_id" IS NOT NULL;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amendment_settlement_id_fkey"
  FOREIGN KEY ("amendment_settlement_id")
  REFERENCES "booking_amendment_settlements"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE UNIQUE INDEX "refunds_amendment_settlement_id_amendment_allocation_index_key"
  ON "refunds"("amendment_settlement_id", "amendment_allocation_index");

CREATE UNIQUE INDEX "refunds_amendment_settlement_id_payment_id_key"
  ON "refunds"("amendment_settlement_id", "payment_id");

CREATE INDEX "refunds_amendment_settlement_id_idx"
  ON "refunds"("amendment_settlement_id");

ALTER TABLE "booking_amendment_refund_resolution_evidence"
  ADD CONSTRAINT "booking_amendment_refund_resolution_evidence_refund_id_fkey"
  FOREIGN KEY ("refund_id")
  REFERENCES "refunds"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "booking_amendment_refund_resolution_evidence_refund_id_evidence_at_idx"
  ON "booking_amendment_refund_resolution_evidence"("refund_id", "evidence_at");
