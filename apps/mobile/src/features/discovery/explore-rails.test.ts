import { describe, expect, it } from 'vitest';
import {
  areaRailTitle,
  contextualExploreRails,
  exploreRailQuery,
  showTripRail,
  uniqueRailVehicles,
} from './explore-rails';

const makati = { label: 'Makati City', latitude: 14.55, longitude: 121.02 };

describe('truthful Explore rail criteria', () => {
  it('names only an explicitly chosen device area as near you', () => {
    expect(areaRailTitle(false, makati)).toBe('Explore cars');
    expect(areaRailTitle(true, makati)).toBe('Cars in Makati City');
    expect(areaRailTitle(true, { ...makati, label: 'Current area', source: 'DEVICE' })).toBe(
      'Cars near you',
    );
    expect(areaRailTitle(true, { ...makati, label: 'Current area' })).toBe('Explore cars');
  });

  it('uses bounded real search criteria without claiming default-date availability', () => {
    const area = new URLSearchParams(exploreRailQuery(makati, 25, 'AREA'));
    const electric = new URLSearchParams(exploreRailQuery(makati, 25, 'ELECTRIC'));
    expect(area.get('latitude')).toBe('14.55');
    expect(area.get('longitude')).toBe('121.02');
    expect(area.get('radius')).toBe('25');
    expect(area.get('limit')).toBe('18');
    expect(area.get('mode')).toBe('LIST');
    expect(area.has('start')).toBe(false);
    expect(area.has('end')).toBe(false);
    expect(area.has('powertrain')).toBe(false);
    expect(electric.get('limit')).toBe('6');
    expect(electric.get('powertrain')).toBe('BATTERY_ELECTRIC');
    expect(exploreRailQuery(makati, 25, 'AREA')).not.toBe(exploreRailQuery(makati, 25, 'ELECTRIC'));
  });

  it('requires explicitly selected valid dates for the trip rail', () => {
    const start = new Date('2026-09-25T09:00:00.000Z');
    const end = new Date('2026-09-27T09:00:00.000Z');
    expect(showTripRail(false, start, end)).toBe(false);
    expect(showTripRail(true, start, start)).toBe(false);
    expect(showTripRail(true, start, end)).toBe(true);
  });

  it('keeps Explore category shortcuts connected to the area rail criteria', () => {
    const suv = new URLSearchParams(exploreRailQuery(makati, 25, 'AREA', { categoryId: 'suv' }));
    const seven = new URLSearchParams(exploreRailQuery(makati, 25, 'AREA', { seats: '7' }));
    const electricArea = exploreRailQuery(makati, 25, 'AREA', {
      powertrain: 'BATTERY_ELECTRIC',
    });
    expect(suv.get('categoryId')).toBe('suv');
    expect(seven.get('seats')).toBe('7');
    expect(new URLSearchParams(electricArea).get('powertrain')).toBe('BATTERY_ELECTRIC');
  });

  it('keeps pickup and return capability criteria independent', () => {
    const query = new URLSearchParams(
      exploreRailQuery(makati, 25, 'AREA', {
        handover: 'DELIVERY_AVAILABLE',
        returnHandover: 'RENTER_RETURN_AVAILABLE',
      }),
    );
    expect(query.get('handover')).toBe('DELIVERY_AVAILABLE');
    expect(query.get('returnHandover')).toBe('RENTER_RETURN_AVAILABLE');
  });

  it('applies global filters to every server-backed rail and uses authoritative newest sorting', () => {
    const filters = {
      categoryId: 'suv',
      handover: 'DELIVERY_AVAILABLE',
      make: 'Toyota',
      maxPrice: '4000',
      minPrice: '1000',
      seats: '7',
      transmission: 'AUTOMATIC',
    };
    const electric = new URLSearchParams(exploreRailQuery(makati, 25, 'ELECTRIC', filters));
    const recent = new URLSearchParams(exploreRailQuery(makati, 25, 'RECENT', filters));
    for (const query of [electric, recent]) {
      expect(query.get('categoryId')).toBe('suv');
      expect(query.get('handover')).toBe('DELIVERY_AVAILABLE');
      expect(query.get('make')).toBe('Toyota');
      expect(query.get('minPrice')).toBe('100000');
      expect(query.get('maxPrice')).toBe('400000');
      expect(query.get('seats')).toBe('7');
      expect(query.get('transmission')).toBe('AUTOMATIC');
    }
    expect(recent.get('sort')).toBe('NEWEST');
    expect(electric.get('sort')).toBe('RECOMMENDED');
  });

  it('deduplicates within a rail but permits a vehicle in different rails', () => {
    const car = { vehicleId: 'one' };
    const area = uniqueRailVehicles([car, car, { vehicleId: 'two' }]);
    const electric = uniqueRailVehicles([car]);
    expect(area.map(({ vehicleId }) => vehicleId)).toEqual(['one', 'two']);
    expect(electric.map(({ vehicleId }) => vehicleId)).toEqual(['one']);
  });

  it('keeps the primary rail first and orders budget-friendly cars by actual price', () => {
    const area = Array.from({ length: 8 }, (_, index) => ({
      vehicleId: `car-${index}`,
      category: { code: index < 3 ? 'SUV' : 'SEDAN', name: index < 3 ? 'SUV' : 'Sedan' },
      displayPrice: { amountMinor: (8 - index) * 100_000 },
    }));
    const rails = contextualExploreRails({
      area,
      electric: [],
      primaryTitle: 'Cars near you',
      recent: [],
    });
    expect(rails[0]?.key).toBe('PRIMARY');
    expect(rails[0]?.title).toBe('Cars near you');
    expect(
      rails.find(({ key }) => key === 'BUDGET')?.items.map(({ vehicleId }) => vehicleId),
    ).toEqual(['car-7', 'car-6', 'car-5']);
    expect(
      rails
        .find(({ key }) => key === 'SUV')
        ?.items.every(({ category }) => category?.code === 'SUV'),
    ).toBe(true);
  });

  it('omits secondary rails for small or repetitive inventory', () => {
    const area = ['one', 'two'].map((vehicleId, index) => ({
      vehicleId,
      category: { code: 'SUV', name: 'SUV' },
      displayPrice: { amountMinor: (index + 1) * 100_000 },
    }));
    expect(
      contextualExploreRails({ area, electric: area, primaryTitle: 'Cars near you', recent: area }),
    ).toEqual([{ key: 'PRIMARY', title: 'Cars near you', items: area }]);
  });

  it('uses a differentiated cheapest subset when the nearby catalog has five cars', () => {
    const area = Array.from({ length: 5 }, (_, index) => ({
      vehicleId: `car-${index}`,
      category: { code: 'SEDAN', name: 'Sedan' },
      displayPrice: { amountMinor: (5 - index) * 100_000 },
    }));
    const rails = contextualExploreRails({
      area,
      electric: [],
      primaryTitle: 'Cars near you',
      recent: area,
    });
    expect(rails.map(({ key }) => key)).toEqual(['PRIMARY', 'BUDGET']);
    expect(rails[1]?.items.map(({ vehicleId }) => vehicleId)).toEqual(['car-4', 'car-3', 'car-2']);
  });

  it('omits exact duplicate rail sets and never invents a popularity rail', () => {
    const area = Array.from({ length: 6 }, (_, index) => ({
      vehicleId: `car-${index}`,
      category: { code: 'SEDAN', name: 'Sedan' },
      displayPrice: { amountMinor: (index + 1) * 100_000 },
    }));
    const rails = contextualExploreRails({
      area,
      electric: area,
      primaryTitle: 'Cars near you',
      recent: area,
    });
    expect(rails.map(({ key }) => key)).toEqual(['PRIMARY', 'BUDGET']);
    expect(rails.some(({ title }) => title.includes('Popular'))).toBe(false);
  });

  it('renders server-filtered EV and recent rails only when each has enough unique cars', () => {
    const vehicle = (prefix: string, index: number) => ({
      vehicleId: `${prefix}-${index}`,
      category: { code: 'SEDAN', name: 'Sedan' },
      displayPrice: { amountMinor: (index + 1) * 100_000 },
    });
    const rails = contextualExploreRails({
      area: Array.from({ length: 7 }, (_, index) => vehicle('area', index)),
      electric: Array.from({ length: 3 }, (_, index) => vehicle('ev', index)),
      primaryTitle: 'Cars near you',
      recent: Array.from({ length: 3 }, (_, index) => vehicle('recent', index)),
    });
    expect(rails.find(({ key }) => key === 'ELECTRIC')?.items).toHaveLength(3);
    expect(rails.find(({ key }) => key === 'RECENT')?.items).toHaveLength(3);
  });
});
