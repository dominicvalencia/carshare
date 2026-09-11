ALTER TABLE "user_profiles"
ADD COLUMN "renter_onboarding_completed_at" TIMESTAMPTZ(3);

-- Compatibility backfill only: this timestamp does not represent the historical
-- moment when a pre-13C-2J Renter completed guided onboarding. It prevents existing
-- Renter and dual-persona accounts from being forced through the new gate.
UPDATE "user_profiles" AS profile
SET "renter_onboarding_completed_at" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1
  FROM "user_roles" AS user_role
  INNER JOIN "roles" AS role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id"
    AND role."code" = 'RENTER'
);
