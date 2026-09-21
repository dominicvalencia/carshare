import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ownerTabs, renterTabs } from './routes';

const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AppNavigation.tsx'),
  'utf8',
);

describe('compact mobile navigation', () => {
  it('uses compatible internal keys for the Explore, Wishlist, and Trips tabs', () => {
    expect(renterTabs).toEqual(['Home', 'Wishlist', 'Bookings', 'Messages', 'Profile']);
    expect(ownerTabs).toEqual(['Dashboard', 'Vehicles', 'Requests', 'Messages', 'More']);
    expect(renterTabs).not.toContain('Favorites');
    expect(renterTabs).not.toContain('Search');
    expect(ownerTabs).not.toContain('Earnings');
    expect(ownerTabs).not.toContain('Rentals');
    expect(navigationSource).toContain("tabBarLabel: 'Explore'");
    expect(navigationSource).toContain("tabBarLabel: 'Wishlist'");
    expect(navigationSource).toContain("tabBarLabel: 'Trips'");
    expect(navigationSource).not.toContain('<RenterTabs.Screen name="Search"');
    expect(navigationSource).toContain('name="Favorites"');
    expect(navigationSource).toContain("Favorites: 'favorites'");
  });

  it('sizes both tab navigators from the platform safe-area inset', () => {
    expect(navigationSource).toContain('useSafeAreaInsets');
    expect(navigationSource).toContain('height: 54 + safeBottom');
    expect(navigationSource).toContain('paddingBottom: safeBottom');
    expect(navigationSource).not.toContain('name="Profile"\n        options=');
  });

  it('hides only the Home renter tab bar while FULL_MAP is authoritative', () => {
    expect(navigationSource).toContain('const [fullMap, setFullMap] = useState(false)');
    expect(navigationSource).toContain("if (route.name !== 'Home') return options");
    expect(navigationSource).toContain("position: 'absolute' as const");
    expect(navigationSource).toContain("display: 'none' as const");
    expect(navigationSource).toContain('<DiscoveryScreen home onFullMapChange={setFullMap} />');
  });
});
