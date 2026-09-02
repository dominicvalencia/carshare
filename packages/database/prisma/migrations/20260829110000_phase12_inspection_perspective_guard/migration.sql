-- Accept the legacy combined cabin photo or the Phase 12 split interior/dashboard photos.
-- The API requires exactly one of every perspective; this database guard independently
-- verifies that all eight logical evidence views exist before finalization.
CREATE OR REPLACE FUNCTION "validate_inspection_finalization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  powertrain "VehiclePowertrain";
  required_count integer;
BEGIN
  IF OLD."status" = 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized inspection evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW."status" <> 'FINALIZED' THEN RETURN NEW; END IF;
  SELECT v."powertrain" INTO powertrain
  FROM "bookings" b JOIN "vehicles" v ON v."id" = b."vehicle_id"
  WHERE b."id" = NEW."booking_id";
  IF NEW."odometer_meters" IS NULL THEN RAISE EXCEPTION 'Odometer is required'; END IF;
  IF powertrain IN ('ICE', 'HYBRID', 'PLUG_IN_HYBRID') AND NEW."fuel_basis_points" IS NULL THEN
    RAISE EXCEPTION 'Fuel measurement is required for this powertrain';
  END IF;
  IF powertrain IN ('BATTERY_ELECTRIC', 'PLUG_IN_HYBRID') AND NEW."battery_soc_basis_points" IS NULL THEN
    RAISE EXCEPTION 'Battery SOC is required for this powertrain';
  END IF;
  IF powertrain = 'BATTERY_ELECTRIC' AND NEW."fuel_basis_points" IS NOT NULL THEN
    RAISE EXCEPTION 'Fuel measurement is not applicable to battery electric vehicles';
  END IF;
  SELECT
    count(DISTINCT "perspective") FILTER (WHERE "perspective" IN (
      'FRONT', 'REAR', 'DRIVER_SIDE', 'PASSENGER_SIDE', 'ODOMETER', 'FUEL_OR_BATTERY_DISPLAY'
    ))
    + CASE WHEN bool_or("perspective" IN ('INTERIOR_DASHBOARD', 'INTERIOR')) THEN 1 ELSE 0 END
    + CASE WHEN bool_or("perspective" IN ('INTERIOR_DASHBOARD', 'DASHBOARD')) THEN 1 ELSE 0 END
  INTO required_count
  FROM "inspection_media"
  WHERE "inspection_id" = NEW."id";
  IF required_count <> 8 THEN
    RAISE EXCEPTION 'Eight logical inspection perspectives are required';
  END IF;
  NEW."finalized_at" := clock_timestamp();
  RETURN NEW;
END;
$$;
