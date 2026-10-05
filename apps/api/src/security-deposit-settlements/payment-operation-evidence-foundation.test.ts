import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  new URL('./security-deposit-settlements.service.ts', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('./security-deposit-settlements.controller.ts', import.meta.url),
  'utf8',
);
const payments = readFileSync(new URL('../payments/payments.service.ts', import.meta.url), 'utf8');

describe('payment operation evidence API foundation', () => {
  it('exposes sanitized evidence and reconciliation diagnostics to settlement admins', () => {
    expect(service).toContain('attribution: evidence.attribution');
    expect(service).toContain('lastReconciledAt');
    expect(service).toContain('manualReviewRequired');
    expect(service).not.toContain('rawBody');
  });

  it('requires payment/claim permissions and audited reasons for admin evidence', () => {
    expect(controller).toContain("@Post('payment-operations/:id/evidence')");
    expect(controller).toContain("@RequirePermissions('claims.review', 'payments.read')");
    expect(service).toContain('PAYMENT_OPERATION_ADMIN_EVIDENCE_ADDED');
    expect(service).toContain("'PaymentOperation'");
  });

  it('schedules retrieval reconciliation instead of allowing mark-success mutation', () => {
    expect(controller).toContain("@Post('payment-operations/:id/reconcile')");
    expect(service).toContain('PAYMENT_OPERATION_RECONCILIATION_REQUIRED');
    expect(controller).not.toContain('mark-success');
  });

  it('persists webhook evidence first without directly invoking reconciliation money effects', () => {
    const webhookBlock = payments.slice(
      payments.indexOf('async receiveWebhook'),
      payments.indexOf('async ownerEarnings'),
    );
    expect(webhookBlock).toContain('paymentOperationEvidence.upsert');
    expect(webhookBlock).toContain('reconciliationRequired: true');
    expect(webhookBlock).not.toContain('this.reconcilePayment(');
  });
});
