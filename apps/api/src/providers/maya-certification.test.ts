import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertMayaCertificationReturnUrls,
  assertMayaCertificationSafety,
  certificationEvidenceForReconciliation,
  certifyMayaCheckoutOnce,
  classifyAuthorizationHold,
  classifyCapture,
  classifyReplay,
  classifyRequestReferenceRecovery,
  classifyVoid,
  classifyWebhookEvidence,
  isAllowedMayaSandboxCheckoutUrl,
  runMayaCertification,
  sanitizeCertificationMetadata,
  selectMayaCertificationScenarios,
  validateCertificationEvidenceWithReconciliation,
} from './maya-certification';
import type { PaymentProvider, ProviderPaymentStatus } from '@carrental/payments';

describe('Maya local certification', () => {
  it('creates exactly one fixed PHP 100 checkout and persists a secret-free marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'maya-certification-'));
    const markerPath = join(directory, 'maya.sent');
    const createCheckout = vi.fn().mockResolvedValue({
      customerActionUrl: 'https://payments-web-sandbox.maya.ph/checkout-1?token=synthetic',
      externalPaymentId: 'checkout-1',
      kind: 'ACTION_REQUIRED',
      providerState: 'CHECKOUT_CREATED',
    });
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 10_000n, currency: 'PHP' }),
    );
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).rejects.toThrow('MAYA_CERTIFICATION_ALREADY_COMPLETED');
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(await readFile(markerPath, 'utf8')).not.toContain('checkout-1');
  });

  it.each([
    [{ kind: 'UNKNOWN' }, 'not accepted'],
    [
      {
        customerActionUrl: 'https://payments.maya.ph/production',
        externalPaymentId: 'checkout-1',
        kind: 'ACTION_REQUIRED',
      },
      'production checkout URL',
    ],
  ])('fails closed for %s and permits a safe retry', async (result) => {
    const directory = await mkdtemp(join(tmpdir(), 'maya-certification-'));
    const markerPath = join(directory, 'maya.sent');
    const createCheckout = vi.fn().mockResolvedValue(result);
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).rejects.toThrow('MAYA_CERTIFICATION_CHECKOUT_NOT_ACCEPTED');
    createCheckout.mockResolvedValue({
      customerActionUrl: 'https://payments-web-sandbox.paymaya.com/checkout-2',
      externalPaymentId: 'checkout-2',
      kind: 'ACTION_REQUIRED',
    });
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
  });

  it('allows only the fixed local certification return URLs', () => {
    expect(() =>
      assertMayaCertificationReturnUrls([
        'http://localhost:8081/payment/success',
        'http://localhost:8081/payment/failure',
        'http://localhost:8081/payment/cancel',
      ]),
    ).not.toThrow();
    expect(() =>
      assertMayaCertificationReturnUrls([
        'https://attacker.example/success',
        'http://localhost:8081/payment/failure',
        'http://localhost:8081/payment/cancel',
      ]),
    ).toThrow('MAYA_CERTIFICATION_RETURN_URL_NOT_ALLOWED');
  });

  it.each([
    'https://payments-web-sandbox.maya.ph/checkout?id=synthetic',
    'https://payments-web-sandbox.paymaya.com/checkout?id=synthetic',
  ])('accepts the exact official sandbox Checkout origin: %s', (url) => {
    expect(isAllowedMayaSandboxCheckoutUrl(url)).toBe(true);
  });

  it.each([
    'https://payments.maya.ph/production',
    'http://payments-web-sandbox.maya.ph/checkout',
    'https://evil.maya.ph/checkout',
    'https://payments-web-sandbox.maya.ph.attacker.example/checkout',
    'https://payments-web-sandbox.paymaya.com.attacker.example/checkout',
    'https://attacker.example/?next=https://payments-web-sandbox.maya.ph',
    'https://user:password@payments-web-sandbox.maya.ph/checkout',
  ])('rejects non-allowlisted, insecure, lookalike, or credentialed URL: %s', (url) => {
    expect(isAllowedMayaSandboxCheckoutUrl(url)).toBe(false);
  });

  it('allows ordinary path/query data only after exact origin validation', () => {
    expect(
      isAllowedMayaSandboxCheckoutUrl(
        'https://payments-web-sandbox.maya.ph/checkout?checkoutId=synthetic#continue',
      ),
    ).toBe(true);
  });
});

const authorized = (overrides: Partial<ProviderPaymentStatus> = {}): ProviderPaymentStatus => ({
  authorizedAmountMinor: 300_000n,
  capturedAmountMinor: 0n,
  currency: 'PHP',
  externalPaymentId: 'payment-1',
  providerState: 'AUTHORIZED',
  state: 'AUTHORIZED',
  ...overrides,
});

