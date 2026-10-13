import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');

describe('Manager vehicle proposal editing', () => {
  it('shows the shared vehicle-management edit affordance only with exact Manager authority', () => {
    expect(source).toContain("ownerWorkspace.capacity === 'MANAGER'");
    expect(source).toContain(
      "hasOwnerPermission(ownerWorkspace, 'vehicles.update_operational_fields')",
    );
    expect(source).toContain(
      "label={proposalEditable ? 'Continue editing changes' : 'Edit vehicle'}",
    );
    expect(source).toContain('function ManagerVehicleProposalEditor(');
  });

  it('uses the proposal endpoints and does not write live vehicle fields from the editor', () => {
    const editor = source.slice(
      source.indexOf('function ManagerVehicleProposalEditor('),
      source.indexOf('function ManagerOperationalVehicleEditor('),
    );
    expect(editor).toContain('/change-proposals');
    expect(editor).toContain('/submission');
    expect(editor).toContain('proposedSnapshot: snapshot');
    for (const restricted of ['/operational-details', '/operational-policy', '/owner/vehicles']) {
      expect(editor).not.toContain(restricted);
    }
  });

  it('uses authority-aware submit labels and preserves live values during review', () => {
    expect(source).toContain("'Submit changes for Owner approval'");
    expect(source).toContain("'Resubmit changes'");
    expect(source).toContain("'Submit changes for review'");
    expect(source).toContain("'Save changes'");
    expect(source).toContain('The live vehicle details below remain unchanged');
  });

  it('shows Owner-parity cards and read-only sections without Owner-only actions', () => {
    expect(source).toContain('<FleetVehicleCard');
    expect(source).toContain('function DelegatedVehicleDetail(');
    expect(source).toContain('title="Known vehicle issues"');
    expect(source).toContain('title="Pricing"');
    const detail = source.slice(
      source.indexOf('function DelegatedVehicleDetail('),
      source.indexOf('function _DelegatedVehicleCard('),
    );
    expect(detail).not.toContain('Manage issues');
    expect(detail).not.toContain('Remove vehicle');
  });

  it('lets the actual Owner open the Manager-edit notification destination', () => {
    expect(navigation).toContain("workspace.capacity === 'OWNER' ? (");
    expect(navigation).toContain('<VehiclesScreen initialVehicleId={route.params.vehicleId} />');
    expect(navigation).toContain(
      "workspace.capacity !== 'OWNER' && !hasOwnerPermission(workspace, 'vehicles.view')",
    );
  });
});
