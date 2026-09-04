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
};

export function resolveAdminModule(segments: readonly string[] = []): AdminModule {
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
  const nestedModule = [
    'renter-verification',
    'owner-verification',
    'inspection-corrections',
  ].includes(module);
  return segments[nestedModule ? 2 : 1];
}