const capabilities: PaymentProvider['capabilities'] = {
  authorizationHoldDurationSeconds: null,
  evidence: {
    supportsAuthorizationExpiryLookup: 'UNPROVEN',
    supportsAuthorizationRetrieval: 'SUPPORTED',
    supportsFullCapture: 'SUPPORTED',
    supportsFullVoid: 'SUPPORTED',
    supportsIdempotentReplayAfterTimeout: 'UNPROVEN',
    supportsMultipleCaptures: 'UNSUPPORTED',
    supportsOperationSpecificRetrieval: 'UNPROVEN',
    supportsPartialCapture: 'UNSUPPORTED',
    supportsPartialRefund: 'UNPROVEN',
    supportsPartialVoid: 'UNSUPPORTED',
    supportsRefund: 'UNPROVEN',
    supportsRequestReferenceRetrieval: 'SUPPORTED',
    supportsSecurityDepositUtilization: 'UNSUPPORTED',
    supportsWebhookOperationAmount: 'UNPROVEN',
    supportsWebhookOperationIdentity: 'UNPROVEN',
  },
  supportsAuthorization: true,
  supportsAuthorizationVoid: true,
  supportsAdditionalPaymentAuthorization: false,
  supportsOffSessionAdditionalCharge: false,
  supportsPartialCapture: false,
  supportsPartialRefund: false,
  supportsRefund: false,
  supportsSecurityDeposit: true,
  supportsSecurityDepositUtilization: false,
  supportsWebhooks: true,
};

function provider(): PaymentProvider {
  return {
    authorize: vi.fn().mockResolvedValue({
      externalPaymentId: 'payment-1',
      kind: 'ACTION_REQUIRED',
      providerState: 'PENDING',
    }),
    capabilities,
    capture: vi.fn(),
    code: 'MAYA',
    refund: vi.fn(),
    retrievePayment: vi.fn().mockResolvedValue(authorized()),
    retrievePaymentByRequestReference: vi.fn().mockResolvedValue(authorized()),
    verifyWebhook: vi.fn(),
    voidAuthorization: vi.fn(),
  };
}

