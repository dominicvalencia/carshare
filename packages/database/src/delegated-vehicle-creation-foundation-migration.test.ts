import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261012190000_delegated_vehicle_creation_foundation/migration.sql',
  ),
  'utf8',
);

describe('delegated vehicle creation foundation migration', () => {
  it('backfills historical vehicle provenance before making its creator required', () => {
    expect(migration).toContain('SET "created_by_user_id" = "owner_user_id"');
    expect(migration).toContain('ADD COLUMN "created_by_membership_id" UUID');
    expect(migration.indexOf('UPDATE "vehicles"')).toBeLessThan(
      migration.indexOf('ALTER COLUMN "created_by_user_id" SET NOT NULL'),
    );
  });

  it('starts existing vehicles at revision zero', () => {
    expect(migration).toContain('"revision" INTEGER NOT NULL DEFAULT 0');
  });

  it('keeps creator and approval membership provenance in the Owner workspace', () => {
    expect(migration).toContain('FOREIGN KEY ("created_by_membership_id", "owner_profile_id")');
    expect(migration).toContain('FOREIGN KEY ("submitted_by_membership_id", "owner_profile_id")');
    expect(migration).toContain('REFERENCES "owner_staff_memberships"("id", "owner_profile_id")');
    expect(migration).toContain('FOREIGN KEY ("vehicle_id", "owner_profile_id")');
    expect(migration).toContain('REFERENCES "vehicles"("id", "owner_profile_id")');
  });

  it('requires a submitted revision and preserves creator and reviewer FK integrity', () => {
    expect(migration).toContain('"submitted_revision" INTEGER NOT NULL');
    expect(migration).toContain('"submitted_by_user_id" UUID NOT NULL');
    expect(migration).toContain('"reviewed_by_user_id" UUID');
    expect(migration).toContain('REFERENCES "users"("id")');
    expect(migration).toMatch(/ON DELETE RESTRICT ON UPDATE CASCADE/g);
  });

  it('allows only one pending request while preserving decided request history', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "vehicle_owner_approval_requests_one_pending_per_vehicle_key"',
    );
    expect(migration).toContain('WHERE "status" = \'PENDING\'');
    expect(migration).not.toMatch(/WHERE "status" IN/u);
    for (const status of ['APPROVED', 'CHANGES_REQUIRED', 'WITHDRAWN']) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it('registers vehicle creation and backfills it only to existing Managers', () => {
    expect(migration).toContain("'vehicles.create'");
    expect(migration).toContain('membership."role" = \'MANAGER\'');
    expect(migration).not.toMatch(/membership\."role"\s*=\s*'STAFF'/u);
  });
});
