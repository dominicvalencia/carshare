-- Task 18C-4A: represent an accepted amendment that requires no renter payment
-- while the complete application workflow remains pending.
ALTER TYPE "BookingAmendmentStatus" ADD VALUE 'OWNER_ACCEPTED_PROCESSING' AFTER 'PENDING_OWNER';

-- OWNER_ACCEPTED_PROCESSING is unresolved and must continue to prevent a
-- second concurrent amendment for the same booking.
DROP INDEX "booking_amendments_one_unresolved_per_booking_idx";
CREATE UNIQUE INDEX "booking_amendments_one_unresolved_per_booking_idx"
ON "booking_amendments"("booking_id")
WHERE "status" IN (
  'PENDING_OWNER',
  'OWNER_ACCEPTED_PROCESSING',
  'OWNER_ACCEPTED_PAYMENT_PENDING'
);
