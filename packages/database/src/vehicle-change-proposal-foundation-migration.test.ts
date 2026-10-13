import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const sql = readFileSync(
  resolve(
    root,
    'prisma/migrations/20261013170000_vehicle_change_proposal_foundation/migration.sql',
  ),
  'utf8',
);

describe('vehicle change proposal foundation migration', () => {
  it('creates a separate lifecycle and complete snapshot storage without live writes', () => {
    expect(sql).toContain('CREATE TYPE "VehicleChangeProposalStatus"');
    expect(sql).toContain("'PENDING_OWNER_APPROVAL'");
    expect(sql).toContain("'PENDING_PLATFORM_REVIEW'");
    expect(sql).toContain('"proposed_snapshot" JSONB NOT NULL');
    expect(sql).toContain('"snapshot_schema_version" INTEGER NOT NULL DEFAULT 1');
    expect(sql).not.toMatch(/UPDATE "vehicles"|INSERT INTO "vehicle_policy_versions"/u);
  });

  it('enforces one active proposal while leaving terminal history reusable', () => {
    const index = sql.slice(sql.indexOf('vehicle_change_proposals_one_active_per_vehicle_key'));
    expect(index).toContain("'DRAFT'");
    expect(index).toContain("'PENDING_OWNER_APPROVAL'");
    expect(index).not.toMatch(/WHERE[\s\S]{0,300}'WITHDRAWN'/u);
    expect(index).not.toMatch(/WHERE[\s\S]{0,300}'REJECTED'/u);
    expect(index).not.toMatch(/WHERE[\s\S]{0,300}'APPLIED'/u);
  });

  it('uses composite workspace constraints for vehicle and submitting membership', () => {
    expect(sql).toContain('FOREIGN KEY ("vehicle_id", "owner_profile_id")');
    expect(sql).toContain('REFERENCES "vehicles"("id", "owner_profile_id")');
    expect(sql).toContain('FOREIGN KEY ("submitted_by_membership_id", "owner_profile_id")');
    expect(sql).toContain('REFERENCES "owner_staff_memberships"("id", "owner_profile_id")');
    expect(sql).toContain('vehicle_change_proposal_submitter_guard');
  });

  it('keeps proposal assets private and detached from live vehicle assets', () => {
    expect(sql).toContain('CREATE TABLE "vehicle_change_proposal_assets"');
    expect(sql).toContain('vehicle_change_proposal_asset_privacy_guard');
    expect(sql).toContain("asset_classification = 'PUBLIC'");
    expect(sql).toContain('FROM "vehicle_photos"');
    expect(sql).toContain('FROM "vehicle_documents"');
    expect(sql).toContain('vehicle_photos_proposal_asset_guard');
    expect(sql).toContain('vehicle_documents_proposal_asset_guard');
    expect(sql).toContain('file_assets_active_proposal_publication_guard');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('defaults trust decisions safely for later transactional submission', () => {
    expect(sql).toContain('"owner_approval_required" BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain('"owner_approval_bypassed" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"trust_enabled_at_submission" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"platform_review_required" BOOLEAN NOT NULL DEFAULT false');
  });
});
