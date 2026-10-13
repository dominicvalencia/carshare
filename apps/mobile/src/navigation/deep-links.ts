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
  const segments = path?.split('/').filter(Boolean) ?? [];
  const [resource, identifier] = segments;
  if (resource === 'owner' && identifier === 'vehicle-approvals' && segments[2])
    return { name: 'OwnerVehicleApproval', params: { vehicleId: segments[2] } };
  if (
    resource === 'owner' &&
    identifier === 'vehicle-change-proposals' &&
    segments[2] &&
    segments[3]
  )
    return {
      name: 'OwnerVehicleChangeProposal',
      params: { proposalId: segments[3], vehicleId: segments[2] },
    };
  if (resource === 'owner' && identifier === 'vehicles' && segments[2])
    return { name: 'OwnerWorkspaceVehicle', params: { vehicleId: segments[2] } };
  if (resource === 'bookings' && identifier)
    return path?.endsWith('/handover-recovery')
      ? { name: 'BookingRecovery', params: { bookingId: identifier } }
      : { name: 'Booking', params: { bookingId: identifier } };
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
  if (resource === 'verification') return { name: 'Verification' };
  return null;
}

export function isSafeRecoveryDeepLink(link: string, scheme = 'carrental'): boolean {
  try {
    const parsed = new URL(link);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return (
      parsed.protocol === `${scheme}:` &&
      parsed.hostname === 'bookings' &&
      segments.length === 2 &&
      segments[1] === 'handover-recovery' &&
      /^[A-Z0-9-]{6,100}$/u.test(segments[0] ?? '') &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}
