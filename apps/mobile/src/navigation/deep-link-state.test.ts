import { describe, expect, it } from 'vitest';
import { parentTabFor, withDeepLinkParent } from './deep-link-state';

describe('deep-link parent state', () => {
  it('places the normal renter parent beneath a cold booking detail', () => {
    const state = withDeepLinkParent(
      { routes: [{ name: 'Booking', params: { bookingId: 'CR-1' } }] },
      'renter',
    );
    expect(state?.routes.map(({ name }) => name)).toEqual(['Marketplace', 'Booking']);
    expect(state?.routes[0]?.state?.routes[0]?.name).toBe('Bookings');
  });

  it.each([
    ['Conversation', 'Messages'],
    ['Notifications', 'Messages'],
    ['Claim', 'Bookings'],
    ['VehicleDetails', 'Home'],
    ['HostProfile', 'Home'],
    ['Favorites', 'Home'],
    ['Support', 'Profile'],
  ])('selects %s over its normal renter parent %s', (destination, parent) => {
    expect(parentTabFor(destination, 'renter')).toBe(parent);
  });

  it('preserves owner mode when selecting a booking parent', () => {
    expect(parentTabFor('Booking', 'owner')).toBe('Requests');
  });

  it('does not duplicate an existing authenticated shell', () => {
    const state = { routes: [{ name: 'Marketplace' }] };
    expect(withDeepLinkParent(state, 'renter')).toBe(state);
  });
});
