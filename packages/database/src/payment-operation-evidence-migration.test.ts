import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL(
    '../prisma/migrations/20261005160000_payment_operation_evidence/migration.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('payment operation evidence migration', () => {
  it('adds normalized, attributable evidence without another operation table', () => {
    expect(migration).toContain('CREATE TABLE "payment_operation_evidence"');
    expect(migration).toContain('"attribution" "PaymentEvidenceAttribution" NOT NULL');
    expect(migration).not.toContain('CREATE TABLE "security_deposit_payment_operations"');
  });

  it('deduplicates evidence and indexes reconciliation/remapping work', () => {
    expect(migration).toContain('payment_operation_evidence_payment_id_evidence_key_key');
    expect(migration).toContain('payment_operations_status_next_reconcile_at_idx');
    expect(migration).toContain(
      'payment_webhook_events_payment_id_permanently_unmappable_at_next_remap_at_idx',
    );
  });

  it('keeps evidence linked to existing payment, operation, webhook, and actor authorities', () => {
    expect(migration).toContain('REFERENCES "payments"("id")');
    expect(migration).toContain('REFERENCES "payment_operations"("id")');
    expect(migration).toContain('REFERENCES "payment_webhook_events"("id")');
    expect(migration).toContain('REFERENCES "users"("id")');
  });
});
