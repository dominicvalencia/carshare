import type { QueryClient } from '@tanstack/react-query';
import { refreshOwnerRequestAuthorities } from './owner-request-freshness';

export function invalidateBookingLifecycle(client: QueryClient, reference?: string | null): void {
  void refreshOwnerRequestAuthorities(client);
  const keys: readonly (readonly unknown[])[] = [
    ['bookings'],
    ['owner-rentals'],
    ['owner-dashboard'],
    ['vehicles'],
    ['public-search'],
    ['public-vehicle'],
    ['notifications'],
    ['notification-summary'],
    ['conversations'],
  ];
  for (const queryKey of keys) void client.invalidateQueries({ queryKey });
  if (!reference) return;
  for (const queryKey of [
    ['booking', reference],
    ['rental', reference],
    ['owner-booking', reference],
    ['owner-rental', reference],
  ])
    void client.invalidateQueries({ queryKey });
}
