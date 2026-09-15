import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260913100000_phase13c2kb4_handover_travel/migration.sql',
  ),
  'utf8',
);

describe('Phase 13C-2K-B4 migration', () => {
  it('creates separately typed append-only handover travel events', () => {
    expect(migration).toContain('CREATE TYPE "HandoverPhase"');
    expect(migration).toContain('CREATE TYPE "HandoverTravelStatus"');
    expect(migration).toContain('CREATE TABLE "booking_handover_travel_events"');
    expect(migration).toContain('booking_handover_travel_events_append_only');
    expect(migration).toContain('reject_append_only_mutation');
  });

  it('enforces idempotency, indexed history, and restrictive relations', () => {
    expect(migration).toContain('UNIQUE ("booking_id", "phase", "status")');
    expect(migration).toContain('booking_id_phase_occurred_at_idx');
    expect(migration).toContain('actor_user_id_occurred_at_idx');
    expect(migration.match(/ON DELETE RESTRICT/g)).toHaveLength(2);
  });

  it('does not mutate booking lifecycle or fabricate historical events', () => {
    expect(migration).not.toMatch(/ALTER TYPE "BookingStatus"/);
    expect(migration).not.toMatch(/INSERT INTO "booking_handover_travel_events"/);
    expect(migration).not.toMatch(/booking_fulfillment_snapshots.*(UPDATE|ALTER)/s);
  });
});
