import type { PaymentProviderEvidenceCapabilities } from './payment-provider';

export type EvidenceAttribution =
  'EXACT' | 'UNAMBIGUOUS_AGGREGATE' | 'AMBIGUOUS' | 'CONFLICTING' | 'INSUFFICIENT';

export type ReconciledOperationState = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'MANUAL_REVIEW';

export interface ReconciliationOperation {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly externalOperationId?: string | null;
  readonly id: string;
  readonly providerRequestReference: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  readonly type: 'AUTHORIZE' | 'CAPTURE' | 'VOID' | 'REFUND' | 'RETRIEVE';
}

export interface NormalizedOperationEvidence {
  readonly amountMinor?: bigint | null;
  readonly attribution: EvidenceAttribution;
  readonly currency?: string | null;
  readonly providerOperationId?: string | null;
  readonly providerStatus: string;
  readonly requestReference?: string | null;
}

export interface ReconciliationDecision {
  readonly attribution: EvidenceAttribution;
  readonly reason: string;
  readonly state: ReconciledOperationState;
}

const successfulStatuses: Readonly<Record<ReconciliationOperation['type'], ReadonlySet<string>>> = {
  AUTHORIZE: new Set(['AUTHORIZED']),
  CAPTURE: new Set(['CAPTURED', 'PAYMENT_SUCCESS']),
  VOID: new Set(['VOIDED']),
  REFUND: new Set(['REFUNDED']),
  RETRIEVE: new Set(),
};
const failedStatuses = new Set(['DECLINED', 'FAILED', 'CANCELLED', 'EXPIRED']);

function evidenceIsExact(
  operation: ReconciliationOperation,
  evidence: NormalizedOperationEvidence,
): boolean {
  return (
    evidence.attribution === 'EXACT' &&
    ((Boolean(operation.externalOperationId) &&
      evidence.providerOperationId === operation.externalOperationId) ||
      evidence.requestReference === operation.providerRequestReference)
  );
}

function amountAndCurrencyMatch(
  operation: ReconciliationOperation,
  evidence: NormalizedOperationEvidence,
): boolean {
  return (
    (evidence.amountMinor === null ||
      evidence.amountMinor === undefined ||
      evidence.amountMinor === operation.amountMinor) &&
    (evidence.currency === null ||
      evidence.currency === undefined ||
      evidence.currency === operation.currency)
  );
}

export function reconcilePaymentOperationEvidence(input: {
  readonly capabilities: PaymentProviderEvidenceCapabilities;
  readonly evidence: readonly NormalizedOperationEvidence[];
  readonly operation: ReconciliationOperation;
  readonly siblingOperations: readonly ReconciliationOperation[];
}): ReconciliationDecision {
  const { capabilities, evidence, operation, siblingOperations } = input;
  const exact = evidence.filter((item) => evidenceIsExact(operation, item));
  const exactSuccess = exact.some(
    (item) =>
      successfulStatuses[operation.type].has(item.providerStatus.toUpperCase()) &&
      amountAndCurrencyMatch(operation, item),
  );
  const exactFailure = exact.some((item) => failedStatuses.has(item.providerStatus.toUpperCase()));
  if (exactSuccess && exactFailure)
    return {
      attribution: 'CONFLICTING',
      reason: 'Exact evidence contains contradictory terminal provider states.',
      state: 'MANUAL_REVIEW',
    };
  if (exactSuccess)
    return {
      attribution: 'EXACT',
      reason: 'Operation-specific evidence proves success.',
      state: 'SUCCEEDED',
    };
  if (exactFailure)
    return {
      attribution: 'EXACT',
      reason: 'Operation-specific evidence proves failure.',
      state: 'FAILED',
    };

  const aggregate = evidence.filter((item) => item.attribution !== 'EXACT');
  const matchingAggregate = aggregate.find(
    (item) =>
      successfulStatuses[operation.type].has(item.providerStatus.toUpperCase()) &&
      amountAndCurrencyMatch(operation, item),
  );
  if (!matchingAggregate)
    return {
      attribution: evidence.some((item) => item.attribution === 'CONFLICTING')
        ? 'CONFLICTING'
        : 'INSUFFICIENT',
      reason: 'No evidence safely proves a terminal result for this operation.',
      state: evidence.some((item) => item.attribution === 'CONFLICTING')
        ? 'MANUAL_REVIEW'
        : 'UNKNOWN',
    };

  const competing = siblingOperations.filter(
    (candidate) =>
      candidate.id !== operation.id &&
      candidate.type === operation.type &&
      ['PROCESSING', 'UNKNOWN', 'SUCCEEDED'].includes(candidate.status),
  );
  if (competing.length > 0)
    return {
      attribution: 'AMBIGUOUS',
      reason: `Aggregate ${operation.type} evidence cannot distinguish competing operations.`,
      state: 'UNKNOWN',
    };

  if (operation.type === 'REFUND')
    return {
      attribution: 'AMBIGUOUS',
      reason: 'Cumulative refund evidence cannot prove an individual refund operation.',
      state: 'UNKNOWN',
    };
  if (operation.type === 'CAPTURE') {
    if (
      capabilities.supportsFullCapture !== 'SUPPORTED' ||
      capabilities.supportsMultipleCaptures !== 'UNSUPPORTED' ||
      operation.amountMinor !== matchingAggregate.amountMinor
    )
      return {
        attribution: 'AMBIGUOUS',
        reason: 'Aggregate capture evidence does not prove the expected full capture.',
        state: 'UNKNOWN',
      };
  } else if (operation.type === 'VOID') {
    if (capabilities.supportsFullVoid !== 'SUPPORTED')
      return {
        attribution: 'INSUFFICIENT',
        reason: 'Provider capability does not prove full authorization void semantics.',
        state: 'UNKNOWN',
      };
  } else {
    return {
      attribution: 'INSUFFICIENT',
      reason: `Aggregate evidence is not sufficient for ${operation.type}.`,
      state: 'UNKNOWN',
    };
  }

  return {
    attribution: 'UNAMBIGUOUS_AGGREGATE',
    reason: `A single compatible full ${operation.type.toLowerCase()} operation explains aggregate provider truth.`,
    state: 'SUCCEEDED',
  };
}
