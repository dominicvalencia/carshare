CREATE TABLE "owner_staff_access_links" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_profile_id" UUID NOT NULL,
  "public_handle" VARCHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_user_id" UUID NOT NULL,
  "rotated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotated_at" TIMESTAMPTZ(3),

  CONSTRAINT "owner_staff_access_links_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_staff_access_links_version_check" CHECK ("version" > 0)
);

INSERT INTO "owner_staff_access_links" (
  "owner_profile_id",
  "public_handle",
  "created_by_user_id"
)
SELECT
  owner_profile."id",
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  owner_profile."user_id"
FROM "owner_profiles" owner_profile;

CREATE UNIQUE INDEX "owner_staff_access_links_owner_profile_id_key"
  ON "owner_staff_access_links"("owner_profile_id");

CREATE UNIQUE INDEX "owner_staff_access_links_public_handle_key"
  ON "owner_staff_access_links"("public_handle");

ALTER TABLE "owner_staff_access_links"
  ADD CONSTRAINT "owner_staff_access_links_owner_profile_id_fkey"
  FOREIGN KEY ("owner_profile_id")
  REFERENCES "owner_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_staff_access_links"
  ADD CONSTRAINT "owner_staff_access_links_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "owner_staff_access_links"
  ADD CONSTRAINT "owner_staff_access_links_rotated_by_user_id_fkey"
  FOREIGN KEY ("rotated_by_user_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
