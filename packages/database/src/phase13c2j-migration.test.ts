import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'prisma/migrations/20260910100000_phase13c2j_renter_onboarding_authority/migration.sql',
  'utf8',
);
const personaMigration = readFileSync(
  'prisma/migrations/20260910200000_phase13c2j_initial_persona_owner_first_entry/migration.sql',
  'utf8',
);

describe('Phase 13C-2J Renter onboarding authority migration', () => {
  it('adds one nullable authoritative timestamp and backfills only existing Renters', () => {
    expect(migration).toContain('ADD COLUMN "renter_onboarding_completed_at" TIMESTAMPTZ(3)');
    expect(migration).toContain('role."code" = \'RENTER\'');
    expect(migration).not.toContain('INSERT INTO "user_roles"');
    expect(migration).not.toContain('UPDATE "user_roles"');
    expect(migration).not.toContain('UPDATE "owner_profiles"');
  });
});

describe('Phase 13C-2J initial persona and Owner first-entry migration', () => {
  it('adds the restricted persona enum and nullable authoritative fields', () => {
    expect(personaMigration).toContain(
      "CREATE TYPE \"MarketplacePersona\" AS ENUM ('RENTER', 'OWNER')",
    );
    expect(personaMigration).toContain('"initial_marketplace_persona" "MarketplacePersona"');
    expect(personaMigration).toContain('"owner_onboarding_first_entered_at" TIMESTAMPTZ(3)');
  });

  it('uses strict role ordering and leaves ambiguous dual-role history nullable', () => {
    expect(personaMigration).toContain('WHEN assignments.renter_at < assignments.owner_at');
    expect(personaMigration).toContain('WHEN assignments.owner_at < assignments.renter_at');
    expect(personaMigration).toContain('assignments.renter_at <> assignments.owner_at');
  });

  it('compatibility-marks established Owners without mutating roles or Owner state', () => {
    expect(personaMigration).toContain(
      'SET "owner_onboarding_first_entered_at" = CURRENT_TIMESTAMP',
    );
    expect(personaMigration).not.toContain('INSERT INTO "user_roles"');
    expect(personaMigration).not.toContain('UPDATE "user_roles"');
    expect(personaMigration).not.toContain('UPDATE "owner_profiles"');
  });
});
