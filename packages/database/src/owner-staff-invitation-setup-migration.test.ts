import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20261012130000_owner_staff_invitation_setup/migration.sql'),
  'utf8',
);

describe('Owner Staff invitation setup migration', () => {
  it('stores only a password hash in invitation-scoped pending state', () => {
    expect(schema).toContain('model OwnerStaffInvitationSetup');
    expect(schema).toContain('passwordHash String');
    expect(schema).not.toContain('plaintextPassword');
    expect(migration).toContain('"password_hash" VARCHAR(255) NOT NULL');
  });

  it('adds an invitation-scoped OTP purpose and exclusive challenge authority', () => {
    expect(schema).toContain('STAFF_INVITATION_SETUP');
    expect(migration).toContain('ALTER TYPE "OtpPurpose" ADD VALUE \'STAFF_INVITATION_SETUP\'');
    expect(migration).toContain('num_nonnulls("user_id", "owner_staff_invitation_setup_id") = 1');
  });

  it('cascades setup invalidation from the one-time invitation', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("invitation_id") REFERENCES "owner_staff_invitations"("id")',
    );
    expect(migration).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
  });
});
