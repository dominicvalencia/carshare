import { AdminRole } from '@carrental/database';

export const ADMIN_PERMISSIONS = {
  'additional_charges.approve': 'Approve claim-derived additional charges',
  'additional_charges.read': 'Read approved additional-charge operations',
  'audit.read': 'Read administrative audit history',
  'claims.late_override': 'Submit an audited post-deadline claim override',
  'claims.read': 'Read private post-return claims and evidence',
  'claims.resolve': 'Resolve approved or rejected claims',
  'claims.review': 'Request evidence and adjudicate post-return claims',
  'commissions.manage': 'Create and disable versioned commission rules',
  'commissions.read': 'Read commission rules and snapshots',
  'disputes.manage': 'Open, review, and resolve post-rental disputes',
  'disputes.read': 'Read post-rental disputes and evidence',
  'earnings.hold': 'Create and release owner earning holds',
  'earnings.read': 'Read owner earning projections and holds',
  'earnings.release': 'Release eligible owner earnings',
  'incidents.manage': 'Acknowledge and resolve rental incidents',
  'incidents.read': 'Read rental incident reports',
  'inspections.read': 'Read private pickup and return inspection evidence',
  'messages.moderate': 'Moderate reported booking messages',
  'moderation.manage': 'Resolve moderation reports and moderate reported content',
  'moderation.read': 'Read user-submitted moderation reports',
  'owners.read': 'Read owner profiles and verification cases',
  'owners.suspend': 'Suspend owner operational access',
  'owners.verify': 'Approve or reject owner verification',
  'payments.read': 'Read payment operations',
  'payout_accounts.manage': 'Manage payout account readiness',
  'payout_accounts.read': 'Read masked owner payout accounts',
  'payouts.approve': 'Approve owner payouts',
  'payouts.cancel': 'Cancel owner payouts before submission',
  'payouts.create': 'Create owner payouts and batches',
  'payouts.read': 'Read owner payout operations',
  'payouts.submit': 'Submit and reconcile approved payouts',
  'refunds.approve': 'Approve refunds',
  'refunds.read': 'Read refund operations',
  'rentals.intervene': 'Place or release audited operational holds',
  'rentals.read': 'Read rental operations and lifecycle diagnostics',
  'renters.verification_documents.read': 'Issue audited access to renter documents',
  'renters.verifications.read': 'Read renter verification queues and cases',
  'renters.verifications.review': 'Review and decide renter verification cases',
  'renters.verifications.suspend': 'Suspend approved renter verification',
  'reviews.moderate': 'Moderate reported marketplace reviews',
  'staff.create': 'Invite staff accounts',
  'staff.disable': 'Disable staff accounts',
  'staff.edit': 'Edit staff identity and role',
  'staff.permissions.manage': 'Assign approved staff permissions',
  'staff.suspend': 'Suspend and reactivate staff accounts',
  'staff.view': 'Read staff accounts',
  'support.assign': 'Assign support tickets',
  'support.internal_notes': 'Create and read staff-only support notes',
  'support.manage': 'Reply to and manage support tickets',
  'support.read': 'Read support queues and history',
  'users.read': 'Read user identity and status information',
  'users.suspend': 'Change user account status',
  'vehicles.read': 'Read owner vehicle listings and review queues',
  'vehicles.review': 'Review owner vehicle listings',
  'vehicles.suspend': 'Suspend and restore vehicle listings',
} as const;

export type AdminPermissionCode = keyof typeof ADMIN_PERMISSIONS;

const verificationProfile: readonly AdminPermissionCode[] = [
  'renters.verifications.read',
  'renters.verifications.review',
  'renters.verification_documents.read',
  'owners.read',
  'owners.verify',
  'vehicles.read',
  'vehicles.review',
];

const supportProfile: readonly AdminPermissionCode[] = [
  'users.read',
  'owners.read',
  'vehicles.read',
  'rentals.read',
  'claims.read',
  'support.read',
  'support.manage',
  'support.assign',
  'support.internal_notes',
  'moderation.read',
  'moderation.manage',
  'messages.moderate',
  'reviews.moderate',
];

const operationsProfile: readonly AdminPermissionCode[] = [
  ...verificationProfile,
  ...supportProfile,
  'users.suspend',
  'vehicles.suspend',
  'rentals.intervene',
  'inspections.read',
  'incidents.read',
  'incidents.manage',
  'claims.review',
  'claims.resolve',
  'disputes.read',
  'disputes.manage',
];

const financeProfile: readonly AdminPermissionCode[] = [
  'payments.read',
  'earnings.read',
  'refunds.read',
  'refunds.approve',
  'payout_accounts.read',
  'payouts.read',
];

export const STAFF_PERMISSION_PROFILES = {
  FINANCE_STAFF: financeProfile,
  OPERATIONS_STAFF: [...new Set(operationsProfile)],
  SUPPORT_STAFF: supportProfile,
  VERIFICATION_STAFF: verificationProfile,
} as const satisfies Readonly<Record<string, readonly AdminPermissionCode[]>>;

export const SUPER_ADMIN_DEFAULT_PERMISSIONS = Object.keys(ADMIN_PERMISSIONS).filter(
  (permission): permission is AdminPermissionCode => permission !== 'commissions.manage',
);

export function assertPermissionCodes(
  values: readonly string[],
): asserts values is AdminPermissionCode[] {
  const known = new Set(Object.keys(ADMIN_PERMISSIONS));
  if (values.some((value) => !known.has(value)))
    throw new Error('Unknown administrative permission.');
}

export function effectiveAdminPermissions(
  role: AdminRole,
  explicit: readonly string[],
): readonly string[] {
  return role === AdminRole.OWNER ? Object.keys(ADMIN_PERMISSIONS) : [...new Set(explicit)].sort();
}
