import type { QueryClient } from '@tanstack/react-query';

export function invalidateBookingLifecycle(client: QueryClient, reference?: string | null): void {
  const keys: readonly (readonly unknown[])[] = [
    ['bookings'],
    ['owner-booking-requests'],
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
