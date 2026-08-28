CREATE TYPE "AddressMatchAssessment" AS ENUM (
  'MATCH',
  'POSSIBLE_MATCH',
  'MISMATCH',
  'NOT_APPLICABLE'
);

CREATE TYPE "GeographicAreaLevel" AS ENUM (
  'REGION',
  'PROVINCE',
  'SPECIAL_GEOGRAPHIC_AREA',
  'CITY',
  'MUNICIPALITY',
  'SUBMUNICIPALITY',
  'BARANGAY'
);

ALTER TABLE "user_profiles"
  ADD COLUMN "region" VARCHAR(120),
  ADD COLUMN "region_code" VARCHAR(10),
  ADD COLUMN "address_scope_code" VARCHAR(10),
  ADD COLUMN "province_code" VARCHAR(10),
  ADD COLUMN "city_municipality_code" VARCHAR(10),
  ADD COLUMN "barangay_code" VARCHAR(10),
  ADD COLUMN "emergency_contact_relation_other" VARCHAR(100),
  ADD COLUMN "renter_verification_draft_step" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "verifications"
  ADD COLUMN "address_assessment" "AddressMatchAssessment",
  ADD COLUMN "address_review_notes" VARCHAR(2000),
  ADD COLUMN "address_assessed_at" TIMESTAMPTZ(3),
  ADD COLUMN "address_assessed_by_user_id" UUID;

ALTER TABLE "verifications"
  ADD CONSTRAINT "verifications_address_assessed_by_user_id_fkey"
  FOREIGN KEY ("address_assessed_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "verifications_address_assessed_by_user_id_address_assessed_at_idx"
  ON "verifications"("address_assessed_by_user_id", "address_assessed_at");

CREATE UNIQUE INDEX "user_profiles_driver_license_number_hash_key"
  ON "user_profiles"("driver_license_number_hash");

CREATE TABLE "geographic_areas" (
  "code" VARCHAR(10) PRIMARY KEY,
  "name" VARCHAR(200) NOT NULL,
  "search_name" VARCHAR(200) NOT NULL,
  "level" "GeographicAreaLevel" NOT NULL,
  "parent_code" VARCHAR(10),
  "region_code" VARCHAR(10) NOT NULL,
  "province_code" VARCHAR(10),
  "city_municipality_code" VARCHAR(10),
  "correspondence_code" VARCHAR(10),
  "city_class" VARCHAR(10),
  "old_name" VARCHAR(255),
  "dataset_version" VARCHAR(40) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "imported_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "geographic_areas_parent_code_fkey"
    FOREIGN KEY ("parent_code") REFERENCES "geographic_areas"("code")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "geographic_areas_level_region_code_name_idx"
  ON "geographic_areas"("level", "region_code", "name");
CREATE INDEX "geographic_areas_level_province_code_name_idx"
  ON "geographic_areas"("level", "province_code", "name");
CREATE INDEX "geographic_areas_level_city_municipality_code_name_idx"
  ON "geographic_areas"("level", "city_municipality_code", "name");
CREATE INDEX "geographic_areas_parent_code_level_name_idx"
  ON "geographic_areas"("parent_code", "level", "name");
CREATE INDEX "geographic_areas_search_name_idx" ON "geographic_areas"("search_name");
