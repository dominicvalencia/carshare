import { describe, expect, it, vi } from 'vitest';
import { GeographyService } from './geography.service';

describe('GeographyService address hierarchy', () => {
  it('accepts a valid region-scoped address when no province applies', async () => {
    const areas = new Map([
      [
        '1900000000',
        {
          code: '1900000000',
          level: 'REGION',
          parentCode: null,
          provinceCode: null,
          regionCode: '1900000000',
        },
      ],
      [
        '1999900000',
        {
          code: '1999900000',
          level: 'CITY',
          parentCode: '1900000000',
          provinceCode: null,
          regionCode: '1900000000',
        },
      ],
      [
        '1999900001',
        {
          cityMunicipalityCode: '1999900000',
          code: '1999900001',
          level: 'BARANGAY',
          parentCode: '1999900000',
          provinceCode: null,
          regionCode: '1900000000',
        },
      ],
    ]);
    const findFirst = vi.fn(({ where }: { where: { code: string } }) =>
      Promise.resolve(areas.get(where.code) ?? null),
    );
    const service = new GeographyService({
      client: { geographicArea: { findFirst } },
    } as never);

    await expect(
      service.validateAddress({
        addressScopeCode: '1900000000',
        barangayCode: '1999900001',
        cityMunicipalityCode: '1999900000',
        regionCode: '1900000000',
      }),
    ).resolves.toMatchObject({
      city: { code: '1999900000' },
      province: null,
      region: { code: '1900000000' },
      scope: { code: '1900000000' },
    });
  });
});
