import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readMigration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const migration62 = readMigration('20260927170000_cancellation_financial_foundation');
const migration63 = readMigration('20260927190000_net_payout_adjustments');
const migration64 = readMigration('20260927200000_cancellation_settlement_reconciliation');

describe('Migration 64 cancellation settlement reconciliation', () => {
  it('leaves accepted Migrations 62 and 63 immutable', () => {
    expect(createHash('sha256').update(migration62).digest('hex')).toBe(
      '0ec0faeab67a516af1c958327c91840d648b37c74b69e16af12492877ca2c6ba',
    );
    expect(createHash('sha256').update(migration63).digest('hex')).toBe(
      '71261fc3c0878c294a7035ae868cce76dc20ffe46247e814f0962732665e850f',
    );
  });

  it('reconciles the three mutually exclusive rental disposition components', () => {
    expect(migration64).toContain('"refundable_rental_minor" + "non_refundable_rental_minor" +');
    expect(migration64).toContain('"cancellation_fee_minor" = "rental_component_minor"');
    expect(migration64).not.toContain('"commission_retained_minor" = "rental_component_minor"');
  });

  it('replaces only the settlement check and performs no data rewrite', () => {
    expect(migration64).toContain(
      'DROP CONSTRAINT "booking_cancellation_settlements_policy_amounts_check"',
    );
    expect(migration64).toContain(
      'ADD CONSTRAINT "booking_cancellation_settlements_policy_amounts_check"',
    );
    expect(migration64).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/u);
  });
});
