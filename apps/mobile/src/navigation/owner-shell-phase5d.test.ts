import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('App.tsx', 'utf8');
const account = readFileSync('src/features/account/AccountScreen.tsx', 'utf8');
const dashboard = readFileSync('src/features/vehicles/OwnerDashboardScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');
const workspace = readFileSync('src/navigation/owner-workspace.ts', 'utf8');

describe('Owner delegated operations Phase 5D', () => {
  it('reuses Today and exposes it only for migrated meaningful read permissions', () => {
    for (const permission of ['bookings.view', 'rentals.view', 'vehicles.view', 'messages.view'])
      expect(workspace).toContain(`'${permission}'`);
    expect(workspace).not.toContain("'claims.view', 'disputes.view'");
    expect(dashboard).toContain('ownerWorkspace?: OwnerWorkspace');
    expect(dashboard).not.toContain('StaffTodayScreen');
  });

  it('independently gates Today sections and never presents owner mutation for no vehicles', () => {
    expect(dashboard).toContain("hasOwnerPermission(ownerWorkspace!, 'bookings.view')");
    expect(dashboard).toContain("hasOwnerPermission(ownerWorkspace!, 'rentals.view')");
    expect(dashboard).toContain("hasOwnerPermission(ownerWorkspace!, 'messages.view')");
    expect(dashboard).toMatch(/const vehicleAction =\s+!delegated/);
    expect(dashboard).toContain('canViewMessages && unreadMessageCount > 0');
    expect(dashboard).not.toContain('vehicleAttentionCount');
    expect(dashboard).not.toContain("'No assigned vehicles'");
  });

  it('uses workspace-scoped Today, upcoming, and unread queries', () => {
    expect(dashboard).toContain('/owner/workspaces/${ownerWorkspace!.ownerProfileId}/home');
    expect(dashboard).toContain('queryKey: [...ownerHomeQueryKey, workspaceKey]');
    expect(dashboard).toContain("queryKey: ['owner-home-upcoming', workspaceKey]");
    expect(dashboard).toContain("queryKey: ['conversations', workspaceKey]");
  });

  it('cleans temporary More shortcuts while retaining Staff and actual Owner behavior', () => {
    expect(account).not.toContain('label="Booking requests"');
    expect(account).toContain('label="Staff"');
    expect(account).toContain("ownerWorkspace.capacity === 'OWNER'");
    expect(account).toContain('label="Active rentals"');
    expect(account).toContain("ownerWorkspace.capacity === 'OWNER' || renterEnabled");
    expect(account).toContain("ownerWorkspace.capacity === 'OWNER' && renterEnrollment.isError");
  });

  it('invalidates all delegated domains on workspace switching', () => {
    for (const key of [
      "['owner-workspace']",
      "['owner-home']",
      "['owner-home-upcoming']",
      "['owner-staff']",
      "['conversations']",
      "['conversation']",
      "['messages']",
      "['claim']",
    ])
      expect(app).toContain(key);
  });

  it('permission-checks delegated conversation, booking lifecycle, and claim deep links', () => {
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace!, 'messages.view')");
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace!, 'bookings.view')");
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace!, 'rentals.view')");
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace!, 'claims.view')");
    expect(navigation).toContain('ownerBookingSurface(booking.data.status)');
    expect(navigation).toContain('<AccessUnavailable />');
  });
});
