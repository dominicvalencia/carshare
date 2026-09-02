-- Preserve authoritative regional parentage for HUC/ICC cities while adding
-- their source-derived geographic province association for address UX.
UPDATE "geographic_areas" AS city
SET "province_code" = province."code"
FROM "geographic_areas" AS province
WHERE city."active" = TRUE
  AND province."active" = TRUE
  AND city."level" = 'CITY'
  AND city."city_class" IN ('HUC', 'ICC')
  AND city."province_code" IS NULL
  AND province."level" = 'PROVINCE'
  AND city."region_code" = province."region_code"
  AND LEFT(city."correspondence_code", 4) = LEFT(province."correspondence_code", 4);
