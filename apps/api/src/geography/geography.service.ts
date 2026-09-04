import { HttpStatus, Injectable } from '@nestjs/common';
import { GeographicAreaLevel } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';

const LOCALITY_LEVELS = [GeographicAreaLevel.CITY, GeographicAreaLevel.MUNICIPALITY] as const;

@Injectable()
export class GeographyService {
  constructor(private readonly database: DatabaseService) {}

  async regions() {
    const items = await this.database.client.geographicArea.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
      where: { active: true, level: GeographicAreaLevel.REGION },
    });
    return this.withVersion(items);
  }

  async scopes(regionCode: string) {
    await this.requireArea(regionCode, [GeographicAreaLevel.REGION]);
    const [areas, directLocalityCount] = await Promise.all([
      this.database.client.geographicArea.findMany({
        orderBy: { name: 'asc' },
        select: { code: true, level: true, name: true },
        where: {
          active: true,
          level: {
            in: [GeographicAreaLevel.PROVINCE, GeographicAreaLevel.SPECIAL_GEOGRAPHIC_AREA],
          },
          parentCode: regionCode,
        },
      }),
      this.database.client.geographicArea.count({
        where: { active: true, level: { in: [...LOCALITY_LEVELS] }, parentCode: regionCode },
      }),
    ]);
    const items = areas.map((area) => ({ ...area, kind: area.level }));
    if (directLocalityCount)
      items.unshift({
        code: regionCode,
        kind: GeographicAreaLevel.REGION,
        level: GeographicAreaLevel.REGION,
        name: areas.length ? 'Independent cities / municipalities' : 'Cities / municipalities',
      });
    return this.withVersion(items);
  }

  async localities(regionCode: string, scopeCode: string) {
    const scope = await this.requireArea(scopeCode, [
      GeographicAreaLevel.REGION,
      GeographicAreaLevel.PROVINCE,
      GeographicAreaLevel.SPECIAL_GEOGRAPHIC_AREA,
    ]);
    if (scope.regionCode !== regionCode)
      throw hierarchyError('The selected province or geographic area is outside the region.');
    const items = await this.database.client.geographicArea.findMany({
      orderBy: { name: 'asc' },
      select: { cityClass: true, code: true, level: true, name: true, provinceCode: true },
      where: {
        active: true,
        level: { in: [...LOCALITY_LEVELS] },
        OR: [{ parentCode: scopeCode }, { provinceCode: scopeCode }],
      },
    });
    return this.withVersion(items);
  }

  async barangays(localityCode: string, query = '', limit = 75) {
    await this.requireArea(localityCode, [...LOCALITY_LEVELS]);
    const normalizedQuery = normalizeSearch(query);
    const items = await this.database.client.geographicArea.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
      take: Math.min(Math.max(limit, 1), 100),
      where: {
        active: true,
        cityMunicipalityCode: localityCode,
        level: GeographicAreaLevel.BARANGAY,
        ...(normalizedQuery ? { searchName: { contains: normalizedQuery } } : {}),
      },
    });
    return this.withVersion(items);
  }

  async validateAddress(input: {
    regionCode: string;
    addressScopeCode: string;
    provinceCode?: string;
    cityMunicipalityCode: string;
    barangayCode: string;
  }) {
    const [region, scope, city, barangay, province] = await Promise.all([
      this.requireArea(input.regionCode, [GeographicAreaLevel.REGION]),
      this.requireArea(input.addressScopeCode, [
        GeographicAreaLevel.REGION,
        GeographicAreaLevel.PROVINCE,
        GeographicAreaLevel.SPECIAL_GEOGRAPHIC_AREA,
      ]),
      this.requireArea(input.cityMunicipalityCode, [...LOCALITY_LEVELS]),
      this.requireArea(input.barangayCode, [GeographicAreaLevel.BARANGAY]),
      input.provinceCode
        ? this.requireArea(input.provinceCode, [GeographicAreaLevel.PROVINCE])
        : Promise.resolve(null),
    ]);
    if (
      scope.regionCode !== region.code ||
      (city.parentCode !== scope.code && city.provinceCode !== scope.code) ||
      city.regionCode !== region.code ||
      (province ? city.provinceCode !== province.code : false)
    )
      throw hierarchyError('The selected city or municipality does not belong to that address.');
    if (province && province.regionCode !== region.code)
      throw hierarchyError('The selected province does not belong to that region.');
    if (barangay.cityMunicipalityCode !== city.code)
      throw hierarchyError('The selected barangay does not belong to that city or municipality.');
    return {
      barangay,
      city,
      province,
      region,
      scope,
    };
  }

  private requireArea(code: string, levels: GeographicAreaLevel[]) {
    if (!/^\d{10}$/.test(code)) throw hierarchyError('A valid ten-digit PSGC code is required.');
    return this.database.client.geographicArea
      .findFirst({
        where: { active: true, code, level: { in: levels } },
      })
      .then((area) => {
        if (!area) throw hierarchyError('The selected Philippine geographic area is not valid.');
        return area;
      });
  }

  private async withVersion<T>(items: T[]) {
    const current = await this.database.client.geographicArea.findFirst({
      orderBy: { importedAt: 'desc' },
      select: { datasetVersion: true },
      where: { active: true },
    });
    return { datasetVersion: current?.datasetVersion ?? null, items };
  }
}

function hierarchyError(message: string) {
  return new ApplicationException(
    'INVALID_PSGC_HIERARCHY',
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}
