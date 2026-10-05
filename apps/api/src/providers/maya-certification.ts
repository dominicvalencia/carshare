import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  reconcilePaymentOperationEvidence,
  type MayaPaymentProvider,
  type NormalizedOperationEvidence,
  type PaymentProvider,
  type ProviderOperationResult,
  type ProviderPaymentStatus,
  type VerifiedWebhookEvent,
} from '@carrental/payments';

export const MAYA_CERTIFICATION_SCENARIOS = [
  'authorization',
  'retrieval',
  'void',
  'capture',
  'request-reference',
  'timeout-replay',
  'webhook',
  'expiry',
  'reversal',
] as const;

export type MayaCertificationScenario = (typeof MAYA_CERTIFICATION_SCENARIOS)[number];
export type CertificationResult = 'PASSED' | 'FAILED' | 'INCONCLUSIVE' | 'BLOCKED';

export interface MayaCertificationSafetyInput {
  readonly amountMinor: bigint;
  readonly appEnvironment: string;
  readonly certificationEnabled: boolean;
  readonly executionConfirmed: boolean;
  readonly mayaEnvironment: string;
  readonly paymentProvider: string;
  readonly paymentsEnabled: boolean;
}

export interface MayaCertificationEvidence {
  readonly amountMinor: string;
  readonly capability: string;
  readonly completedAt: string;
  readonly currency: 'PHP';
  readonly environment: 'sandbox';
  readonly evidenceSummary: string;
  readonly expectedState: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly observedState: string;
  readonly provider: 'MAYA';
  readonly providerOperationId?: string;
  readonly providerPaymentId?: string;
  readonly requestReference: string;
  readonly result: CertificationResult;
  readonly runId: string;
  readonly scenario: MayaCertificationScenario;
  readonly scenarioVersion: 1;
  readonly startedAt: string;
  readonly webhookEvidence?: Readonly<{
    amountExact: boolean;
    operationIdentityExact: boolean;
    providerEventId?: string;
  }>;
}

export interface MayaCertificationReport {
  readonly capabilitiesChanged: false;
  readonly dryRun: boolean;
  readonly environment: 'sandbox';
  readonly evidence: readonly MayaCertificationEvidence[];
  readonly provider: 'MAYA';
  readonly runId: string;
  readonly scenarios: readonly MayaCertificationScenario[];
}

const maximumCertificationAmountMinor = 500_000n;
const minimumCertificationAmountMinor = 100n;
const sensitiveKey = /secret|authorization|credential|token|key|card|email/i;

export function assertMayaCertificationSafety(
  input: MayaCertificationSafetyInput,
  options: { readonly dryRun: boolean },
): void {
  if (!['local', 'test'].includes(input.appEnvironment))
    throw new Error('MAYA_CERTIFICATION_REQUIRES_LOCAL_OR_TEST');
  if (input.paymentProvider !== 'maya' || input.mayaEnvironment !== 'sandbox')
    throw new Error('Maya certification requires the Maya sandbox provider.');
  if (!input.certificationEnabled) throw new Error('MAYA_CERTIFICATION_ENABLED_REQUIRED');
  if (input.paymentsEnabled) throw new Error('APPLICATION_PAYMENTS_MUST_REMAIN_DISABLED');
  if (
    input.amountMinor < minimumCertificationAmountMinor ||
    input.amountMinor > maximumCertificationAmountMinor
  )
    throw new Error('MAYA_CERTIFICATION_AMOUNT_UNSAFE');
  if (!options.dryRun && !input.executionConfirmed)
    throw new Error('MAYA_CERTIFICATION_EXECUTION_CONFIRMATION_REQUIRED');
}

export function sanitizeCertificationMetadata(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number | boolean | null>> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey.test(key))
      .map(([key, item]) => [
        key,
        item === null || ['string', 'number', 'boolean'].includes(typeof item)
          ? typeof item === 'string'
            ? item.replace(/\b(?:pk|sk)-[A-Za-z0-9_-]+\b/g, '[REDACTED]').slice(0, 200)
            : (item as number | boolean | null)
          : '[OMITTED]',
      ]),
  );
}

