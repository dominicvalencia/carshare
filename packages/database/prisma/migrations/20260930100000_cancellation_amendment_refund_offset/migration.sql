-- Migration 72: preserve cancellation settlement conservation when value is
-- already committed to a surviving booking-amendment refund obligation.
ALTER TABLE "booking_cancellation_settlements"
  ADD COLUMN "amendment_refund_obligation_offset_minor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "booking_cancellation_settlements"
  DROP CONSTRAINT "booking_cancellation_settlements_amounts_check";

ALTER TABLE "booking_cancellation_settlements"
  ADD CONSTRAINT "booking_cancellation_settlements_amounts_check" CHECK (
    "rental_component_minor" >= 0 AND "commission_retained_minor" >= 0 AND
    "delivery_fee_minor" >= 0 AND "delivery_retained_minor" >= 0 AND
    "delivery_refunded_minor" >= 0 AND "collection_fee_minor" >= 0 AND
    "collection_refunded_minor" >= 0 AND "captured_amount_minor" >= 0 AND
    "refund_amount_minor" >= 0 AND "amendment_refund_obligation_offset_minor" >= 0 AND
    "commission_retained_minor" <= "rental_component_minor" AND
    "delivery_retained_minor" + "delivery_refunded_minor" = "delivery_fee_minor" AND
    "collection_refunded_minor" = "collection_fee_minor" AND
    "refund_amount_minor" + "amendment_refund_obligation_offset_minor" +
      "commission_retained_minor" + "delivery_retained_minor" = "captured_amount_minor"
  );
