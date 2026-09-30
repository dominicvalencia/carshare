import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

const migration69 = migration('20260929120000_booking_amendment_refund_correlation');
const migration70 = migration('20260929143000_amendment_refund_suspense');

describe('Migration 70 amendment refund suspense authority', () => {
  it('preserves accepted Migration 69', () => {
    expect(createHash('sha256').update(migration69).digest('hex')).toBe(
      'dc2faf129e7120f83fbeebcf20de6ae93fe53dee4d4d914ab3ab1aa8a39d8ee8',
    );
  });

  it('adds only the required suspense account authority', () => {
    expect(migration70).toContain(
      `ALTER TYPE "FinancialAccountType" ADD VALUE 'AMENDMENT_REFUND_SUSPENSE'`,
    );
    expect(migration70).toContain(`'AMENDMENT_REFUND_SUSPENSE'`);
    expect(migration70).toContain(`'PHP'`);
    expect(migration70).toContain('ON CONFLICT ("code", "currency") DO NOTHING');
    expect(migration70).not.toMatch(/CREATE TABLE|ADD COLUMN|DROP TABLE|DROP COLUMN/u);
    expect(migration70).not.toContain('pickup_discrepancy_responses');
    expect(migration70).not.toContain('round_number');
  });
});
