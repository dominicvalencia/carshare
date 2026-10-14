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
const labels = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'owner-staff-labels.ts'),
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
    expect(source).toContain('compactNestedHeader');
    expect(source).toContain('<SectionHeader title="Staff members" />');
    expect(source).toContain('<StatusBadge');
    expect(source).toContain("ACTIVE: 'success'");
    expect(source).toContain("INVITED: 'warning'");
    expect(source).toContain("SUSPENDED: 'neutral'");
    expect(source).toContain("DISABLED: 'danger'");
    expect(source).toContain('<StateView');
  });

  it('shows stable Staff access-link management only for the actual Owner', () => {
    expect(source).toContain("capacity === 'OWNER' ? (");
    expect(source).toContain('<StaffAccessLinkCard');
    expect(source).toContain("queryKey = ['owner-staff-access-link', ownerProfileId]");
    expect(source).toContain('title="Staff access link"');
    expect(source).toContain('Existing Staff can use this link to sign in on a new device.');
    expect(source).not.toContain("capacity === 'MANAGER' ? <StaffAccessLinkCard");
  });

  it('loads, retries, copies, and shares the authoritative full link safely', () => {
    expect(source).toContain('`/owner/workspaces/${ownerProfileId}/staff-access-link`');
    expect(source).toContain('title="Loading Staff access link"');
    expect(source).toContain('title="Unable to load Staff access link"');
    expect(source).toContain('onAction={() => void accessLink.refetch()}');
    expect(source).toContain('numberOfLines={1}');
    expect(source).toContain('Clipboard.setStringAsync(accessLink.data.url)');
    expect(source).toContain("Alert.alert('Link copied')");
    expect(source).toContain('Share.share({');
    expect(source).toContain('accessLink.data.url');
    expect(source).toContain('styles.accessLinkActions');
    expect(source).toContain('styles.regenerateAction');
    expect(source).not.toContain('ownerProfileId}\\n${accessLink.data.url}');
  });

  it('keeps Staff member cards compact with status aligned to the name row', () => {
    expect(source).toContain('styles.memberHeadingRow');
    expect(source).toContain('minHeight: 76');
    expect(source).toContain('paddingVertical: spacing.sm');
    expect(source).toContain('{staffRoleLabel(member)} · {scopeLabel(member)}');
    expect(source).toContain('{invitationIdentity(member)!.value}');
  });

  it('prioritizes membership role in directory and detail terminology', () => {
    expect(labels).toContain("if (member.role === 'MANAGER') return 'Manager'");
    expect(labels).toContain("CUSTOM: 'Custom Staff'");
    expect(source).toContain('staffPermissionLabel(value.role, value.preset)');
    expect(source).toContain('label="Permissions"');
    expect(source).not.toContain('label="Access level" value={presetLabel(value.preset)}');
  });

  it('presents semantic access details and reuses the existing editors', () => {
    expect(source).toContain('<SectionHeader title="Access" />');
    expect(source).toContain('label="Role"');
    expect(source).toContain('label="Permissions"');
    expect(source).toContain('label="Vehicle access"');
    expect(source).not.toContain('`${value.permissions.length} configured`');
    expect(source).toContain('accessibilityLabel="Edit access"');
    expect(source).toContain('style={styles.accessActionRow}');
    expect(source).toContain('name="chevron-forward"');
    expect(source).toContain("manageable && value.status !== 'DISABLED'");
    expect(source).toContain("onSelect('permissions')");
    expect(source).toContain("onSelect('vehicles')");
    expect(source).toContain(
      '<PermissionEditor selected={permissions} onChange={setPermissions} />',
    );
    expect(source).toContain('<SegmentedControl');
  });

  it('uses one native modal while switching from the access menu to an editor', () => {
    expect(source).toContain('const [editorView, setEditorView]');
    expect(source).toContain('visible={editorView !== null}');
    expect(source).toContain("editorView === 'menu'");
    expect(source).toContain('onSelect={setEditorView}');
    expect(source).toContain('kind={editorView}');
    expect(source).toContain('<MemberEditorPanel');
    expect(source).toContain('style={[styles.sheet, animatedSheetStyle]}');
    expect(source).toContain('adaptiveSheetLayout({');
    expect(source).not.toContain('const [accessMenu, setAccessMenu]');
    expect(source).not.toContain('const [pendingEditor, setPendingEditor]');
    expect(source).not.toContain('<MemberEditorModal');
  });

  it('uses the shared top Cancel control for the Edit access menu without a bottom action', () => {
    const menu = source.slice(
      source.indexOf('function AccessEditorMenu'),
      source.indexOf('function MemberEditorPanel'),
    );
    expect(menu).toContain('<BackControl label="Cancel" onPress={onClose} />');
    expect(menu).toContain("onPress={() => onSelect('permissions')}");
    expect(menu).toContain("onPress={() => onSelect('vehicles')}");
    expect(menu).toContain('Math.max(safeArea.bottom, spacing.xl)');
    expect(menu).not.toContain('<Button label="Cancel"');
  });

  it('keeps the identity summary read-only on the Staff detail screen', () => {
    expect(source).not.toContain('label="Edit display name"');
    expect(source).not.toContain("setEditor('identity')");
    expect(source).toContain("subtitle={`${value.role === 'MANAGER' ? 'Manager' : 'Staff'}");
    expect(source).toContain('action={');
    expect(source).toContain('style={styles.staffStatusAction}');
  });

  it('shows trusted Manager authority only to the actual Owner with confirmation and refresh', () => {
    expect(source).toContain("capacity === 'OWNER' && value.role === 'MANAGER'");
    expect(source).toContain('<SectionHeader title="Manager authority" />');
    expect(source).toContain('Act without Owner approval');
    expect(source).toContain(
      'Allows this Manager to make supported vehicle changes without your approval.',
    );
    expect(source).toContain('You’ll still be notified of every trusted vehicle update or submission.');
    expect(source).toContain('setManagerAuthorityConfirmation(!value.ownerApprovalBypassEnabled)');
    expect(source).toContain('accessibilityRole="switch"');
    expect(source).toContain('styles.managerAuthoritySwitchTrack');
    expect(source).toContain('styles.managerAuthoritySwitchThumb');
    expect(source).toContain('managerAuthoritySwitchTrackEnabled: { backgroundColor: colors.primary }');
    expect(source).toContain('Enable trusted authority?');
    expect(source).toContain('Enable trusted authority');
    expect(source).toContain('Remove trusted authority?');
    expect(source).toContain('Remove trusted authority');
    expect(source).toContain(
      'Existing submissions keep the approval rules that applied when they were submitted.',
    );
    expect(source).toContain('/manager-authority`');
    expect(source).toContain('await refresh()');
    expect(source).toContain('(error.status === 403 || error.status === 409)');
  });

  it('keeps Manager authority confirmation dismissal and mutation behavior unchanged', () => {
    const detail = source.slice(
      source.indexOf('function StaffDetailScreen'),
      source.indexOf('function AccessEditorModal'),
    );
    const confirmation = source.slice(
      source.indexOf('function ManagerAuthorityConfirmationModal'),
      source.indexOf('const styles = StyleSheet.create'),
    );

    expect(detail).toContain('enabled={managerAuthorityConfirmation}');
    expect(detail).toContain('onCancel={() => setManagerAuthorityConfirmation(null)}');
    expect(detail).toContain('managerAuthority.mutate(managerAuthorityConfirmation)');
    expect(confirmation).toContain('<BackControl label="Cancel" onPress={onCancel} />');
    expect(confirmation).toContain('onPress={onConfirm}');
    expect(confirmation).not.toContain('<Button disabled={pending} label="Cancel"');
  });

  it('shows a compact selected-vehicle summary row and removes the standalone picker button', () => {
    expect(source).toContain('vehicleSelectionLabel(vehicleIds.length)');
    expect(source).toContain('Selected vehicles. ${vehicleSelectionLabel(vehicleIds.length)}');
    expect(source).toContain('pressed && styles.selectorRowPressed');
    expect(source).toContain('hitSlop={4}');
    expect(source).not.toContain("'Select vehicles'\n                  }");
  });

  it('gates picker completion and saving on resolved, valid, dirty state', () => {
    expect(source).toContain(
      'disabled={vehicles.isPending || vehicles.isError || selected.length === 0}',
    );
    expect(source).toContain('const dirty =');
    expect(source).toContain('scope !== member.vehicleScopeMode');
    expect(source).toContain('!sameStringSet(vehicleIds, initialVehicleIds)');
    expect(source).toContain('disabled={!dirty || !valid || mutation.isPending}');
    expect(source).toContain(
      "variant={!dirty || !valid || mutation.isPending ? 'secondary' : 'primary'}",
    );
  });

  it('shows lifecycle actions only for their authoritative member states', () => {
    expect(source).toContain("value.status === 'INVITED'");
    expect(source).toContain('label="Reissue invitation"');
    expect(source).toContain('>Revoke invitation</Text>');
    expect(source).toContain("value.status === 'ACTIVE' || value.status === 'SUSPENDED'");
    expect(source).toContain('label="Suspend access"');
    expect(source).toContain('label="Reactivate"');
    expect(source).toContain('label="Remove access"');
    expect(source).toContain("value.status === 'DISABLED'");
  });

  it('keeps expired invitation management visible and prioritizes reissue', () => {
    expect(source).toContain('tone={invitationStateTone(value.invitation.state)}');
    expect(source).toContain("EXPIRED: 'danger'");
    expect(source).toContain("value.invitation.state === 'EXPIRED' ? 'primary' : 'secondary'");
    expect(source).toContain('label="Reissue invitation"');
    expect(source).toContain('>Revoke invitation</Text>');
    expect(source).toContain("value.status === 'INVITED' && value.invitation");
    expect(source).toContain('styles.invitationActions');
    expect(source).toContain('style={styles.destructiveTextAction}');
    expect(source).toContain('invitationActions: { gap: spacing.sm }');
  });

  it('refreshes authoritative invitation state and expiration after reissue', () => {
    expect(source).toContain("if (confirm === 'reissue') Alert.alert('Invitation sent again')");
    expect(source).toContain('await refresh()');
    expect(source).toContain('label="Expires" value={dateTimeLabel(value.invitation.expiresAt)}');
  });

  it('keeps Activity informational and after contextual management actions', () => {
    const manageAccess = source.indexOf('<SectionHeader title="Manage access" />');
    const dangerZone = source.indexOf('>Danger zone</Text>');
    const activity = source.indexOf('<SectionHeader title="Activity" />');
    expect(activity).toBeGreaterThan(manageAccess);
    expect(activity).toBeGreaterThan(dangerZone);
    expect(source).toContain('style={styles.activityCard}');
  });

  it('keeps destructive workspace removal separate with explicit confirmation copy', () => {
    expect(source).toContain('Remove access from workspace');
    expect(source).toContain('previous activity and audit history will be preserved');
    expect(source).toContain('This invitation will no longer be usable.');
    expect(source).toContain('temporarily lose access to this Owner workspace');
    expect(source).toContain("completedAction === 'disable'");
  });

  it('keeps Owner versus Manager target restrictions on every detail action', () => {
    expect(source).toContain('const manageable = canManageMember(capacity, value)');
    expect(source).toContain('selfMembershipId !== undefined');
    expect(source).toContain('memberId !== undefined');
    expect(source).toContain('return !isSelf');
    expect(source).toContain("capacity === 'OWNER' || member.role === 'STAFF'");
    expect(source).toContain('manageable && value.status');
    expect(source).toContain('error.status === 403 || error.status === 409');
    expect(source).toContain('await refresh()');
  });

  it('confirms rotation and atomically replaces the cached link', () => {
    expect(source).toContain('Regenerate Staff access link?');
    expect(source).toContain('The current link will stop working immediately.');
    expect(source).toContain('Existing Staff accounts and active');
    expect(source).toContain('/staff-access-link/regenerate`');
    expect(source).toContain('client.setQueryData(queryKey, next)');
    expect(source).toContain("Alert.alert('New Staff access link created')");
    expect(source).toContain('label="Cancel"');
  });

  it('offers only Manager and Operations Staff during creation', () => {
    const addStaff = source.slice(
      source.indexOf('const presetOptions'),
      source.indexOf('function friendlyError'),
    );
    expect(source).toContain('Managers can manage Staff, but not other Managers.');
    expect(source).not.toContain('Managers can administer ordinary Staff only.');
    expect(source).toContain("capacity === 'OWNER' || option.role !== 'MANAGER'");
    expect(addStaff).toContain("preset: 'MANAGER'");
    expect(addStaff).toContain("label: 'Manager'");
    expect(addStaff).toContain("preset: 'OPERATIONS_STAFF'");
    expect(addStaff).toContain("label: 'Operations Staff'");
    expect(addStaff).not.toContain("preset: 'CUSTOM'");
    expect(addStaff).not.toContain("label: 'Custom Staff'");
    expect(addStaff).not.toContain("preset: 'SUPPORT_STAFF'");
    expect(addStaff).not.toContain('Verification Staff');
  });

  it('uses concise creation copy without exposing trusted-authority controls', () => {
    const addStaff = source.slice(
      source.indexOf('const presetOptions'),
      source.indexOf('function PermissionEditor'),
    );
    expect(addStaff).toContain(
      'Can manage vehicles, booking requests, rental operations, and ordinary Staff. Vehicle changes require your approval unless trusted authority is enabled.',
    );
    expect(addStaff).toContain(
      'Handles day-to-day rental operations for approved vehicles.',
    );
    expect(addStaff).not.toContain('Act without Owner approval');
    expect(addStaff).not.toContain('Enable trusted authority');
  });

  it('sends the selected role and preset without changing invitation semantics', () => {
    const addStaff = source.slice(
      source.indexOf('function InviteStaffScreen'),
      source.indexOf('function PermissionEditor'),
    );
    expect(addStaff).toContain('preset,\n          role: selectedOption.role,');
    expect(addStaff).toContain('`/owner/workspaces/${ownerProfileId}/staff/invitations`');
    expect(addStaff).toContain("method: 'POST'");
    expect(addStaff).not.toContain("preset === 'CUSTOM'");
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

  it('keeps custom permissions available in Edit access but not during creation', () => {
    const addStaff = source.slice(
      source.indexOf('function InviteStaffScreen'),
      source.indexOf('function PermissionEditor'),
    );
    expect(addStaff).not.toContain('Custom Staff');
    expect(addStaff).not.toContain('Configure permissions');
    expect(addStaff).not.toContain('<PermissionEditorModal');
    expect(source).toContain(
      '<PermissionEditor selected={permissions} onChange={setPermissions} />',
    );
    expect(source).toContain("kind === 'permissions' ? 'Edit permissions' : 'Vehicle access'");
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

  it('shows the compact selected-vehicle summary during creation', () => {
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
    expect(source).toContain('useSharedValue(Math.min(320, maximumHeight))');
    expect(source).toContain('adaptiveSheetLayout({');
    expect(source).toContain('style={[styles.sheet, animatedSheetStyle]}');
    expect(source).toContain('title="Loading vehicles"');
    expect(source).toContain('title="Unable to load vehicles"');
    expect(source).toContain('actionLabel="Retry"');
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
    expect(source).toContain('label="Done"\n              onPress={onClose}');
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

  it('uses the shared Field for an SMS-first Philippine mobile invitation', () => {
    expect(source).toContain('label="Mobile number"');
    expect(source).toContain('keyboardType="phone-pad"');
    expect(source).toContain('mobileNumber: mobileNumber.trim()');
    expect(source).not.toContain('label="Email"\n          placeholder="name@example.com"');
    expect(source).toContain('isPlausiblePhilippineMobile(mobileNumber)');
  });

  it('presents pending invitation identity by authoritative channel', () => {
    expect(source).toContain("member.invitation.channel === 'SMS' ? 'Mobile number' : 'Email'");
    expect(source).toContain('value: member.invitation.destination');
    expect(source).toContain("Alert.alert('Invitation sent again')");
  });

  it('renders safe delivery and rate-limit failures', () => {
    expect(source).toContain("error.code === 'OWNER_STAFF_INVITATION_DELIVERY_FAILED'");
    expect(source).toContain('Invitation created, but the SMS could not be sent.');
    expect(source).toContain("error.code === 'RATE_LIMITED'");
    expect(source).toContain('Too many invitation attempts.');
  });
});
