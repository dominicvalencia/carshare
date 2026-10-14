import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const navigation = readFileSync(resolve(process.cwd(), 'src/navigation/AppNavigation.tsx'), 'utf8');
const account = readFileSync(
  resolve(process.cwd(), 'src/features/account/AccountScreen.tsx'),
  'utf8',
);
const rentals = readFileSync(
  resolve(process.cwd(), 'src/features/rentals/OwnerRentalsScreen.tsx'),
  'utf8',
);
const operations = readFileSync(
  resolve(process.cwd(), 'src/features/rentals/RentalOperationsPanels.tsx'),
  'utf8',
);
const dashboard = readFileSync(
  resolve(process.cwd(), 'src/features/vehicles/OwnerDashboardScreen.tsx'),
  'utf8',
);

describe('Owner delegated operations Phase 5B', () => {
  it('reuses Active rentals with workspace-scoped reads and cache keys', () => {
    expect(account).toContain("hasOwnerPermission(ownerWorkspace, 'rentals.view')");
    expect(account).toContain('label="Active rentals"');
    expect(navigation).toContain("hasOwnerPermission(properties.ownerWorkspace, 'rentals.view')");
    expect(rentals).toContain('/owner/workspaces/${ownerWorkspace.ownerProfileId}/rentals');
    expect(rentals).toContain("['owner-workspace', workspaceKey, 'rentals']");
    expect(rentals).toContain("eyebrow={ownerWorkspace ? 'Staff mode' : 'Owner mode'}");
    expect(operations).toContain("['owner-workspace', workspaceKey, 'rental', reference]");
    expect(operations).toContain('apiClient.request<RentalDetail>(rentalEndpoint)');
  });

  it('routes every Today rental card through the delegated workspace detail surface', () => {
    expect(dashboard).toContain('delegated\n      ? setSelectedRentalReference(reference)');
    expect(dashboard).toContain('<OwnerRentalsScreen');
    expect(dashboard).toContain('{...(delegated ? { ownerWorkspace } : {})}');
    expect(dashboard.match(/onPress={openBooking}/g)).toHaveLength(4);
  });

  it('resolves delegated detail failures to retry instead of permanent loading', () => {
    expect(operations).toContain('if (rental.isPending)');
    expect(operations).toContain('if (rental.isError)');
    expect(operations).toContain(
      "title={accessDenied ? 'Rental access unavailable' : 'Rental operations unavailable'}",
    );
    expect(operations).toContain('rental.error instanceof ApiError && rental.error.status === 403');
    expect(operations).toContain('await auth.refreshIdentity()');
    expect(operations).toContain('onAction={() => void retryRental()}');
  });

  it('uses explicit handover, return, and inspection permissions', () => {
    expect(operations).toContain("hasOwnerPermission(ownerWorkspace, 'handover.perform')");
    expect(operations).toContain("hasOwnerPermission(ownerWorkspace, 'return.perform')");
    expect(operations).toContain("hasOwnerPermission(ownerWorkspace, 'inspections.create')");
    expect(operations).toContain("hasOwnerPermission(ownerWorkspace, 'inspections.update')");
  });

  it('keeps cancellation and review UI owner-only after Phase 5C migration', () => {
    expect(rentals).toContain("hasOwnerPermission(ownerWorkspace, 'claims.view')");
    expect(rentals).toContain('!ownerWorkspace && selectedBooking');
    expect(operations).toContain('const allowDeferredActions = !ownerWorkspace');
  });
});
