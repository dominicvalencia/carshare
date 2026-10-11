import { describe, expect, it } from 'vitest';
import type { OwnerWorkspace } from '../auth/auth.types';
import {
  activeOwnerWorkspaces,
  delegatedOwnerTabs,
  hasOwnerPermission,
  resolveOwnerWorkspace,
} from './owner-workspace';

const workspace = (overrides: Partial<OwnerWorkspace> = {}): OwnerWorkspace => ({
  capacity: 'STAFF',
  membershipId: 'membership-1',
  membershipStatus: 'ACTIVE',
  ownerProfileId: 'owner-1',
  ownerProfileStatus: 'VERIFIED',
  permissions: ['vehicles.view'],
  vehicleScopeMode: 'SELECTED_VEHICLES',
  workspaceLabel: 'Lucena Fleet',
  ...overrides,
});

describe('delegated Owner workspace resolution', () => {
  it('allows actual Owner and active delegated memberships without requiring OWNER role', () => {
    expect(activeOwnerWorkspaces([workspace()])).toHaveLength(1);
    expect(
      activeOwnerWorkspaces([workspace({ capacity: 'OWNER', membershipStatus: 'OWNER' })]),
    ).toHaveLength(1);
  });

  it.each(['INVITED', 'SUSPENDED', 'DISABLED'] as const)(
    'rejects %s delegated membership from Owner mode',
    (membershipStatus) => {
      expect(activeOwnerWorkspaces([workspace({ membershipStatus })])).toEqual([]);
    },
  );

  it('restores a valid selection, falls back safely, and clears a stale selection', () => {
    const first = workspace();
    const second = workspace({ ownerProfileId: 'owner-2' });
    expect(resolveOwnerWorkspace([first, second], 'owner-2')).toEqual(second);
    expect(resolveOwnerWorkspace([first], 'missing')).toEqual(first);
    expect(resolveOwnerWorkspace([], 'missing')).toBeNull();
  });

  it('keeps actual Owner tabs intact and delegated tabs within migrated read APIs', () => {
    expect(delegatedOwnerTabs(workspace({ capacity: 'OWNER', membershipStatus: 'OWNER' }))).toEqual(
      { today: true, vehicles: true, messages: true, more: true },
    );
    expect(delegatedOwnerTabs(workspace())).toEqual({
      today: true,
      vehicles: true,
      messages: false,
      more: true,
    });
    expect(delegatedOwnerTabs(workspace({ permissions: ['messages.view'] }))).toEqual({
      today: true,
      vehicles: false,
      messages: true,
      more: true,
    });
  });

  it('uses explicit permissions for delegated presentation only', () => {
    expect(hasOwnerPermission(workspace(), 'vehicles.view')).toBe(true);
    expect(hasOwnerPermission(workspace(), 'staff.view')).toBe(false);
  });
});
