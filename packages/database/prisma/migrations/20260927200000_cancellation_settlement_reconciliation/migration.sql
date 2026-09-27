-- Migration 64: align cancellation settlement reconciliation with the accepted
-- policy's mutually exclusive refundable, non-refundable, and fee components.
ALTER TABLE "booking_cancellation_settlements"
  DROP CONSTRAINT "booking_cancellation_settlements_policy_amounts_check";

ALTER TABLE "booking_cancellation_settlements"
  ADD CONSTRAINT "booking_cancellation_settlements_policy_amounts_check" CHECK (
    "cancellation_fee_minor" >= 0 AND "refundable_rental_minor" >= 0 AND
    "non_refundable_rental_minor" >= 0 AND "owner_earning_forfeited_minor" >= 0 AND
    (
      "policy_code" = 'LEGACY_UNSPECIFIED' OR
      (
        "confirmed_at" IS NOT NULL AND "scheduled_pickup_at" IS NOT NULL AND
        "evaluated_at" IS NOT NULL AND
        "refundable_rental_minor" + "non_refundable_rental_minor" +
          "cancellation_fee_minor" = "rental_component_minor" AND
        "cancellation_fee_minor" <= "rental_component_minor"
      )
    )
  );
