ALTER TABLE "inspection_media"
  DROP CONSTRAINT IF EXISTS "inspection_media_file_asset_id_key";

CREATE UNIQUE INDEX IF NOT EXISTS "inspection_media_inspection_id_file_asset_id_key"
  ON "inspection_media"("inspection_id", "file_asset_id");

-- Backfill only snapshots with no evidence and exactly one historical known-issue match.
-- Ambiguous snapshots remain unchanged rather than attaching potentially incorrect evidence.
DROP TABLE IF EXISTS "migration48_known_issue_evidence_backfill";

CREATE TEMP TABLE "migration48_known_issue_evidence_backfill" AS
SELECT
  ici."id" AS "issue_id",
  ici."inspection_id",
  vkie."file_asset_id",
  ici."created_by_user_id" AS "submitted_by_id"
FROM "inspection_condition_issues" ici
JOIN "inspections" inspection ON inspection."id" = ici."inspection_id"
JOIN "bookings" booking ON booking."id" = inspection."booking_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "vehicle_known_issues" candidate
  WHERE candidate."vehicle_id" = booking."vehicle_id"
    AND candidate."category" = ici."category"
    AND candidate."vehicle_area" = ici."vehicle_area"
    AND candidate."classification" = ici."classification"
    AND candidate."description" = ici."description"
    AND candidate."created_at" <= ici."created_at"
) matched ON TRUE
JOIN "vehicle_known_issue_evidence" vkie ON vkie."issue_id" = matched."id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "inspection_condition_issue_evidence" existing
  WHERE existing."issue_id" = ici."id"
)
AND (
  SELECT COUNT(*)
  FROM "vehicle_known_issues" candidate
  WHERE candidate."vehicle_id" = booking."vehicle_id"
    AND candidate."category" = ici."category"
    AND candidate."vehicle_area" = ici."vehicle_area"
    AND candidate."classification" = ici."classification"
    AND candidate."description" = ici."description"
    AND candidate."created_at" <= ici."created_at"
) = 1;

WITH sequenced AS (
  SELECT
    backfill.*,
    COALESCE(existing."maximum_sequence", 0)
      + ROW_NUMBER() OVER (
          PARTITION BY backfill."inspection_id"
          ORDER BY backfill."issue_id", backfill."file_asset_id"
        ) AS "evidence_sequence"
  FROM "migration48_known_issue_evidence_backfill" backfill
  LEFT JOIN LATERAL (
    SELECT MAX(media."evidence_sequence") AS "maximum_sequence"
    FROM "inspection_media" media
    WHERE media."inspection_id" = backfill."inspection_id"
      AND media."perspective" = 'ADDITIONAL'
  ) existing ON TRUE
)
INSERT INTO "inspection_media" (
  "id",
  "inspection_id",
  "file_asset_id",
  "perspective",
  "evidence_sequence",
  "submitted_by_id",
  "created_at"
)
SELECT
  gen_random_uuid(),
  sequenced."inspection_id",
  sequenced."file_asset_id",
  'ADDITIONAL',
  sequenced."evidence_sequence",
  sequenced."submitted_by_id",
  CURRENT_TIMESTAMP
FROM sequenced
ON CONFLICT ("inspection_id", "file_asset_id") DO NOTHING;

INSERT INTO "inspection_condition_issue_evidence" (
  "issue_id",
  "inspection_media_id",
  "created_at"
)
SELECT
  backfill."issue_id",
  media."id",
  CURRENT_TIMESTAMP
FROM "migration48_known_issue_evidence_backfill" backfill
JOIN "inspection_media" media
  ON media."inspection_id" = backfill."inspection_id"
 AND media."file_asset_id" = backfill."file_asset_id"
ON CONFLICT ("issue_id", "inspection_media_id") DO NOTHING;

DROP TABLE "migration48_known_issue_evidence_backfill";
