ALTER TABLE "owner_staff_memberships"
ADD COLUMN "owner_approval_bypass_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "owner_approval_bypass_changed_at" TIMESTAMPTZ(3),
ADD COLUMN "owner_approval_bypass_changed_by_user_id" UUID;

ALTER TABLE "owner_staff_memberships"
ADD CONSTRAINT "owner_staff_memberships_approval_bypass_manager_check"
CHECK (NOT "owner_approval_bypass_enabled" OR "role" = 'MANAGER'::"OwnerStaffRole");

ALTER TABLE "owner_staff_memberships"
ADD CONSTRAINT "owner_staff_memberships_approval_bypass_changed_by_fkey"
FOREIGN KEY ("owner_approval_bypass_changed_by_user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
