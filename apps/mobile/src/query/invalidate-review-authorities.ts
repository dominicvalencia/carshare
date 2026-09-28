import type { QueryClient } from '@tanstack/react-query';

export const reviewDependentQueryKeys = [
  ['my-reviews'],
  ['public-vehicle'],
  ['public-review-preview'],
  ['public-reviews'],
  ['public-host'],
  ['public-search'],
  ['favorites'],
  ['renter-history', 'vehicles'],
  ['renter-recommendations'],
  ['owner-booking-requests'],
  ['owner-booking'],
  ['owner-rentals'],
] as const;

export async function invalidateReviewAuthorities(
  client: QueryClient,
  bookingReference: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['review-eligibility', bookingReference] }),
    ...reviewDependentQueryKeys.map((queryKey) => client.invalidateQueries({ queryKey })),
  ]);
}
