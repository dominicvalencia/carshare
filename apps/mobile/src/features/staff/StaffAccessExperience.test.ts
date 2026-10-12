import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const access = readFileSync(resolve(directory, 'StaffAccessExperience.tsx'), 'utf8');
const app = readFileSync(resolve(directory, '../../../App.tsx'), 'utf8');
const auth = readFileSync(resolve(directory, '../../auth/AuthProvider.tsx'), 'utf8');
const navigation = readFileSync(resolve(directory, '../../navigation/AppNavigation.tsx'), 'utf8');

describe('Phase E Staff access mobile experience', () => {
  it('routes stable Staff access deep links without adding a generic auth entry', () => {
    expect(app).toContain('staffAccessLink(url, appScheme)');
    expect(app).toContain('<StaffAccessExperience');
    expect(app).toContain('staffAccessHandle={staffAccessHandle}');
  });

  it('uses mobile and password only for contextual Staff login', () => {
    const login = access.slice(
      access.indexOf('function StaffLoginForm('),
      access.indexOf('export function StaffInvitationSetup('),
    );
    expect(login).toContain('label="Mobile number"');
    expect(login).toContain('keyboardType="phone-pad"');
    expect(login).toContain('label="Password"');
    expect(login).toContain('<PasswordVisibility');
    expect(login).toContain('apiClient.loginStaffAccess(handle');
    expect(login).not.toContain('Email');
    expect(login).not.toContain('Create account');
    expect(login).toContain('Forgot password?');
  });

  it('keeps Staff recovery contextual and uses mobile OTP before a new password', () => {
    const recovery = access.slice(
      access.indexOf('function StaffPasswordRecovery('),
      access.indexOf('export function StaffInvitationSetup('),
    );
    expect(recovery).toContain('Reset Staff password');
    expect(recovery).toContain('label="Mobile number"');
    expect(recovery).toContain('/password-reset/requests`');
    expect(recovery).toContain('label="Verification code"');
    expect(recovery).toContain('/password-reset/verify`');
    expect(recovery).toContain('Create new password');
    expect(recovery).toContain('label="Confirm password"');
    expect(recovery).toContain('/password-reset/complete`');
    expect(recovery).toContain('Back to Staff login');
    expect(recovery).not.toContain('Email');
  });

  it('keeps contextual login failures generic and authorizes existing sessions', () => {
    expect(access).toContain('Unable to access this workspace');
    expect(access).toMatch(/ask the Owner if your Staff access is still\s+active/);
    expect(access).toContain('/authorize`');
    expect(access).toContain('if (resolution.data?.valid && auth.user');
    expect(access).toContain('title="Access unavailable"');
  });

  it('stores ordinary session tokens and selects the authorized workspace', () => {
    expect(auth).toContain('acceptAuthentication(result: AuthTokens)');
    expect(access).toContain('await auth.acceptAuthentication(result)');
    expect(access).toContain('ownerWorkspaceStorage.set(result.user.id');
    expect(access).toContain("activeRoleStorage.set(result.user.id, 'owner')");
    expect(navigation).toContain("? 'Dashboard'");
    expect(navigation).toContain("? 'Vehicles'");
    expect(navigation).toContain("? 'Messages'");
  });

  it('shows password-only invitation setup followed by OTP verification', () => {
    const setup = access.slice(access.indexOf('export function StaffInvitationSetup('));
    expect(setup).toContain(
      "title={challengeId ? 'Verify your mobile number' : 'Set up your account'}",
    );
    expect(setup).toContain('label="Password"');
    expect(setup).toContain('label="Confirm password"');
    expect(setup).toContain('Use 12–128 characters and avoid common passwords.');
    expect(setup).toContain("'/owner/staff-invitations/setup'");
    expect(setup).toContain(
      'JSON.stringify({ confirmPassword, password, token: invitationToken })',
    );
    expect(setup).toContain('label="Verification code"');
    expect(setup).toContain('completeStaffInvitationSetup');
    expect(setup).not.toContain('label="Mobile number"');
    expect(setup).not.toContain('label="Email"');
  });

  it('keeps invalid stable links private and invitation terminal states shared', () => {
    expect(access).toContain('Staff access link unavailable');
    expect(access).toContain('Ask the Owner for the current Staff access link.');
    expect(access).toContain('<StateView');
    for (const state of ['EXPIRED', 'REVOKED']) expect(app).toContain(state);
    expect(app).toContain('Invitation already accepted');
  });
});
