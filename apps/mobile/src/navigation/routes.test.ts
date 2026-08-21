import { describe, expect, it } from 'vitest';
import { ownerTabs, renterTabs } from './routes';

describe('compact mobile navigation', () => {
  it('keeps favorites and earnings out of permanent bottom tabs', () => {
    expect(renterTabs).toEqual(['Home', 'Search', 'Bookings', 'Messages', 'Profile']);
    expect(ownerTabs).toEqual(['Dashboard', 'Vehicles', 'Requests', 'Rentals', 'Messages', 'More']);
    expect(renterTabs).not.toContain('Favorites');
    expect(ownerTabs).not.toContain('Earnings');
  });
});
