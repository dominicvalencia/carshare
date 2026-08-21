-- Spatial search and range exclusion support are explicit database dependencies.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "VehicleLifecycleStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CHANGES_REQUIRED', 'REJECTED', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VehicleOperationalStatus" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'TEMPORARILY_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "VehicleTransmission" AS ENUM ('AUTOMATIC', 'MANUAL', 'CVT', 'DCT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehiclePowertrain" AS ENUM ('ICE', 'HYBRID', 'PLUG_IN_HYBRID', 'BATTERY_ELECTRIC');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('GASOLINE', 'DIESEL', 'ELECTRIC', 'HYBRID', 'OTHER');

-- CreateEnum
CREATE TYPE "VehiclePhotoPerspective" AS ENUM ('FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'INTERIOR_DASHBOARD', 'OTHER');

-- CreateEnum
CREATE TYPE "MileagePolicyType" AS ENUM ('UNLIMITED', 'LIMITED');

-- CreateEnum
CREATE TYPE "FuelReturnPolicyType" AS ENUM ('SAME_TO_SAME', 'FULL_TO_FULL');

-- CreateEnum
CREATE TYPE "EvReturnPolicyType" AS ENUM ('SAME_TO_SAME', 'MINIMUM_PERCENTAGE');

-- CreateEnum
CREATE TYPE "AvailabilityPolicyType" AS ENUM ('EVERY_DAY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "VehicleBlockReason" AS ENUM ('PERSONAL_USE', 'MAINTENANCE', 'REPAIR', 'UNAVAILABLE', 'OTHER');

-- CreateTable
CREATE TABLE "vehicle_categories" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_features" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_document_definitions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(75) NOT NULL,
    "jurisdiction" CHAR(2) NOT NULL DEFAULT 'PH',
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_document_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "owner_profile_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "category_id" UUID,
    "status" "VehicleLifecycleStatus" NOT NULL DEFAULT 'DRAFT',
    "operational_status" "VehicleOperationalStatus" NOT NULL DEFAULT 'AVAILABLE',
    "make" VARCHAR(100),
    "model" VARCHAR(100),
    "variant" VARCHAR(100),
    "model_year" INTEGER,
    "transmission" "VehicleTransmission",
    "powertrain" "VehiclePowertrain",
    "fuel_type" "VehicleFuelType",
    "seat_count" INTEGER,
    "door_count" INTEGER,
    "color" VARCHAR(75),
    "plate_number" VARCHAR(30),
    "plate_hash" CHAR(64),
    "vin" VARCHAR(64),
    "vin_hash" CHAR(64),
    "description" VARCHAR(3000),
    "rental_requirements" VARCHAR(2000),
    "last_completed_section" VARCHAR(50),
    "review_reason" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_feature_assignments" (
    "vehicle_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_feature_assignments_pkey" PRIMARY KEY ("vehicle_id","feature_id")
);

-- CreateTable
CREATE TABLE "vehicle_photos" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "perspective" "VehiclePhotoPerspective" NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_documents" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "file_asset_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" DATE,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "review_reason" VARCHAR(1000),
    "replaces_document_id" UUID,
    "replaced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_locations" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "point" geography(Point,4326) GENERATED ALWAYS AS (
      ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
    ) STORED,
    "city" VARCHAR(120) NOT NULL,
    "province" VARCHAR(120) NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'PH',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Manila',
    "pickup_area_label" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicle_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_policy_versions" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'PHP',
    "daily_rate_minor" INTEGER NOT NULL,
    "minimum_rental_days" INTEGER NOT NULL,
    "maximum_rental_days" INTEGER NOT NULL,
    "mileage_policy" "MileagePolicyType" NOT NULL,
    "included_kilometers_per_day" INTEGER,
    "excess_kilometer_rate_minor" INTEGER,
    "fuel_return_policy" "FuelReturnPolicyType",
    "fuel_tolerance_percent" INTEGER,
    "fuel_calculation_policy_ref" VARCHAR(100),
    "ev_return_policy" "EvReturnPolicyType",
    "ev_required_percentage" INTEGER,
    "ev_tolerance_percent" INTEGER,
    "ev_calculation_policy_ref" VARCHAR(100),
    "turnaround_minutes" INTEGER NOT NULL DEFAULT 120,
    "availability_policy" "AvailabilityPolicyType" NOT NULL DEFAULT 'EVERY_DAY',
    "monday" BOOLEAN NOT NULL DEFAULT true,
    "tuesday" BOOLEAN NOT NULL DEFAULT true,
    "wednesday" BOOLEAN NOT NULL DEFAULT true,
    "thursday" BOOLEAN NOT NULL DEFAULT true,
    "friday" BOOLEAN NOT NULL DEFAULT true,
    "saturday" BOOLEAN NOT NULL DEFAULT true,
    "sunday" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_blocked_periods" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" "VehicleBlockReason" NOT NULL,
    "private_note" VARCHAR(1000),
    "created_by_user_id" UUID NOT NULL,
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_blocked_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_status_history" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "previous_status" "VehicleLifecycleStatus",
    "new_status" "VehicleLifecycleStatus" NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "reason" VARCHAR(1000),
    "correlation_id" VARCHAR(100),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_categories_code_key" ON "vehicle_categories"("code");

-- CreateIndex
CREATE INDEX "vehicle_categories_active_sort_order_idx" ON "vehicle_categories"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_features_code_key" ON "vehicle_features"("code");

-- CreateIndex
CREATE INDEX "vehicle_features_active_sort_order_idx" ON "vehicle_features"("active", "sort_order");

-- CreateIndex
CREATE INDEX "vehicle_document_definitions_jurisdiction_active_sort_order_idx" ON "vehicle_document_definitions"("jurisdiction", "active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_document_definitions_jurisdiction_code_key" ON "vehicle_document_definitions"("jurisdiction", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_hash_key" ON "vehicles"("plate_hash");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_hash_key" ON "vehicles"("vin_hash");

-- CreateIndex
CREATE INDEX "vehicles_owner_user_id_status_updated_at_idx" ON "vehicles"("owner_user_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "vehicles_owner_profile_id_idx" ON "vehicles"("owner_profile_id");

-- CreateIndex
CREATE INDEX "vehicles_status_submitted_at_idx" ON "vehicles"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "vehicles_category_id_status_idx" ON "vehicles"("category_id", "status");

-- CreateIndex
CREATE INDEX "vehicle_feature_assignments_feature_id_idx" ON "vehicle_feature_assignments"("feature_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_photos_file_asset_id_key" ON "vehicle_photos"("file_asset_id");

-- CreateIndex
CREATE INDEX "vehicle_photos_vehicle_id_removed_at_display_order_idx" ON "vehicle_photos"("vehicle_id", "removed_at", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_documents_file_asset_id_key" ON "vehicle_documents"("file_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_documents_replaces_document_id_key" ON "vehicle_documents"("replaces_document_id");

-- CreateIndex
CREATE INDEX "vehicle_documents_vehicle_id_status_replaced_at_idx" ON "vehicle_documents"("vehicle_id", "status", "replaced_at");

-- CreateIndex
CREATE INDEX "vehicle_documents_definition_id_idx" ON "vehicle_documents"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_documents_vehicle_id_definition_id_version_key" ON "vehicle_documents"("vehicle_id", "definition_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_locations_vehicle_id_key" ON "vehicle_locations"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_locations_city_province_country_idx" ON "vehicle_locations"("city", "province", "country");

-- CreateIndex
CREATE INDEX "vehicle_policy_versions_vehicle_id_created_at_idx" ON "vehicle_policy_versions"("vehicle_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_policy_versions_vehicle_id_version_key" ON "vehicle_policy_versions"("vehicle_id", "version");

-- CreateIndex
CREATE INDEX "vehicle_blocked_periods_vehicle_id_starts_at_ends_at_idx" ON "vehicle_blocked_periods"("vehicle_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "vehicle_status_history_vehicle_id_occurred_at_idx" ON "vehicle_status_history"("vehicle_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vehicle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_feature_assignments" ADD CONSTRAINT "vehicle_feature_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_feature_assignments" ADD CONSTRAINT "vehicle_feature_assignments_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "vehicle_features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "vehicle_document_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_replaces_document_id_fkey" FOREIGN KEY ("replaces_document_id") REFERENCES "vehicle_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_locations" ADD CONSTRAINT "vehicle_locations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_blocked_periods" ADD CONSTRAINT "vehicle_blocked_periods_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_blocked_periods" ADD CONSTRAINT "vehicle_blocked_periods_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_status_history" ADD CONSTRAINT "vehicle_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that must hold regardless of application entry point.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_model_year_check"
  CHECK ("model_year" IS NULL OR "model_year" BETWEEN 1900 AND 2100);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_seat_count_check"
  CHECK ("seat_count" IS NULL OR "seat_count" BETWEEN 1 AND 20);
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_door_count_check"
  CHECK ("door_count" IS NULL OR "door_count" BETWEEN 1 AND 6);
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_display_order_check"
  CHECK ("display_order" >= 0);
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_version_check"
  CHECK ("version" > 0);
ALTER TABLE "vehicle_locations" ADD CONSTRAINT "vehicle_locations_latitude_check"
  CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "vehicle_locations" ADD CONSTRAINT "vehicle_locations_longitude_check"
  CHECK ("longitude" BETWEEN -180 AND 180);
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_pricing_check"
  CHECK (
    "version" > 0 AND "currency" = 'PHP' AND "daily_rate_minor" > 0
    AND "minimum_rental_days" > 0
    AND "maximum_rental_days" >= "minimum_rental_days"
    AND "maximum_rental_days" <= 365
  );
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_mileage_check"
  CHECK (
    ("mileage_policy" = 'UNLIMITED' AND "included_kilometers_per_day" IS NULL AND "excess_kilometer_rate_minor" IS NULL)
    OR
    ("mileage_policy" = 'LIMITED' AND "included_kilometers_per_day" > 0 AND "excess_kilometer_rate_minor" > 0)
  );
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_return_policy_check"
  CHECK (
    ("fuel_return_policy" IS NULL OR "ev_return_policy" IS NULL)
    AND ("fuel_tolerance_percent" IS NULL OR "fuel_tolerance_percent" BETWEEN 0 AND 100)
    AND ("ev_required_percentage" IS NULL OR "ev_required_percentage" BETWEEN 0 AND 100)
    AND ("ev_tolerance_percent" IS NULL OR "ev_tolerance_percent" BETWEEN 0 AND 100)
    AND ("ev_return_policy" <> 'MINIMUM_PERCENTAGE' OR "ev_required_percentage" IS NOT NULL)
  );
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_turnaround_check"
  CHECK ("turnaround_minutes" IN (120, 240, 360, 720, 1440));
ALTER TABLE "vehicle_policy_versions" ADD CONSTRAINT "vehicle_policy_versions_availability_check"
  CHECK (
    "availability_policy" = 'WEEKLY'
    OR ("monday" AND "tuesday" AND "wednesday" AND "thursday" AND "friday" AND "saturday" AND "sunday")
  );
ALTER TABLE "vehicle_blocked_periods" ADD CONSTRAINT "vehicle_blocked_periods_range_check"
  CHECK ("starts_at" < "ends_at");

-- Active presentation records have stable ordering and one cover.
CREATE UNIQUE INDEX "vehicle_photos_one_active_cover_idx"
  ON "vehicle_photos" ("vehicle_id") WHERE "is_cover" AND "removed_at" IS NULL;
CREATE UNIQUE INDEX "vehicle_photos_active_order_idx"
  ON "vehicle_photos" ("vehicle_id", "display_order") WHERE "removed_at" IS NULL;
CREATE UNIQUE INDEX "vehicle_documents_one_active_type_idx"
  ON "vehicle_documents" ("vehicle_id", "definition_id") WHERE "replaced_at" IS NULL;

-- PostGIS and blocked-period indexes are ready for later authoritative availability queries.
CREATE INDEX "vehicle_locations_point_gist_idx" ON "vehicle_locations" USING GIST ("point");
ALTER TABLE "vehicle_blocked_periods" ADD CONSTRAINT "vehicle_blocked_periods_no_overlap"
  EXCLUDE USING GIST (
    "vehicle_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("removed_at" IS NULL);

-- Status history and policy versions are immutable facts.
CREATE TRIGGER "vehicle_status_history_append_only"
BEFORE UPDATE OR DELETE ON "vehicle_status_history"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

CREATE TRIGGER "vehicle_policy_versions_append_only"
BEFORE UPDATE OR DELETE ON "vehicle_policy_versions"
FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();
