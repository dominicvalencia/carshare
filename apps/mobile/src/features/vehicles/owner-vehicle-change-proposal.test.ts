import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const review = readFileSync('src/features/vehicles/OwnerVehicleChangeProposalScreen.tsx', 'utf8');
const vehicles = readFileSync('src/features/vehicles/VehiclesScreen.tsx', 'utf8');
const dashboard = readFileSync('src/features/vehicles/OwnerDashboardScreen.tsx', 'utf8');
const navigation = readFileSync('src/navigation/AppNavigation.tsx', 'utf8');

describe('Owner vehicle-change proposal review', () => {
  it('is an actual-Owner-only route with authoritative proposal data', () => {
    expect(navigation).toContain('name="OwnerVehicleChangeProposal"');
    expect(navigation).toContain("properties.ownerWorkspace?.capacity === 'OWNER'");
    expect(review).toContain('/change-proposals/${proposalId}`');
    expect(review).not.toContain('fileAssetId}</Text>');
  });

  it('shows submitter context, before and after values, and full proposed summary', () => {
    expect(review).toContain('Changes awaiting your approval');
    expect(review).toContain('label="Submitted by"');
    expect(review).toContain('label="Current"');
    expect(review).toContain('label="Proposed"');
    expect(review).toContain('Proposed configuration');
    expect(review).toContain('label="Security deposit"');
  });

  it('keeps safe and platform-review approval outcomes distinct', () => {
    expect(review).toContain('If you approve, these changes will apply immediately.');
    expect(review).toContain('remains unchanged until that review is complete.');
    expect(review).toContain("result.status === 'APPLIED'");
    expect(review).toContain('Approve and send to CarShare');
  });

  it('supports confirmation, return feedback, and stale recovery', () => {
    expect(review).toContain('Alert.alert(');
    expect(review).toContain("'Approve these changes?'");
    expect(review).toContain('<VehicleOwnerReturnSheet');
    expect(review).toContain('This proposal is out of date.');
    expect(review).toContain('void proposal.refetch()');
  });

  it('derives Fleet and Today proposal attention from server statuses', () => {
    expect(vehicles).toContain('Changes awaiting your approval');
    expect(vehicles).toContain('Changes under CarShare review');
    expect(dashboard).toContain('const pendingVehicleChanges =');
    expect(dashboard).toContain("navigation.navigate('OwnerVehicleChangeProposal'");
  });
});
