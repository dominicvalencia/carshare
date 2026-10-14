INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'known_issues.create',
  'Add a new known issue through the vehicle proposal workflow',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE
SET "description" = EXCLUDED."description", "updated_at" = CURRENT_TIMESTAMP;

WITH "operational_staff_permission_migration" AS (
  SELECT membership."id" AS "membership_id", membership."created_by_user_id"
  FROM "owner_staff_memberships" membership
  JOIN "owner_staff_permissions" assignment
    ON assignment."membership_id" = membership."id"
  JOIN "permissions" permission
    ON permission."id" = assignment."permission_id"
  WHERE membership."role" = 'STAFF'
  GROUP BY membership."id", membership."created_by_user_id"
  HAVING COUNT(DISTINCT permission."code") FILTER (
    WHERE permission."code" <> 'known_issues.create'
  ) = 18
    AND COUNT(DISTINCT permission."code") FILTER (
      WHERE permission."code" NOT IN (
        'vehicles.view',
        'vehicles.update_operational_fields',
        'availability.view',
        'availability.update',
        'bookings.view',
        'bookings.accept',
        'bookings.reject',
        'rentals.view',
        'handover.perform',
        'return.perform',
        'inspections.create',
        'inspections.update',
        'incidents.create',
        'incidents.update',
        'messages.view',
        'messages.reply',
        'claims.view',
        'audit.view_own_actions',
        'known_issues.create'
      )
    ) = 0
)
INSERT INTO "owner_staff_permissions" (
  "membership_id",
  "permission_id",
  "assigned_by_user_id",
  "assigned_at"
)
SELECT
  membership."membership_id",
  permission."id",
  membership."created_by_user_id",
  CURRENT_TIMESTAMP
FROM "operational_staff_permission_migration" membership
CROSS JOIN "permissions" permission
WHERE permission."code" = 'known_issues.create'
ON CONFLICT ("membership_id", "permission_id") DO NOTHING;

WITH "operational_staff_permission_migration" AS (
  SELECT membership."id" AS "membership_id"
  FROM "owner_staff_memberships" membership
  JOIN "owner_staff_permissions" assignment
    ON assignment."membership_id" = membership."id"
  JOIN "permissions" permission
    ON permission."id" = assignment."permission_id"
  WHERE membership."role" = 'STAFF'
  GROUP BY membership."id"
  HAVING COUNT(DISTINCT permission."code") FILTER (
    WHERE permission."code" <> 'known_issues.create'
  ) = 18
    AND COUNT(DISTINCT permission."code") FILTER (
      WHERE permission."code" NOT IN (
        'vehicles.view',
        'vehicles.update_operational_fields',
        'availability.view',
        'availability.update',
        'bookings.view',
        'bookings.accept',
        'bookings.reject',
        'rentals.view',
        'handover.perform',
        'return.perform',
        'inspections.create',
        'inspections.update',
        'incidents.create',
        'incidents.update',
        'messages.view',
        'messages.reply',
        'claims.view',
        'audit.view_own_actions',
        'known_issues.create'
      )
    ) = 0
)
DELETE FROM "owner_staff_permissions" assignment
USING "permissions" permission, "operational_staff_permission_migration" membership
WHERE assignment."permission_id" = permission."id"
  AND assignment."membership_id" = membership."membership_id"
  AND permission."code" IN (
    'vehicles.update_operational_fields',
    'bookings.view',
    'bookings.accept',
    'bookings.reject'
  );
