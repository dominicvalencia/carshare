import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Admin staff access foundation', () => {
  it('filters navigation by explicit permissions and protects direct module rendering', () => {
    const shell = readFileSync('src/components/AdminShell.tsx', 'utf8');
    const consoleSource = readFileSync('src/components/AdminConsole.tsx', 'utf8');
    expect(shell).toContain("permission: 'staff.view'");
    expect(shell).toContain('filter((item) => !item.permission || can(item.permission))');
    expect(consoleSource).toContain('Your staff account does not have permission');
  });

  it('provides staff management, audit, and single-use invitation screens', () => {
    const staff = readFileSync('src/components/StaffManagementPanel.tsx', 'utf8');
    const audit = readFileSync('src/components/AdminAuditPanel.tsx', 'utf8');
    const invitation = readFileSync('src/components/StaffInvitationActivation.tsx', 'utf8');
    const styles = readFileSync('src/app/styles.css', 'utf8');
    const create = readFileSync('src/components/StaffCreatePanel.tsx', 'utf8');
    const detail = readFileSync('src/components/StaffDetailPanel.tsx', 'utf8');
    expect(staff).toContain('href="/admin/staff/new"');
    expect(staff).toContain('Copy local invite link');
    expect(staff).toContain('/local-invitation');
    expect(staff).toContain("can('staff.suspend')");
    expect(create).toContain('OPERATIONS_STAFF');
    expect(create).toContain('VERIFICATION_STAFF');
    expect(create).toContain('SUPPORT_STAFF');
    expect(create).toContain('FINANCE_STAFF');
    expect(create).toContain('Customize permissions');
    expect(create).toContain("window.confirm('Replace your custom permissions");
    expect(create).not.toContain('value="OWNER"');
    expect(detail).toContain('Review and customize full permissions');
    expect(audit).toContain('/admin/audit');
    expect(invitation).toContain('/admin/auth/activate');
    expect(invitation).not.toContain('default password');
    expect(styles).toContain("[data-module='staff'] .module-staff");
    expect(styles).toContain("[data-module='audit'] .module-audit");
  });

  it('provides a distinct Owner workspace and deliberate operations-console entry', () => {
    const shell = readFileSync('src/components/AdminShell.tsx', 'utf8');
    const consoleSource = readFileSync('src/components/AdminConsole.tsx', 'utf8');
    expect(shell).toContain('Owner workspace');
    expect(shell).toContain('Operations Console');
    expect(shell).toContain('/admin/owner/overview');
    expect(shell).toContain('/admin/operations-console/dashboard');
    expect(consoleSource).toContain('Revenue reporting foundation');
    expect(consoleSource).toContain('intentionally not displayed');
    expect(consoleSource).toContain('<OwnerStaffActivityPanel />');
  });
});
