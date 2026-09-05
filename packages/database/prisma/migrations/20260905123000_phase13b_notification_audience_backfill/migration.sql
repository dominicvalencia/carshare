UPDATE "notifications"
SET "audience" = 'OWNER'
WHERE "audience" = 'ACCOUNT'
  AND (
    "source_event_type" IN (
      'BOOKING_OWNER_REQUESTED',
      'BOOKING_AWAITING_OWNER',
      'INSPECTION_CORRECTION_REQUESTED',
      'INSPECTION_CORRECTION_REJECTED'
    )
    OR "source_event_type" LIKE 'EARNING\_%' ESCAPE '\'
    OR "source_event_type" LIKE 'PAYOUT\_%' ESCAPE '\'
  );

UPDATE "notifications"
SET "audience" = 'RENTER'
WHERE "audience" = 'ACCOUNT'
  AND (
    "source_event_type" IN ('BOOKING_CONFIRMED')
    OR "source_event_type" LIKE '%OWNER_ACCEPTED%'
    OR "source_event_type" LIKE '%OWNER_REJECTED%'
    OR "source_event_type" LIKE 'PAYMENT\_%' ESCAPE '\'
    OR "source_event_type" LIKE 'REFUND\_%' ESCAPE '\'
  );

UPDATE "notifications" AS notification
SET "audience" = CASE
  WHEN booking."owner_user_id" = notification."user_id" THEN 'OWNER'::"NotificationAudience"
  WHEN booking."renter_user_id" = notification."user_id" THEN 'RENTER'::"NotificationAudience"
  ELSE notification."audience"
END
FROM "bookings" AS booking
WHERE notification."audience" = 'ACCOUNT'
  AND (
    notification."source_id" = booking."id"
    OR EXISTS (
      SELECT 1
      FROM "messages" AS message
      JOIN "conversations" AS conversation ON conversation."id" = message."conversation_id"
      WHERE message."id" = notification."source_id"
        AND conversation."booking_id" = booking."id"
    )
    OR EXISTS (
      SELECT 1 FROM "post_return_claims" AS claim
      WHERE claim."id" = notification."source_id"
        AND claim."booking_id" = booking."id"
    )
    OR EXISTS (
      SELECT 1 FROM "reviews" AS review
      WHERE review."id" = notification."source_id"
        AND review."booking_id" = booking."id"
    )
  );
