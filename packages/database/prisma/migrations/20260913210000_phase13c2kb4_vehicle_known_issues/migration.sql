CREATE TYPE "VehicleKnownIssueStatus" AS ENUM ('ACTIVE', 'RESOLVED');

CREATE TABLE "vehicle_known_issues" (
  "id" UUID NOT NULL,
  "vehicle_id" UUID NOT NULL,
  "category" "InspectionConditionCategory" NOT NULL,
  "vehicle_area" "InspectionConditionVehicleArea" NOT NULL,
  "classification" "InspectionConditionClassification" NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "status" "VehicleKnownIssueStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_by_user_id" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "vehicle_known_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_known_issues_resolution_state_check" CHECK (
    ("status" = 'ACTIVE' AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL)
    OR
    ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL)
  )
);

CREATE TABLE "vehicle_known_issue_evidence" (
  "issue_id" UUID NOT NULL,
  "file_asset_id" UUID NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_known_issue_evidence_pkey" PRIMARY KEY ("issue_id", "file_asset_id")
);

CREATE INDEX "vehicle_known_issues_vehicle_id_status_created_at_idx" ON "vehicle_known_issues"("vehicle_id", "status", "created_at");
CREATE INDEX "vehicle_known_issues_vehicle_id_classification_status_idx" ON "vehicle_known_issues"("vehicle_id", "classification", "status");
CREATE UNIQUE INDEX "vehicle_known_issue_evidence_file_asset_id_key" ON "vehicle_known_issue_evidence"("file_asset_id");
CREATE INDEX "vehicle_known_issue_evidence_issue_id_created_at_idx" ON "vehicle_known_issue_evidence"("issue_id", "created_at");
CREATE INDEX "vehicle_known_issue_evidence_uploaded_by_user_id_created_at_idx" ON "vehicle_known_issue_evidence"("uploaded_by_user_id", "created_at");

ALTER TABLE "vehicle_known_issues" ADD CONSTRAINT "vehicle_known_issues_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_known_issues" ADD CONSTRAINT "vehicle_known_issues_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_known_issues" ADD CONSTRAINT "vehicle_known_issues_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_known_issue_evidence" ADD CONSTRAINT "vehicle_known_issue_evidence_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "vehicle_known_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_known_issue_evidence" ADD CONSTRAINT "vehicle_known_issue_evidence_file_asset_id_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_known_issue_evidence" ADD CONSTRAINT "vehicle_known_issue_evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing booking inspection history is intentionally not backfilled into current vehicle state.
