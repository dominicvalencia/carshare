DROP INDEX IF EXISTS "pickup_discrepancy_responses_original_confirmation_id_key";
DROP INDEX IF EXISTS "pickup_discrepancy_responses_incident_id_key";

ALTER TABLE "pickup_discrepancy_responses"
  ADD COLUMN IF NOT EXISTS "round_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "previous_response_id" UUID;
ALTER TABLE "pickup_discrepancy_responses" ALTER COLUMN "round_number" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "pickup_discrepancy_responses_incident_round_key"
  ON "pickup_discrepancy_responses"("incident_id", "round_number");
CREATE UNIQUE INDEX IF NOT EXISTS "pickup_discrepancy_responses_incident_previous_key"
  ON "pickup_discrepancy_responses"("incident_id", "previous_response_id");
CREATE INDEX IF NOT EXISTS "pickup_discrepancy_responses_confirmation_round_idx"
  ON "pickup_discrepancy_responses"("original_confirmation_id", "round_number");
ALTER TABLE "pickup_discrepancy_responses"
  ADD CONSTRAINT "pickup_discrepancy_responses_previous_response_id_fkey"
  FOREIGN KEY ("previous_response_id") REFERENCES "pickup_discrepancy_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "booking_cancellation_settlements" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "booking_cancellation_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "commission_snapshot_id" UUID NOT NULL,
  "refund_id" UUID,
  "rental_component_minor" BIGINT NOT NULL,
  "commission_retained_minor" BIGINT NOT NULL,
  "delivery_fee_minor" BIGINT NOT NULL,
  "delivery_retained_minor" BIGINT NOT NULL,
  "delivery_refunded_minor" BIGINT NOT NULL,
  "collection_fee_minor" BIGINT NOT NULL,
  "collection_refunded_minor" BIGINT NOT NULL,
  "captured_amount_minor" BIGINT NOT NULL,
  "refund_amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "delivery_completed" BOOLEAN NOT NULL,
  "delivery_completion_basis" VARCHAR(100) NOT NULL,
  "calculation_version" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_cancellation_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_cancellation_settlements_amounts_check" CHECK (
    "rental_component_minor" >= 0 AND "commission_retained_minor" >= 0 AND
    "delivery_fee_minor" >= 0 AND "delivery_retained_minor" >= 0 AND
    "delivery_refunded_minor" >= 0 AND "collection_fee_minor" >= 0 AND
    "collection_refunded_minor" >= 0 AND "captured_amount_minor" >= 0 AND
    "refund_amount_minor" >= 0 AND
    "commission_retained_minor" <= "rental_component_minor" AND
    "delivery_retained_minor" + "delivery_refunded_minor" = "delivery_fee_minor" AND
    "collection_refunded_minor" = "collection_fee_minor" AND
    "refund_amount_minor" + "commission_retained_minor" + "delivery_retained_minor" = "captured_amount_minor"
  )
);
CREATE UNIQUE INDEX "booking_cancellation_settlements_booking_id_key" ON "booking_cancellation_settlements"("booking_id");
CREATE UNIQUE INDEX "booking_cancellation_settlements_cancellation_id_key" ON "booking_cancellation_settlements"("booking_cancellation_id");
CREATE UNIQUE INDEX "booking_cancellation_settlements_payment_id_key" ON "booking_cancellation_settlements"("payment_id");
CREATE UNIQUE INDEX "booking_cancellation_settlements_commission_id_key" ON "booking_cancellation_settlements"("commission_snapshot_id");
CREATE UNIQUE INDEX "booking_cancellation_settlements_refund_id_key" ON "booking_cancellation_settlements"("refund_id");
CREATE INDEX "booking_cancellation_settlements_created_at_idx" ON "booking_cancellation_settlements"("created_at");
ALTER TABLE "booking_cancellation_settlements" ADD CONSTRAINT "booking_cancellation_settlements_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellation_settlements" ADD CONSTRAINT "booking_cancellation_settlements_cancellation_id_fkey" FOREIGN KEY ("booking_cancellation_id") REFERENCES "booking_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellation_settlements" ADD CONSTRAINT "booking_cancellation_settlements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellation_settlements" ADD CONSTRAINT "booking_cancellation_settlements_commission_id_fkey" FOREIGN KEY ("commission_snapshot_id") REFERENCES "commission_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_cancellation_settlements" ADD CONSTRAINT "booking_cancellation_settlements_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "booking_cancellation_settlements_immutable"
  BEFORE UPDATE OR DELETE ON "booking_cancellation_settlements"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
