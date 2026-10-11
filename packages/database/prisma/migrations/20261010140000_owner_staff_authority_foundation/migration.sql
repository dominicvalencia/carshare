CREATE TYPE "OwnerStaffRole" AS ENUM ('MANAGER', 'STAFF');
CREATE TYPE "OwnerStaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');
CREATE TYPE "OwnerStaffVehicleScopeMode" AS ENUM ('ALL_VEHICLES', 'SELECTED_VEHICLES');

CREATE TABLE "owner_staff_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_profile_id" UUID NOT NULL,
  "user_id" UUID,
  "normalized_email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(150) NOT NULL,
  "role" "OwnerStaffRole" NOT NULL,
  "status" "OwnerStaffStatus" NOT NULL DEFAULT 'INVITED',
  "vehicle_scope_mode" "OwnerStaffVehicleScopeMode" NOT NULL DEFAULT 'SELECTED_VEHICLES',
  "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ(3),
  "suspended_at" TIMESTAMPTZ(3),
  "suspended_by_user_id" UUID,
  "suspension_reason" VARCHAR(1000),
  "disabled_at" TIMESTAMPTZ(3),
  "disabled_by_user_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "owner_staff_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_staff_permissions" (
  "membership_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "assigned_by_user_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_staff_permissions_pkey" PRIMARY KEY ("membership_id", "permission_id")
);

CREATE TABLE "owner_staff_vehicle_assignments" (
  "membership_id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "assigned_by_user_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_staff_vehicle_assignments_pkey" PRIMARY KEY ("membership_id", "vehicle_id")
);

CREATE TABLE "owner_staff_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "membership_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_staff_memberships_owner_profile_id_normalized_email_key" ON "owner_staff_memberships"("owner_profile_id", "normalized_email");
CREATE UNIQUE INDEX "owner_staff_memberships_owner_profile_id_user_id_key" ON "owner_staff_memberships"("owner_profile_id", "user_id");
CREATE INDEX "owner_staff_memberships_user_id_status_idx" ON "owner_staff_memberships"("user_id", "status");
CREATE INDEX "owner_staff_memberships_owner_profile_id_role_status_idx" ON "owner_staff_memberships"("owner_profile_id", "role", "status");
CREATE INDEX "owner_staff_permissions_permission_id_idx" ON "owner_staff_permissions"("permission_id");
CREATE INDEX "owner_staff_permissions_assigned_by_user_id_idx" ON "owner_staff_permissions"("assigned_by_user_id");
CREATE INDEX "owner_staff_vehicle_assignments_vehicle_id_idx" ON "owner_staff_vehicle_assignments"("vehicle_id");
CREATE INDEX "owner_staff_vehicle_assignments_assigned_by_user_id_idx" ON "owner_staff_vehicle_assignments"("assigned_by_user_id");
CREATE UNIQUE INDEX "owner_staff_invitations_token_hash_key" ON "owner_staff_invitations"("token_hash");
CREATE INDEX "owner_staff_invitations_membership_id_created_at_idx" ON "owner_staff_invitations"("membership_id", "created_at");
CREATE INDEX "owner_staff_invitations_expires_at_idx" ON "owner_staff_invitations"("expires_at");

ALTER TABLE "owner_staff_memberships" ADD CONSTRAINT "owner_staff_memberships_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_memberships" ADD CONSTRAINT "owner_staff_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_memberships" ADD CONSTRAINT "owner_staff_memberships_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_memberships" ADD CONSTRAINT "owner_staff_memberships_suspended_by_user_id_fkey" FOREIGN KEY ("suspended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_memberships" ADD CONSTRAINT "owner_staff_memberships_disabled_by_user_id_fkey" FOREIGN KEY ("disabled_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_permissions" ADD CONSTRAINT "owner_staff_permissions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "owner_staff_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_staff_permissions" ADD CONSTRAINT "owner_staff_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_permissions" ADD CONSTRAINT "owner_staff_permissions_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_vehicle_assignments" ADD CONSTRAINT "owner_staff_vehicle_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "owner_staff_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_staff_vehicle_assignments" ADD CONSTRAINT "owner_staff_vehicle_assignments_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_staff_vehicle_assignments" ADD CONSTRAINT "owner_staff_vehicle_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_invitations" ADD CONSTRAINT "owner_staff_invitations_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "owner_staff_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "owner_staff_invitations" ADD CONSTRAINT "owner_staff_invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "enforce_owner_staff_vehicle_scope"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "owner_staff_memberships" membership
    JOIN "vehicles" vehicle ON vehicle."id" = NEW."vehicle_id"
    WHERE membership."id" = NEW."membership_id"
      AND membership."owner_profile_id" = vehicle."owner_profile_id"
  ) THEN
    RAISE EXCEPTION 'Owner Staff vehicle assignment must remain within one Owner workspace';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "owner_staff_vehicle_scope_guard"
BEFORE INSERT OR UPDATE ON "owner_staff_vehicle_assignments"
FOR EACH ROW EXECUTE FUNCTION "enforce_owner_staff_vehicle_scope"();

INSERT INTO "permissions" ("id", "code", "description", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'audit.view_own_actions', 'View the actor''s own Owner-business audit history', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'availability.update', 'Update vehicle availability and blocked periods', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'availability.view', 'View vehicle availability and blocked periods', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bookings.accept', 'Accept eligible booking requests', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bookings.cancel', 'Cancel Owner bookings under current policy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bookings.reject', 'Reject eligible booking requests', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'bookings.view', 'View Owner booking requests and details', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'claims.create', 'Start eligible post-return claims', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'claims.respond', 'Respond to claims and add Owner evidence', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'claims.view', 'View claims for Owner rentals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'disputes.view', 'View disputes for Owner rentals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'handover.perform', 'Perform pickup handover and eligible recovery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'incidents.create', 'Report incidents for Owner rentals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'incidents.update', 'Update Owner incident reports where allowed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'inspections.create', 'Create inspection drafts and evidence', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'inspections.update', 'Update and submit permitted inspections', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'messages.reply', 'Reply in booking conversations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'messages.view', 'View booking conversations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'owner_authority.transfer', 'Transfer Owner authority through an approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'owner_business.delete', 'Close the Owner business through an approved flow', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'owner_settings.manage', 'Manage Owner business settings', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'payout_accounts.manage', 'Manage Owner payout destinations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'payout_accounts.view', 'View masked Owner payout destinations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'rentals.view', 'View active and historical rentals', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'return.perform', 'Perform return receipt and eligible recovery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.assign_permissions', 'Assign approved permissions to ordinary Staff', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.assign_vehicles', 'Assign ordinary Staff to Owner vehicles', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.disable', 'Disable ordinary Staff memberships', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.invite', 'Invite ordinary Staff memberships', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.reissue_invite', 'Reissue ordinary Staff invitations', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.suspend', 'Suspend or reactivate ordinary Staff memberships', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.update', 'Edit ordinary Staff access', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'staff.view', 'View the Owner Staff directory', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'support_cases.create', 'Create Owner-business support cases', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'support_cases.update', 'Update Owner-business support cases', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'support_cases.view', 'View Owner-business support cases', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'users.view_basic_profile', 'View the minimum renter profile needed for assigned work', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'vehicles.archive', 'Archive an eligible Owner vehicle', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'vehicles.update_operational_fields', 'Edit non-ownership operational vehicle fields', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'vehicles.view', 'View Owner vehicles', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description", "updated_at" = CURRENT_TIMESTAMP;
