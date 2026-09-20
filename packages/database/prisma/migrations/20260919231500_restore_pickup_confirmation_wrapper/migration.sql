-- Migration 55 extends the underlying evidence predicate. Reapply that change
-- to the pre-historical-report helper and restore Migration 52's outer guard.
CREATE OR REPLACE FUNCTION "booking_pre_historical_report_workflow_compliance_blocker"(booking_id uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b "bookings"%ROWTYPE; pickup "inspections"%ROWTYPE; returned "inspections"%ROWTYPE;
  start_waived boolean; return_waived boolean; blocker text;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = booking_id;
  IF NOT FOUND THEN RETURN 'BOOKING_MISSING'; END IF;
  IF b."handover_workflow_version" IS NULL THEN RETURN NULL; END IF;
  IF b."status" = 'CANCELLED' AND EXISTS (SELECT 1 FROM "booking_cancellation_settlements" s WHERE s."booking_id" = b."id") THEN RETURN NULL; END IF;
  IF b."handover_workflow_version" <> 1 THEN RETURN 'UNSUPPORTED_HANDOVER_WORKFLOW'; END IF;
  IF b."operational_hold" THEN RETURN 'OPERATIONS_HOLD'; END IF;
  SELECT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'START'
    AND w."waived_by_user_id" = b."owner_user_id" AND w."acknowledgement_version" = 'HANDOVER_EVIDENCE_WAIVER_V1') INTO start_waived;
  SELECT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'RETURN'
    AND w."acknowledgement_version" = 'HANDOVER_EVIDENCE_WAIVER_V1'
    AND (w."waived_by_user_id" = b."renter_user_id" OR (w."waived_by_user_id" = b."owner_user_id" AND EXISTS (
      SELECT 1 FROM "booking_fulfillment_snapshots" f WHERE f."booking_id" = b."id" AND f."end_method" = 'OWNER_COLLECTION'
    )))) INTO return_waived;
  IF NOT start_waived THEN
    blocker := "booking_verified_workflow_compliance_blocker"(b."id");
    IF blocker IN ('OWNER_INSPECTION_REQUIRED','RENTER_REVIEW_REQUIRED','DISCREPANCY_RESOLUTION_REQUIRED','PICKUP_VERIFICATION_REQUIRED') THEN RETURN blocker; END IF;
  END IF;
  IF b."actual_pickup_at" IS NULL OR NOT EXISTS (SELECT 1 FROM "inspection_verification_challenges" c WHERE c."booking_id" = b."id"
      AND c."issued_to_user_id" = b."renter_user_id" AND c."consumed_by_user_id" = b."owner_user_id" AND c."consumed_at" = b."actual_pickup_at")
    THEN RETURN 'PICKUP_VERIFICATION_REQUIRED'; END IF;
  IF return_waived THEN
    IF NOT EXISTS (SELECT 1 FROM "booking_handover_return_receipts" r WHERE r."booking_id" = b."id" AND r."confirmed_by_user_id" = b."owner_user_id"
      AND r."confirmed_at" = b."actual_return_at") THEN RETURN 'OWNER_RETURN_RECEIPT_REQUIRED'; END IF;
  ELSE
    SELECT * INTO returned FROM "inspections" i WHERE i."booking_id" = b."id" AND i."type" = 'RETURN' AND i."status" = 'FINALIZED'
      AND i."submitted_by_user_id" = b."renter_user_id" ORDER BY i."version" ASC LIMIT 1;
    IF returned."id" IS NULL OR returned."finalized_at" IS NULL THEN RETURN 'RENTER_RETURN_INSPECTION_REQUIRED'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id" AND c."role" = 'RENTER' AND c."user_id" = b."renter_user_id")
      OR NOT EXISTS (SELECT 1 FROM "inspection_confirmations" c WHERE c."inspection_id" = returned."id" AND c."role" = 'OWNER' AND c."user_id" = b."owner_user_id")
      THEN RETURN 'OWNER_RETURN_REVIEW_REQUIRED'; END IF;
  END IF;
  IF b."actual_return_at" IS NULL OR b."status" NOT IN ('RETURNED', 'COMPLETED') THEN RETURN 'RETURN_COMPLETION_REQUIRED'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "booking_workflow_compliance_blocker"(booking_id uuid)
RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = booking_id;
  IF b."handover_workflow_version" = 1
    AND EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'START')
    AND NOT EXISTS (SELECT 1 FROM "booking_pickup_handover_responses" r WHERE r."booking_id" = b."id"
      AND r."responded_by_user_id" = b."renter_user_id" AND r."decision" = 'CONFIRMED')
    THEN RETURN 'PICKUP_HANDOVER_TIME_CONFIRMATION_REQUIRED';
  END IF;
  RETURN "booking_pre_historical_report_workflow_compliance_blocker"(booking_id);
END $$;
