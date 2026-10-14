import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vehicles = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');
const dashboard = readFileSync('src/features/vehicles/OwnerDashboardScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');

describe('Owner vehicle approval experience', () => {
  it('derives Owner and Manager wording without changing the vehicle lifecycle', () => {
    expect(vehicles).toContain("? 'Awaiting your approval'");
    expect(vehicles).toContain("return 'Awaiting Owner approval'");
    expect(vehicles).toContain(
      "value.status === 'DRAFT' && value.ownerApproval?.status === 'PENDING'",
    );
    expect(vehicles).toContain("if (vehicle.status === 'PENDING_APPROVAL') return 'Under review'");
  });

  it('separates the Manager pending badge from its review guidance', () => {
    expect(vehicles).toContain("return 'Awaiting Owner approval'");
    expect(vehicles).toContain('<VehicleDetailSection title="Waiting for Owner review">');
    expect(vehicles).toContain(
      'The Owner needs to approve this vehicle before it can be submitted to CarShare.',
    );
    expect(vehicles).toContain('label="Withdraw submission"');
    expect(vehicles).toContain('title="Marketplace & availability"');
  });

  it('shows the safe submission context and complete existing vehicle detail sections', () => {
    expect(vehicles).toContain('<VehicleDetailSection emphasized title="Review submission">');
    expect(vehicles).toContain('label="Submitted by"');
    expect(vehicles).toContain('pendingOwnerApproval.submittedByDisplayName');
    expect(vehicles).toContain('dateTimeLabel(pendingOwnerApproval.submittedAt)');
    for (const title of [
      'Vehicle overview',
      'Registration & verification',
      'Private pickup location',
      'Pricing',
      'Handover & usage',
    ]) {
      expect(vehicles).toContain(`title="${title}"`);
    }
    expect(vehicles).not.toContain('submittedByMembershipId');
  });

  it('uses explicit approval and return actions with confirmation and meaningful feedback', () => {
    expect(vehicles).toContain("'Approve and submit for review'");
    expect(vehicles).toContain("'Approve this vehicle?'");
    expect(vehicles).toContain("'This will submit the vehicle to CarShare for review.'");
    expect(vehicles).toContain('function VehicleOwnerReturnSheet(');
    expect(vehicles).toContain('const meaningful = reason.trim().length >= 10');
    expect(vehicles).toContain('<BackControl label="Cancel" onPress={close} />');
    expect(vehicles).toContain('compactMultiline');
    expect(vehicles).toContain('ownerReturnAction: { marginTop: spacing.lg }');
    expect(vehicles).toContain("label={loading ? 'Returning…' : 'Return for changes'}");
    const returnSheet = vehicles.slice(
      vehicles.indexOf('function VehicleOwnerReturnSheet('),
      vehicles.indexOf('function vehicleDeleteBlockerMessage('),
    );
    expect(returnSheet).not.toContain('automaticallyAdjustKeyboardInsets');
  });

  it('shows stale recovery copy and refreshes authoritative vehicle state', () => {
    expect(vehicles).toContain("error.code === 'VEHICLE_OWNER_APPROVAL_STALE'");
    expect(vehicles).toContain(
      'This vehicle changed after it was submitted. Review the latest version before approving.',
    );
    expect(vehicles).toContain('onError: async () => {\n      await vehicle.refetch();');
  });

  it('adds Today attention only for actual Owner pending approvals', () => {
    expect(dashboard).toContain('const pendingOwnerApprovals =');
    expect(dashboard).toContain('!delegated\n      ? (vehicles.data?.filter(');
    expect(dashboard).toContain("status === 'DRAFT' && ownerApproval?.status === 'PENDING'");
    expect(dashboard).toContain("pendingOwnerApprovals.length === 1 ? 'vehicle' : 'vehicles'");
    expect(dashboard).toContain("navigation.navigate('OwnerVehicleApproval'");
    expect(dashboard).not.toContain('View vehicles');
  });

  it('uses Owner-directed pending copy only in Owner mode', () => {
    expect(vehicles).toContain("? `${title}. Awaiting Owner approval. View vehicle.`");
    expect(vehicles).toContain("? 'Awaiting Owner approval'");
    expect(vehicles).toContain("? 'Waiting for Owner review'");
    expect(vehicles).toContain("{delegated ? 'View vehicle' : actionLabel} →");
  });

  it('authorizes deep-link review destinations by current app role and workspace', () => {
    expect(navigation).toContain("properties.ownerWorkspace?.capacity === 'OWNER'");
    expect(navigation).toContain("hasOwnerPermission(workspace, 'vehicles.view')");
    expect(navigation).toContain("workspace.capacity === 'OWNER' ? (");
    expect(navigation).toContain('<AccessUnavailable />');
  });
});
