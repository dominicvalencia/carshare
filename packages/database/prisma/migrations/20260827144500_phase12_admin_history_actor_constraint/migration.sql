ALTER TABLE "booking_status_history"
DROP CONSTRAINT "booking_status_history_actor_check";

ALTER TABLE "booking_status_history"
ADD CONSTRAINT "booking_status_history_actor_check" CHECK (
  ("actor_type" IN ('USER', 'ADMIN') AND "actor_user_id" IS NOT NULL) OR
  ("actor_type" IN ('SYSTEM', 'WORKER') AND "actor_user_id" IS NULL)
);
