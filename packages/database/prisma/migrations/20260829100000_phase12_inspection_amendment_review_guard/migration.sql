-- Replace the original blanket append-only trigger with a narrow review guard.
-- Proposal evidence remains immutable; only the pending review fields may change once.
DROP TRIGGER IF EXISTS "inspection_amendments_append_only" ON "inspection_amendments";
DROP TRIGGER IF EXISTS "inspection_amendment_review_guard" ON "inspection_amendments";

CREATE OR REPLACE FUNCTION "guard_inspection_amendment_review"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inspection amendments are append-only' USING ERRCODE = '55000';
  END IF;
  IF OLD."status" <> 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'reviewed inspection amendments are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."inspection_id" IS DISTINCT FROM OLD."inspection_id"
     OR NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."proposed_odometer_meters" IS DISTINCT FROM OLD."proposed_odometer_meters"
     OR NEW."proposed_fuel_basis_points" IS DISTINCT FROM OLD."proposed_fuel_basis_points"
     OR NEW."proposed_battery_soc_basis_points" IS DISTINCT FROM OLD."proposed_battery_soc_basis_points"
     OR NEW."evidence" IS DISTINCT FROM OLD."evidence"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'inspection amendment proposal is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inspection_amendment_review_guard"
  BEFORE UPDATE OR DELETE ON "inspection_amendments"
  FOR EACH ROW EXECUTE FUNCTION "guard_inspection_amendment_review"();
