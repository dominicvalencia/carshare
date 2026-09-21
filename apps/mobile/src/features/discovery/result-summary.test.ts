import { describe, expect, it } from 'vitest';
import { formatResultSummary, uniqueVehicleCount } from './result-summary';

describe('Task 12C FULL_MAP result summary', () => {
  it('uses truthful more-results and final wording', () => {
    expect(
      formatResultSummary({
        hasNextPage: true,
        initialError: false,
        initialLoading: false,
        loadedCount: 5,
      }),
    ).toBe('Over 5 cars available');
    expect(
      formatResultSummary({
        hasNextPage: false,
        initialError: false,
        initialLoading: false,
        loadedCount: 5,
      }),
    ).toBe('5 cars available');
    expect(
      formatResultSummary({
        hasNextPage: false,
        initialError: false,
        initialLoading: false,
        loadedCount: 1,
      }),
    ).toBe('1 car available');
  });

  it('handles initial loading, initial failure, and successful empty results', () => {
    expect(
      formatResultSummary({
        hasNextPage: false,
        initialError: false,
        initialLoading: true,
        loadedCount: 0,
      }),
    ).toBe('Updating cars…');
    expect(
      formatResultSummary({
        hasNextPage: false,
        initialError: true,
        initialLoading: false,
        loadedCount: 0,
      }),
    ).toBe('Vehicle results unavailable');
    expect(
      formatResultSummary({
        hasNextPage: false,
        initialError: false,
        initialLoading: false,
        loadedCount: 0,
      }),
    ).toBe('No cars available in this area');
  });

  it('retains usable results during pagination loading, refresh, or pagination failure', () => {
    for (const state of [
      { initialError: false, initialLoading: true },
      { initialError: true, initialLoading: false },
      { initialError: false, initialLoading: false },
    ]) {
      expect(
        formatResultSummary({
          hasNextPage: true,
          loadedCount: 5,
          ...state,
        }),
      ).toBe('Over 5 cars available');
    }
  });

  it('counts unique loaded LIST vehicles by public vehicle identity', () => {
    expect(
      uniqueVehicleCount([
        { vehicleId: 'vehicle-1' },
        { vehicleId: 'vehicle-2' },
        { vehicleId: 'vehicle-1' },
      ]),
    ).toBe(2);
  });
});
