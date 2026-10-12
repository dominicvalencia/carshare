import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');

describe('delegated Manager vehicle creation mobile flow', () => {
  it('keeps one shared eight-step wizard for Owner and Manager', () => {
    expect(source.match(/function VehicleEditor\(/g)).toHaveLength(1);
    expect(source).toContain("'Details',");
    expect(source).toContain("'Features',");
    expect(source).toContain("'Photos',");
    expect(source).toContain("'Documents',");
    expect(source).toContain("'Location',");
    expect(source).toContain("'Pricing',");
    expect(source).toContain("'Handover & usage',");
    expect(source).toContain("'Review',");
  });

  it('gates Add vehicle to active Managers with vehicles.create', () => {
    expect(source).toContain("ownerWorkspace.capacity === 'MANAGER'");
    expect(source).toContain("ownerWorkspace.membershipStatus === 'ACTIVE'");
    expect(source).toContain("hasOwnerPermission(ownerWorkspace, 'vehicles.create')");
  });

  it('routes delegated create and all draft writes through the selected workspace', () => {
    expect(source).toContain(
      'const workspaceBase = `/owner/workspaces/${ownerWorkspace.ownerProfileId}/vehicles`',
    );
    expect(source).toContain('apiClient.request<Vehicle>(workspaceBase');
    expect(source).toContain('endpointBase={`${workspaceBase}/${selectedId}`}');
    expect(source).toContain('referenceBase={`${workspaceBase}/reference-data`}');
  });

  it('uses Owner approval wording and never maps the pending request to lifecycle state', () => {
    expect(source).toContain("? 'Submit for Owner approval'");
    expect(source).toContain("vehicle.ownerApproval?.status === 'PENDING'");
    expect(source).toContain("return 'Awaiting Owner approval'");
    expect(source).toContain("vehicle.status === 'PENDING_APPROVAL'");
    expect(source).toContain("return 'Under review'");
  });

  it('locks pending editing and supports withdrawal and returned changes', () => {
    expect(source).toContain("selected.ownerApproval?.status === 'PENDING'");
    expect(source).toContain("label={withdraw.isPending ? 'Withdrawing…' : 'Withdraw submission'}");
    expect(source).toContain("selected.ownerApproval?.status === 'CHANGES_REQUIRED'");
    expect(source).toContain('label="Continue editing"');
  });
});
