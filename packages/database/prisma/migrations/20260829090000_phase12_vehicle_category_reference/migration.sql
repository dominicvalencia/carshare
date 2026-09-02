CREATE TYPE "InspectionAmendmentStatus" AS ENUM ('LEGACY_RECORDED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

ALTER TYPE "VehiclePhotoPerspective" ADD VALUE IF NOT EXISTS 'INTERIOR';
ALTER TYPE "VehiclePhotoPerspective" ADD VALUE IF NOT EXISTS 'DASHBOARD';
ALTER TYPE "VehiclePhotoPerspective" ADD VALUE IF NOT EXISTS 'CARGO';
ALTER TYPE "VehiclePhotoPerspective" ADD VALUE IF NOT EXISTS 'ADDITIONAL';
ALTER TYPE "InspectionPerspective" ADD VALUE IF NOT EXISTS 'INTERIOR';
ALTER TYPE "InspectionPerspective" ADD VALUE IF NOT EXISTS 'DASHBOARD';

CREATE TABLE "vehicle_makes" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vehicle_makes_code_key" ON "vehicle_makes"("code");
CREATE UNIQUE INDEX "vehicle_makes_name_key" ON "vehicle_makes"("name");
CREATE INDEX "vehicle_makes_active_sort_order_idx" ON "vehicle_makes"("active", "sort_order");

INSERT INTO "vehicle_makes" ("id", "code", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'TOYOTA', 'Toyota', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HONDA', 'Honda', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MITSUBISHI', 'Mitsubishi', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'NISSAN', 'Nissan', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUZUKI', 'Suzuki', 50, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FORD', 'Ford', 60, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HYUNDAI', 'Hyundai', 70, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'KIA', 'Kia', 80, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ISUZU', 'Isuzu', 90, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MAZDA', 'Mazda', 100, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SUBARU', 'Subaru', 110, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHEVROLET', 'Chevrolet', 120, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MG', 'MG', 130, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GEELY', 'Geely', 140, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BYD', 'BYD', 150, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'CHERY', 'Chery', 160, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GAC', 'GAC', 170, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'JETOUR', 'Jetour', 180, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'JAC', 'JAC', 190, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'FOTON', 'Foton', 200, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VOLKSWAGEN', 'Volkswagen', 210, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BMW', 'BMW', 220, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MERCEDES_BENZ', 'Mercedes-Benz', 230, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'AUDI', 'Audi', 240, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LEXUS', 'Lexus', 250, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'VOLVO', 'Volvo', 260, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PORSCHE', 'Porsche', 270, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TESLA', 'Tesla', 280, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OTHER', 'Other', 999, CURRENT_TIMESTAMP);

INSERT INTO "vehicle_categories" ("id", "code", "name", "active", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'CROSSOVER', 'Crossover', true, 35, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'WAGON', 'Wagon', true, 85, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "active" = true, "updated_at" = CURRENT_TIMESTAMP;

UPDATE "vehicle_categories" SET "name" = 'Pickup Truck', "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'PICKUP';

ALTER TABLE "inspection_amendments"
  ADD COLUMN "reviewed_by_user_id" UUID,
  ADD COLUMN "status" "InspectionAmendmentStatus",
  ADD COLUMN "review_reason" VARCHAR(1000),
  ADD COLUMN "proposed_odometer_meters" BIGINT,
  ADD COLUMN "proposed_fuel_basis_points" INTEGER,
  ADD COLUMN "proposed_battery_soc_basis_points" INTEGER,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3);

UPDATE "inspection_amendments" SET "status" = 'LEGACY_RECORDED' WHERE "status" IS NULL;
ALTER TABLE "inspection_amendments" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
ALTER TABLE "inspection_amendments" ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "inspection_amendments"
  ADD CONSTRAINT "inspection_amendments_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inspection_amendments_proposed_measurement_check" CHECK (
    "status" = 'LEGACY_RECORDED' OR
    "proposed_odometer_meters" IS NOT NULL OR
    "proposed_fuel_basis_points" IS NOT NULL OR
    "proposed_battery_soc_basis_points" IS NOT NULL
  ),
  ADD CONSTRAINT "inspection_amendments_measurement_range_check" CHECK (
    ("proposed_odometer_meters" IS NULL OR "proposed_odometer_meters" >= 0) AND
    ("proposed_fuel_basis_points" IS NULL OR "proposed_fuel_basis_points" BETWEEN 0 AND 10000) AND
    ("proposed_battery_soc_basis_points" IS NULL OR "proposed_battery_soc_basis_points" BETWEEN 0 AND 10000)
  ),
  ADD CONSTRAINT "inspection_amendments_review_state_check" CHECK (
    ("status" = 'LEGACY_RECORDED' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL) OR
    ("status" = 'PENDING_REVIEW' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL) OR
    ("status" IN ('APPROVED', 'REJECTED') AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND "review_reason" IS NOT NULL)
  );

CREATE UNIQUE INDEX "inspection_amendments_one_pending_per_inspection_idx"
  ON "inspection_amendments"("inspection_id") WHERE "status" = 'PENDING_REVIEW';
CREATE INDEX "inspection_amendments_status_created_at_idx" ON "inspection_amendments"("status", "created_at");

CREATE FUNCTION "guard_inspection_amendment_review"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'reviewed inspection amendments are immutable';
  END IF;
  IF NEW."inspection_id" <> OLD."inspection_id"
     OR NEW."created_by_user_id" <> OLD."created_by_user_id"
     OR NEW."reason" <> OLD."reason"
     OR NEW."proposed_odometer_meters" IS DISTINCT FROM OLD."proposed_odometer_meters"
     OR NEW."proposed_fuel_basis_points" IS DISTINCT FROM OLD."proposed_fuel_basis_points"
     OR NEW."proposed_battery_soc_basis_points" IS DISTINCT FROM OLD."proposed_battery_soc_basis_points"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence" THEN
    RAISE EXCEPTION 'inspection amendment proposal is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_amendment_review_guard"
  BEFORE UPDATE ON "inspection_amendments"
  FOR EACH ROW EXECUTE FUNCTION "guard_inspection_amendment_review"();
