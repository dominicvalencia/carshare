CREATE TYPE "VehicleChangeProposalStatus" AS ENUM (
  'DRAFT',
  'PENDING_OWNER_APPROVAL',
  'OWNER_CHANGES_REQUIRED',
  'PENDING_PLATFORM_REVIEW',
  'PLATFORM_CHANGES_REQUIRED',
  'REJECTED',
  'WITHDRAWN',
  'APPLIED',
  'SUPERSEDED'
);

CREATE TYPE "VehicleChangeClassification" AS ENUM (
  'OWNER_APPROVAL_ONLY',
  'PLATFORM_REVIEW_REQUIRED'
);

CREATE TYPE "VehicleChangeProposalAssetKind" AS ENUM ('PHOTO', 'DOCUMENT');

CREATE TABLE "vehicle_change_proposals" (
  "id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "owner_profile_id" UUID NOT NULL,
  "base_vehicle_revision" INTEGER NOT NULL,
  "snapshot_schema_version" INTEGER NOT NULL DEFAULT 1,
  "proposed_snapshot" JSONB NOT NULL,
  "changed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "change_classification" "VehicleChangeClassification" NOT NULL DEFAULT 'OWNER_APPROVAL_ONLY',
  "status" "VehicleChangeProposalStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_by_user_id" UUID NOT NULL,
  "submitted_by_membership_id" UUID NOT NULL,
  "owner_approval_required" BOOLEAN NOT NULL DEFAULT true,
  "owner_approval_bypassed" BOOLEAN NOT NULL DEFAULT false,
  "trust_enabled_at_submission" BOOLEAN NOT NULL DEFAULT false,
  "platform_review_required" BOOLEAN NOT NULL DEFAULT false,
  "owner_reviewed_by_user_id" UUID,
  "owner_reviewed_at" TIMESTAMPTZ(3),
  "owner_review_reason" VARCHAR(1000),
  "platform_reviewed_by_admin_id" UUID,
  "platform_reviewed_at" TIMESTAMPTZ(3),
  "platform_review_reason" VARCHAR(1000),
  "submitted_at" TIMESTAMPTZ(3),
  "applied_at" TIMESTAMPTZ(3),
  "withdrawn_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "vehicle_change_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_change_proposals_revision_check" CHECK ("base_vehicle_revision" >= 0),
  CONSTRAINT "vehicle_change_proposals_snapshot_version_check" CHECK ("snapshot_schema_version" = 1),
  CONSTRAINT "vehicle_change_proposals_snapshot_object_check" CHECK (jsonb_typeof("proposed_snapshot") = 'object'),
  CONSTRAINT "vehicle_change_proposals_trust_decision_check" CHECK (
    NOT "owner_approval_bypassed"
    OR ("trust_enabled_at_submission" AND NOT "owner_approval_required")
  )
);

