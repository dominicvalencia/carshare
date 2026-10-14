import { OwnerStaffRole } from '@carrental/database';

export const OWNER_PERMISSIONS = {
  'audit.view_own_actions': 'View the actor’s own Owner-business audit history',
  'availability.update': 'Update vehicle availability and blocked periods',
  'availability.view': 'View vehicle availability and blocked periods',
  'bookings.accept': 'Accept eligible booking requests',
  'bookings.cancel': 'Cancel Owner bookings under current policy',
  'bookings.reject': 'Reject eligible booking requests',
  'bookings.view': 'View Owner booking requests and details',
  'claims.create': 'Start eligible post-return claims',
  'claims.respond': 'Respond to claims and add Owner evidence',
  'claims.view': 'View claims for Owner rentals',
  'disputes.view': 'View disputes for Owner rentals',
  'handover.perform': 'Perform pickup handover and eligible recovery',
  'incidents.create': 'Report incidents for Owner rentals',
  'incidents.update': 'Update Owner incident reports where allowed',
  'inspections.create': 'Create inspection drafts and evidence',
  'inspections.update': 'Update and submit permitted inspections',
  'messages.reply': 'Reply in booking conversations',
  'messages.view': 'View booking conversations',
  'known_issues.create': 'Add a new known issue through the vehicle proposal workflow',
  'owner_authority.transfer': 'Transfer Owner authority through an approved flow',
  'owner_business.delete': 'Close the Owner business through an approved flow',
  'owner_settings.manage': 'Manage Owner business settings',
  'payout_accounts.manage': 'Manage Owner payout destinations',
  'payout_accounts.view': 'View masked Owner payout destinations',
  'rentals.view': 'View active and historical rentals',
  'return.perform': 'Perform return receipt and eligible recovery',
  'staff.assign_permissions': 'Assign approved permissions to ordinary Staff',
  'staff.assign_vehicles': 'Assign ordinary Staff to Owner vehicles',
  'staff.disable': 'Disable ordinary Staff memberships',
  'staff.invite': 'Invite ordinary Staff memberships',
  'staff.reissue_invite': 'Reissue ordinary Staff invitations',
  'staff.suspend': 'Suspend or reactivate ordinary Staff memberships',
  'staff.update': 'Edit ordinary Staff access',
  'staff.view': 'View the Owner Staff directory',
  'support_cases.create': 'Create Owner-business support cases',
  'support_cases.update': 'Update Owner-business support cases',
  'support_cases.view': 'View Owner-business support cases',
  'users.view_basic_profile': 'View the minimum renter profile needed for assigned work',
  'vehicles.archive': 'Archive an eligible Owner vehicle',
  'vehicles.create': 'Create a new vehicle inside an authorized Owner workspace',
  'vehicles.update_operational_fields': 'Edit non-ownership operational vehicle fields',
  'vehicles.view': 'View Owner vehicles',
} as const;

export type OwnerPermissionCode = keyof typeof OWNER_PERMISSIONS;

export const DEFAULT_OWNER_STAFF_PERMISSIONS = [
  'audit.view_own_actions',
] as const satisfies readonly OwnerPermissionCode[];

export function withDefaultOwnerStaffPermissions(
  permissions: readonly string[],
): OwnerPermissionCode[] {
  assertOwnerPermissionCodes(permissions);
  return [...new Set<OwnerPermissionCode>([...permissions, ...DEFAULT_OWNER_STAFF_PERMISSIONS])];
}

export const VEHICLE_SCOPED_OWNER_PERMISSIONS = new Set<OwnerPermissionCode>([
  'availability.update',
  'availability.view',
  'bookings.accept',
  'bookings.cancel',
  'bookings.reject',
  'bookings.view',
  'claims.create',
  'claims.respond',
  'claims.view',
  'disputes.view',
  'handover.perform',
  'incidents.create',
  'incidents.update',
  'inspections.create',
  'inspections.update',
  'messages.reply',
  'messages.view',
  'known_issues.create',
  'rentals.view',
  'return.perform',
  'vehicles.archive',
  'vehicles.update_operational_fields',
  'vehicles.view',
]);

export const OWNER_ONLY_PERMISSIONS = new Set<OwnerPermissionCode>([
  'owner_authority.transfer',
  'owner_business.delete',
  'owner_settings.manage',
  'payout_accounts.manage',
  'payout_accounts.view',
  'vehicles.archive',
]);

export const MANAGER_ONLY_PERMISSIONS = new Set<OwnerPermissionCode>(['vehicles.create']);

