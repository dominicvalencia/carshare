import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(
  resolve(
    root,
    'prisma/migrations/20261013160000_trusted_manager_authority_foundation/migration.sql',
  ),
  'utf8',
);
const architecture = readFileSync(
  resolve(root, '../../docs/architecture/owner-staff-authority.md'),
  'utf8',
);

describe('trusted Manager authority foundation migration', () => {
  it('defaults every existing and new membership to requiring Owner approval', () => {
    expect(migration).toContain('"owner_approval_bypass_enabled" BOOLEAN NOT NULL DEFAULT false');
  });

  it('allows approval bypass only for Manager memberships', () => {
    expect(migration).toContain(
      'CHECK (NOT "owner_approval_bypass_enabled" OR "role" = \'MANAGER\'::"OwnerStaffRole")',
    );
  });

  it('records the actual Owner actor through a constrained user reference', () => {
    expect(migration).toContain('"owner_approval_bypass_changed_by_user_id" UUID');
    expect(migration).toContain('REFERENCES "users"("id")');
  });

  it('locks future-action, permission, review, Owner-boundary, and notification semantics', () => {
    expect(architecture).toContain('It is separate from permission grants: it adds no permission');
    expect(architecture).toContain('does not confer the Owner role');
    expect(architecture).toContain('Trust changes apply only to future actions and submissions.');
    expect(architecture).toContain('CarShare review');
    expect(architecture).toContain('Security Deposit settlement');
    expect(architecture).toContain(
      'No successful vehicle mutation that uses trusted authority may be silent.',
    );
    expect(architecture).toContain('in-app notification for the actual Owner');
    expect(architecture).toContain('push delivery');
  });
});
