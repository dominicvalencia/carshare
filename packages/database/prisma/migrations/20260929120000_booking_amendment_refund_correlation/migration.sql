ALTER TABLE "booking_amendment_settlements"
  ADD CONSTRAINT "booking_amendment_settlements_refund_id_fkey"
  FOREIGN KEY ("refund_id") REFERENCES "refunds"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