export function classifyAuthorizationHold(
  status: ProviderPaymentStatus,
  expectedAmountMinor: bigint,
): Pick<MayaCertificationEvidence, 'evidenceSummary' | 'observedState' | 'result'> {
  if (status.state === 'CAPTURED' || ['PAYMENT_SUCCESS', 'CAPTURED'].includes(status.providerState))
    return {
      evidenceSummary: 'Provider settled funds instead of creating an authorization hold.',
      observedState: status.providerState,
      result: 'FAILED',
    };
  const captured = status.capturedAmountMinor ?? 0n;
  const passed =
    status.state === 'AUTHORIZED' &&
    status.authorizedAmountMinor === expectedAmountMinor &&
    captured === 0n;
  return {
    evidenceSummary: passed
      ? 'Authoritative retrieval proves the exact authorization with no captured amount.'
      : 'Authoritative retrieval does not prove the exact uncaptured authorization.',
    observedState: status.providerState,
    result: passed ? 'PASSED' : status.state === 'PENDING' ? 'INCONCLUSIVE' : 'FAILED',
  };
}

export function classifyCapture(
  status: ProviderPaymentStatus,
  expectedAmountMinor: bigint,
): Pick<MayaCertificationEvidence, 'evidenceSummary' | 'observedState' | 'result'> {
  const passed = status.state === 'CAPTURED' && status.capturedAmountMinor === expectedAmountMinor;
  return {
    evidenceSummary: passed
      ? 'Authoritative retrieval proves one exact full capture.'
      : 'Captured state and exact captured amount were not both proven.',
    observedState: status.providerState,
    result: passed ? 'PASSED' : 'FAILED',
  };
}

export function classifyVoid(
  status: ProviderPaymentStatus,
): Pick<MayaCertificationEvidence, 'evidenceSummary' | 'observedState' | 'result'> {
  const noCapture = (status.capturedAmountMinor ?? 0n) === 0n;
  const noRemainingAuthorization = (status.authorizedAmountMinor ?? 0n) === 0n;
  const passed = status.state === 'VOIDED' && noCapture && noRemainingAuthorization;
  return {
    evidenceSummary: passed
      ? 'Authoritative retrieval proves release with no capture or remaining authorization.'
      : 'Void truth is incomplete or an authorization/capture amount remains.',
    observedState: status.providerState,
    result: passed ? 'PASSED' : 'FAILED',
  };
}

export function classifyRequestReferenceRecovery(input: {
  readonly expectedPaymentId: string;
  readonly status: ProviderPaymentStatus;
}): Pick<MayaCertificationEvidence, 'evidenceSummary' | 'observedState' | 'result'> {
  const exact = input.status.externalPaymentId === input.expectedPaymentId;
  return {
    evidenceSummary: exact
      ? 'Request-reference lookup recovered the exact provider payment.'
      : 'Request-reference lookup did not recover the exact provider payment.',
    observedState: input.status.providerState,
    result: exact ? 'PASSED' : 'FAILED',
  };
}

export function classifyReplay(input: {
  readonly originalPaymentId?: string;
  readonly replayPaymentId?: string;
  readonly responseWasObserved: boolean;
}): Pick<MayaCertificationEvidence, 'evidenceSummary' | 'observedState' | 'result'> {
  if (!input.responseWasObserved || !input.originalPaymentId || !input.replayPaymentId)
    return {
      evidenceSummary: 'Safe same-key replay could not be proven without risking duplication.',
      observedState: 'UNPROVEN',
      result: 'INCONCLUSIVE',
    };
  const same = input.originalPaymentId === input.replayPaymentId;
  return {
    evidenceSummary: same
      ? 'Same-key replay resolved to the original provider payment.'
      : 'Same-key replay produced a different provider payment.',
    observedState: same ? 'SAME_PAYMENT' : 'DUPLICATE_PAYMENT',
    result: same ? 'PASSED' : 'FAILED',
  };
}

