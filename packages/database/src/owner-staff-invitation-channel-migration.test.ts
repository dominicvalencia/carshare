import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261011193000_owner_staff_invitation_channels/migration.sql',
  ),
  'utf8',
);

describe('Owner Staff invitation channel migration', () => {
  it('backfills legacy email invitations before requiring channel-neutral identity', () => {
    expect(migration).toContain('"channel" = \'EMAIL\'');
    expect(migration).toContain('"destination_normalized" = membership."normalized_email"');
    expect(migration).toContain('"owner_profile_id" = membership."owner_profile_id"');
    expect(migration.indexOf('UPDATE "owner_staff_invitations"')).toBeLessThan(
      migration.indexOf('ALTER COLUMN "owner_profile_id" SET NOT NULL'),
    );
  });

  it('enforces workspace consistency with a composite foreign key', () => {
    expect(migration).toContain('FOREIGN KEY ("membership_id", "owner_profile_id")');
    expect(migration).toContain('REFERENCES "owner_staff_memberships"("id", "owner_profile_id")');
  });

  it('allows only one unconsumed and unrevoked destination per workspace and channel', () => {
    expect(migration).toContain(
      'ON "owner_staff_invitations"("owner_profile_id", "channel", "destination_normalized")',
    );
    expect(migration).toContain('WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL');
    expect(migration).not.toMatch(/expires_at[^;]*WHERE|WHERE[^;]*expires_at/iu);
  });
});
