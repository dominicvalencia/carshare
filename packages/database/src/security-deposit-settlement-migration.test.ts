import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20261005130000_security_deposit_settlement_foundation/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('Security Deposit settlement foundation migration', () => {
  it('adds the versioned settlement, immutable items, and operation links', () => {
    expect(migration).toContain('CREATE TABLE "security_deposit_settlements"');
    expect(migration).toContain('CREATE TABLE "security_deposit_settlement_items"');
    expect(migration).toContain('CREATE TABLE "security_deposit_settlement_legs"');
    expect(migration).toContain('"payment_operation_id" UUID NOT NULL');
  });

  it('enforces amount bounds and one execution-authorized version', () => {
    expect(migration).toContain('security_deposit_settlement_amounts_nonnegative');
    expect(migration).toContain('security_deposit_settlement_amounts_bounded');
    expect(migration).toContain('security_deposit_settlement_single_execution_authority');
    expect(migration).toContain('WHERE "execution_authority_entered_at" IS NOT NULL');
  });

  it('keeps operation truth in the existing PaymentOperation table', () => {
    expect(migration).toContain('REFERENCES "payment_operations"("id")');
    expect(migration).not.toContain('CREATE TABLE "security_deposit_settlement_operations"');
  });
});
