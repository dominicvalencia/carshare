import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./payment-operation-evidence-reconciliation.ts', import.meta.url),
  'utf8',
);
const legacyWorker = readFileSync(new URL('./payment-reconciliation.ts', import.meta.url), 'utf8');

describe('payment operation evidence worker boundaries', () => {
  it('retrieves provider truth but never invokes a money-moving method', () => {
    expect(source).toContain('provider.retrievePayment(');
    expect(source).toContain('provider.retrievePaymentByRequestReference(');
    expect(source).not.toMatch(/provider\.(capture|voidAuthorization|refund)\(/);
  });

  it('uses atomic claims, stable evidence keys, and bounded webhook remapping', () => {
    expect(source).toContain('updateMany');
    expect(source).toContain('evidenceKey');
    expect(source).toContain('WEBHOOK_REMAP_MAX_ATTEMPTS');
    expect(source).toContain('permanentlyUnmappableAt');
  });

  it('does not pass settlement-operation webhooks through legacy direct finalization', () => {
    expect(legacyWorker).toContain(
      'payment.operations.some((operation) => operation.securityDepositSettlementLeg)',
    );
    expect(source).toContain('Webhook proves aggregate payment evidence');
  });

  it('keeps insufficient truth unknown and escalates without ledger or earnings writes', () => {
    expect(source).toContain('PaymentOperationStatus.UNKNOWN');
    expect(source).toContain('PAYMENT_OPERATION_MANUAL_REVIEW_REQUIRED');
    expect(source).not.toContain('ledgerEntry');
    expect(source).not.toContain('ownerEarning');
  });
});