export function classifyWebhookEvidence(input: {
  readonly amountMinor?: bigint;
  readonly event: VerifiedWebhookEvent;
  readonly expectedAmountMinor: bigint;
  readonly expectedOperationId?: string;
}): Readonly<{
  amount: CertificationResult;
  identity: CertificationResult;
  normalized: MayaCertificationEvidence['webhookEvidence'];
}> {
  const operationId =
    typeof input.event.redactedPayload.operationId === 'string'
      ? input.event.redactedPayload.operationId
      : undefined;
  const identityExact = Boolean(
    input.expectedOperationId && operationId === input.expectedOperationId,
  );
  const amountExact = input.amountMinor === input.expectedAmountMinor;
  return {
    amount: amountExact ? 'PASSED' : 'INCONCLUSIVE',
    identity: identityExact ? 'PASSED' : 'INCONCLUSIVE',
    normalized: {
      amountExact,
      operationIdentityExact: identityExact,
      providerEventId: input.event.externalEventId,
    },
  };
}

export function certificationEvidenceForReconciliation(input: {
  readonly amountMinor?: bigint;
  readonly operationId?: string;
  readonly providerStatus: string;
  readonly requestReference?: string;
}): NormalizedOperationEvidence {
  return {
    ...(input.amountMinor === undefined ? {} : { amountMinor: input.amountMinor }),
    attribution: input.operationId || input.requestReference ? 'EXACT' : 'INSUFFICIENT',
    ...(input.operationId ? { providerOperationId: input.operationId } : {}),
    providerStatus: input.providerStatus,
    ...(input.requestReference ? { requestReference: input.requestReference } : {}),
  };
}

export function validateCertificationEvidenceWithReconciliation(input: {
  readonly amountMinor: bigint;
  readonly capabilities: PaymentProvider['capabilities']['evidence'];
  readonly evidence: NormalizedOperationEvidence;
  readonly operationId: string;
  readonly requestReference: string;
  readonly type: 'AUTHORIZE' | 'CAPTURE' | 'VOID';
}) {
  return reconcilePaymentOperationEvidence({
    capabilities: input.capabilities,
    evidence: [input.evidence],
    operation: {
      amountMinor: input.amountMinor,
      currency: 'PHP',
      externalOperationId: input.operationId,
      id: `certification-${input.operationId}`,
      providerRequestReference: input.requestReference,
      status: 'UNKNOWN',
      type: input.type,
    },
    siblingOperations: [],
  });
}

export interface MayaCertificationRunInput {
  readonly amountMinor: bigint;
  readonly artifactPath?: string;
  readonly dryRun: boolean;
  readonly existingPaymentId?: string;
  readonly existingRequestReference?: string;
  readonly now?: () => Date;
  readonly provider: PaymentProvider;
  readonly runId?: string;
  readonly scenarios: readonly MayaCertificationScenario[];
}

const scenarioCalls: Readonly<Record<MayaCertificationScenario, readonly string[]>> = {
  authorization: ['authorize(PREAUTHORIZATION)', 'retrievePayment'],
  retrieval: ['retrievePayment'],
  void: ['voidAuthorization', 'retrievePayment'],
  capture: ['capture', 'retrievePayment'],
  'request-reference': ['retrievePaymentByRequestReference'],
  'timeout-replay': ['no call unless a safe intercepted response fixture is supplied'],
  webhook: ['consume previously verified webhook evidence only'],
  expiry: ['retrievePayment; inspect expiry evidence when exposed'],
  reversal: ['retrievePayment; inspect reversal evidence when exposed'],
};

