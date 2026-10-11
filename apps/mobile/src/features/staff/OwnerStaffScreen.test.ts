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
    expect(source).toContain('label="All vehicles"');
    expect(source).toContain('label="Selected vehicles"');
    expect(source).toContain('accessibilityRole="checkbox"');
    expect(source).toContain('accessibilityState={{ checked }}');
    expect(source).toContain('/vehicle-scope');
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
