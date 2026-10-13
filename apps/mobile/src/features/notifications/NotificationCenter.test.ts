import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const notificationCenter = readFileSync(
  'src/features/notifications/NotificationCenter.tsx',
  'utf8',
);
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');

describe('vehicle-authority notification routing', () => {
  it('opens Manager submissions in the existing Owner approval route', () => {
    expect(notificationCenter).toContain("case 'OwnerVehicleApproval':");
    expect(notificationCenter).toContain(
      "navigation.navigate('OwnerVehicleApproval', destination.params)",
    );
    expect(navigation).toContain("properties.ownerWorkspace?.capacity === 'OWNER'");
    expect(navigation).toContain('<VehiclesScreen initialVehicleId={route.params.vehicleId} />');
  });

  it('opens handled approvals and related vehicle updates in current vehicle detail', () => {
    expect(notificationCenter).toContain("case 'OwnerWorkspaceVehicle':");
    expect(notificationCenter).toContain(
      "navigation.navigate('OwnerWorkspaceVehicle', destination.params)",
    );
    expect(navigation).toContain("hasOwnerPermission(workspace, 'vehicles.view')");
    expect(navigation).toContain('<AccessUnavailable />');
  });

  it('preserves the generic error for truly unsupported destinations', () => {
    expect(notificationCenter).toContain(
      "setOpenError('This notification target is not available in the current app version.')",
    );
  });
});
