-- Phase 13C-2K-B1: additive self-drive fulfillment policy and immutable booking evidence.
CREATE TYPE "StartFulfillmentMethod" AS ENUM ('RENTER_PICKUP', 'OWNER_DELIVERY');
CREATE TYPE "EndFulfillmentMethod" AS ENUM ('RENTER_RETURN', 'OWNER_COLLECTION');

ALTER TABLE "vehicle_policy_versions"
  ADD COLUMN "supports_renter_pickup" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supports_owner_delivery" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supports_renter_return" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supports_owner_collection" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fulfillment_service_radius_meters" INTEGER,
  ADD COLUMN "delivery_fee_minor" INTEGER,
  ADD COLUMN "collection_fee_minor" INTEGER,
  ADD COLUMN "fulfillment_minimum_notice_minutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "vehicle_policy_versions"
  ADD CONSTRAINT "vehicle_policy_versions_fulfillment_start_check" CHECK (
    "supports_renter_pickup" OR "supports_owner_delivery"
  ),
  ADD CONSTRAINT "vehicle_policy_versions_fulfillment_end_check" CHECK (
    "supports_renter_return" OR "supports_owner_collection"
  ),
  ADD CONSTRAINT "vehicle_policy_versions_fulfillment_radius_check" CHECK (
    (NOT "supports_owner_delivery" AND NOT "supports_owner_collection")
    OR ("fulfillment_service_radius_meters" BETWEEN 1 AND 50000)
  ),
  ADD CONSTRAINT "vehicle_policy_versions_delivery_fee_check" CHECK (
    ("supports_owner_delivery" AND "delivery_fee_minor" IS NOT NULL AND "delivery_fee_minor" >= 0)
    OR (NOT "supports_owner_delivery" AND "delivery_fee_minor" IS NULL)
  ),
  ADD CONSTRAINT "vehicle_policy_versions_collection_fee_check" CHECK (
    ("supports_owner_collection" AND "collection_fee_minor" IS NOT NULL AND "collection_fee_minor" >= 0)
    OR (NOT "supports_owner_collection" AND "collection_fee_minor" IS NULL)
  ),
  ADD CONSTRAINT "vehicle_policy_versions_fulfillment_notice_check" CHECK (
    "fulfillment_minimum_notice_minutes" BETWEEN 0 AND 10080
  );

CREATE TABLE "booking_fulfillment_snapshots" (
  "booking_id" UUID NOT NULL,
  "start_method" "StartFulfillmentMethod" NOT NULL,
  "end_method" "EndFulfillmentMethod" NOT NULL,
  "start_address_line_1" VARCHAR(255),
  "start_barangay" VARCHAR(120),
  "start_city" VARCHAR(120) NOT NULL,
  "start_province" VARCHAR(120) NOT NULL,
  "start_postal_code" VARCHAR(12),
  "start_country" CHAR(2) NOT NULL DEFAULT 'PH',
  "start_latitude" DECIMAL(9,6) NOT NULL,
  "start_longitude" DECIMAL(9,6) NOT NULL,
  "end_address_line_1" VARCHAR(255),
  "end_barangay" VARCHAR(120),
  "end_city" VARCHAR(120) NOT NULL,
  "end_province" VARCHAR(120) NOT NULL,
  "end_postal_code" VARCHAR(12),
  "end_country" CHAR(2) NOT NULL DEFAULT 'PH',
  "end_latitude" DECIMAL(9,6) NOT NULL,
  "end_longitude" DECIMAL(9,6) NOT NULL,
  "delivery_distance_meters" INTEGER,
  "collection_distance_meters" INTEGER,
  "delivery_fee_minor" INTEGER NOT NULL DEFAULT 0,
  "collection_fee_minor" INTEGER NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "service_radius_meters" INTEGER,
  "minimum_notice_minutes" INTEGER NOT NULL,
  "source_policy_version_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_fulfillment_snapshots_pkey" PRIMARY KEY ("booking_id"),
  CONSTRAINT "booking_fulfillment_snapshots_coordinates_check" CHECK (
    "start_latitude" BETWEEN -90 AND 90 AND "end_latitude" BETWEEN -90 AND 90
    AND "start_longitude" BETWEEN -180 AND 180 AND "end_longitude" BETWEEN -180 AND 180
  ),
  CONSTRAINT "booking_fulfillment_snapshots_values_check" CHECK (
    "delivery_fee_minor" >= 0 AND "collection_fee_minor" >= 0
    AND "minimum_notice_minutes" BETWEEN 0 AND 10080
    AND ("service_radius_meters" IS NULL OR "service_radius_meters" BETWEEN 1 AND 50000)
  ),
  CONSTRAINT "booking_fulfillment_snapshots_delivery_check" CHECK (
    ("start_method" = 'RENTER_PICKUP' AND "delivery_distance_meters" IS NULL AND "delivery_fee_minor" = 0)
    OR ("start_method" = 'OWNER_DELIVERY' AND "delivery_distance_meters" >= 0
      AND "service_radius_meters" IS NOT NULL AND "delivery_distance_meters" <= "service_radius_meters")
  ),
  CONSTRAINT "booking_fulfillment_snapshots_collection_check" CHECK (
    ("end_method" = 'RENTER_RETURN' AND "collection_distance_meters" IS NULL AND "collection_fee_minor" = 0)
    OR ("end_method" = 'OWNER_COLLECTION' AND "collection_distance_meters" >= 0
      AND "service_radius_meters" IS NOT NULL AND "collection_distance_meters" <= "service_radius_meters")
  )
);

CREATE INDEX "booking_fulfillment_snapshots_source_policy_version_id_idx"
  ON "booking_fulfillment_snapshots"("source_policy_version_id");

ALTER TABLE "booking_fulfillment_snapshots"
  ADD CONSTRAINT "booking_fulfillment_snapshots_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_fulfillment_snapshots_source_policy_version_id_fkey"
  FOREIGN KEY ("source_policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "booking_fulfillment_snapshots_append_only"
  BEFORE UPDATE OR DELETE ON "booking_fulfillment_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

-- Existing bookings intentionally remain without fabricated evidence. Application compatibility
-- projects them as renter pickup + renter return with zero fulfillment fees.
