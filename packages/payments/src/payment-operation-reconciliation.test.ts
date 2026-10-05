import { describe, expect, it } from 'vitest';
import type { PaymentProviderEvidenceCapabilities } from './payment-provider';
import {
  reconcilePaymentOperationEvidence,
  type ReconciliationOperation,
} from './payment-operation-reconciliation';

const capabilities: PaymentProviderEvidenceCapabilities = {
  supportsAuthorizationExpiryLookup: 'UNPROVEN',
  supportsAuthorizationRetrieval: 'SUPPORTED',
  supportsFullCapture: 'SUPPORTED',
  supportsFullVoid: 'SUPPORTED',
  supportsIdempotentReplayAfterTimeout: 'UNPROVEN',
  supportsMultipleCaptures: 'UNSUPPORTED',
  supportsOperationSpecificRetrieval: 'UNPROVEN',
  supportsPartialCapture: 'UNSUPPORTED',
  supportsPartialRefund: 'SUPPORTED',
  supportsPartialVoid: 'UNSUPPORTED',
  supportsRefund: 'SUPPORTED',
  supportsRequestReferenceRetrieval: 'SUPPORTED',
  supportsSecurityDepositUtilization: 'UNSUPPORTED',
  supportsWebhookOperationAmount: 'UNPROVEN',
  supportsWebhookOperationIdentity: 'UNPROVEN',
};

const operation = (overrides: Partial<ReconciliationOperation> = {}): ReconciliationOperation => ({
  amountMinor: 300_000n,
  currency: 'PHP',
  id: 'operation-1',
  providerRequestReference: 'request-1',
  status: 'UNKNOWN',
  type: 'VOID',
  ...overrides,
});

describe('payment operation evidence reconciliation', () => {
  it('accepts exact synchronous or retrieval evidence', () => {
    const result = reconcilePaymentOperationEvidence({
      capabilities,
      evidence: [{ attribution: 'EXACT', providerStatus: 'VOIDED', requestReference: 'request-1' }],
      operation: operation(),
      siblingOperations: [],
    });
    expect(result).toMatchObject({ attribution: 'EXACT', state: 'SUCCEEDED' });
  });

  it('safely attributes one compatible full void from aggregate truth', () => {
    const result = reconcilePaymentOperationEvidence({
      capabilities,
      evidence: [{ attribution: 'AMBIGUOUS', providerStatus: 'VOIDED' }],
      operation: operation(),
      siblingOperations: [],
    });
    expect(result).toMatchObject({ attribution: 'UNAMBIGUOUS_AGGREGATE', state: 'SUCCEEDED' });
  });

  it('keeps competing void operations ambiguous', () => {
    const current = operation();
    const result = reconcilePaymentOperationEvidence({
      capabilities,
      evidence: [{ attribution: 'AMBIGUOUS', providerStatus: 'VOIDED' }],
      operation: current,
      siblingOperations: [current, operation({ id: 'operation-2' })],
    });
    expect(result).toMatchObject({ attribution: 'AMBIGUOUS', state: 'UNKNOWN' });
  });

  it('requires an amount-matched full capture with no multiple capture capability', () => {
    const capture = operation({ type: 'CAPTURE' });
    expect(
      reconcilePaymentOperationEvidence({
        capabilities,
        evidence: [{ amountMinor: 300_000n, attribution: 'AMBIGUOUS', providerStatus: 'CAPTURED' }],
        operation: capture,
        siblingOperations: [],
      }),
    ).toMatchObject({ attribution: 'UNAMBIGUOUS_AGGREGATE', state: 'SUCCEEDED' });
    expect(
      reconcilePaymentOperationEvidence({
        capabilities,
        evidence: [{ amountMinor: 100_000n, attribution: 'AMBIGUOUS', providerStatus: 'CAPTURED' }],
        operation: capture,
        siblingOperations: [],
      }).state,
    ).toBe('UNKNOWN');
  });

  it('never attributes cumulative aggregate refunds to an individual refund', () => {
    const result = reconcilePaymentOperationEvidence({
      capabilities,
      evidence: [{ amountMinor: 300_000n, attribution: 'AMBIGUOUS', providerStatus: 'REFUNDED' }],
      operation: operation({ type: 'REFUND' }),
      siblingOperations: [],
    });
    expect(result).toMatchObject({ attribution: 'AMBIGUOUS', state: 'UNKNOWN' });
  });

  it('escalates contradictory exact terminal evidence', () => {
    const result = reconcilePaymentOperationEvidence({
      capabilities,
      evidence: [
        { attribution: 'EXACT', providerStatus: 'VOIDED', requestReference: 'request-1' },
        { attribution: 'EXACT', providerStatus: 'FAILED', requestReference: 'request-1' },
      ],
      operation: operation(),
      siblingOperations: [],
    });
    expect(result).toMatchObject({ attribution: 'CONFLICTING', state: 'MANUAL_REVIEW' });
  });
});