describe('Maya settlement capability certification', () => {
  const safe = {
    amountMinor: 300_000n,
    appEnvironment: 'local',
    certificationEnabled: true,
    executionConfirmed: true,
    mayaEnvironment: 'sandbox',
    paymentProvider: 'maya',
    paymentsEnabled: false,
  } as const;

  it.each([
    [{ ...safe, appEnvironment: 'production' }, 'MAYA_CERTIFICATION_REQUIRES_LOCAL_OR_TEST'],
    [
      { ...safe, paymentProvider: 'fake' },
      'Maya certification requires the Maya sandbox provider.',
    ],
    [{ ...safe, certificationEnabled: false }, 'MAYA_CERTIFICATION_ENABLED_REQUIRED'],
    [{ ...safe, amountMinor: 10_000_000n }, 'MAYA_CERTIFICATION_AMOUNT_UNSAFE'],
    [{ ...safe, executionConfirmed: false }, 'MAYA_CERTIFICATION_EXECUTION_CONFIRMATION_REQUIRED'],
  ])('rejects unsafe certification configuration', (input, message) => {
    expect(() => assertMayaCertificationSafety(input, { dryRun: false })).toThrow(message);
  });

  it('permits a guarded dry run without execution confirmation', () => {
    expect(() =>
      assertMayaCertificationSafety({ ...safe, executionConfirmed: false }, { dryRun: true }),
    ).not.toThrow();
  });

  it('requires an exact uncaptured authorization and rejects a sale', () => {
    expect(classifyAuthorizationHold(authorized(), 300_000n).result).toBe('PASSED');
    expect(
      classifyAuthorizationHold(
        authorized({
          capturedAmountMinor: 300_000n,
          providerState: 'PAYMENT_SUCCESS',
          state: 'CAPTURED',
        }),
        300_000n,
      ).result,
    ).toBe('FAILED');
  });

  it('fails capture amount mismatch and void with remaining authorization', () => {
    expect(
      classifyCapture(
        authorized({ capturedAmountMinor: 200_000n, providerState: 'CAPTURED', state: 'CAPTURED' }),
        300_000n,
      ).result,
    ).toBe('FAILED');
    expect(classifyVoid(authorized({ providerState: 'VOIDED', state: 'VOIDED' })).result).toBe(
      'FAILED',
    );
    expect(
      classifyVoid(
        authorized({ authorizedAmountMinor: 0n, providerState: 'VOIDED', state: 'VOIDED' }),
      ).result,
    ).toBe('PASSED');
  });

  it('classifies request-reference recovery only when the exact payment is recovered', () => {
    expect(
      classifyRequestReferenceRecovery({ expectedPaymentId: 'payment-1', status: authorized() })
        .result,
    ).toBe('PASSED');
    expect(
      classifyRequestReferenceRecovery({
        expectedPaymentId: 'payment-2',
        status: authorized(),
      }).result,
    ).toBe('FAILED');
  });

  it('keeps unobserved timeout replay inconclusive and detects duplicate IDs', () => {
    expect(classifyReplay({ responseWasObserved: false }).result).toBe('INCONCLUSIVE');
    expect(
      classifyReplay({
        originalPaymentId: 'payment-1',
        replayPaymentId: 'payment-2',
        responseWasObserved: true,
      }).result,
    ).toBe('FAILED');
  });

  it('evaluates webhook identity and amount independently', () => {
    const event = {
      eventType: 'CAPTURED',
      externalEventId: 'event-1',
      providerPaymentId: 'payment-1',
      redactedPayload: { operationId: 'operation-1' },
    };
    expect(
      classifyWebhookEvidence({
        amountMinor: 300_000n,
        event,
        expectedAmountMinor: 300_000n,
        expectedOperationId: 'operation-1',
      }),
    ).toMatchObject({ amount: 'PASSED', identity: 'PASSED' });
    expect(classifyWebhookEvidence({ event, expectedAmountMinor: 300_000n })).toMatchObject({
      amount: 'INCONCLUSIVE',
      identity: 'INCONCLUSIVE',
    });
  });

  it('sanitizes secrets and bounded diagnostics from artifacts', () => {
    const result = sanitizeCertificationMetadata({
      apiSecret: 'sk-do-not-print',
      nested: { card: '4111111111111111' },
      note: 'provider said sk-sensitive',
    });
    expect(result).toEqual({ nested: '[OMITTED]', note: 'provider said [REDACTED]' });
    expect(JSON.stringify(result)).not.toContain('do-not-print');
  });

  it('feeds exact certification evidence through the existing reconciliation engine', () => {
    const evidence = certificationEvidenceForReconciliation({
      amountMinor: 300_000n,
      operationId: 'operation-1',
      providerStatus: 'CAPTURED',
    });
    expect(
      validateCertificationEvidenceWithReconciliation({
        amountMinor: 300_000n,
        capabilities: capabilities.evidence,
        evidence,
        operationId: 'operation-1',
        requestReference: 'request-1',
        type: 'CAPTURE',
      }).state,
    ).toBe('SUCCEEDED');
  });

  it('dry-run selects scenarios, makes no provider calls, and never promotes capabilities', async () => {
    const maya = provider();
    const report = await runMayaCertification({
      amountMinor: 300_000n,
      dryRun: true,
      provider: maya,
      runId: 'run-1',
      scenarios: selectMayaCertificationScenarios(['authorization', 'void']),
    });
    expect(report.scenarios).toEqual(['authorization', 'void']);
    expect(report.capabilitiesChanged).toBe(false);
    expect(report.evidence.every((item) => item.result === 'BLOCKED')).toBe(true);
    expect(maya.authorize).not.toHaveBeenCalled();
    expect(maya.voidAuthorization).not.toHaveBeenCalled();
  });

  it('refuses capture and void against one live certification fixture', async () => {
    await expect(
      runMayaCertification({
        amountMinor: 300_000n,
        dryRun: false,
        existingPaymentId: 'payment-1',
        provider: provider(),
        runId: 'run-conflict',
        scenarios: ['capture', 'void'],
      }),
    ).rejects.toThrow('MAYA_CERTIFICATION_DISTINCT_CAPTURE_AND_VOID_FIXTURES_REQUIRED');
  });

  it('uses unique run correlation and request references without domain side effects', async () => {
    const maya = provider();
    const first = await runMayaCertification({
      amountMinor: 300_000n,
      dryRun: true,
      provider: maya,
      runId: 'run-one',
      scenarios: ['authorization'],
    });
    const second = await runMayaCertification({
      amountMinor: 300_000n,
      dryRun: true,
      provider: maya,
      runId: 'run-two',
      scenarios: ['authorization'],
    });
    expect(first.evidence[0]?.requestReference).not.toBe(second.evidence[0]?.requestReference);
    expect(Object.keys(maya)).not.toContain('booking');
  });

  it('marks expiry and reversal unproven when provider metadata is absent', async () => {
    const report = await runMayaCertification({
      amountMinor: 300_000n,
      dryRun: false,
      existingPaymentId: 'payment-1',
      provider: provider(),
      runId: 'run-expiry',
      scenarios: ['expiry', 'reversal'],
    });
    expect(report.evidence.map((item) => item.result)).toEqual(['INCONCLUSIVE', 'INCONCLUSIVE']);
  });
});
