import type { QueryClient } from '@tanstack/react-query';

export const OWNER_REQUEST_POLL_INTERVAL_MS = 15_000;

export const ownerRequestAuthorityKeys = [
  ['owner-home'],
  ['owner-booking-requests'],
  ['owner-amendments'],
] as const;

export async function refreshOwnerRequestAuthorities(client: QueryClient): Promise<void> {
  await Promise.all(
    ownerRequestAuthorityKeys.map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}