export function selectMayaCertificationScenarios(
  requested: readonly string[],
): readonly MayaCertificationScenario[] {
  const expanded = requested.includes('all') ? [...MAYA_CERTIFICATION_SCENARIOS] : requested;
  const invalid = expanded.filter(
    (scenario) => !MAYA_CERTIFICATION_SCENARIOS.includes(scenario as MayaCertificationScenario),
  );
  if (invalid.length) throw new Error(`UNKNOWN_MAYA_CERTIFICATION_SCENARIO:${invalid.join(',')}`);
  return [...new Set(expanded)] as MayaCertificationScenario[];
}

function expectedState(scenario: MayaCertificationScenario): string {
  if (scenario === 'authorization' || scenario === 'retrieval') return 'AUTHORIZED';
  if (scenario === 'void') return 'VOIDED_WITH_ZERO_REMAINING_AUTHORIZATION';
  if (scenario === 'capture') return 'CAPTURED_EXACT_AMOUNT';
  return 'EXACT_PROVIDER_EVIDENCE';
}

function buildEvidence(input: {
  readonly amountMinor: bigint;
  readonly capability: string;
  readonly classification: Pick<
    MayaCertificationEvidence,
    'evidenceSummary' | 'observedState' | 'result'
  >;
  readonly completedAt: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly paymentId?: string;
  readonly operationId?: string;
  readonly requestReference: string;
  readonly runId: string;
  readonly scenario: MayaCertificationScenario;
  readonly startedAt: string;
}): MayaCertificationEvidence {
  return {
    amountMinor: input.amountMinor.toString(),
    capability: input.capability,
    completedAt: input.completedAt,
    currency: 'PHP',
    environment: 'sandbox',
    evidenceSummary: input.classification.evidenceSummary,
    expectedState: expectedState(input.scenario),
    metadata: sanitizeCertificationMetadata(input.metadata ?? {}),
    observedState: input.classification.observedState,
    provider: 'MAYA',
    ...(input.operationId ? { providerOperationId: input.operationId } : {}),
    ...(input.paymentId ? { providerPaymentId: input.paymentId } : {}),
    requestReference: input.requestReference,
    result: input.classification.result,
    runId: input.runId,
    scenario: input.scenario,
    scenarioVersion: 1,
    startedAt: input.startedAt,
  };
}

