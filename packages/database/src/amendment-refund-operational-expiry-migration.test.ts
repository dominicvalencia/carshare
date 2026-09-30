import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(resolve(import.meta.dirname, `../prisma/migrations/${name}/migration.sql`), 'utf8');

describe('Migration 71 amendment refund operational expiry', () => {
  it('preserves accepted Migration 69 and 70 checksums', () => {
    expect(
      createHash('sha256')
        .update(migration('20260929120000_booking_amendment_refund_correlation'))
        .digest('hex'),
    ).toBe('dc2faf129e7120f83fbeebcf20de6ae93fe53dee4d4d914ab3ab1aa8a39d8ee8');
    expect(
      createHash('sha256')
        .update(migration('20260929143000_amendment_refund_suspense'))
        .digest('hex'),
    ).toBe('fc463463fec3c4a8a03c0c732d8d09555cae7fdb4480610241a55cf9606d67b5');
  });

  it('contains only the exceptional lifecycle and structured evidence authority', () => {
    const sql = migration('20260930090000_amendment_refund_operational_expiry');
    expect(sql).toContain("ADD VALUE 'FINANCIAL_RECOVERY_PENDING'");
    expect(sql).toContain('"operationally_expired_at"');
    expect(sql).toContain('booking_amendment_refund_resolution_evidence');
    expect(sql).toContain('"idempotency_key"');
    expect(sql).not.toContain('UPDATE "booking_amendments"');
    expect(sql).not.toContain('pickup_discrepancy_responses');
  });
});
