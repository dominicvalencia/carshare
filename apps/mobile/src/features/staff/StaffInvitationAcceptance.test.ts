import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../App.tsx'),
  'utf8',
);
const auth = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../auth/AuthFlow.tsx'),
  'utf8',
);

describe('Owner Staff invitation acceptance UI', () => {
  it('retains invitation context across ordinary login and password-only setup', () => {
    expect(app).toContain('invitationContext={{');
    expect(app).toContain('roleLabel: invitation.roleLabel');
    expect(app).toContain('workspaceLabel: invitation.workspaceLabel');
    expect(app).toContain('onBackToContext={() => setAuthScreen(null)}');
    expect(app).toContain("setAuthScreen('login')");
    expect(app).toContain('setShowSetup(true)');
    expect(app).toContain('<StaffInvitationSetup');
    expect(auth).toContain("initialScreen = 'welcome'");
  });

  it('uses the standard auth composition with compact invitation context', () => {
    const compactContext = auth.slice(
      auth.indexOf('function InvitationContextCard('),
      auth.indexOf('function AuthStatusScreen('),
    );
    expect(auth).toContain('<InvitationContextCard context={invitationContext} />');
    expect(app).toContain('roleLabel={invitation.roleLabel}');
    expect(compactContext).toContain('<Card');
    expect(compactContext).toContain('JOINING');
    expect(compactContext).toContain('context.workspaceLabel');
    expect(compactContext).toContain('context.roleLabel');
    expect(compactContext).not.toContain('SMS invitation');
    expect(compactContext).not.toContain('YOU’VE BEEN INVITED TO JOIN');
    expect(app).not.toContain('contextHeader={invitationCard}');
  });

  it('loads authoritative invitation context and reuses shared UI primitives', () => {
    expect(app).toContain('/owner/staff-invitations/preview?token=');
    expect(app).toContain('<Card style={styles.invitationCard}>');
    expect(app).toContain('<BackControl label="Back"');
    expect(app).toContain('<StatusBadge');
    expect(app).toContain('<StateView');
    expect(app).toContain('<Field');
    expect(app).toContain("'/owner/staff-invitations/mobile-verification/requests'");
    expect(app).toContain("'/auth/otp/verifications'");
    expect(app).not.toContain('token}</Text>');
  });

  it('uses the authenticated acceptance endpoint and refreshes identity', () => {
    expect(app).toContain("'/owner/staff-invitations/accept'");
    expect(app).toContain('await auth.refreshIdentity()');
    expect(app).toContain("setMode('owner')");
    expect(app).toContain("activeRoleStorage.set(auth.user.id, 'owner')");
    expect(app).toContain('Invitation accepted');
  });

  it('maps verified-mobile and invitation lifecycle errors to safe states', () => {
    for (const code of [
      'MOBILE_VERIFICATION_REQUIRED',
      'INVITATION_DESTINATION_MISMATCH',
      'OWNER_STAFF_INVITATION_EXPIRED',
      'OWNER_STAFF_INVITATION_REVOKED',
      'OWNER_STAFF_INVITATION_CONSUMED',
    ])
      expect(app).toContain(code);
    expect(app).toContain('Verify mobile number');
    expect(app).toContain('Switch account');
  });

  it('does not alter generic login, registration, or password reset requests', () => {
    expect(auth).toContain('auth.register(identifier, password)');
    expect(auth).toContain('auth.login(identifier, password)');
    expect(auth).toContain("apiClient.request('/auth/password-reset/requests'");
  });
});
