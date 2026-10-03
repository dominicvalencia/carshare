import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  OWNER_REQUEST_POLL_INTERVAL_MS,
  ownerRequestAuthorityKeys,
  refreshOwnerRequestAuthorities,
} from './owner-request-freshness';

describe('Owner request freshness', () => {
  it('refreshes cross-session booking and amendment authorities without appending duplicates', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let server = {
      amendments: [] as string[],
      bookings: [] as string[],
      home: { amendmentRequestsCount: 0, bookingRequestsCount: 0, totalRequestsCount: 0 },
    };
    const observers = [
      new QueryObserver(client, {
        queryFn: async () => server.home,
        queryKey: ownerRequestAuthorityKeys[0],
      }),
      new QueryObserver(client, {
        queryFn: async () => server.bookings,
        queryKey: ownerRequestAuthorityKeys[1],
      }),
      new QueryObserver(client, {
        queryFn: async () => server.amendments,
        queryKey: [...ownerRequestAuthorityKeys[2], 'ACTIONABLE'],
      }),
    ];
    const unsubscribes = observers.map((observer) => observer.subscribe(() => undefined));
    await Promise.all(observers.map((observer) => observer.refetch()));

    server = {
      amendments: ['AMENDMENT-1'],
      bookings: ['BOOKING-1'],
      home: { amendmentRequestsCount: 1, bookingRequestsCount: 1, totalRequestsCount: 2 },
    };
    await refreshOwnerRequestAuthorities(client);
    await refreshOwnerRequestAuthorities(client);

    expect(client.getQueryData(ownerRequestAuthorityKeys[0])).toEqual(server.home);
    expect(client.getQueryData(ownerRequestAuthorityKeys[1])).toEqual(['BOOKING-1']);
    expect(client.getQueryData([...ownerRequestAuthorityKeys[2], 'ACTIONABLE'])).toEqual([
      'AMENDMENT-1',
    ]);
    expect(OWNER_REQUEST_POLL_INTERVAL_MS).toBe(15_000);
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    client.clear();
  });

  it('preserves last good data when a background refresh fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let fails = false;
    const observer = new QueryObserver(client, {
      queryFn: async () => {
        if (fails) throw new Error('temporary network failure');
        return { totalRequestsCount: 1 };
      },
      queryKey: ownerRequestAuthorityKeys[0],
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    fails = true;
    await refreshOwnerRequestAuthorities(client);

    expect(client.getQueryData(ownerRequestAuthorityKeys[0])).toEqual({ totalRequestsCount: 1 });
    unsubscribe();
    client.clear();
  });
});
