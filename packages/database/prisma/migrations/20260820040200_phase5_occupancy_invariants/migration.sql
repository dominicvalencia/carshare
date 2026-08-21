-- Close cross-table integrity gaps that cannot be expressed in Prisma schema syntax.
CREATE OR REPLACE FUNCTION "validate_booking_occupancy"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  booking_vehicle_id UUID;
  booking_status "BookingStatus";
BEGIN
  IF NEW."type" <> 'BOOKING_RESERVATION' THEN
    RETURN NEW;
  END IF;

  SELECT "vehicle_id", "status"
    INTO booking_vehicle_id, booking_status
    FROM "bookings"
    WHERE "id" = NEW."booking_id";

  IF booking_vehicle_id IS NULL OR booking_vehicle_id <> NEW."vehicle_id" THEN
    RAISE EXCEPTION 'booking occupancy vehicle must match booking vehicle'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."active"
    AND booking_status IN ('HOLD', 'AWAITING_PAYMENT', 'AWAITING_OWNER')
    AND NEW."expires_at" IS NULL
  THEN
    RAISE EXCEPTION 'temporary booking occupancy requires expires_at'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "vehicle_occupancies_validate_booking"
BEFORE INSERT OR UPDATE OF "vehicle_id", "booking_id", "type", "active", "expires_at"
ON "vehicle_occupancies"
FOR EACH ROW EXECUTE FUNCTION "validate_booking_occupancy"();

CREATE OR REPLACE FUNCTION "prevent_booking_vehicle_mismatch"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."vehicle_id" <> OLD."vehicle_id"
    AND EXISTS (
      SELECT 1
      FROM "vehicle_occupancies"
      WHERE "booking_id" = NEW."id" AND "vehicle_id" <> NEW."vehicle_id"
    )
  THEN
    RAISE EXCEPTION 'booking vehicle cannot diverge from its occupancy vehicle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "bookings_prevent_vehicle_mismatch"
BEFORE UPDATE OF "vehicle_id" ON "bookings"
FOR EACH ROW EXECUTE FUNCTION "prevent_booking_vehicle_mismatch"();

-- Expiration analytics are derived from the append-only transition record and
-- therefore commit atomically with booking expiration and its outbox event.
CREATE OR REPLACE FUNCTION "record_booking_expiration_analytics"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."to_status" = 'EXPIRED'
    AND NEW."reason_code" IN ('HOLD_EXPIRED', 'OWNER_RESPONSE_EXPIRED')
  THEN
    INSERT INTO "analytics_events" (
      "id", "event_type", "booking_id", "correlation_id", "occurred_at"
    ) VALUES (
      gen_random_uuid(),
      CASE
        WHEN NEW."reason_code" = 'HOLD_EXPIRED' THEN 'BOOKING_HOLD_EXPIRED'
        ELSE 'BOOKING_OWNER_RESPONSE_EXPIRED'
      END,
      NEW."booking_id",
      NEW."correlation_id",
      NEW."occurred_at"
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "booking_status_history_expiration_analytics"
AFTER INSERT ON "booking_status_history"
FOR EACH ROW EXECUTE FUNCTION "record_booking_expiration_analytics"();
