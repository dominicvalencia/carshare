import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('App.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');
const account = readFileSync('src/features/account/AccountScreen.tsx', 'utf8');
const vehicles = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');
const staff = readFileSync('src/features/staff/OwnerStaffScreen.tsx', 'utf8');

describe('Phase 4 permission-aware Owner shell', () => {
  it('derives Owner eligibility and active workspace from ownerWorkspaces', () => {
    expect(app).toContain('activeOwnerWorkspaces(auth.user?.ownerWorkspaces ?? [])');
    expect(app).toContain('const ownerEnabled = ownerWorkspaces.length > 0');
    expect(app).toContain('resolveOwnerWorkspace');
    expect(app).not.toContain('const ownerCapable = Boolean(owner.data) || ownerRole');
  });

  it('persists account-scoped workspace selection and isolates caches on switching', () => {
    expect(app).toMatch(/ownerWorkspaceStorage\s*\.get\(userId\)/);
    expect(app).toContain('ownerWorkspaceStorage.set(auth.user!.id, ownerProfileId)');
    expect(app).toContain("['owner-workspace']");
    expect(app).toContain('invalidateQueries({ queryKey })');
    expect(staff).toContain("queryKey: ['owner-staff', ownerProfileId]");
  });

  it('uses conditional tabs and always retains More', () => {
    expect(navigation).toContain('delegatedOwnerTabs(ownerWorkspace)');
    expect(navigation).toContain('{tabs.today ? (');
    expect(navigation).toContain('{tabs.vehicles ? (');
    expect(navigation).toContain('{tabs.messages ? (');
    expect(navigation).toContain('<OwnerTabs.Screen name="More">');
  });

  it('uses workspace-scoped delegated vehicle reads and removes write controls', () => {
    expect(vehicles).toContain('DelegatedVehiclesScreen');
    expect(vehicles).toContain('/owner/workspaces/${ownerWorkspace.ownerProfileId}/vehicles');
    expect(vehicles).toContain(
      "queryKey: ['owner-workspace', ownerWorkspace.ownerProfileId, 'vehicles']",
    );
    expect(vehicles).toContain('title="No assigned vehicles"');
    const delegated = vehicles.slice(
      vehicles.indexOf('function DelegatedVehiclesScreen'),
      vehicles.indexOf('function FleetVehicleCard'),
    );
    expect(delegated).not.toContain('Add vehicle');
    expect(delegated).not.toContain('Manage vehicle');
  });

  it('shows Staff only with permission and hides Owner financial/settings rows', () => {
    expect(account).toContain("hasOwnerPermission(ownerWorkspace, 'staff.view')");
    expect(account).toContain("ownerWorkspace.capacity === 'OWNER'");
    expect(account).toContain('label="Earnings & payouts"');
    expect(account).toContain('label="Payout methods"');
    expect(account).toContain('label="Owner settings"');
  });

  it('blocks delegated operational and financial deep-link destinations', () => {
    expect(navigation).toContain("properties.ownerWorkspace?.capacity !== 'OWNER'");
    expect(navigation).toContain('<AccessUnavailable />');
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace, 'staff.view')");
  });
});
