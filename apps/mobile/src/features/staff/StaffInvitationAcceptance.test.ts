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
  it('retains invitation context across ordinary login and registration', () => {
    expect(app).toContain('<AuthFlow initialScreen={authScreen} />');
    expect(app).toContain("setAuthScreen('login')");
    expect(app).toContain("setAuthScreen('register')");
    expect(auth).toContain("initialScreen = 'welcome'");
  });

  it('uses the authenticated acceptance endpoint and refreshes identity', () => {
    expect(app).toContain("'/owner/staff-invitations/accept'");
    expect(app).toContain('await auth.refreshIdentity()');
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
