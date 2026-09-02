import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { combinedActivityUnread, ownerBookingSurface } from './activity-routing';
import { bookingStatusLabel } from '../ui/format';

const navigationSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'AppNavigation.tsx'),
  'utf8',
);
const appSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../App.tsx'),
  'utf8',
);

describe('activity badges and role-aware booking routing', () => {
  it('aggregates message and general-notification unread counts without conflating sources', () => {
    expect(combinedActivityUnread([{ unreadCount: 2 }, { unreadCount: 1 }], 4)).toBe(7);
    expect(combinedActivityUnread([{ unreadCount: 0 }], 3)).toBe(3);
    expect(combinedActivityUnread([{ unreadCount: 2 }], 0)).toBe(2);
    expect(combinedActivityUnread([], 0)).toBe(0);
  });

  it.each(['AWAITING_OWNER', 'CAPTURE_PENDING', 'REJECTED', 'CANCELLED'])(
    'opens %s in the owner request surface',
    (status) => expect(ownerBookingSurface(status)).toBe('request'),
  );

  it.each(['CONFIRMED', 'READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'COMPLETED'])(
    'opens %s in the owner rental surface',
    (status) => expect(ownerBookingSurface(status)).toBe('rental'),
  );

  it('presents the owner-response state from the active role perspective', () => {
    expect(bookingStatusLabel('AWAITING_OWNER', 'owner')).toBe('Waiting for your response');
    expect(bookingStatusLabel('AWAITING_OWNER', 'renter')).toBe('Waiting for owner');
  });

  it('resolves booking notifications inside the active role without mutating role state', () => {
    expect(navigationSource).toContain("properties.mode === 'owner'");
    expect(navigationSource).toContain('<OwnerBookingDestination');
    expect(navigationSource).toContain('<MyBookingsScreen');
    const destination = navigationSource.slice(
      navigationSource.indexOf('function OwnerBookingDestination'),
    );
    expect(destination).not.toContain('onModeChange');
    expect(appSource).toMatch(/activeRoleStorage\s*\.get/);
    expect(appSource).toContain('Restoring your workspace…');
    expect(appSource).toContain('activeRoleStorage.set');
  });
});
