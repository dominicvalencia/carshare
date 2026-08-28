DROP INDEX IF EXISTS "inspections_one_finalized_type_per_booking_idx";

CREATE UNIQUE INDEX "inspections_one_finalized_participant_type_per_booking_idx"
ON "inspections"("booking_id", "type", "submitted_by_user_id")
WHERE "status" = 'FINALIZED';
