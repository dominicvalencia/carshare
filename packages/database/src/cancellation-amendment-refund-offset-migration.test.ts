import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../prisma/migrations/20260930100000_cancellation_amendment_refund_offset/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Migration 72 cancellation amendment refund offset', () => {
  it('defaults historical rows to zero and enforces a nonnegative typed offset', () => {
    expect(sql).toContain(
      'ADD COLUMN "amendment_refund_obligation_offset_minor" BIGINT NOT NULL DEFAULT 0',
    );
    expect(sql).toContain('"amendment_refund_obligation_offset_minor" >= 0');
  });

  it('preserves the accepted settlement rules while adding the offset to conservation', () => {
    expect(sql).toContain('DROP CONSTRAINT "booking_cancellation_settlements_amounts_check"');
    expect(sql).toContain('"refund_amount_minor" + "amendment_refund_obligation_offset_minor" +');
    expect(sql).toContain(
      '"delivery_retained_minor" + "delivery_refunded_minor" = "delivery_fee_minor"',
    );
    expect(sql).toContain('"collection_refunded_minor" = "collection_fee_minor"');
  });

  it('does not contain unrelated table changes', () => {
    const altered = [...sql.matchAll(/ALTER TABLE "([^"]+)"/gu)].map((match) => match[1]);
    expect(new Set(altered)).toEqual(new Set(['booking_cancellation_settlements']));
  });
});
