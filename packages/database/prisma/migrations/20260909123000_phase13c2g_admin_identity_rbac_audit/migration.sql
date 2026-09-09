CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'SUPER_ADMIN', 'STAFF');
CREATE TYPE "AdminStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');

CREATE TABLE "admin_users" (
  "id" UUID NOT NULL,
  "credential_user_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "normalized_email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(150) NOT NULL,
  "role" "AdminRole" NOT NULL,
  "status" "AdminStatus" NOT NULL DEFAULT 'INVITED',
  "created_by_admin_id" UUID,
  "invited_at" TIMESTAMPTZ(3),
  "activated_at" TIMESTAMPTZ(3),
  "last_login_at" TIMESTAMPTZ(3),
  "password_changed_at" TIMESTAMPTZ(3),
  "suspended_at" TIMESTAMPTZ(3),
  "suspended_by_admin_id" UUID,
  "suspension_reason" VARCHAR(1000),
  "disabled_at" TIMESTAMPTZ(3),
  "disabled_by_admin_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_permissions" (
  "id" UUID NOT NULL,
  "code" VARCHAR(100) NOT NULL,
  "description" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_user_permissions" (
  "admin_user_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "assigned_by_admin_id" UUID NOT NULL,
  CONSTRAINT "admin_user_permissions_pkey" PRIMARY KEY ("admin_user_id", "permission_id")
);

CREATE TABLE "admin_invitations" (
  "id" UUID NOT NULL,
  "admin_user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_by_admin_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_audit_logs" (
  "id" UUID NOT NULL,
  "actor_admin_id" UUID NOT NULL,
  "actor_role" "AdminRole" NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "entity_type" VARCHAR(100) NOT NULL,
  "entity_id" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(1000),
  "previous_state" JSONB,
  "new_state" JSONB,
  "request_correlation_id" VARCHAR(100),
  "ip_address" INET,
  "user_agent" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "verifications" ADD COLUMN "reviewed_by_admin_id" UUID;

CREATE UNIQUE INDEX "admin_users_credential_user_id_key" ON "admin_users"("credential_user_id");
CREATE UNIQUE INDEX "admin_users_normalized_email_key" ON "admin_users"("normalized_email");
CREATE INDEX "admin_users_role_status_idx" ON "admin_users"("role", "status");
CREATE UNIQUE INDEX "admin_users_single_owner_key" ON "admin_users"("role") WHERE "role" = 'OWNER';
CREATE INDEX "admin_users_created_by_admin_id_idx" ON "admin_users"("created_by_admin_id");
CREATE UNIQUE INDEX "admin_permissions_code_key" ON "admin_permissions"("code");
CREATE INDEX "admin_user_permissions_permission_id_idx" ON "admin_user_permissions"("permission_id");
CREATE INDEX "admin_user_permissions_assigned_by_admin_id_idx" ON "admin_user_permissions"("assigned_by_admin_id");
CREATE UNIQUE INDEX "admin_invitations_token_hash_key" ON "admin_invitations"("token_hash");
CREATE INDEX "admin_invitations_admin_user_id_created_at_idx" ON "admin_invitations"("admin_user_id", "created_at");
CREATE INDEX "admin_invitations_expires_at_idx" ON "admin_invitations"("expires_at");
CREATE INDEX "admin_audit_logs_actor_admin_id_created_at_idx" ON "admin_audit_logs"("actor_admin_id", "created_at");
CREATE INDEX "admin_audit_logs_entity_type_entity_id_created_at_idx" ON "admin_audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "admin_audit_logs_action_created_at_idx" ON "admin_audit_logs"("action", "created_at");
CREATE INDEX "verifications_reviewed_by_admin_id_reviewed_at_idx" ON "verifications"("reviewed_by_admin_id", "reviewed_at");

ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_credential_user_id_fkey" FOREIGN KEY ("credential_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_suspended_by_admin_id_fkey" FOREIGN KEY ("suspended_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_disabled_by_admin_id_fkey" FOREIGN KEY ("disabled_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "admin_permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_user_permissions" ADD CONSTRAINT "admin_user_permissions_assigned_by_admin_id_fkey" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_admin_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin audit logs are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "admin_audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();
