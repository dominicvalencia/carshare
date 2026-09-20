-- An overdue Owner Collection may have been completed outside the app. In that
-- recovery case, participant acknowledgement replaces the missing travel event;
-- it does not replace the Owner's separate physical-receipt confirmation.
CREATE OR REPLACE FUNCTION "validate_handover_evidence_waiver"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
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
    IF NEW."waived_by_user_id" <> b."renter_user_id" OR b."actual_pickup_at" IS NULL
      OR b."actual_return_at" IS NOT NULL OR b."status" <> 'RETURN_PENDING'
      THEN RAISE EXCEPTION 'invalid Renter Return waiver'; END IF;
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
    SELECT 1 FROM "booking_fulfillment_snapshots" f
    JOIN "booking_handover_travel_events" e ON e."booking_id" = NEW."booking_id" AND e."phase" = 'RETURN' AND e."status" = 'ARRIVED'
    WHERE f."booking_id" = NEW."booking_id" AND f."end_method" = 'OWNER_COLLECTION'
      AND NEW."reported_physical_handover_at" < e."occurred_at"
  ) THEN RAISE EXCEPTION 'reported Return time cannot precede Collection arrival'; END IF;
  NEW."decided_at" := clock_timestamp();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "validate_handover_return_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "bookings"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "bookings" WHERE "id" = NEW."booking_id" FOR UPDATE;
  IF b."handover_workflow_version" IS DISTINCT FROM 1 OR NEW."confirmed_by_user_id" <> b."owner_user_id"
    OR b."status" <> 'RETURN_PENDING' OR b."actual_pickup_at" IS NULL OR b."actual_return_at" IS NOT NULL
    OR b."operational_hold" OR NOT EXISTS (SELECT 1 FROM "booking_handover_evidence_waivers" w WHERE w."booking_id" = b."id" AND w."phase" = 'RETURN')
    THEN RAISE EXCEPTION 'invalid Owner vehicle receipt'; END IF;
  IF EXISTS (SELECT 1 FROM "booking_fulfillment_snapshots" f WHERE f."booking_id" = b."id" AND f."end_method" = 'OWNER_COLLECTION')
    AND b."rental_end" + interval '120 minutes' >= clock_timestamp()
    AND NOT EXISTS (SELECT 1 FROM "booking_handover_travel_events" e WHERE e."booking_id" = b."id" AND e."phase" = 'RETURN' AND e."status" = 'ARRIVED')
    THEN RAISE EXCEPTION 'collection arrival required'; END IF;
  NEW."confirmed_at" := clock_timestamp();
  RETURN NEW;
END $$;
