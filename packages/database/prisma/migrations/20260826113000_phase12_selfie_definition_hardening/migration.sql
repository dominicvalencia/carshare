UPDATE "renter_document_definitions"
SET
  "name" = 'New camera selfie for manual review',
  "accepted_mime_types" = ARRAY['image/jpeg', 'image/png']::TEXT[],
  "updated_at" = CURRENT_TIMESTAMP
WHERE "jurisdiction" = 'PH' AND "code" = 'SELFIE';
