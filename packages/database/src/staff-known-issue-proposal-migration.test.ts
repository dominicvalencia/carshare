import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261014120000_staff_known_issue_proposals/migration.sql',
  ),
  'utf8',
);

describe('Staff known-issue proposal migration', () => {
  it('classifies proposal ownership without weakening Manager integrity', () => {
    expect(sql).toContain('"VehicleChangeProposalKind"');
    expect(sql).toContain("membership.\"role\" = 'MANAGER' AND NEW.\"kind\" = 'GENERAL'");
    expect(sql).toContain("membership.\"role\" = 'STAFF'");
    expect(sql).toContain("NEW.\"kind\" = 'STAFF_KNOWN_ISSUE'");
  });

  it('requires the narrow permission for Staff proposal ownership', () => {
    expect(sql).toContain("permission.\"code\" = 'known_issues.create'");
    expect(sql).toContain(`membership."status" <> 'ACTIVE'`);
    expect(sql).toContain(`membership."owner_profile_id" <> NEW."owner_profile_id"`);
  });
});
