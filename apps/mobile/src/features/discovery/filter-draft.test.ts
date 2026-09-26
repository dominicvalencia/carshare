import { describe, expect, it } from 'vitest';
import {
  cloneDiscoveryFilters,
  DEFAULT_DISCOVERY_FILTERS,
  discoveryFiltersEqual,
  priceRangeError,
} from './filter-draft';

describe('Discovery filter draft', () => {
  it('clones committed filters without sharing an editable object', () => {
    const draft = cloneDiscoveryFilters(DEFAULT_DISCOVERY_FILTERS);
    expect(draft).toEqual(DEFAULT_DISCOVERY_FILTERS);
    expect(draft).not.toBe(DEFAULT_DISCOVERY_FILTERS);
  });

  it('detects changed and unchanged atomic apply payloads', () => {
    expect(discoveryFiltersEqual(DEFAULT_DISCOVERY_FILTERS, { ...DEFAULT_DISCOVERY_FILTERS })).toBe(
      true,
    );
    expect(
      discoveryFiltersEqual(DEFAULT_DISCOVERY_FILTERS, {
        ...DEFAULT_DISCOVERY_FILTERS,
        seats: '7',
      }),
    ).toBe(false);
    expect(
      discoveryFiltersEqual(DEFAULT_DISCOVERY_FILTERS, {
        ...DEFAULT_DISCOVERY_FILTERS,
        returnHandover: 'OWNER_COLLECTION_AVAILABLE',
      }),
    ).toBe(false);
  });

  it('validates the PHP daily price range', () => {
    expect(priceRangeError({ minPrice: '', maxPrice: '' })).toBe('');
    expect(priceRangeError({ minPrice: '2100', maxPrice: '3000' })).toBe('');
    expect(priceRangeError({ minPrice: '3100', maxPrice: '3000' })).toBe(
      'Minimum price cannot be greater than maximum price.',
    );
  });
});
