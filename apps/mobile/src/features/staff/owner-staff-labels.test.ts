import { describe, expect, it } from 'vitest';
import type { OwnerStaffListItem } from '@carrental/api-contracts';
import {
  sameStringSet,
  staffPermissionLabel,
  staffRoleLabel,
  vehicleSelectionLabel,
} from './owner-staff-labels';

const member = (
  role: OwnerStaffListItem['role'],
  preset: OwnerStaffListItem['preset'],
): Pick<OwnerStaffListItem, 'preset' | 'role'> => ({ preset, role });

describe('Owner Staff labels', () => {
  it('prioritizes Manager membership role over its inferred permission preset', () => {
    expect(staffRoleLabel(member('MANAGER', 'MANAGER'))).toBe('Manager');
    expect(staffRoleLabel(member('MANAGER', 'CUSTOM'))).toBe('Manager');
    expect(staffRoleLabel(member('MANAGER', 'OPERATIONS_STAFF'))).toBe('Manager');
  });

  it('keeps ordinary Staff preset labels distinct', () => {
    expect(staffRoleLabel(member('STAFF', 'OPERATIONS_STAFF'))).toBe('Operations Staff');
    expect(staffRoleLabel(member('STAFF', 'SUPPORT_STAFF'))).toBe('Support Staff');
    expect(staffRoleLabel(member('STAFF', 'CUSTOM'))).toBe('Custom Staff');
  });

  it('describes customized Manager permissions without calling the member Staff', () => {
    expect(staffPermissionLabel('MANAGER', 'MANAGER')).toBe('Manager default');
    expect(staffPermissionLabel('MANAGER', 'CUSTOM')).toBe('Custom permissions');
    expect(staffPermissionLabel('STAFF', 'OPERATIONS_STAFF')).toBe('Operations');
    expect(staffPermissionLabel('STAFF', 'SUPPORT_STAFF')).toBe('Support');
    expect(staffPermissionLabel('STAFF', 'CUSTOM')).toBe('Custom permissions');
  });

  it('formats selected-vehicle counts with an explicit empty state', () => {
    expect(vehicleSelectionLabel(0)).toBe('No vehicles selected');
    expect(vehicleSelectionLabel(1)).toBe('1 vehicle');
    expect(vehicleSelectionLabel(3)).toBe('3 vehicles');
  });

  it('compares vehicle and permission selections without depending on order', () => {
    expect(sameStringSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameStringSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameStringSet(['a'], ['b'])).toBe(false);
  });
});
