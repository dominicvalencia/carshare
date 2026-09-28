-- Complete the forward correction of amendment-hold release authority.
-- The shared occupancy constraint requires release evidence whenever an
-- occupancy becomes inactive. Preserve the first release evidence on retries.
CREATE OR REPLACE FUNCTION "release_booking_amendment_holds"(
  amendment_uuid uuid,
  target_status "BookingAmendmentHoldStatus",
  release_code text
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  released_count integer;
BEGIN
  IF target_status = 'ACTIVE' THEN
    RAISE EXCEPTION 'release target must be terminal';
  END IF;

  UPDATE "vehicle_occupancies" occupancy
  SET "active" = false,
      "released_at" = COALESCE(occupancy."released_at", CURRENT_TIMESTAMP),
      "release_reason" = COALESCE(occupancy."release_reason", release_code)
  FROM "booking_amendment_holds" hold
  WHERE hold."amendment_id" = amendment_uuid
    AND hold."status" = 'ACTIVE'
    AND occupancy."id" = hold."occupancy_id"
    AND occupancy."active" = true;

  UPDATE "booking_amendment_holds"
  SET "status" = target_status,
      "released_at" = COALESCE("released_at", CURRENT_TIMESTAMP),
      "release_reason" = COALESCE("release_reason", release_code)
  WHERE "amendment_id" = amendment_uuid AND "status" = 'ACTIVE';
  GET DIAGNOSTICS released_count = ROW_COUNT;
  RETURN released_count;
END;
$$;
