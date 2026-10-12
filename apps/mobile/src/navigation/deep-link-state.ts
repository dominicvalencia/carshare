import type { getStateFromPath as getStateFromPathType } from '@react-navigation/native';
import type { MobileMode } from './routes';

type ParsedState = ReturnType<typeof getStateFromPathType>;

export function withDeepLinkParent(state: ParsedState, mode: MobileMode): ParsedState {
  if (!state?.routes.length || state.routes[0]?.name === 'Marketplace') return state;
  const destination = state.routes.at(-1)?.name ?? '';
  const parentTab = parentTabFor(destination, mode);
  const parentRoute =
    mode === 'owner' && parentTab === 'Requests'
      ? { name: 'Dashboard', params: { initialTab: 'Requests' } }
      : { name: parentTab };
  return {
    ...state,
    index: state.routes.length,
    routes: [
      {
        name: 'Marketplace',
        state: { index: 0, routes: [parentRoute], stale: true },
      },
      ...state.routes,
    ],
  } as ParsedState;
}

export function parentTabFor(destination: string, mode: MobileMode): string {
  if (destination === 'Conversation' || destination === 'Notifications') return 'Messages';
  if (destination === 'Booking' || destination === 'BookingRecovery' || destination === 'Claim')
    return mode === 'owner' ? 'Requests' : 'Bookings';
  if (destination === 'OwnerEarnings' || destination === 'Payout') return 'More';
  if (destination === 'OwnerVehicleApproval' || destination === 'OwnerWorkspaceVehicle')
    return 'Vehicles';
  if (['VehicleDetails', 'HostProfile', 'PublicReviews', 'Favorites'].includes(destination))
    return mode === 'owner' ? 'Dashboard' : 'Home';
  return mode === 'owner' ? 'More' : 'Profile';
}
