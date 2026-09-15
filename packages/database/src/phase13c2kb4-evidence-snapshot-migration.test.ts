import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(process.cwd(), `prisma/migrations/${name}/migration.sql`), 'utf8');

describe('Phase 13C-2K-B4 known-issue evidence snapshot migration', () => {
  const migration47 = migration('20260913210000_phase13c2kb4_vehicle_known_issues');
  const migration48 = migration('20260914120000_phase13c2kb4_known_issue_evidence_snapshots');

  it('preserves the accepted migration 47', () => {
    expect(createHash('sha256').update(migration47).digest('hex')).toBe(
      '862be54769738b69b3f18bd4e2d97b6347d65ce84e460053d4447d390cce7c83',
    );
  });

  it('allows evidence reuse across immutable inspection snapshots but not within one inspection', () => {
    expect(migration48).toContain('DROP CONSTRAINT IF EXISTS "inspection_media_file_asset_id_key"');
    expect(migration48).toContain('"inspection_media_inspection_id_file_asset_id_key"');
    expect(migration48).toContain('("inspection_id", "file_asset_id")');
  });

  it('backfills only unambiguous snapshots and links copied media to the condition issue', () => {
    expect(migration48).toContain('COUNT(*)');
    expect(migration48).toContain(') = 1');
    expect(migration48).toContain('NOT EXISTS');
    expect(migration48).toContain('INSERT INTO "inspection_media"');
    expect(migration48).toContain('INSERT INTO "inspection_condition_issue_evidence"');
    expect(migration48).toContain('ON CONFLICT');
    expect(migration48).toContain('DROP TABLE "migration48_known_issue_evidence_backfill"');
  });
});
