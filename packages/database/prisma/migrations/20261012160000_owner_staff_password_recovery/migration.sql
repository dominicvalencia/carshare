ALTER TYPE "AuthTokenType" ADD VALUE 'STAFF_PASSWORD_RESET';
ALTER TYPE "OtpPurpose" ADD VALUE 'STAFF_PASSWORD_RESET';

ALTER TABLE "auth_tokens"
  ADD COLUMN "owner_staff_access_link_id" UUID,
  ADD COLUMN "staff_access_link_version" INTEGER;

ALTER TABLE "otp_challenges"
  ADD COLUMN "owner_staff_access_link_id" UUID,
  ADD COLUMN "staff_access_link_version" INTEGER;

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_owner_staff_access_link_id_fkey"
  FOREIGN KEY ("owner_staff_access_link_id") REFERENCES "owner_staff_access_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_owner_staff_access_link_id_fkey"
  FOREIGN KEY ("owner_staff_access_link_id") REFERENCES "owner_staff_access_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "auth_tokens_owner_staff_access_link_id_type_created_at_idx"
  ON "auth_tokens"("owner_staff_access_link_id", "type", "created_at");

CREATE INDEX "otp_challenges_owner_staff_access_link_id_purpose_created_at_idx"
  ON "otp_challenges"("owner_staff_access_link_id", "purpose", "created_at");

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_staff_access_context_check"
  CHECK (
    ("type" = 'STAFF_PASSWORD_RESET' AND "owner_staff_access_link_id" IS NOT NULL AND "staff_access_link_version" IS NOT NULL)
    OR
    ("type" <> 'STAFF_PASSWORD_RESET' AND "owner_staff_access_link_id" IS NULL AND "staff_access_link_version" IS NULL)
  );

ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_challenges_staff_access_context_check"
  CHECK (
    ("purpose" = 'STAFF_PASSWORD_RESET' AND "owner_staff_access_link_id" IS NOT NULL AND "staff_access_link_version" IS NOT NULL AND "user_id" IS NOT NULL)
    OR
    ("purpose" <> 'STAFF_PASSWORD_RESET' AND "owner_staff_access_link_id" IS NULL AND "staff_access_link_version" IS NULL)
  );
