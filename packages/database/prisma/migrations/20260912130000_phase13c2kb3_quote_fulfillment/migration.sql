-- Phase 13C-2K-B3: immutable quote fulfillment evidence and explicit owner service earnings.
CREATE TABLE "pricing_quote_fulfillments" (
  "quote_id" UUID NOT NULL,
  "source_policy_version_id" UUID NOT NULL,
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
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_quote_fulfillments_pkey" PRIMARY KEY ("quote_id"),
  CONSTRAINT "pricing_quote_fulfillments_coordinates_check" CHECK (
    "start_latitude" BETWEEN -90 AND 90 AND "end_latitude" BETWEEN -90 AND 90
    AND "start_longitude" BETWEEN -180 AND 180 AND "end_longitude" BETWEEN -180 AND 180
  ),
  CONSTRAINT "pricing_quote_fulfillments_values_check" CHECK (
    "delivery_fee_minor" >= 0 AND "collection_fee_minor" >= 0
    AND "minimum_notice_minutes" BETWEEN 0 AND 10080
    AND ("service_radius_meters" IS NULL OR "service_radius_meters" BETWEEN 1 AND 50000)
  ),
  CONSTRAINT "pricing_quote_fulfillments_delivery_check" CHECK (
    ("start_method" = 'RENTER_PICKUP' AND "delivery_distance_meters" IS NULL AND "delivery_fee_minor" = 0)
    OR ("start_method" = 'OWNER_DELIVERY' AND "delivery_distance_meters" >= 0 AND "service_radius_meters" IS NOT NULL)
  ),
  CONSTRAINT "pricing_quote_fulfillments_collection_check" CHECK (
    ("end_method" = 'RENTER_RETURN' AND "collection_distance_meters" IS NULL AND "collection_fee_minor" = 0)
    OR ("end_method" = 'OWNER_COLLECTION' AND "collection_distance_meters" >= 0 AND "service_radius_meters" IS NOT NULL)
  )
);

CREATE INDEX "pricing_quote_fulfillments_source_policy_version_id_idx"
  ON "pricing_quote_fulfillments"("source_policy_version_id");

ALTER TABLE "pricing_quote_fulfillments"
  ADD CONSTRAINT "pricing_quote_fulfillments_quote_id_fkey"
    FOREIGN KEY ("quote_id") REFERENCES "pricing_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pricing_quote_fulfillments_source_policy_version_id_fkey"
    FOREIGN KEY ("source_policy_version_id") REFERENCES "vehicle_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "pricing_quote_fulfillments_append_only"
  BEFORE UPDATE OR DELETE ON "pricing_quote_fulfillments"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

ALTER TABLE "owner_earnings"
  ADD COLUMN "delivery_earning_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "collection_earning_minor" BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT "owner_earnings_fulfillment_nonnegative_check"
    CHECK ("delivery_earning_minor" >= 0 AND "collection_earning_minor" >= 0);
