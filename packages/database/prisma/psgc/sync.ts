import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { Pool } from 'pg';

loadEnvironment({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true });

interface Area {
  readonly code: string;
  readonly name: string;
  readonly searchName: string;
  readonly level: string;
  readonly parentCode: string | null;
  readonly regionCode: string;
  readonly provinceCode: string | null;
  readonly cityMunicipalityCode: string | null;
  readonly correspondenceCode: string | null;
  readonly cityClass: string | null;
  readonly oldName: string | null;
  readonly datasetVersion: string;
}

async function sync() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const sourceArgument = process.argv.slice(2).find((argument) => argument !== '--');
  const sourcePath = resolve(process.cwd(), sourceArgument ?? 'reference/psgc-2q-2026.json');
  const payload = JSON.parse(await readFile(sourcePath, 'utf8')) as {
    metadata: { datasetVersion: string };
    areas: Area[];
  };
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let start = 0; start < payload.areas.length; start += 1_000) {
      const chunk = payload.areas.slice(start, start + 1_000);
      await client.query(
        `INSERT INTO geographic_areas (
          code, name, search_name, level, parent_code, region_code, province_code,
          city_municipality_code, correspondence_code, city_class, old_name,
          dataset_version, active, imported_at
        )
        SELECT
          item.code, item.name, item.search_name, item.level::"GeographicAreaLevel",
          item.parent_code, item.region_code, item.province_code, item.city_municipality_code,
          item.correspondence_code, item.city_class, item.old_name,
          item.dataset_version, TRUE, NOW()
        FROM jsonb_to_recordset($1::jsonb) AS item(
          code text, name text, search_name text, level text, parent_code text,
          region_code text, province_code text, city_municipality_code text,
          correspondence_code text, city_class text, old_name text, dataset_version text
        )
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          search_name = EXCLUDED.search_name,
          level = EXCLUDED.level,
          parent_code = EXCLUDED.parent_code,
          region_code = EXCLUDED.region_code,
          province_code = EXCLUDED.province_code,
          city_municipality_code = EXCLUDED.city_municipality_code,
          correspondence_code = EXCLUDED.correspondence_code,
          city_class = EXCLUDED.city_class,
          old_name = EXCLUDED.old_name,
          dataset_version = EXCLUDED.dataset_version,
          active = TRUE,
          imported_at = NOW()`,
        [
          JSON.stringify(
            chunk.map((area) => ({
              city_class: area.cityClass,
              city_municipality_code: area.cityMunicipalityCode,
              code: area.code,
              correspondence_code: area.correspondenceCode,
              dataset_version: area.datasetVersion,
              level: area.level,
              name: area.name,
              old_name: area.oldName,
              parent_code: area.parentCode,
              province_code: area.provinceCode,
              region_code: area.regionCode,
              search_name: area.searchName,
            })),
          ),
        ],
      );
    }
    await client.query('UPDATE geographic_areas SET active = FALSE WHERE dataset_version <> $1', [
      payload.metadata.datasetVersion,
    ]);
    await client.query('COMMIT');
    console.log(`Synchronized ${payload.areas.length} ${payload.metadata.datasetVersion} areas.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void sync();
