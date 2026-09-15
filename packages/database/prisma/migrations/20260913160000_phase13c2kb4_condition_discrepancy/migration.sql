CREATE TYPE "InspectionConditionDisclosureState" AS ENUM ('NOT_REVIEWED', 'NO_KNOWN_ISSUES', 'ISSUES_REPORTED');
CREATE TYPE "InspectionConditionCategory" AS ENUM ('SCRATCH', 'DENT', 'CRACK', 'PAINT_DAMAGE', 'WHEEL_OR_RIM', 'TIRE', 'GLASS', 'INTERIOR', 'WARNING_LIGHT', 'MECHANICAL_OR_OPERATIONAL', 'OTHER');
CREATE TYPE "InspectionConditionVehicleArea" AS ENUM ('FRONT_BUMPER', 'REAR_BUMPER', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'WINDSHIELD', 'WHEEL_OR_TIRE', 'INTERIOR', 'DASHBOARD', 'OTHER');
CREATE TYPE "InspectionConditionClassification" AS ENUM ('COSMETIC', 'OPERATIONAL', 'SAFETY_CRITICAL');
CREATE TYPE "PickupDiscrepancyResponseType" AS ENUM ('ACKNOWLEDGE_CONDITION', 'CLARIFY_EXISTING_EVIDENCE', 'REQUEST_SUPPORT');
CREATE TYPE "PickupDiscrepancyResolutionDecision" AS ENUM ('ACCEPTED', 'STILL_DISAGREES');

ALTER TABLE "inspections" ADD COLUMN "condition_disclosure_state" "InspectionConditionDisclosureState";

CREATE TABLE "inspection_condition_issues" (
  "id" UUID NOT NULL,
  "inspection_id" UUID NOT NULL,
  "category" "InspectionConditionCategory" NOT NULL,
  "vehicle_area" "InspectionConditionVehicleArea" NOT NULL,
  "classification" "InspectionConditionClassification" NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspection_condition_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inspection_condition_issue_evidence" (
  "issue_id" UUID NOT NULL,
  "inspection_media_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inspection_condition_issue_evidence_pkey" PRIMARY KEY ("issue_id", "inspection_media_id")
);

CREATE TABLE "pickup_discrepancy_responses" (
  "id" UUID NOT NULL,
  "original_confirmation_id" UUID NOT NULL,
  "incident_id" UUID NOT NULL,
  "response_type" "PickupDiscrepancyResponseType" NOT NULL,
  "response_text" VARCHAR(1000) NOT NULL,
  "acknowledged_condition_issue_id" UUID,
  "referenced_inspection_media_id" UUID,
  "responded_by_user_id" UUID NOT NULL,
  "responded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pickup_discrepancy_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pickup_discrepancy_resolution_reviews" (
  "id" UUID NOT NULL,
  "response_id" UUID NOT NULL,
  "decision" "PickupDiscrepancyResolutionDecision" NOT NULL,
  "reason" VARCHAR(1000),
  "reviewed_by_user_id" UUID NOT NULL,
  "reviewed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pickup_discrepancy_resolution_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inspection_condition_issues_inspection_id_classification_idx" ON "inspection_condition_issues"("inspection_id", "classification");
CREATE INDEX "inspection_condition_issues_classification_inspection_id_idx" ON "inspection_condition_issues"("classification", "inspection_id");
CREATE INDEX "inspection_condition_issue_evidence_inspection_media_id_idx" ON "inspection_condition_issue_evidence"("inspection_media_id");
CREATE UNIQUE INDEX "pickup_discrepancy_responses_original_confirmation_id_key" ON "pickup_discrepancy_responses"("original_confirmation_id");
CREATE UNIQUE INDEX "pickup_discrepancy_responses_incident_id_key" ON "pickup_discrepancy_responses"("incident_id");
CREATE INDEX "pickup_discrepancy_responses_responded_by_user_id_responded_at_idx" ON "pickup_discrepancy_responses"("responded_by_user_id", "responded_at");
CREATE UNIQUE INDEX "pickup_discrepancy_resolution_reviews_response_id_key" ON "pickup_discrepancy_resolution_reviews"("response_id");
CREATE INDEX "pickup_discrepancy_resolution_reviews_reviewed_by_user_id_reviewed_at_idx" ON "pickup_discrepancy_resolution_reviews"("reviewed_by_user_id", "reviewed_at");

ALTER TABLE "inspection_condition_issues" ADD CONSTRAINT "inspection_condition_issues_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_condition_issues" ADD CONSTRAINT "inspection_condition_issues_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_condition_issue_evidence" ADD CONSTRAINT "inspection_condition_issue_evidence_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "inspection_condition_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inspection_condition_issue_evidence" ADD CONSTRAINT "inspection_condition_issue_evidence_inspection_media_id_fkey" FOREIGN KEY ("inspection_media_id") REFERENCES "inspection_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_responses" ADD CONSTRAINT "pickup_discrepancy_responses_original_confirmation_id_fkey" FOREIGN KEY ("original_confirmation_id") REFERENCES "inspection_confirmations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_responses" ADD CONSTRAINT "pickup_discrepancy_responses_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "rental_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_responses" ADD CONSTRAINT "pickup_discrepancy_responses_acknowledged_condition_issue_id_fkey" FOREIGN KEY ("acknowledged_condition_issue_id") REFERENCES "inspection_condition_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_responses" ADD CONSTRAINT "pickup_discrepancy_responses_referenced_inspection_media_id_fkey" FOREIGN KEY ("referenced_inspection_media_id") REFERENCES "inspection_media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_responses" ADD CONSTRAINT "pickup_discrepancy_responses_responded_by_user_id_fkey" FOREIGN KEY ("responded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_resolution_reviews" ADD CONSTRAINT "pickup_discrepancy_resolution_reviews_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "pickup_discrepancy_responses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pickup_discrepancy_resolution_reviews" ADD CONSTRAINT "pickup_discrepancy_resolution_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_finalized_inspection_condition_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inspections" WHERE "id" = OLD."inspection_id" AND "status" = 'FINALIZED') THEN
    RAISE EXCEPTION 'Finalized inspection condition records are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_condition_issues_immutable_after_finalize"
BEFORE UPDATE OR DELETE ON "inspection_condition_issues"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_inspection_condition_mutation();

CREATE OR REPLACE FUNCTION prevent_finalized_condition_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "inspection_condition_issues" issue
    JOIN "inspections" inspection ON inspection."id" = issue."inspection_id"
    WHERE issue."id" = OLD."issue_id" AND inspection."status" = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'Finalized inspection condition evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_condition_issue_evidence_immutable_after_finalize"
BEFORE UPDATE OR DELETE ON "inspection_condition_issue_evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_condition_evidence_mutation();

CREATE OR REPLACE FUNCTION prevent_immutable_handover_record_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Handover discrepancy response and review records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "pickup_discrepancy_responses_immutable"
BEFORE UPDATE OR DELETE ON "pickup_discrepancy_responses"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_handover_record_mutation();

CREATE TRIGGER "pickup_discrepancy_resolution_reviews_immutable"
BEFORE UPDATE OR DELETE ON "pickup_discrepancy_resolution_reviews"
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_handover_record_mutation();
