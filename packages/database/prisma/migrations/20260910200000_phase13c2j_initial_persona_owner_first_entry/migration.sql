CREATE TYPE "MarketplacePersona" AS ENUM ('RENTER', 'OWNER');

ALTER TABLE "user_profiles"
ADD COLUMN "initial_marketplace_persona" "MarketplacePersona",
ADD COLUMN "owner_onboarding_first_entered_at" TIMESTAMPTZ(3);

-- Single-persona accounts have an unambiguous compatibility value.
UPDATE "user_profiles" AS profile
SET "initial_marketplace_persona" = 'RENTER'
WHERE EXISTS (
  SELECT 1 FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id" AND role."code" = 'RENTER'
)
AND NOT EXISTS (
  SELECT 1 FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id" AND role."code" = 'OWNER'
);

UPDATE "user_profiles" AS profile
SET "initial_marketplace_persona" = 'OWNER'
WHERE EXISTS (
  SELECT 1 FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id" AND role."code" = 'OWNER'
)
AND NOT EXISTS (
  SELECT 1 FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id" AND role."code" = 'RENTER'
);

-- A strict assignment-time ordering is usable for established dual-persona
-- accounts. Equal/ambiguous timestamps remain NULL and use the documented
-- deterministic application fallback.
WITH marketplace_assignments AS (
  SELECT user_role."user_id",
    MIN(user_role."assigned_at") FILTER (WHERE role."code" = 'RENTER') AS renter_at,
    MIN(user_role."assigned_at") FILTER (WHERE role."code" = 'OWNER') AS owner_at
  FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE role."code" IN ('RENTER', 'OWNER')
  GROUP BY user_role."user_id"
)
UPDATE "user_profiles" profile
SET "initial_marketplace_persona" = CASE
  WHEN assignments.renter_at < assignments.owner_at THEN 'RENTER'::"MarketplacePersona"
  WHEN assignments.owner_at < assignments.renter_at THEN 'OWNER'::"MarketplacePersona"
END
FROM marketplace_assignments assignments
WHERE profile."user_id" = assignments."user_id"
  AND assignments.renter_at IS NOT NULL
  AND assignments.owner_at IS NOT NULL
  AND assignments.renter_at <> assignments.owner_at;

-- Compatibility marker only: it prevents established Owners from unexpectedly
-- receiving first-time Welcome. It is not historical evidence of guide entry.
UPDATE "user_profiles" AS profile
SET "owner_onboarding_first_entered_at" = CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "user_roles" user_role
  INNER JOIN "roles" role ON role."id" = user_role."role_id"
  WHERE user_role."user_id" = profile."user_id" AND role."code" = 'OWNER'
);
