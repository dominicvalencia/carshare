import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  invalidateReviewAuthorities,
  reviewDependentQueryKeys,
} from './invalidate-review-authorities';

describe('post-review cache refresh', () => {
  it('invalidates every authority that can change through direct or counterpart publication', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const client = { invalidateQueries } as unknown as QueryClient;

    await invalidateReviewAuthorities(client, 'CR-REVIEW-1');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['review-eligibility', 'CR-REVIEW-1'],
    });
    for (const queryKey of reviewDependentQueryKeys) {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey });
    }
    expect(invalidateQueries).toHaveBeenCalledTimes(reviewDependentQueryKeys.length + 1);
  });

  it('targets review, public discovery, and Owner renter-rating authorities without resetting all caches', () => {
    expect(reviewDependentQueryKeys).toEqual(
      expect.arrayContaining([
        ['my-reviews'],
        ['public-vehicle'],
        ['public-review-preview'],
        ['public-reviews'],
        ['public-host'],
        ['public-search'],
        ['owner-booking-requests'],
        ['owner-booking'],
        ['owner-rentals'],
      ]),
    );
    expect(reviewDependentQueryKeys).not.toContainEqual([]);
  });
});
