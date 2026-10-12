import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(root, 'prisma/migrations/20261012100000_owner_staff_access_links/migration.sql'),
  'utf8',
);

describe('Owner Staff access-link migration', () => {
  it('models one current public access handle per Owner workspace', () => {
    expect(schema).toContain('model OwnerStaffAccessLink');
    expect(schema).toContain('ownerProfileId  String    @unique');
    expect(schema).toContain('publicHandle    String    @unique');
    expect(migration).toContain('"owner_staff_access_links_owner_profile_id_key"');
    expect(migration).toContain('"owner_staff_access_links_public_handle_key"');
  });

  it('backfills every existing Owner workspace with a high-entropy opaque handle', () => {
    expect(migration).toContain('FROM "owner_profiles" owner_profile');
    expect(migration).toContain(
      "replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')",
    );
    expect(migration).not.toContain('owner_profile."id"::text');
  });

  it('retains actor attribution and positive rotation versions', () => {
    expect(migration).toContain('"created_by_user_id" UUID NOT NULL');
    expect(migration).toContain('"rotated_by_user_id" UUID');
    expect(migration).toContain('CHECK ("version" > 0)');
    expect(migration).toContain('owner_profile."user_id"');
    expect(migration).toContain('"owner_staff_access_links_created_by_user_id_fkey"');
    expect(migration).toContain('"owner_staff_access_links_rotated_by_user_id_fkey"');
  });
});
