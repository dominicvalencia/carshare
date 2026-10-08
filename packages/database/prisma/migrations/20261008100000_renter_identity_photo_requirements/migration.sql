-- The former SELFIE evidence is already a camera-only face photo. Rename its
-- stable definition in place so existing document foreign keys and review
-- history remain intact, then add the second private identity-photo requirement.
UPDATE "renter_document_definitions"
SET
  "code" = 'PROFILE_PHOTO',
  "name" = 'Profile photo',
  "category" = 'IDENTITY_PHOTO',
  "accepted_mime_types" = ARRAY['image/jpeg', 'image/png']::TEXT[],
  "updated_at" = CURRENT_TIMESTAMP
WHERE "jurisdiction" = 'PH' AND "code" = 'SELFIE';

UPDATE "verification_documents" AS document
SET "document_type" = 'PROFILE_PHOTO'
FROM "renter_document_definitions" AS definition
WHERE document."definition_id" = definition."id"
  AND definition."jurisdiction" = 'PH'
  AND definition."code" = 'PROFILE_PHOTO'
  AND document."document_type" = 'SELFIE';

INSERT INTO "renter_document_definitions" (
  "id",
  "jurisdiction",
  "code",
  "name",
  "category",
  "verification_type",
  "required",
  "accepted_mime_types",
  "maximum_bytes",
  "active",
  "sort_order",
  "created_at",
  "updated_at"
)
VALUES (
  '20000000-0000-4000-8000-000000000006',
  'PH',
  'SELFIE_WITH_LICENSE',
  'Selfie with driver’s license',
  'IDENTITY_PHOTO',
  'IDENTITY',
  true,
  ARRAY['image/jpeg', 'image/png']::TEXT[],
  10485760,
  true,
  60,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("jurisdiction", "code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "category" = EXCLUDED."category",
  "verification_type" = EXCLUDED."verification_type",
  "required" = EXCLUDED."required",
  "accepted_mime_types" = EXCLUDED."accepted_mime_types",
  "active" = EXCLUDED."active",
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;
