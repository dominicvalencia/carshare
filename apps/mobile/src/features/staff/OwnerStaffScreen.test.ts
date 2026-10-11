import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'OwnerStaffScreen.tsx'),
  'utf8',
);
const account = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../account/AccountScreen.tsx'),
  'utf8',
);
const navigation = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../navigation/AppNavigation.tsx'),
  'utf8',
);
const primitives = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/primitives.tsx'),
  'utf8',
);

describe('Owner Staff management UI', () => {
  it('places Staff in the existing More Operations menu and wires its route', () => {
    expect(account).toContain('<MenuSection title="Operations">');
    expect(account).toContain('label="Staff"');
    expect(account).toContain("navigation.navigate('OwnerStaff')");
    expect(navigation).toContain('<OwnerStaffScreen');
  });

  it('supports the directory states and compact shared presentation', () => {
    expect(source).toContain('title="No staff yet"');
    expect(source).toContain('<StatusBadge');
    expect(source).toContain("ACTIVE: 'success'");
    expect(source).toContain("INVITED: 'warning'");
    expect(source).toContain("SUSPENDED: 'neutral'");
    expect(source).toContain("DISABLED: 'danger'");
    expect(source).toContain('<StateView');
  });

  it('keeps Manager role choice owner-only and never exposes Verification Staff', () => {
    expect(source).toContain("capacity === 'OWNER' || option.role !== 'MANAGER'");
    expect(source).toContain("preset: 'MANAGER'");
    expect(source).not.toContain('Verification Staff');
  });

  it('uses human permission labels and excludes owner-only financial authority', () => {
    expect(source).toContain("['bookings.accept', 'Accept bookings']");
    expect(source).toContain("['messages.reply', 'Reply to renters']");
    expect(source).not.toContain('payout_accounts.manage');
    expect(source).not.toContain('owner_authority.transfer');
    expect(source).not.toContain('security_deposit');
  });

  it('supports all and selected vehicle scope with accessible multi-select controls', () => {
    expect(source).toContain('<SegmentedControl');
    expect(source).toContain("{ label: 'All vehicles', value: 'ALL_VEHICLES' }");
    expect(source).toContain("{ label: 'Selected vehicles', value: 'SELECTED_VEHICLES' }");
    expect(primitives).toContain('accessibilityRole="radiogroup"');
    expect(primitives).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked }}');
    expect(source).toContain('/vehicle-scope');
  });

  it('separates search and vehicle results with the shared spacing scale', () => {
    expect(source).toContain('paddingTop: spacing.md');
    expect(source).toContain('contentContainerStyle={styles.sheetContent}');
  });

  it('keeps custom permissions off the Add staff page and opens a dedicated editor', () => {
    const customBlock = source.slice(
      source.indexOf("{preset === 'CUSTOM' ? ("),
      source.indexOf('<SectionHeader title="Vehicle access" />'),
    );
    expect(customBlock).toContain('title="Permissions"');
    expect(customBlock).toContain('onPress={() => setPermissionEditor(true)}');
    expect(customBlock).toContain('{permissions.length} selected');
    expect(customBlock).not.toContain('<PermissionEditor');
    expect(source).toContain('<PermissionEditorModal');
    expect(source).toContain('Configure permissions\n            </Text>');
  });

  it('groups custom permissions and keeps section bulk controls inline and trailing', () => {
    for (const title of [
      'Vehicles',
      'Bookings',
      'Rentals',
      'Operations',
      'Messages',
      'Claims',
      'Support',
    ])
      expect(source).toContain(`title: '${title}'`);
    expect(source).not.toContain("title: 'Audit'");
    expect(source).not.toContain("['audit.view_own_actions', 'View own activity']");
    expect(source).toContain('<SectionHeader\n      flush\n      title={title}\n      action={');
    const selectAllText = source.indexOf('<Text style={styles.selectAllText}>Select all</Text>');
    expect(selectAllText).toBeGreaterThan(-1);
    expect(selectAllText).toBeLessThan(source.indexOf('name={', selectAllText));
    expect(source).toContain('accessibilityLabel={`Select all ${title} permissions`}');
    expect(source).toContain('accessibilityState={{ checked }}');
    expect(source).toContain('selectedCount === permissions.length ? true');
    expect(source).toContain("selectedCount === 0 ? false : 'mixed'");
  });

  it('bulk toggles only through the trailing control while individual rows remain accessible', () => {
    expect(source).toContain('onPress={toggle}');
    expect(source).not.toContain('<SectionHeader title={group.title} onPress=');
    expect(source).toContain('selected.filter((permission) => !permissions.includes(permission))');
    expect(source).toContain('[...new Set([...selected, ...permissions])]');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked: selected.includes(code) }}');
  });

  it('aligns bulk and row checkboxes with shared insets and compact group spacing', () => {
    expect(source).toContain('paddingHorizontal: spacing.md');
    expect(source).toContain('paddingRight: spacing.md');
    expect(source).toContain('permissionGroup: { gap: spacing.xxs }');
    expect(source).toContain('permissionGroups: { gap: spacing.sm }');
    expect(source).toContain('<SectionHeader\n      flush');
  });

  it('shows compact custom-permission and selected-vehicle summaries', () => {
    expect(source).toContain('Custom · {permissions.length} selected');
    expect(source).toContain(
      "{vehicleIds.length} vehicle{vehicleIds.length === 1 ? '' : 's'} selected",
    );
    expect(source).toContain('accessibilityLabel="Change selected vehicles"');
    expect(source).toContain('label="Change"');
    expect(source).toContain('onPress={() => setVehiclePicker(true)}');
  });

  it('keeps Send invitation in a persistent safe-area footer', () => {
    const inviteScreen = source.slice(
      source.indexOf('function InviteStaffScreen'),
      source.indexOf('function PermissionEditor'),
    );
    const footer = inviteScreen.slice(
      inviteScreen.indexOf('bottomAccessory={'),
      inviteScreen.indexOf('contentBottomPadding={spacing.lg}'),
    );
    expect(footer).toContain('styles.inviteFooter');
    expect(footer).toContain('Math.max(safeArea.bottom, spacing.sm)');
    expect(footer).toContain(
      "label={invite.isPending ? 'Sending invitation…' : 'Send invitation'}",
    );
    expect(footer).toContain('disabled={!valid || invite.isPending}');
    expect(inviteScreen.indexOf('bottomAccessory={')).toBeLessThan(
      inviteScreen.indexOf('<Card style={styles.formCard}>'),
    );
  });

  it('keeps the vehicle selector visibly sized through loading, empty, error, and loaded states', () => {
    expect(source).toContain('useSharedValue(Math.min(360, maximumHeight))');
    expect(source).toContain('adaptiveSheetLayout({');
    expect(source).toContain('style={[styles.sheet, animatedSheetStyle]}');
    expect(source).toContain('title="Loading vehicles"');
    expect(source).toContain('title="Unable to load vehicles"');
    expect(source).toContain('title="No vehicles available"');
    expect(source).toContain('There are no vehicles available to assign in this workspace.');
  });

  it('uses the active workspace vehicle query and preserves accessible multi-selection', () => {
    expect(source).toContain("queryKey: ['owner-workspace-vehicles', ownerProfileId]");
    expect(source).toContain('`/owner/workspaces/${ownerProfileId}/vehicles`');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain(
      "accessibilityLabel={`${label || 'Vehicle'}, ${checked ? 'selected' : 'not selected'}`}",
    );
    expect(source).toContain('<Button label="Done" onPress={onClose} />');
  });

  it('wires every Phase 2 member mutation without operational delegation', () => {
    for (const marker of [
      '/permissions',
      '/vehicle-scope',
      "'suspend'",
      "'reactivate'",
      "'disable'",
      "'reissue'",
      "'revoke'",
    ])
      expect(source).toContain(marker);
    expect(navigation).not.toContain('capacity="MANAGER"');
  });

  it('enforces Manager target and lifecycle control boundaries in presentation', () => {
    expect(source).toContain("capacity === 'OWNER' || member.role === 'STAFF'");
    expect(source).toContain("value.status === 'SUSPENDED'");
    expect(source).toContain("value.status === 'ACTIVE'");
    expect(source).toContain("value.status === 'DISABLED'");
    expect(source).toContain('cannot be reactivated');
  });

  it('prevents duplicate submissions and refreshes authoritative queries', () => {
    expect(source).toContain('invite.isPending');
    expect(source).toContain('mutation.isPending');
    expect(source).toContain('action.isPending');
    expect(source).toContain("invalidateQueries({ queryKey: ['owner-staff'");
  });
});
