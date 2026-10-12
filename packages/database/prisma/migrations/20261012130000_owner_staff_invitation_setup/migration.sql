ALTER TYPE "OtpPurpose" ADD VALUE 'STAFF_INVITATION_SETUP';

CREATE TABLE "owner_staff_invitation_setups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invitation_id" UUID NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_staff_invitation_setups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_staff_invitation_setups_invitation_id_key"
  ON "owner_staff_invitation_setups"("invitation_id");
CREATE INDEX "owner_staff_invitation_setups_expires_at_idx"
  ON "owner_staff_invitation_setups"("expires_at");

ALTER TABLE "owner_staff_invitation_setups"
  ADD CONSTRAINT "owner_staff_invitation_setups_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "owner_staff_invitations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "otp_challenges" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "otp_challenges" ADD COLUMN "owner_staff_invitation_setup_id" UUID;
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_owner_staff_invitation_setup_id_fkey"
  FOREIGN KEY ("owner_staff_invitation_setup_id")
  REFERENCES "owner_staff_invitation_setups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_single_authority_check"
  CHECK (num_nonnulls("user_id", "owner_staff_invitation_setup_id") = 1);
CREATE INDEX "otp_challenges_owner_staff_invitation_setup_id_purpose_created_at_idx"
  ON "otp_challenges"("owner_staff_invitation_setup_id", "purpose", "created_at");
