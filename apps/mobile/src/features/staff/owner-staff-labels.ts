import type {
  OwnerStaffListItem,
  OwnerStaffPreset,
  OwnerStaffRole,
} from '@carrental/api-contracts';

export function staffRoleLabel(member: Pick<OwnerStaffListItem, 'preset' | 'role'>): string {
  if (member.role === 'MANAGER') return 'Manager';
  return {
    MANAGER: 'Manager',
    OPERATIONS_STAFF: 'Operations Staff',
    SUPPORT_STAFF: 'Support Staff',
    CUSTOM: 'Custom Staff',
  }[member.preset];
}

export function staffPermissionLabel(role: OwnerStaffRole, preset: OwnerStaffPreset): string {
  if (role === 'MANAGER') return preset === 'MANAGER' ? 'Manager default' : 'Custom permissions';
  return {
    MANAGER: 'Manager default',
    OPERATIONS_STAFF: 'Operations',
    SUPPORT_STAFF: 'Support',
    CUSTOM: 'Custom permissions',
  }[preset];
}

export function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightValues = new Set(right);
  return left.every((value) => rightValues.has(value));
}

export function vehicleSelectionLabel(count: number): string {
  if (count === 0) return 'No vehicles selected';
  return `${count} vehicle${count === 1 ? '' : 's'}`;
}
