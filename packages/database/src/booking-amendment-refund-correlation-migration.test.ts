import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const acceptedMigrations = [
  [
    '20260928020352_booking_amendment_foundation',
    '90951f91a420bfbf5b9796432a5795497638122648e731dae3f8e1402eaa7a1b',
  ],
  [
    '20260928043000_correct_amendment_hold_release',
    '8931abe78d19e1664eae030fffe35ea93507fb9159d4ea672ce11fda1ac9473e',
  ],
  [
    '20260928050000_complete_amendment_hold_release',
    '27d1f2818cd6e54707781e14e7d9ca09f63859bda0fdec6d60d10ce8f27f6a5d',
  ],
  [
    '20260928130000_owner_accepted_processing',
    '3a77ed5312655e3094c07ddf8bf1d0ceb49d12c3a490d0b21f4d38c717b5bce1',
  ],
] as const;

const migration69 = migration('20260929120000_booking_amendment_refund_correlation');

describe('Migration 69 booking-amendment refund correlation', () => {
  it('preserves accepted Migrations 65 through 68', () => {
    for (const [name, checksum] of acceptedMigrations) {
      expect(createHash('sha256').update(migration(name)).digest('hex')).toBe(checksum);
    }
  });

  it('adds only the nullable refund foreign key', () => {
    expect(migration69).toContain('ADD CONSTRAINT "booking_amendment_settlements_refund_id_fkey"');
    expect(migration69).toContain('FOREIGN KEY ("refund_id") REFERENCES "refunds"("id")');
    expect(migration69).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(migration69).not.toMatch(/ADD COLUMN|DROP COLUMN|CREATE INDEX|DROP INDEX/u);
    expect(migration69).not.toContain('pickup_discrepancy_responses');
    expect(migration69).not.toContain('round_number');
  });
});
