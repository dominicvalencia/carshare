CREATE TYPE "OwnerStaffInvitationChannel" AS ENUM ('SMS', 'EMAIL');

ALTER TABLE "owner_staff_memberships"
  ALTER COLUMN "normalized_email" DROP NOT NULL;

ALTER TABLE "owner_staff_invitations"
  ADD COLUMN "owner_profile_id" UUID,
  ADD COLUMN "channel" "OwnerStaffInvitationChannel",
  ADD COLUMN "destination_normalized" VARCHAR(320);

UPDATE "owner_staff_invitations" invitation
SET
  "owner_profile_id" = membership."owner_profile_id",
  "channel" = 'EMAIL',
  "destination_normalized" = membership."normalized_email"
FROM "owner_staff_memberships" membership
WHERE membership."id" = invitation."membership_id";

ALTER TABLE "owner_staff_invitations"
  ALTER COLUMN "owner_profile_id" SET NOT NULL,
  ALTER COLUMN "channel" SET NOT NULL,
  ALTER COLUMN "channel" SET DEFAULT 'SMS',
  ALTER COLUMN "destination_normalized" SET NOT NULL;

CREATE UNIQUE INDEX "owner_staff_memberships_id_owner_profile_id_key"
  ON "owner_staff_memberships"("id", "owner_profile_id");

ALTER TABLE "owner_staff_invitations"
  DROP CONSTRAINT "owner_staff_invitations_membership_id_fkey";

ALTER TABLE "owner_staff_invitations"
  ADD CONSTRAINT "owner_staff_invitations_membership_id_owner_profile_id_fkey"
  FOREIGN KEY ("membership_id", "owner_profile_id")
  REFERENCES "owner_staff_memberships"("id", "owner_profile_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "owner_staff_invitations_live_destination_key"
  ON "owner_staff_invitations"("owner_profile_id", "channel", "destination_normalized")
  WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
