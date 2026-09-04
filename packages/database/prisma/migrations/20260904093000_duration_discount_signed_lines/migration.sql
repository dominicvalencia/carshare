ALTER TABLE "pricing_quote_lines"
  DROP CONSTRAINT "pricing_quote_lines_values_check",
  ADD CONSTRAINT "pricing_quote_lines_values_check" CHECK (
    "quantity" > 0
    AND "amount_minor" = "quantity" * "unit_amount_minor"
    AND (
      ("code" = 'DURATION_DISCOUNT' AND "unit_amount_minor" <= 0 AND "amount_minor" <= 0)
      OR
      ("code" <> 'DURATION_DISCOUNT' AND "unit_amount_minor" >= 0 AND "amount_minor" >= 0)
    )
  );

ALTER TABLE "booking_pricing_snapshot_lines"
  DROP CONSTRAINT "booking_pricing_snapshot_lines_values_check",
  ADD CONSTRAINT "booking_pricing_snapshot_lines_values_check" CHECK (
    "quantity" > 0
    AND "amount_minor" = "quantity" * "unit_amount_minor"
    AND (
      ("code" = 'DURATION_DISCOUNT' AND "unit_amount_minor" <= 0 AND "amount_minor" <= 0)
      OR
      ("code" <> 'DURATION_DISCOUNT' AND "unit_amount_minor" >= 0 AND "amount_minor" >= 0)
    )
  );
