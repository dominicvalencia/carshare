-- Phase 13C-2K-B4: append-only Owner Delivery and Owner Collection travel progress.
CREATE TYPE "HandoverPhase" AS ENUM ('START', 'RETURN');
CREATE TYPE "HandoverTravelStatus" AS ENUM ('PREPARING', 'ON_THE_WAY', 'ARRIVED');

CREATE TABLE "booking_handover_travel_events" (
  "id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "phase" "HandoverPhase" NOT NULL,
  "status" "HandoverTravelStatus" NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_handover_travel_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_handover_travel_events_booking_id_phase_status_key"
    UNIQUE ("booking_id", "phase", "status")
);

CREATE INDEX "booking_handover_travel_events_booking_id_phase_occurred_at_idx"
  ON "booking_handover_travel_events"("booking_id", "phase", "occurred_at");
CREATE INDEX "booking_handover_travel_events_actor_user_id_occurred_at_idx"
  ON "booking_handover_travel_events"("actor_user_id", "occurred_at");

ALTER TABLE "booking_handover_travel_events"
  ADD CONSTRAINT "booking_handover_travel_events_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_handover_travel_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "booking_handover_travel_events_append_only"
  BEFORE UPDATE OR DELETE ON "booking_handover_travel_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
