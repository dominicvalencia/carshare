import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const navigation = readFileSync(resolve(process.cwd(), 'src/navigation/AppNavigation.tsx'), 'utf8');
const account = readFileSync(
  resolve(process.cwd(), 'src/features/account/AccountScreen.tsx'),
  'utf8',
);
const bookings = readFileSync(
  resolve(process.cwd(), 'src/features/bookings/OwnerBookingRequestsScreen.tsx'),
  'utf8',
);
const vehicles = readFileSync(
  resolve(process.cwd(), 'src/features/vehicles/VehiclesScreen.tsx'),
  'utf8',
);

describe('Owner delegated operations Phase 5A', () => {
  it('exposes booking requests only with view permission and scopes requests by workspace', () => {
    expect(account).not.toContain('label="Booking requests"');
    expect(navigation).toContain('ownerWorkspace={properties.ownerWorkspace!}');
    expect(bookings).toContain('/owner/workspaces/${ownerWorkspace.ownerProfileId}/bookings');
    expect(bookings).toContain("['owner-workspace', workspaceKey, 'booking-requests']");
  });

  it('gates accept and reject independently and keeps delegated cancellation unavailable', () => {
    expect(bookings).toContain("hasOwnerPermission(ownerWorkspace, 'bookings.accept')");
    expect(bookings).toContain("hasOwnerPermission(ownerWorkspace, 'bookings.reject')");
    expect(bookings).toContain('allowCancellation={!ownerWorkspace}');
    expect(bookings).toContain('{canAccept ? (');
    expect(bookings).toContain('{canReject ? (');
  });

  it('uses review copy for delegated viewers who cannot respond', () => {
    expect(bookings).toContain('const canRespondToRequests =');
    expect(bookings).toContain("? 'Needs review'");
    expect(bookings).toContain("? 'No requests need your response'");
    expect(bookings).toContain(": 'No requests need review'");
    expect(bookings).toContain("? 'No booking requests need review'");
  });

  it('reuses availability UI with workspace-scoped cache and view-only behavior', () => {
    expect(vehicles).toContain("hasOwnerPermission(ownerWorkspace, 'availability.view')");
    expect(vehicles).toContain("hasOwnerPermission(ownerWorkspace, 'availability.update')");
    expect(vehicles).toContain("'vehicle-blocks', id");
    expect(vehicles).toContain('You have view-only availability access.');
    expect(vehicles).toContain('endpointBase={`${workspaceBase}/${vehicleId}`}');
  });
});
