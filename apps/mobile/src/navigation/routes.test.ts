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
  it('keeps favorites and earnings out of permanent bottom tabs', () => {
    expect(renterTabs).toEqual(['Home', 'Search', 'Bookings', 'Messages', 'Profile']);
    expect(ownerTabs).toEqual(['Dashboard', 'Vehicles', 'Requests', 'Messages', 'More']);
    expect(renterTabs).not.toContain('Favorites');
    expect(ownerTabs).not.toContain('Earnings');
    expect(ownerTabs).not.toContain('Rentals');
  });

  it('sizes both tab navigators from the platform safe-area inset', () => {
    expect(navigationSource).toContain('useSafeAreaInsets');
    expect(navigationSource).toContain('height: 54 + safeBottom');
    expect(navigationSource).toContain('paddingBottom: safeBottom');
    expect(navigationSource).not.toContain('name="Profile"\n        options=');
  });
});
