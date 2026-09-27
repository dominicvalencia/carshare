import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260927190000_net_payout_adjustments/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 63 net payout adjustment authority', () => {
  it('allows nonempty zero-net payouts and retains the accounting equation', () => {
    expect(sql).toContain('"amount_minor" >= 0');
    expect(sql).toContain('gross_items <= 0');
    expect(sql).toContain('expected <> gross_items + signed_adjustments');
    expect(sql).toContain('expected < 0');
  });

  it('enforces negative immutable idempotent adjustments with matching authority', () => {
    expect(sql).toContain('"signed_amount_minor" < 0');
    expect(sql).toContain('payout_adjustments_idempotency_key_key');
    expect(sql).toContain('payout adjustment history is append-only');
    expect(sql).toContain('Cancellation recovery adjustment source authority mismatch');
  });

  it('protects reserved obligation value from a racing waiver', () => {
    expect(sql).toContain('Waiver exceeds unreserved remaining obligation');
    expect(sql).toContain('AND "status" = \'RESERVED\'');
  });

  it('prevents aggregate over-reservation and binds applied adjustments to recovery ledger authority', () => {
    expect(sql).toContain('Cancellation recovery adjustment exceeds unreserved obligation balance');
    expect(sql).toContain('ledger_row."type" <> \'OWNER_PENALTY_RECOVERY\'');
    expect(sql).toContain('ledger_row."source_type" <> \'PAYOUT_ADJUSTMENT\'');
    expect(sql).toContain('ledger_row."source_id" <> NEW."id"');
  });
});
