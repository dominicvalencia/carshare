import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');

describe('Manager operational vehicle editing', () => {
  it('shows the shared vehicle-management edit affordance only with exact Manager authority', () => {
    expect(source).toContain("ownerWorkspace.capacity === 'MANAGER'");
    expect(source).toContain(
      "hasOwnerPermission(ownerWorkspace, 'vehicles.update_operational_fields')",
    );
    expect(source).toContain('label="Edit vehicle settings"');
    expect(source).toContain('function ManagerOperationalVehicleEditor(');
  });

  it('uses narrow delegated endpoints and never reuses draft or Owner-wide mutation routes', () => {
    for (const endpoint of [
      '/operational-details',
      '/operational-features',
      '/operational-policy',
      '/operational-status',
    ]) {
      expect(source).toContain(endpoint);
    }
    const editor = source.slice(
      source.indexOf('function ManagerOperationalVehicleEditor('),
      source.indexOf('function managerOperationalEditError('),
    );
    for (const restricted of [
      'dailyRateMinor',
      'deliveryFeeMinor',
      'collectionFeeMinor',
      'excessKilometerRateMinor',
      'securityDepositRequired',
      '"plateNumber"',
      '"vin"',
      '/photos',
      '/documents',
      '/location',
      '/remove',
    ]) {
      expect(editor).not.toContain(restricted);
    }
  });

  it('refreshes after success and exposes stale/permission-loss recovery copy', () => {
    expect(source).toContain('onSuccess: onClose');
    expect(source).toContain(
      'This vehicle changed since you opened it. Review the latest details before saving again.',
    );
    expect(source).toContain('You no longer have permission to update this vehicle.');
    expect(source).not.toContain('Waiting for Owner approval because of operational changes');
  });

  it('lets the actual Owner open the Manager-edit notification destination', () => {
    expect(navigation).toContain("workspace.capacity === 'OWNER' ? (");
    expect(navigation).toContain('<VehiclesScreen initialVehicleId={route.params.vehicleId} />');
    expect(navigation).toContain(
      "workspace.capacity !== 'OWNER' && !hasOwnerPermission(workspace, 'vehicles.view')",
    );
  });
});
