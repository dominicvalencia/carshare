CREATE TYPE "VehicleRemovalReason" AS ENUM (
  'SOLD_VEHICLE',
  'NO_LONGER_RENTING',
  'VEHICLE_UNAVAILABLE',
  'MAINTENANCE_OR_REPAIRS',
  'REPLACING_VEHICLE',
  'CARSHARE_EXPERIENCE',
  'OTHER'
);

ALTER TABLE "vehicles"
  ADD COLUMN "archived_by_user_id" UUID,
  ADD COLUMN "removal_reason" "VehicleRemovalReason",
  ADD COLUMN "removal_other_reason" VARCHAR(500);

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_archived_by_user_id_fkey"
  FOREIGN KEY ("archived_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_removal_other_reason_consistency_check"
  CHECK (
    "removal_other_reason" IS NULL
    OR "removal_reason" = 'OTHER'
  );

CREATE INDEX "vehicles_removal_reason_archived_at_idx"
  ON "vehicles"("removal_reason", "archived_at");
