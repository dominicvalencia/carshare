CREATE TYPE "VehicleChangeProposalKind" AS ENUM ('GENERAL', 'STAFF_KNOWN_ISSUE');

ALTER TABLE "vehicle_change_proposals"
  ADD COLUMN "kind" "VehicleChangeProposalKind" NOT NULL DEFAULT 'GENERAL';

CREATE OR REPLACE FUNCTION enforce_vehicle_change_proposal_submitter()
RETURNS trigger AS $$
DECLARE
  membership "owner_staff_memberships"%ROWTYPE;
  can_create_known_issues boolean;
BEGIN
  SELECT * INTO membership
  FROM "owner_staff_memberships"
  WHERE "id" = NEW."submitted_by_membership_id";

  SELECT EXISTS (
    SELECT 1
    FROM "owner_staff_permissions" assignment
    JOIN "permissions" permission ON permission."id" = assignment."permission_id"
    WHERE assignment."membership_id" = NEW."submitted_by_membership_id"
      AND permission."code" = 'known_issues.create'
  ) INTO can_create_known_issues;

  IF membership."owner_profile_id" <> NEW."owner_profile_id"
    OR membership."user_id" IS DISTINCT FROM NEW."submitted_by_user_id"
    OR membership."status" <> 'ACTIVE'
    OR NOT (
      (membership."role" = 'MANAGER' AND NEW."kind" = 'GENERAL')
      OR (
        membership."role" = 'STAFF'
        AND NEW."kind" = 'STAFF_KNOWN_ISSUE'
        AND can_create_known_issues
      )
    ) THEN
    RAISE EXCEPTION 'vehicle proposal submitter must be an authorized active workspace membership actor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "vehicle_change_proposal_submitter_guard" ON "vehicle_change_proposals";

CREATE TRIGGER "vehicle_change_proposal_submitter_guard"
BEFORE INSERT OR UPDATE OF "submitted_by_user_id", "submitted_by_membership_id", "owner_profile_id", "kind"
ON "vehicle_change_proposals"
FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_change_proposal_submitter();
