import type { QueryClient } from '@tanstack/react-query';

export function invalidateRenterVerification(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ['renter-verification'] }),
    client.invalidateQueries({ queryKey: ['me'] }),
    client.invalidateQueries({ queryKey: ['renter-eligibility'] }),
    client.invalidateQueries({ queryKey: ['public-vehicle'] }),
    client.invalidateQueries({ queryKey: ['bookings'] }),
    client.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}