export async function runMayaCertification(
  input: MayaCertificationRunInput,
): Promise<MayaCertificationReport> {
  if (!input.dryRun && input.scenarios.includes('capture') && input.scenarios.includes('void'))
    throw new Error('MAYA_CERTIFICATION_DISTINCT_CAPTURE_AND_VOID_FIXTURES_REQUIRED');
  const now = input.now ?? (() => new Date());
  const runId = input.runId ?? randomUUID();
  const rootReference = `carshare-cert-${runId}`.slice(0, 36);
  const evidence: MayaCertificationEvidence[] = [];
  let paymentId = input.existingPaymentId;
  let authorizationReference =
    input.existingRequestReference ?? `${rootReference}-auth`.slice(0, 36);

  for (const scenario of input.scenarios) {
    const startedAt = now().toISOString();
    const reference =
      scenario === 'authorization'
        ? authorizationReference
        : `${rootReference}-${scenario}`.slice(0, 36);
    if (input.dryRun) {
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability: scenario,
          classification: {
            evidenceSummary: `Dry run only. Would call: ${scenarioCalls[scenario].join(' -> ')}.`,
            observedState: 'NOT_EXECUTED',
            result: 'BLOCKED',
          },
          completedAt: now().toISOString(),
          requestReference: reference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    if (scenario === 'authorization') {
      const created = await input.provider.authorize({
        amountMinor: input.amountMinor,
        authorizationType: 'PREAUTHORIZATION',
        currency: 'PHP',
        description: 'CarShare Maya capability certification',
        idempotencyKey: `maya-cert:${runId}:authorization`,
        requestReference: reference,
      });
      paymentId = created.externalPaymentId;
      authorizationReference = reference;
      const classification = paymentId
        ? classifyAuthorizationHold(
            await input.provider.retrievePayment(paymentId),
            input.amountMinor,
          )
        : {
            evidenceSummary: 'Provider response did not include a payment identifier.',
            observedState: created.providerState ?? created.kind,
            result: 'FAILED' as const,
          };
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability: 'supportsAuthorizationRetrieval',
          classification,
          completedAt: now().toISOString(),
          metadata: { responseKind: created.kind },
          ...(created.externalOperationId ? { operationId: created.externalOperationId } : {}),
          ...(paymentId ? { paymentId } : {}),
          requestReference: reference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    if (scenario === 'timeout-replay' || scenario === 'webhook') {
      const classification =
        scenario === 'timeout-replay'
          ? classifyReplay({ responseWasObserved: false })
          : {
              evidenceSummary: 'No verified webhook fixture was supplied for exact attribution.',
              observedState: 'UNPROVEN',
              result: 'INCONCLUSIVE' as const,
            };
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability:
            scenario === 'timeout-replay'
              ? 'supportsIdempotentReplayAfterTimeout'
              : 'supportsWebhookOperationIdentityAndAmount',
          classification,
          completedAt: now().toISOString(),
          requestReference: reference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    if (!paymentId) {
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability: scenario,
          classification: {
            evidenceSummary: 'An isolated certification payment ID is required for this scenario.',
            observedState: 'MISSING_FIXTURE',
            result: 'BLOCKED',
          },
          completedAt: now().toISOString(),
          requestReference: reference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    if (scenario === 'request-reference') {
      const status = await input.provider.retrievePaymentByRequestReference(authorizationReference);
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability: 'supportsRequestReferenceRetrieval',
          classification: classifyRequestReferenceRecovery({
            expectedPaymentId: paymentId,
            status,
          }),
          completedAt: now().toISOString(),
          paymentId,
          requestReference: authorizationReference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    if (scenario === 'capture' || scenario === 'void') {
      const operation = await input.provider[
        scenario === 'capture' ? 'capture' : 'voidAuthorization'
      ]({
        amountMinor: input.amountMinor,
        currency: 'PHP',
        externalPaymentId: paymentId,
        idempotencyKey: `maya-cert:${runId}:${scenario}`,
        requestReference: reference,
      });
      const status = await input.provider.retrievePayment(paymentId);
      const classification =
        scenario === 'capture' ? classifyCapture(status, input.amountMinor) : classifyVoid(status);
      const normalized = certificationEvidenceForReconciliation({
        ...(scenario === 'capture' && status.capturedAmountMinor !== undefined
          ? { amountMinor: status.capturedAmountMinor }
          : {}),
        ...(operation.externalOperationId ? { operationId: operation.externalOperationId } : {}),
        providerStatus: status.providerState,
        ...(operation.externalOperationId ? {} : { requestReference: reference }),
      });
      const reconciliation = validateCertificationEvidenceWithReconciliation({
        amountMinor: input.amountMinor,
        capabilities: input.provider.capabilities.evidence,
        evidence: normalized,
        operationId: operation.externalOperationId ?? `request:${reference}`,
        requestReference: reference,
        type: scenario === 'capture' ? 'CAPTURE' : 'VOID',
      });
      evidence.push(
        buildEvidence({
          amountMinor: input.amountMinor,
          capability: scenario === 'capture' ? 'supportsFullCapture' : 'supportsFullVoid',
          classification:
            classification.result === 'PASSED' && reconciliation.state !== 'SUCCEEDED'
              ? {
                  evidenceSummary: `Provider state passed, but reconciliation remained ${reconciliation.state}.`,
                  observedState: status.providerState,
                  result: 'INCONCLUSIVE',
                }
              : classification,
          completedAt: now().toISOString(),
          metadata: { reconciliationState: reconciliation.state },
          ...(operation.externalOperationId ? { operationId: operation.externalOperationId } : {}),
          paymentId,
          requestReference: reference,
          runId,
          scenario,
          startedAt,
        }),
      );
      continue;
    }

    const status = await input.provider.retrievePayment(paymentId);
    const isRetrieval = scenario === 'retrieval';
    evidence.push(
      buildEvidence({
        amountMinor: input.amountMinor,
        capability: isRetrieval ? 'supportsAuthorizationRetrieval' : scenario,
        classification: isRetrieval
          ? classifyAuthorizationHold(status, input.amountMinor)
          : {
              evidenceSummary: `Maya retrieval exposes no proven ${scenario} metadata or event.`,
              observedState: status.providerState,
              result: 'INCONCLUSIVE',
            },
        completedAt: now().toISOString(),
        paymentId,
        requestReference: reference,
        runId,
        scenario,
        startedAt,
      }),
    );
  }

  const report: MayaCertificationReport = {
    capabilitiesChanged: false,
    dryRun: input.dryRun,
    environment: 'sandbox',
    evidence,
    provider: 'MAYA',
    runId,
    scenarios: input.scenarios,
  };
  if (input.artifactPath) {
    await mkdir(dirname(input.artifactPath), { recursive: true, mode: 0o700 });
    await writeFile(input.artifactPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

export class MayaCertificationError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'MayaCertificationError';
  }
}

const allowedReturnUrls = [
  'http://localhost:8081/payment/success',
  'http://localhost:8081/payment/failure',
  'http://localhost:8081/payment/cancel',
] as const;

const allowedSandboxCheckoutOrigins = new Set([
  'https://payments-web-sandbox.maya.ph',
  'https://payments-web-sandbox.paymaya.com',
]);

export function isAllowedMayaSandboxCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      allowedSandboxCheckoutOrigins.has(url.origin)
    );
  } catch {
    return false;
  }
}

export function assertMayaCertificationReturnUrls(urls: readonly string[]): void {
  if (
    urls.length !== allowedReturnUrls.length ||
    urls.some((url, index) => url !== allowedReturnUrls[index])
  ) {
    throw new Error('MAYA_CERTIFICATION_RETURN_URL_NOT_ALLOWED');
  }
}

export async function certifyMayaCheckoutOnce(input: {
  readonly provider: Pick<MayaPaymentProvider, 'createCheckout'>;
  readonly markerPath: string;
}): Promise<ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' }> {
  await mkdir(dirname(input.markerPath), { recursive: true });
  let marker;
  try {
    marker = await open(input.markerPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('MAYA_CERTIFICATION_ALREADY_COMPLETED');
    throw error;
  }

  let accepted = false;
  try {
    const result = await input.provider.createCheckout({
      amountMinor: 10_000n,
      currency: 'PHP',
      description: 'CarShare Maya sandbox certification',
      idempotencyKey: createHash('sha256')
        .update('maya-local-checkout-certification')
        .digest('hex'),
      requestReference: 'carshare-local-maya-certification',
    });
    let returnedOrigin: string | undefined;
    try {
      returnedOrigin = result.customerActionUrl
        ? new URL(result.customerActionUrl).origin
        : undefined;
    } catch {
      returnedOrigin = undefined;
    }
    if (
      result.kind !== 'ACTION_REQUIRED' ||
      !result.externalPaymentId ||
      !result.customerActionUrl ||
      !isAllowedMayaSandboxCheckoutUrl(result.customerActionUrl)
    ) {
      throw new MayaCertificationError('MAYA_CERTIFICATION_CHECKOUT_NOT_ACCEPTED', {
        reason:
          result.kind !== 'ACTION_REQUIRED'
            ? 'Provider did not return an actionable Checkout.'
            : !result.externalPaymentId
              ? 'Provider did not return a checkout identifier.'
              : 'Provider returned an unexpected hosted Checkout origin.',
        requestReference: 'carshare-local-maya-certification',
        ...(returnedOrigin ? { returnedOrigin } : {}),
      });
    }
    accepted = true;
    await marker.writeFile(
      JSON.stringify({ provider: 'MAYA', status: result.providerState, completed: true }),
    );
    return result as ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' };
  } finally {
    await marker.close().catch(() => undefined);
    if (!accepted) await unlink(input.markerPath).catch(() => undefined);
  }
}
