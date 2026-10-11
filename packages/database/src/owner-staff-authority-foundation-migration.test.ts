import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20261010140000_owner_staff_authority_foundation/migration.sql'),
  'utf8',
);

describe('Owner Staff authority foundation migration', () => {
  it('models memberships, explicit permissions, invitations, and vehicle assignments', () => {
    expect(schema).toContain('model OwnerStaffMembership');
    expect(schema).toContain('model OwnerStaffPermission');
    expect(schema).toContain('model OwnerStaffInvitation');
    expect(schema).toContain('model OwnerStaffVehicleAssignment');
    expect(migration).toContain('owner_staff_memberships_owner_profile_id_user_id_key');
    expect(migration).toContain('owner_staff_invitations_token_hash_key');
  });

  it('enforces same-owner vehicle assignment in the database', () => {
    expect(migration).toContain('enforce_owner_staff_vehicle_scope');
    expect(migration).toContain('membership."owner_profile_id" = vehicle."owner_profile_id"');
    expect(migration).toContain('owner_staff_vehicle_scope_guard');
  });

  it('seeds exact Owner permissions without wildcard grants', () => {
    expect(migration).toContain("'vehicles.view'");
    expect(migration).toContain("'staff.assign_permissions'");
    expect(migration).not.toContain("'vehicles.*'");
  });
});
