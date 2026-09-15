CREATE TYPE "PickupHandoverOperationsOutcome" AS ENUM (
  'HANDOVER_MAY_RESUME',
  'BOOKING_CANCELLATION_REQUIRED',
  'MAINTENANCE_REQUIRED',
  'SUPPORT_FOLLOW_UP_REQUIRED'
);

CREATE TABLE "pickup_handover_operations_resolutions" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "dispute_id" UUID,
  "discrepancy_resolution_review_id" UUID,
  "outcome" "PickupHandoverOperationsOutcome" NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "resolved_by_user_id" UUID NOT NULL,
  "resolved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pickup_handover_operations_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pickup_handover_operations_resolutions_incident_id_key"
  ON "pickup_handover_operations_resolutions"("incident_id");
CREATE UNIQUE INDEX "pickup_handover_operations_resolutions_dispute_id_key"
  ON "pickup_handover_operations_resolutions"("dispute_id");
CREATE UNIQUE INDEX "pickup_handover_operations_resolutions_review_id_key"
  ON "pickup_handover_operations_resolutions"("discrepancy_resolution_review_id");
CREATE INDEX "pickup_handover_operations_resolutions_booking_resolved_at_idx"
  ON "pickup_handover_operations_resolutions"("booking_id", "resolved_at");
CREATE INDEX "pickup_handover_operations_resolutions_outcome_resolved_at_idx"
  ON "pickup_handover_operations_resolutions"("outcome", "resolved_at");
CREATE INDEX "pickup_handover_operations_resolutions_actor_resolved_at_idx"
  ON "pickup_handover_operations_resolutions"("resolved_by_user_id", "resolved_at");

ALTER TABLE "pickup_handover_operations_resolutions"
  ADD CONSTRAINT "pickup_handover_operations_resolutions_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_handover_operations_resolutions"
  ADD CONSTRAINT "pickup_handover_operations_resolutions_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "rental_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_handover_operations_resolutions"
  ADD CONSTRAINT "pickup_handover_operations_resolutions_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_handover_operations_resolutions"
  ADD CONSTRAINT "pickup_handover_operations_resolutions_review_id_fkey"
  FOREIGN KEY ("discrepancy_resolution_review_id") REFERENCES "pickup_discrepancy_resolution_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_handover_operations_resolutions"
  ADD CONSTRAINT "pickup_handover_operations_resolutions_actor_id_fkey"
  FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_pickup_handover_operations_resolution_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Pickup handover Operations resolutions are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pickup_handover_operations_resolutions_immutable
BEFORE UPDATE OR DELETE ON "pickup_handover_operations_resolutions"
FOR EACH ROW EXECUTE FUNCTION prevent_pickup_handover_operations_resolution_mutation();
