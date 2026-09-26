import { describe, expect, it } from 'vitest';
import {
  VehicleHandoverFilter,
  VehicleReturnHandoverFilter,
  VehicleSearchMode,
  VehicleSearchSort,
} from './discovery.dto';
import { PublicVehiclesService } from './public-vehicles.service';

describe('public vehicle return filter criteria', () => {
  const service = Object.create(PublicVehiclesService.prototype) as PublicVehiclesService;
  const input = {
    latitude: '14.55',
    longitude: '121.02',
    radius: 25,
    mode: VehicleSearchMode.LIST,
    sort: VehicleSearchSort.RECOMMENDED,
    handover: VehicleHandoverFilter.DELIVERY_AVAILABLE,
    returnHandover: VehicleReturnHandoverFilter.OWNER_COLLECTION_AVAILABLE,
    limit: 10,
  };

  it('binds pickup and return capabilities into pagination cursor criteria', () => {
    const criteria = JSON.parse(
      (service as unknown as { cursorCriteria(value: typeof input): string }).cursorCriteria(input),
    ) as Record<string, unknown>;
    expect(criteria).toMatchObject({
      handover: 'DELIVERY_AVAILABLE',
      returnHandover: 'OWNER_COLLECTION_AVAILABLE',
    });
  });

  it('counts pickup and return restrictions independently', () => {
    expect(
      (service as unknown as { filterCount(value: typeof input): number }).filterCount(input),
    ).toBe(2);
  });
});
