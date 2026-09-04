CREATE TYPE "ReviewPublicationStatus" AS ENUM ('PENDING', 'PUBLISHED');

ALTER TABLE "owner_profiles" ADD COLUMN "public_reference" VARCHAR(32);
UPDATE "owner_profiles"
SET "public_reference" = 'HOST-' || UPPER(SUBSTRING(MD5("id"::text) FROM 1 FOR 20));
ALTER TABLE "owner_profiles" ALTER COLUMN "public_reference" SET NOT NULL;
CREATE UNIQUE INDEX "owner_profiles_public_reference_key" ON "owner_profiles"("public_reference");

ALTER TABLE "vehicle_policy_versions"
  ADD COLUMN "short_duration_discount_bps" INTEGER,
  ADD COLUMN "weekly_discount_bps" INTEGER,
  ADD COLUMN "extended_trip_discount_bps" INTEGER,
  ADD COLUMN "monthly_discount_bps" INTEGER;

ALTER TABLE "pricing_quotes"
  ADD COLUMN "base_rental_amount_minor" INTEGER,
  ADD COLUMN "duration_discount_tier" VARCHAR(30),
  ADD COLUMN "duration_discount_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "duration_discount_amount_minor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discounted_rental_subtotal_minor" INTEGER;
DROP TRIGGER "pricing_quotes_append_only" ON "pricing_quotes";
UPDATE "pricing_quotes"
SET "base_rental_amount_minor" = "subtotal_minor",
    "discounted_rental_subtotal_minor" = "subtotal_minor";
ALTER TABLE "pricing_quotes"
  ALTER COLUMN "base_rental_amount_minor" SET NOT NULL,
  ALTER COLUMN "discounted_rental_subtotal_minor" SET NOT NULL;
CREATE TRIGGER "pricing_quotes_append_only" BEFORE UPDATE OR DELETE ON "pricing_quotes"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

ALTER TABLE "booking_pricing_snapshots"
  ADD COLUMN "base_rental_amount_minor" INTEGER,
  ADD COLUMN "duration_discount_tier" VARCHAR(30),
  ADD COLUMN "duration_discount_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "duration_discount_amount_minor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discounted_rental_subtotal_minor" INTEGER;
DROP TRIGGER "booking_pricing_snapshots_append_only" ON "booking_pricing_snapshots";
UPDATE "booking_pricing_snapshots"
SET "base_rental_amount_minor" = "subtotal_minor",
    "discounted_rental_subtotal_minor" = "subtotal_minor";
ALTER TABLE "booking_pricing_snapshots"
  ALTER COLUMN "base_rental_amount_minor" SET NOT NULL,
  ALTER COLUMN "discounted_rental_subtotal_minor" SET NOT NULL;
CREATE TRIGGER "booking_pricing_snapshots_append_only" BEFORE UPDATE OR DELETE ON "booking_pricing_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_mutation"();

ALTER TABLE "reviews"
  ADD COLUMN "publication_status" "ReviewPublicationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "publish_after" TIMESTAMPTZ(3),
  ADD COLUMN "published_at" TIMESTAMPTZ(3);
UPDATE "reviews"
SET "publication_status" = 'PUBLISHED',
    "publish_after" = "created_at",
    "published_at" = "created_at";
ALTER TABLE "reviews" ALTER COLUMN "publish_after" SET NOT NULL;

DROP INDEX IF EXISTS "reviews_vehicle_id_moderation_status_created_at_idx";
DROP INDEX IF EXISTS "reviews_owner_profile_id_moderation_status_created_at_idx";
DROP INDEX IF EXISTS "reviews_subject_user_id_moderation_status_created_at_idx";
CREATE INDEX "reviews_vehicle_id_publication_status_moderation_status_created_at_idx"
  ON "reviews"("vehicle_id", "publication_status", "moderation_status", "created_at");
CREATE INDEX "reviews_owner_profile_id_publication_status_moderation_status_created_at_idx"
  ON "reviews"("owner_profile_id", "publication_status", "moderation_status", "created_at");
CREATE INDEX "reviews_subject_user_id_publication_status_moderation_status_created_at_idx"
  ON "reviews"("subject_user_id", "publication_status", "moderation_status", "created_at");
CREATE INDEX "reviews_publication_status_publish_after_idx"
  ON "reviews"("publication_status", "publish_after");
