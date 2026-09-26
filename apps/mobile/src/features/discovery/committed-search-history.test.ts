import { describe, expect, it } from 'vitest';
import { committedSearchPayload } from './committed-search-history';

const base = {
  location: {
    city: 'Makati City',
    province: 'Metro Manila',
    latitude: 14.556789,
    longitude: 121.024567,
  },
  radiusKm: 25,
  datesExplicit: false,
  start: new Date('2026-09-25T09:00:00.000Z'),
  end: new Date('2026-09-27T09:00:00.000Z'),
  categoryId: '',
  make: '',
  seats: '',
  transmission: '',
  powertrain: '',
  minPrice: '',
  maxPrice: '',
  handover: 'ANY',
  returnHandover: 'ANY',
};

describe('committed search history payload', () => {
  it('omits provisional dates and unrelated private place detail', () => {
    const result = committedSearchPayload(base);
    expect(result).not.toHaveProperty('start');
    expect(result).not.toHaveProperty('end');
    expect(result).toMatchObject({ city: 'Makati City', datesExplicit: false, source: 'PLACE' });
    expect(result).not.toHaveProperty('addressLine1');
  });

  it('preserves explicit dates and selected criteria only', () => {
    expect(
      committedSearchPayload({
        ...base,
        datesExplicit: true,
        powertrain: 'BATTERY_ELECTRIC',
        seats: '7',
      }),
    ).toMatchObject({
      datesExplicit: true,
      start: '2026-09-25T09:00:00.000Z',
      end: '2026-09-27T09:00:00.000Z',
      powertrain: 'BATTERY_ELECTRIC',
      seats: 7,
    });
  });

  it('records return capability independently from pickup capability', () => {
    expect(
      committedSearchPayload({
        ...base,
        handover: 'DELIVERY_AVAILABLE',
        returnHandover: 'OWNER_COLLECTION_AVAILABLE',
      }),
    ).toMatchObject({
      handover: 'DELIVERY_AVAILABLE',
      returnHandover: 'OWNER_COLLECTION_AVAILABLE',
    });
  });

  it('does not give a device point a private address or city label', () => {
    const result = committedSearchPayload({
      ...base,
      location: { ...base.location, source: 'DEVICE' },
    });
    expect(result).toMatchObject({
      source: 'DEVICE',
      city: '',
      province: '',
      latitude: 0,
      longitude: 0,
    });
  });
});
