import type { RootStackParamList } from './routes';

export type InternalDestination = {
  [K in keyof RootStackParamList]: RootStackParamList[K] extends undefined
    ? { readonly name: K }
    : { readonly name: K; readonly params: RootStackParamList[K] };
}[keyof RootStackParamList];

export function internalDestination(
  link: string | null,
  scheme = 'carrental',
): InternalDestination | null {
  const prefix = `${scheme}://`;
  if (!link?.startsWith(prefix)) return null;
  const [path] = link.slice(prefix.length).split(/[?#]/, 1);
  const [resource, identifier] = path?.split('/').filter(Boolean) ?? [];
  if (resource === 'bookings' && identifier)
    return { name: 'Booking', params: { bookingId: identifier } };
  if (resource === 'messages' && identifier)
    return { name: 'Conversation', params: { conversationId: identifier } };
  if (resource === 'claims' && identifier)
    return { name: 'Claim', params: { claimId: identifier } };
  if (resource === 'support')
    return { name: 'Support', params: identifier ? { ticketId: identifier } : undefined };
  if (resource === 'earnings') return { name: 'OwnerEarnings' };
  if (resource === 'payouts' && identifier)
    return { name: 'Payout', params: { payoutId: identifier } };
  if (resource === 'notifications') return { name: 'Notifications' };
  return null;
}
