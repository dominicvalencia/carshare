import { describe, expect, it } from 'vitest';
import { areaRailTitle, exploreRailQuery, showTripRail, uniqueRailVehicles } from './explore-rails';

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
    expect(area.get('limit')).toBe('6');
    expect(area.get('mode')).toBe('LIST');
    expect(area.has('start')).toBe(false);
    expect(area.has('end')).toBe(false);
    expect(area.has('powertrain')).toBe(false);
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
    const electric = exploreRailQuery(makati, 25, 'AREA', {
      powertrain: 'BATTERY_ELECTRIC',
    });
    expect(suv.get('categoryId')).toBe('suv');
    expect(seven.get('seats')).toBe('7');
    expect(electric).toBe(exploreRailQuery(makati, 25, 'ELECTRIC'));
  });

  it('deduplicates within a rail but permits a vehicle in different rails', () => {
    const car = { vehicleId: 'one' };
    const area = uniqueRailVehicles([car, car, { vehicleId: 'two' }]);
    const electric = uniqueRailVehicles([car]);
    expect(area.map(({ vehicleId }) => vehicleId)).toEqual(['one', 'two']);
    expect(electric.map(({ vehicleId }) => vehicleId)).toEqual(['one']);
  });
});