CREATE TABLE "vehicle_change_proposal_assets" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "file_asset_id" UUID NOT NULL,
  "kind" "VehicleChangeProposalAssetKind" NOT NULL,
  "photo_perspective" "VehiclePhotoPerspective",
  "display_order" INTEGER,
  "is_cover" BOOLEAN NOT NULL DEFAULT false,
  "document_definition_id" UUID,
  "document_type" VARCHAR(100),
  "expires_at" DATE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vehicle_change_proposal_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_change_proposal_assets_file_asset_id_key" UNIQUE ("file_asset_id"),
  CONSTRAINT "vehicle_change_proposal_assets_shape_check" CHECK (
    (
      "kind" = 'PHOTO'
      AND "photo_perspective" IS NOT NULL
      AND "display_order" IS NOT NULL
      AND "display_order" >= 0
      AND "document_definition_id" IS NULL
      AND "document_type" IS NULL
      AND "expires_at" IS NULL
    )
    OR
    (
      "kind" = 'DOCUMENT'
      AND "photo_perspective" IS NULL
      AND "display_order" IS NULL
      AND NOT "is_cover"
      AND "document_definition_id" IS NOT NULL
      AND "document_type" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "vehicle_change_proposals_one_active_per_vehicle_key"
  ON "vehicle_change_proposals"("vehicle_id")
  WHERE "status" IN (
    'DRAFT',
    'PENDING_OWNER_APPROVAL',
    'OWNER_CHANGES_REQUIRED',
    'PENDING_PLATFORM_REVIEW',
    'PLATFORM_CHANGES_REQUIRED'
  );

CREATE INDEX "vehicle_change_proposals_vehicle_id_created_at_idx"
  ON "vehicle_change_proposals"("vehicle_id", "created_at");
CREATE INDEX "vehicle_change_proposals_owner_profile_id_status_submitted_at_idx"
  ON "vehicle_change_proposals"("owner_profile_id", "status", "submitted_at");
CREATE INDEX "vehicle_change_proposals_submitted_by_membership_id_created_at_idx"
  ON "vehicle_change_proposals"("submitted_by_membership_id", "created_at");
CREATE INDEX "vehicle_change_proposals_status_platform_review_required_submitted_at_idx"
  ON "vehicle_change_proposals"("status", "platform_review_required", "submitted_at");
CREATE INDEX "vehicle_change_proposal_assets_proposal_id_kind_display_order_idx"
  ON "vehicle_change_proposal_assets"("proposal_id", "kind", "display_order");
CREATE INDEX "vehicle_change_proposal_assets_document_definition_id_idx"
  ON "vehicle_change_proposal_assets"("document_definition_id");

ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_vehicle_id_owner_profile_id_fkey"
  FOREIGN KEY ("vehicle_id", "owner_profile_id")
  REFERENCES "vehicles"("id", "owner_profile_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_owner_profile_id_fkey"
  FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_submitted_by_user_id_fkey"
  FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_submitted_membership_workspace_fkey"
  FOREIGN KEY ("submitted_by_membership_id", "owner_profile_id")
  REFERENCES "owner_staff_memberships"("id", "owner_profile_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_owner_reviewed_by_user_id_fkey"
  FOREIGN KEY ("owner_reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposals"
  ADD CONSTRAINT "vehicle_change_proposals_platform_reviewed_by_admin_id_fkey"
  FOREIGN KEY ("platform_reviewed_by_admin_id") REFERENCES "admin_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_change_proposal_assets"
  ADD CONSTRAINT "vehicle_change_proposal_assets_proposal_id_fkey"
  FOREIGN KEY ("proposal_id") REFERENCES "vehicle_change_proposals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposal_assets"
  ADD CONSTRAINT "vehicle_change_proposal_assets_file_asset_id_fkey"
  FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_change_proposal_assets"
  ADD CONSTRAINT "vehicle_change_proposal_assets_document_definition_id_fkey"
  FOREIGN KEY ("document_definition_id") REFERENCES "vehicle_document_definitions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_vehicle_change_proposal_submitter()
RETURNS trigger AS $$
DECLARE
  membership "owner_staff_memberships"%ROWTYPE;
BEGIN
  SELECT * INTO membership
  FROM "owner_staff_memberships"
  WHERE "id" = NEW."submitted_by_membership_id";

  IF membership."owner_profile_id" <> NEW."owner_profile_id"
    OR membership."user_id" IS DISTINCT FROM NEW."submitted_by_user_id"
    OR membership."role" <> 'MANAGER'
    OR membership."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'vehicle proposal submitter must be its active Manager membership actor';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "vehicle_change_proposal_submitter_guard"
BEFORE INSERT OR UPDATE OF "submitted_by_user_id", "submitted_by_membership_id", "owner_profile_id"
ON "vehicle_change_proposals"
FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_change_proposal_submitter();

CREATE FUNCTION enforce_vehicle_change_proposal_asset_privacy()
RETURNS trigger AS $$
DECLARE
  asset_classification "FileClassification";
BEGIN
  SELECT "classification" INTO asset_classification
  FROM "file_assets"
  WHERE "id" = NEW."file_asset_id";

  IF asset_classification = 'PUBLIC'
    OR EXISTS (SELECT 1 FROM "vehicle_photos" WHERE "file_asset_id" = NEW."file_asset_id")
    OR EXISTS (SELECT 1 FROM "vehicle_documents" WHERE "file_asset_id" = NEW."file_asset_id") THEN
    RAISE EXCEPTION 'proposal assets must remain non-public and detached from the live vehicle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "vehicle_change_proposal_asset_privacy_guard"
BEFORE INSERT OR UPDATE OF "file_asset_id" ON "vehicle_change_proposal_assets"
FOR EACH ROW EXECUTE FUNCTION enforce_vehicle_change_proposal_asset_privacy();

CREATE FUNCTION prevent_live_use_of_active_vehicle_change_proposal_asset()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "vehicle_change_proposal_assets" asset
    JOIN "vehicle_change_proposals" proposal ON proposal."id" = asset."proposal_id"
    WHERE asset."file_asset_id" = NEW."file_asset_id"
      AND proposal."status" IN (
        'DRAFT',
        'PENDING_OWNER_APPROVAL',
        'OWNER_CHANGES_REQUIRED',
        'PENDING_PLATFORM_REVIEW',
        'PLATFORM_CHANGES_REQUIRED'
      )
  ) THEN
    RAISE EXCEPTION 'active proposal assets cannot be attached to the live vehicle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "vehicle_photos_proposal_asset_guard"
BEFORE INSERT OR UPDATE OF "file_asset_id" ON "vehicle_photos"
FOR EACH ROW EXECUTE FUNCTION prevent_live_use_of_active_vehicle_change_proposal_asset();

CREATE TRIGGER "vehicle_documents_proposal_asset_guard"
BEFORE INSERT OR UPDATE OF "file_asset_id" ON "vehicle_documents"
FOR EACH ROW EXECUTE FUNCTION prevent_live_use_of_active_vehicle_change_proposal_asset();

CREATE FUNCTION prevent_active_vehicle_change_proposal_asset_publication()
RETURNS trigger AS $$
BEGIN
  IF NEW."classification" = 'PUBLIC' AND EXISTS (
    SELECT 1
    FROM "vehicle_change_proposal_assets" asset
    JOIN "vehicle_change_proposals" proposal ON proposal."id" = asset."proposal_id"
    WHERE asset."file_asset_id" = NEW."id"
      AND proposal."status" IN (
        'DRAFT',
        'PENDING_OWNER_APPROVAL',
        'OWNER_CHANGES_REQUIRED',
        'PENDING_PLATFORM_REVIEW',
        'PLATFORM_CHANGES_REQUIRED'
      )
  ) THEN
    RAISE EXCEPTION 'active proposal assets cannot be made public';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "file_assets_active_proposal_publication_guard"
BEFORE UPDATE OF "classification" ON "file_assets"
FOR EACH ROW EXECUTE FUNCTION prevent_active_vehicle_change_proposal_asset_publication();
