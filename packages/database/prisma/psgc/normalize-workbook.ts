import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

const DATASET_VERSION = 'PSGC_2Q_2026';
const SOURCE_AS_OF = '2026-06-30';
const SOURCE_URL = 'https://psa.gov.ph/system/files/scd/PSGC-2Q-2026-Publication-Datafile.xlsx';

type AreaLevel =
  | 'REGION'
  | 'PROVINCE'
  | 'SPECIAL_GEOGRAPHIC_AREA'
  | 'CITY'
  | 'MUNICIPALITY'
  | 'SUBMUNICIPALITY'
  | 'BARANGAY';

interface NormalizedArea {
  readonly code: string;
  readonly name: string;
  readonly searchName: string;
  readonly level: AreaLevel;
  readonly parentCode: string | null;
  readonly regionCode: string;
  readonly provinceCode: string | null;
  readonly cityMunicipalityCode: string | null;
  readonly correspondenceCode: string | null;
  readonly cityClass: string | null;
  readonly oldName: string | null;
  readonly datasetVersion: string;
}

const levelMap = new Map<string, AreaLevel>([
  ['Reg', 'REGION'],
  ['Prov', 'PROVINCE'],
  ['City', 'CITY'],
  ['Mun', 'MUNICIPALITY'],
  ['SubMun', 'SUBMUNICIPALITY'],
  ['Bgy', 'BARANGAY'],
]);

async function normalize() {
  const [sourcePath, outputPath] = process.argv.slice(2);
  if (!sourcePath || !outputPath) {
    throw new Error('Usage: normalize-workbook.ts <official-psgc.xlsx> <output.json>');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheet = workbook.getWorksheet('PSGC');
  if (!sheet) throw new Error('The official workbook does not contain a PSGC sheet.');

  const areas: NormalizedArea[] = [];
  let regionCode: string | null = null;
  let provinceCode: string | null = null;
  let localityCode: string | null = null;
  let immediateBarangayParent: string | null = null;
  let specialAreaCode: string | null = null;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const code = row.getCell(1).text.trim();
    const name = row.getCell(2).text.trim();
    const sourceLevel = row.getCell(4).text.trim();
    if (!code && !name && !sourceLevel) return;
    const level =
      levelMap.get(sourceLevel) ??
      (sourceLevel === '' &&
      (name.endsWith('(Not a Province)') || name === 'Special Geographic Area')
        ? 'SPECIAL_GEOGRAPHIC_AREA'
        : undefined);
    if (!level || !/^\d{10}$/.test(code) || !name) {
      throw new Error(`Unsupported PSGC row ${rowNumber}: ${code} ${name} ${sourceLevel}`);
    }
    const cityClass = nullable(row.getCell(6).text);
    let parentCode: string | null = null;
    if (level === 'REGION') {
      regionCode = code;
      provinceCode = null;
      localityCode = null;
      immediateBarangayParent = null;
      specialAreaCode = null;
    } else {
      if (!regionCode) throw new Error(`PSGC row ${rowNumber} has no region parent.`);
      if (level === 'PROVINCE') {
        parentCode = regionCode;
        provinceCode = code;
        localityCode = null;
        immediateBarangayParent = null;
        specialAreaCode = null;
      } else if (level === 'SPECIAL_GEOGRAPHIC_AREA') {
        parentCode = regionCode;
        provinceCode = null;
        localityCode = null;
        immediateBarangayParent = null;
        specialAreaCode = code;
      } else if (level === 'CITY' || level === 'MUNICIPALITY') {
        const isIndependentCity = cityClass === 'HUC' || cityClass === 'ICC';
        if (isIndependentCity) provinceCode = null;
        parentCode = provinceCode ?? specialAreaCode ?? regionCode;
        localityCode = code;
        immediateBarangayParent = code;
      } else if (level === 'SUBMUNICIPALITY') {
        parentCode = localityCode ?? regionCode;
        immediateBarangayParent = code;
      } else {
        parentCode = immediateBarangayParent ?? localityCode;
        if (!parentCode || !localityCode) {
          throw new Error(`Barangay row ${rowNumber} has no city or municipality parent.`);
        }
      }
    }
    areas.push({
      cityClass,
      cityMunicipalityCode:
        level === 'CITY' || level === 'MUNICIPALITY'
          ? code
          : level === 'SUBMUNICIPALITY' || level === 'BARANGAY'
            ? localityCode
            : null,
      code,
      correspondenceCode: nullable(row.getCell(3).text),
      datasetVersion: DATASET_VERSION,
      level,
      name,
      oldName: nullable(row.getCell(5).text),
      parentCode,
      provinceCode: level === 'PROVINCE' ? code : provinceCode,
      regionCode: level === 'REGION' ? code : regionCode!,
      searchName: normalizeSearch(name),
    });
  });

  const levels = [...new Set<AreaLevel>([...levelMap.values(), 'SPECIAL_GEOGRAPHIC_AREA'])];
  const counts = Object.fromEntries(
    levels.map((level) => [level, areas.filter((area) => area.level === level).length]),
  );
  if (counts.REGION !== 18 || counts.PROVINCE !== 82 || counts.BARANGAY !== 42_010) {
    throw new Error(`Unexpected official PSGC counts: ${JSON.stringify(counts)}`);
  }
  const sourceSha256 = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        metadata: {
          counts,
          datasetVersion: DATASET_VERSION,
          sourceAsOf: SOURCE_AS_OF,
          sourceSha256,
          sourceUrl: SOURCE_URL,
        },
        areas,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Normalized ${areas.length} PSGC areas from ${DATASET_VERSION}.`);
}

function nullable(value: string) {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

void normalize();