export const OPERATIONS_STAFF_PERMISSIONS = [
  'vehicles.view',
  'availability.view',
  'availability.update',
  'known_issues.create',
  'rentals.view',
  'handover.perform',
  'return.perform',
  'inspections.create',
  'inspections.update',
  'incidents.create',
  'incidents.update',
  'messages.view',
  'messages.reply',
  'claims.view',
  'audit.view_own_actions',
] as const satisfies readonly OwnerPermissionCode[];

export const SUPPORT_STAFF_PERMISSIONS = [
  'bookings.view',
  'rentals.view',
  'users.view_basic_profile',
  'messages.view',
  'messages.reply',
  'support_cases.view',
  'support_cases.create',
  'support_cases.update',
  'claims.view',
  'disputes.view',
  'audit.view_own_actions',
] as const satisfies readonly OwnerPermissionCode[];

export const MANAGER_PERMISSIONS = [
  ...new Set<OwnerPermissionCode>([
    ...OPERATIONS_STAFF_PERMISSIONS,
    ...SUPPORT_STAFF_PERMISSIONS,
    'vehicles.update_operational_fields',
    'bookings.view',
    'bookings.accept',
    'bookings.reject',
    'bookings.cancel',
    'claims.create',
    'claims.respond',
    'staff.view',
    'staff.invite',
    'staff.update',
    'staff.suspend',
    'staff.disable',
    'staff.reissue_invite',
    'staff.assign_permissions',
    'staff.assign_vehicles',
    'vehicles.create',
  ]),
] satisfies readonly OwnerPermissionCode[];

export const OWNER_PERMISSION_PRESETS = {
  MANAGER: MANAGER_PERMISSIONS,
  OPERATIONS_STAFF: OPERATIONS_STAFF_PERMISSIONS,
  SUPPORT_STAFF: SUPPORT_STAFF_PERMISSIONS,
} as const;

export function assertOwnerPermissionCodes(
  values: readonly string[],
): asserts values is OwnerPermissionCode[] {
  const known = new Set(Object.keys(OWNER_PERMISSIONS));
  if (values.some((value) => !known.has(value) || value.includes('*')))
    throw new Error('Unknown Owner permission.');
}

export function assertAssignableOwnerPermissions(
  role: OwnerStaffRole,
  values: readonly string[],
): asserts values is OwnerPermissionCode[] {
  assertOwnerPermissionCodes(values);
  if (values.some((value) => OWNER_ONLY_PERMISSIONS.has(value)))
    throw new Error(`${role} cannot receive Owner-only permission.`);
  if (role === OwnerStaffRole.STAFF && values.some((value) => MANAGER_ONLY_PERMISSIONS.has(value)))
    throw new Error('Ordinary Staff cannot receive Manager-only permission.');
}

export function assertManagerTargetRole(targetRole: OwnerStaffRole): void {
  if (targetRole !== OwnerStaffRole.STAFF)
    throw new Error('Manager may manage ordinary Staff only.');
}

const MANAGER_PERMISSION_CEILING = new Set<OwnerPermissionCode>(MANAGER_PERMISSIONS);
const STAFF_ADMINISTRATION_PERMISSIONS = new Set<OwnerPermissionCode>([
  'staff.assign_permissions',
  'staff.assign_vehicles',
  'staff.disable',
  'staff.invite',
  'staff.reissue_invite',
  'staff.suspend',
  'staff.update',
  'staff.view',
]);

export function assertActorCanGrantOwnerPermissions(
  actor: {
    readonly capacity: 'OWNER' | 'MANAGER' | 'STAFF';
    readonly permissions: readonly string[];
  },
  targetRole: OwnerStaffRole,
  permissions: readonly string[],
): asserts permissions is OwnerPermissionCode[] {
  assertAssignableOwnerPermissions(targetRole, permissions);
  if (
    targetRole === OwnerStaffRole.MANAGER &&
    permissions.some((permission) => !MANAGER_PERMISSION_CEILING.has(permission))
  )
    throw new Error('Permission exceeds the Manager permission ceiling.');
  if (
    targetRole === OwnerStaffRole.STAFF &&
    permissions.some((permission) => STAFF_ADMINISTRATION_PERMISSIONS.has(permission))
  )
    throw new Error('Ordinary Staff cannot receive Staff-administration permission.');
  if (
    actor.capacity === 'MANAGER' &&
    permissions.some((permission) => !actor.permissions.includes(permission))
  )
    throw new Error('Manager cannot grant a permission outside their delegated set.');
  if (actor.capacity === 'STAFF') throw new Error('Staff cannot grant Owner permissions.');
}
