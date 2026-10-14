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

  it('offers creator-authorized draft discard without exposing Owner removal controls', () => {
    expect(source).toContain('readonly canDiscardDraft?: boolean');
    expect(source).toContain('value.canDiscardDraft ?');
    expect(source).toContain('label="Discard vehicle"');
    expect(source).toContain('`${workspaceBase}/${vehicleId}/draft`');
  });

  it('routes delegated create and all draft writes through the selected workspace', () => {
    expect(source).toContain(
      'const workspaceBase = `/owner/workspaces/${ownerWorkspace.ownerProfileId}/vehicles`',
    );
    expect(source).toContain('apiClient.request<Vehicle>(workspaceBase');
    expect(source).toContain('endpointBase={`${workspaceBase}/${selectedId}`}');
    expect(source).toContain('referenceBase={`${workspaceBase}/reference-data`}');
    expect(source).toContain('onClose={async () => {');
    expect(source).toContain('await vehicles.refetch();');
  });

  it('uses the shared Owner submit label and never maps the pending request to lifecycle state', () => {
    expect(source).toContain("action.isPending ? 'Submitting…' : 'Submit for approval'");
    expect(source).not.toContain('Submit for Owner approval');
    expect(source).toContain("vehicle.ownerApproval?.status === 'PENDING'");
    expect(source).toContain("return 'Awaiting Owner approval'");
    expect(source).toContain("vehicle.status === 'PENDING_APPROVAL'");
    expect(source).toContain("return 'Under review'");
  });

  it('keeps the shared footer sizing while preserving delegated submission authority', () => {
    expect(source).toContain('style={[styles.secondaryButton, styles.editorActionButton]}');
    expect(source).toContain('style={[styles.primaryButton, styles.editorActionButton]}');
    expect(source).toContain('editorActionButton: { flex: 1, marginTop: 0 }');
    expect(source).toContain("path: delegated ? '/owner-approval-submission' : '/submission'");
    expect(source).toContain("await client.invalidateQueries({ queryKey: ['owner-workspace'] })");
  });

  it('locks pending editing and supports withdrawal and returned changes', () => {
    expect(source).toContain("value.ownerApproval?.status === 'PENDING'");
    expect(source).toContain('label="Withdraw submission"');
    expect(source).toContain("'Withdraw submission?'");
    expect(source).toContain("{ text: 'Cancel', style: 'cancel' }");
    expect(source).toContain("onPress: () => withdraw.mutate(selected.id)");
    expect(source).toContain('ownerWorkspace.membershipId ?? ownerWorkspace.capacity');
    expect(source).toContain(
      'client.invalidateQueries({ queryKey: vehicleDetailQueryKey(vehicleId) })',
    );
    expect(source).toContain(
      '<StatusBadge label={delegatedApprovalLabel(value)} tone={delegatedApprovalTone(value)} />',
    );
    expect(source).not.toContain("await client.invalidateQueries({ queryKey: ['vehicle', vehicleId] })");
    expect(source).toContain('setEditing(false)');
    expect(source).toContain("active?.status === 'OWNER_CHANGES_REQUIRED'");
    expect(source).toContain("'Resubmit changes'");
  });
});
