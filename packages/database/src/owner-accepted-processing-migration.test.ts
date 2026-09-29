import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');
const migration65 = migration('20260928020352_booking_amendment_foundation');
const migration66 = migration('20260928043000_correct_amendment_hold_release');
const migration67 = migration('20260928050000_complete_amendment_hold_release');
const migration68 = migration('20260928130000_owner_accepted_processing');

describe('Migration 68 Owner-accepted processing authority', () => {
  it('preserves accepted Migrations 65 through 67', () => {
    expect(createHash('sha256').update(migration65).digest('hex')).toBe(
      '90951f91a420bfbf5b9796432a5795497638122648e731dae3f8e1402eaa7a1b',
    );
    expect(createHash('sha256').update(migration66).digest('hex')).toBe(
      '8931abe78d19e1664eae030fffe35ea93507fb9159d4ea672ce11fda1ac9473e',
    );
    expect(createHash('sha256').update(migration67).digest('hex')).toBe(
      '27d1f2818cd6e54707781e14e7d9ca09f63859bda0fdec6d60d10ce8f27f6a5d',
    );
  });

  it('adds only the processing state and unresolved uniqueness authority', () => {
    expect(migration68).toContain(
      `ALTER TYPE "BookingAmendmentStatus" ADD VALUE 'OWNER_ACCEPTED_PROCESSING'`,
    );
    expect(migration68).toContain('booking_amendments_one_unresolved_per_booking_idx');
    expect(migration68).toContain("'OWNER_ACCEPTED_PROCESSING'");
    expect(migration68).not.toContain('pickup_discrepancy_responses');
    expect(migration68).not.toContain('round_number');
    expect(migration68).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP TABLE/u);
  });

  it('does not broaden the Owner-response or renter-payment expiry predicates', () => {
    expect(migration68).not.toContain('expire_stale_booking_amendments');
    expect(migration65).toContain(
      `"status" = 'PENDING_OWNER' AND "expires_at" <= CURRENT_TIMESTAMP`,
    );
    expect(migration65).toContain(`"status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'`);
    expect(migration65).not.toContain('OWNER_ACCEPTED_PROCESSING');
  });
});
