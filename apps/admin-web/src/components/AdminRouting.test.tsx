import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminRouteModules, resolveAdminDetailId, resolveAdminModule } from './admin-routing';

describe('admin information architecture', () => {
  it('maps every primary route to one existing operational module', () => {
    expect(adminRouteModules).toMatchObject({
      dashboard: 'dashboard',
      'verification/renters': 'renter-verification',
      vehicles: 'vehicles',
      rentals: 'rentals',
      claims: 'claims',
      payouts: 'payouts',
      support: 'support',
      'trust-safety': 'trust-safety',
      'operations/inspection-corrections': 'inspection-corrections',
      'settings/commissions': 'commissions',
    });
    expect(resolveAdminModule(['rentals', 'CR-2026-TEST'])).toBe('rentals');
    expect(resolveAdminModule(['verification', 'owners', 'owner-id'])).toBe('owner-verification');
    expect(resolveAdminModule(['users', '00000000-0000-0000-0000-000000000000'])).toBe('users');
    expect(resolveAdminModule(['staff', 'new'])).toBe('staff-new');
    expect(resolveAdminModule(['staff', 'staff-id'])).toBe('staff-detail');
    expect(resolveAdminModule(['owner', 'overview'])).toBe('owner-overview');
    expect(resolveAdminModule(['operations-console', 'rentals'])).toBe('rentals');
    expect(resolveAdminModule(['operations-console', 'operations', 'inspection-corrections'])).toBe(
      'inspection-corrections',
    );
    expect(resolveAdminModule(['operations-console', 'settings', 'commissions'])).toBe(
      'commissions',
    );
    expect(resolveAdminDetailId(['staff', 'staff-id'], 'staff-detail')).toBe('staff-id');
    expect(resolveAdminDetailId(['owner', 'finance'], 'payouts')).toBeUndefined();
    expect(resolveAdminModule(['unknown'])).toBe('dashboard');
    expect(
      resolveAdminDetailId(
        ['verification', 'owners', '00000000-0000-0000-0000-000000000000'],
        'owner-verification',
      ),
    ).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('uses client navigation for every Dashboard queue link and provides account detail views', () => {
    const consoleSource = readFileSync('src/components/AdminConsole.tsx', 'utf8');
    const renterSource = readFileSync('src/components/RenterVerificationAdminPanel.tsx', 'utf8');
    const userDetailSource = readFileSync('src/components/AdminUserDetail.tsx', 'utf8');
    expect(consoleSource).toContain('<Link className="metric-card" href={href}>');
    expect(consoleSource).not.toContain('<a className="metric-card"');
    expect(consoleSource).toContain('href={`/admin/users/${user.id}`}');
    expect(userDetailSource).toContain('renterBookings');
    expect(userDetailSource).toContain('ownedVehicles');
    expect(userDetailSource).toContain('ownerBookings');
    expect(userDetailSource).toContain('Renter activity');
    expect(userDetailSource).toContain('Owner activity');
    expect(userDetailSource).toContain('href={`/admin/claims/${claim.id}`}');
    expect(userDetailSource).toContain('href={`/admin/rentals/${booking.publicReference}`}');
    expect(userDetailSource).not.toContain('addressLine1');
    expect(userDetailSource).not.toContain('driverLicense');
    expect(consoleSource).toContain("selectedVehicleId ? 'is-detail-route' : ''");
    expect(consoleSource).toContain('href="/admin/rentals"');
    expect(consoleSource).toContain('href="/admin/claims"');
    expect(consoleSource).toContain('href="/admin/bookings"');
    expect(renterSource).toContain('backHref="/admin/verification/renters"');
    expect(renterSource).toContain('AdminEvidenceCard');
    expect(renterSource).toContain('Security & audit');
    expect(renterSource).toContain('Protected evidence is available only in the Documents tab');
    expect(renterSource).not.toContain('Supporting address evidence');
    expect(renterSource).toContain("detail.data.status === 'UNDER_REVIEW'");
    expect(renterSource).toContain('Start verification review');
    expect(renterSource).toContain('Approve renter');
    expect(renterSource).toContain(
      'Reviewer notes must be saved before this case can be approved.',
    );
    expect(renterSource).toContain('!detail.data.addressReviewNotes?.trim()');
    expect(renterSource).toContain('<AdminErrorDialog');
    expect(renterSource).toContain('Add and save reviewer notes documenting the checks completed');
    expect(consoleSource).toContain('Technical ledger details');
    expect(consoleSource).toContain('Public listing eligibility');
    expect(consoleSource).toContain('Administrative intervention');
  });

  it('centralizes authentication expiry and preserves secure file grants', () => {
    const consoleSource = readFileSync('src/components/AdminConsole.tsx', 'utf8');
    const sessionSource = readFileSync('src/components/AdminSession.tsx', 'utf8');
    const renterSource = readFileSync('src/components/RenterVerificationAdminPanel.tsx', 'utf8');
    expect(consoleSource).toContain('response.status === 401');
    expect(consoleSource).toContain('logout();');
    expect(sessionSource).toContain('queryClient.clear();');
    expect(renterSource).toContain('/access-grants');
    expect(renterSource).toContain('grant.contentPath');
  });

  it('contains deliberate desktop, tablet, and mobile navigation behavior', () => {
    const styles = readFileSync('src/app/styles.css', 'utf8');
    expect(styles).toContain('@media (max-width: 1199px)');
    expect(styles).toContain('@media (max-width: 767px)');
    expect(styles).toContain('.admin-sidebar.is-open');
    expect(styles).toContain('.dashboard-grid');
    expect(styles).toContain('.admin-summary-grid');
    expect(styles).toContain('.admin-evidence-grid');
    expect(styles).toContain('.admin-action-bar');
    expect(styles).toContain('grid-template-columns: 1fr');
  });
});
