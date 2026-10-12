CREATE TYPE "VehicleOwnerApprovalStatus" AS ENUM (
  'PENDING',
  'CHANGES_REQUIRED',
  'APPROVED',
  'WITHDRAWN'
);

ALTER TABLE "vehicles"
  ADD COLUMN "created_by_user_id" UUID,
  ADD COLUMN "created_by_membership_id" UUID,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

UPDATE "vehicles"
SET "created_by_user_id" = "owner_user_id"
WHERE "created_by_user_id" IS NULL;

ALTER TABLE "vehicles"
  ALTER COLUMN "created_by_user_id" SET NOT NULL;

CREATE UNIQUE INDEX "vehicles_id_owner_profile_id_key"
  ON "vehicles"("id", "owner_profile_id");

CREATE INDEX "vehicles_created_by_membership_id_idx"
  ON "vehicles"("created_by_membership_id");

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_created_by_membership_id_owner_profile_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "owner_profile_id")
  REFERENCES "owner_staff_memberships"("id", "owner_profile_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "vehicle_owner_approval_requests" (
  "id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "owner_profile_id" UUID NOT NULL,
  "submitted_revision" INTEGER NOT NULL,
  "status" "VehicleOwnerApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "submitted_by_user_id" UUID NOT NULL,
  "submitted_by_membership_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "review_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "vehicle_owner_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_owner_approval_requests_owner_profile_id_status_submitted_at_idx"
  ON "vehicle_owner_approval_requests"("owner_profile_id", "status", "submitted_at");

CREATE INDEX "vehicle_owner_approval_requests_vehicle_id_submitted_at_idx"
  ON "vehicle_owner_approval_requests"("vehicle_id", "submitted_at");

CREATE INDEX "vehicle_owner_approval_requests_submitted_by_membership_id_idx"
  ON "vehicle_owner_approval_requests"("submitted_by_membership_id");

CREATE UNIQUE INDEX "vehicle_owner_approval_requests_one_pending_per_vehicle_key"
  ON "vehicle_owner_approval_requests"("vehicle_id")
  WHERE "status" = 'PENDING';

ALTER TABLE "vehicle_owner_approval_requests"
  ADD CONSTRAINT "vehicle_owner_approval_requests_vehicle_id_owner_profile_id_fkey"
  FOREIGN KEY ("vehicle_id", "owner_profile_id")
  REFERENCES "vehicles"("id", "owner_profile_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_owner_approval_requests"
  ADD CONSTRAINT "vehicle_owner_approval_requests_owner_profile_id_fkey"
  FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_owner_approval_requests"
  ADD CONSTRAINT "vehicle_owner_approval_requests_submitted_by_membership_id_owner_profile_id_fkey"
  FOREIGN KEY ("submitted_by_membership_id", "owner_profile_id")
  REFERENCES "owner_staff_memberships"("id", "owner_profile_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_owner_approval_requests"
  ADD CONSTRAINT "vehicle_owner_approval_requests_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_owner_approval_requests"
  ADD CONSTRAINT "vehicle_owner_approval_requests_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'vehicles.create',
  'Create a new vehicle inside an authorized Owner workspace',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "description" = EXCLUDED."description", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "owner_staff_permissions" (
  "membership_id",
  "permission_id",
  "assigned_by_user_id",
  "assigned_at"
)
SELECT
  membership."id",
  permission."id",
  membership."created_by_user_id",
  CURRENT_TIMESTAMP
FROM "owner_staff_memberships" membership
CROSS JOIN "permissions" permission
WHERE membership."role" = 'MANAGER'
  AND permission."code" = 'vehicles.create'
ON CONFLICT ("membership_id", "permission_id") DO NOTHING;
