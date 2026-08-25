import { describe, expect, it } from 'vitest';
import { locationSearchProvider } from './location-provider';

describe('development location provider boundary', () => {
  it('returns curated Philippine areas without making coordinates a domain authority', async () => {
    expect(locationSearchProvider.mode).toBe('development-fallback');
    const cebu = await locationSearchProvider.suggestions('Cebu');
    expect(cebu).toHaveLength(1);
    expect(cebu[0]).toMatchObject({ city: 'Cebu City', province: 'Cebu' });
  });
});
