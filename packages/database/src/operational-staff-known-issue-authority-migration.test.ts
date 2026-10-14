import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261014103000_operational_staff_known_issue_authority/migration.sql',
  ),
  'utf8',
);

describe('Operational Staff known-issue authority migration', () => {
  it('adds the narrow permission and migrates only the exact legacy Operations preset', () => {
    expect(sql).toContain("'known_issues.create'");
    expect(sql).toMatch(
      /COUNT\(DISTINCT permission\."code"\) FILTER \([\s\S]*?<> 'known_issues\.create'[\s\S]*?\) = 18/,
    );
    expect(sql).toContain('membership."role" = \'STAFF\'');
    expect(sql).toContain('operational_staff_permission_migration');
  });

  it('removes broad vehicle editing and request authority from migrated Operations Staff', () => {
    expect(sql).toContain('DELETE FROM "owner_staff_permissions"');
    expect(sql).toContain("'vehicles.update_operational_fields'");
    expect(sql).toContain("'bookings.view'");
    expect(sql).toContain("'bookings.accept'");
    expect(sql).toContain("'bookings.reject'");
  });
});
