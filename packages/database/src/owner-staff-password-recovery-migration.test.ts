import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20261012160000_owner_staff_password_recovery/migration.sql'),
  'utf8',
);

describe('Owner Staff password recovery migration', () => {
  it('adds dedicated recovery purposes and binds challenges and tokens to link versions', () => {
    expect(schema).toContain('STAFF_PASSWORD_RESET');
    expect(schema).toContain('ownerStaffAccessLinkId');
    expect(schema).toContain('staffAccessLinkVersion');
    expect(migration).toContain('ALTER TYPE "OtpPurpose" ADD VALUE \'STAFF_PASSWORD_RESET\'');
    expect(migration).toContain('otp_challenges_staff_access_context_check');
    expect(migration).toContain('auth_tokens_staff_access_context_check');
  });
});
