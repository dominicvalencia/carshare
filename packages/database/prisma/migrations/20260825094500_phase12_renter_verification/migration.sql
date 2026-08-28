ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'MORE_INFORMATION_REQUIRED';
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "VerificationStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

ALTER TABLE "user_profiles"
  ADD COLUMN "address_line_1" VARCHAR(255),
  ADD COLUMN "barangay" VARCHAR(120),
  ADD COLUMN "city_municipality" VARCHAR(120),
  ADD COLUMN "province" VARCHAR(120),
  ADD COLUMN "postal_code" VARCHAR(12),
  ADD COLUMN "driver_license_number_hash" CHAR(64),
  ADD COLUMN "driver_license_last_four" VARCHAR(4),
  ADD COLUMN "driver_license_expiry" DATE,
  ADD COLUMN "driver_license_class" VARCHAR(100),
  ADD COLUMN "driver_license_restrictions" VARCHAR(255),
  ADD COLUMN "emergency_contact_name" VARCHAR(200),
  ADD COLUMN "emergency_contact_mobile" VARCHAR(32),
  ADD COLUMN "emergency_contact_relation" VARCHAR(100);

CREATE TABLE "renter_document_definitions" (
  "id" UUID NOT NULL,
  "jurisdiction" CHAR(2) NOT NULL DEFAULT 'PH',
  "code" VARCHAR(100) NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "category" VARCHAR(100) NOT NULL,
  "verification_type" "VerificationType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "accepted_mime_types" TEXT[] NOT NULL DEFAULT ARRAY['image/jpeg', 'image/png', 'application/pdf']::TEXT[],
  "maximum_bytes" BIGINT NOT NULL DEFAULT 10485760,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "renter_document_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "renter_document_definitions_jurisdiction_code_key"
  ON "renter_document_definitions"("jurisdiction", "code");
CREATE INDEX "renter_document_definitions_jurisdiction_active_sort_order_idx"
  ON "renter_document_definitions"("jurisdiction", "active", "sort_order");

ALTER TABLE "verification_documents"
  ADD COLUMN "definition_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" "VerificationStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN "expires_at" DATE,
  ADD COLUMN "review_feedback" VARCHAR(1000),
  ADD COLUMN "replaced_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "verification_documents_verification_id_definition_id_version_key"
  ON "verification_documents"("verification_id", "definition_id", "version");
CREATE INDEX "verification_documents_definition_id_status_replaced_at_idx"
  ON "verification_documents"("definition_id", "status", "replaced_at");

ALTER TABLE "verification_documents"
  ADD CONSTRAINT "verification_documents_definition_id_fkey"
  FOREIGN KEY ("definition_id") REFERENCES "renter_document_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "renter_document_definitions"
  ("id", "code", "name", "category", "verification_type", "required", "sort_order", "updated_at")
VALUES
  ('20000000-0000-4000-8000-000000000001', 'DRIVER_LICENSE_FRONT', 'Driver’s license front', 'DRIVER_LICENSE', 'DRIVER_LICENSE', true, 10, CURRENT_TIMESTAMP),
  ('20000000-0000-4000-8000-000000000002', 'DRIVER_LICENSE_BACK', 'Driver’s license back', 'DRIVER_LICENSE', 'DRIVER_LICENSE', true, 20, CURRENT_TIMESTAMP),
  ('20000000-0000-4000-8000-000000000003', 'ADDITIONAL_GOVERNMENT_ID', 'Additional government-issued ID', 'GOVERNMENT_ID', 'IDENTITY', true, 30, CURRENT_TIMESTAMP),
  ('20000000-0000-4000-8000-000000000004', 'PROOF_OF_ADDRESS', 'Proof of residential address', 'PROOF_OF_ADDRESS', 'IDENTITY', true, 40, CURRENT_TIMESTAMP),
  ('20000000-0000-4000-8000-000000000005', 'SELFIE', 'Selfie / profile verification image', 'SELFIE', 'IDENTITY', true, 50, CURRENT_TIMESTAMP)
ON CONFLICT ("jurisdiction", "code") DO NOTHING;
