-- For an overdue Owner Collection, the verified Owner may record that the
-- vehicle was already received without the normal Return inspection. The
-- immutable waiver remains reduced-evidence context, while the separate Owner
-- receipt remains the custody-completion authority.
CREATE OR REPLACE FUNCTION "validate_handover_evidence_waiver"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "bookings"%ROWTYPE; owner_collection boolean;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  SELECT EXISTS (SELECT 1 FROM "booking_fulfillment_snapshots" f WHERE f."booking_id" = b."id" AND f."end_method" = 'OWNER_COLLECTION') INTO owner_collection;
  IF b."handover_workflow_version" IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'waiver requires supported B4 workflow'; END IF;
  IF NEW."phase" = 'START' THEN
    IF NEW."reported_physical_handover_at" IS NOT NULL THEN RAISE EXCEPTION 'Start handover time belongs to the participant report'; END IF;
    IF NEW."waived_by_user_id" <> b."owner_user_id" OR b."actual_pickup_at" IS NOT NULL
      OR b."status" <> 'READY_FOR_PICKUP' THEN RAISE EXCEPTION 'invalid Owner Start waiver'; END IF;
    IF b."operational_hold" OR EXISTS (SELECT 1 FROM "vehicles" v WHERE v."id" = b."vehicle_id" AND v."operational_status" <> 'AVAILABLE')
      OR EXISTS (SELECT 1 FROM "vehicle_known_issues" k WHERE k."vehicle_id" = b."vehicle_id" AND k."status" = 'ACTIVE' AND k."classification" = 'SAFETY_CRITICAL')
      OR EXISTS (SELECT 1 FROM "inspection_condition_issues" k JOIN "inspections" i ON i."id" = k."inspection_id" WHERE i."booking_id" = b."id" AND k."classification" = 'SAFETY_CRITICAL')
      OR EXISTS (SELECT 1 FROM "rental_incidents" i WHERE i."booking_id" = b."id" AND i."blocks_completion" AND i."status" IN ('OPEN', 'ACKNOWLEDGED'))
      OR EXISTS (SELECT 1 FROM "disputes" d WHERE d."booking_id" = b."id" AND d."blocks_completion" AND d."status" IN ('OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'))
      THEN RAISE EXCEPTION 'safety or Operations blocker prevents Start waiver'; END IF;
  ELSE
    IF NOT (
        (owner_collection AND b."rental_end" + interval '120 minutes' < clock_timestamp() AND NEW."waived_by_user_id" = b."owner_user_id")
        OR (NOT (owner_collection AND b."rental_end" + interval '120 minutes' < clock_timestamp()) AND NEW."waived_by_user_id" = b."renter_user_id")
      ) OR b."actual_pickup_at" IS NULL OR b."actual_return_at" IS NOT NULL OR b."status" <> 'RETURN_PENDING'
      THEN RAISE EXCEPTION 'invalid participant Return waiver'; END IF;
    IF b."operational_hold" THEN RAISE EXCEPTION 'Operations hold prevents Return waiver'; END IF;
    IF NEW."reported_physical_handover_at" IS NULL
      OR NEW."reported_physical_handover_at" < b."actual_pickup_at"
      OR NEW."reported_physical_handover_at" > clock_timestamp()
      THEN RAISE EXCEPTION 'reported Return time is outside the allowed booking window'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "inspections" i WHERE i."booking_id" = b."id" AND i."status" = 'FINALIZED'
      AND i."type" = CASE WHEN NEW."phase" = 'START' THEN 'PICKUP'::"InspectionType" ELSE 'RETURN'::"InspectionType" END)
    THEN RAISE EXCEPTION 'finalized evidence cannot be waived'; END IF;
  IF EXISTS (SELECT 1 FROM "booking_fulfillment_snapshots" f WHERE f."booking_id" = b."id"
      AND ((NEW."phase" = 'START' AND f."start_method" = 'OWNER_DELIVERY') OR (NEW."phase" = 'RETURN' AND f."end_method" = 'OWNER_COLLECTION')))
    AND NOT (NEW."phase" = 'RETURN' AND b."rental_end" + interval '120 minutes' < clock_timestamp())
    AND NOT EXISTS (SELECT 1 FROM "booking_handover_travel_events" e WHERE e."booking_id" = b."id" AND e."phase" = NEW."phase" AND e."status" = 'ARRIVED')
    THEN RAISE EXCEPTION 'travel arrival required before waiver'; END IF;
  IF NEW."phase" = 'RETURN' AND EXISTS (
    SELECT 1 FROM "booking_handover_travel_events" e
    WHERE e."booking_id" = NEW."booking_id" AND e."phase" = 'RETURN' AND e."status" = 'ARRIVED'
      AND NEW."reported_physical_handover_at" < e."occurred_at"
  ) THEN RAISE EXCEPTION 'reported Return time cannot precede Collection arrival'; END IF;
  NEW."decided_at" := clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "booking_workflow_compliance_blocker"(booking_id uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
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
