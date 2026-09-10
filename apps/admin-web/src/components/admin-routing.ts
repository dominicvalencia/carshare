import type { AdminModule } from './AdminConsole';

export const adminRouteModules: Readonly<Record<string, AdminModule>> = {
  dashboard: 'dashboard',
  users: 'users',
  'verification/renters': 'renter-verification',
  'verification/owners': 'owner-verification',
  vehicles: 'vehicles',
  bookings: 'bookings',
  rentals: 'rentals',
  claims: 'claims',
  payouts: 'payouts',
  support: 'support',
  'trust-safety': 'trust-safety',
  'operations/inspection-corrections': 'inspection-corrections',
  'settings/commissions': 'commissions',
  staff: 'staff',
  'staff/new': 'staff-new',
  audit: 'audit',
  'owner/overview': 'owner-overview',
  'owner/finance': 'owner-revenue',
  'owner/reports': 'owner-reports',
  'owner/staff-activity': 'owner-staff-activity',
  'owner/audit-security': 'audit',
  'owner/business-settings': 'commissions',
  'operations-console/dashboard': 'dashboard',
  'operations-console/users': 'users',
  'operations-console/verification/renters': 'renter-verification',
  'operations-console/verification/owners': 'owner-verification',
  'operations-console/vehicles': 'vehicles',
  'operations-console/bookings': 'bookings',
  'operations-console/rentals': 'rentals',
  'operations-console/claims': 'claims',
  'operations-console/payouts': 'payouts',
  'operations-console/support': 'support',
  'operations-console/trust-safety': 'trust-safety',
  'operations-console/operations/inspection-corrections': 'inspection-corrections',
  'operations-console/settings/commissions': 'commissions',
};

export function resolveAdminModule(segments: readonly string[] = []): AdminModule {
  if (segments[0] === 'staff' && segments[1] && segments[1] !== 'new') return 'staff-detail';
  for (let length = segments.length; length > 0; length -= 1) {
    const module = adminRouteModules[segments.slice(0, length).join('/')];
    if (module) return module;
  }
  return 'dashboard';
}

export function resolveAdminDetailId(
  segments: readonly string[],
  module: AdminModule,
): string | undefined {
  if (module === 'staff-detail') return segments[1];
  if (segments[0] === 'owner') return undefined;
  const nestedModule = [
    'renter-verification',
    'owner-verification',
    'inspection-corrections',
  ].includes(module);
  if (segments[0] === 'operations-console') return segments[nestedModule ? 3 : 2];
  return segments[nestedModule ? 2 : 1];
}
