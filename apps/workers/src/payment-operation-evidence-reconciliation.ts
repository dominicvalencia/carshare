import { createHash } from 'node:crypto';
import type { WorkerEnvironment } from '@carrental/config';
import {
  PaymentEvidenceAttribution,
  PaymentOperationEvidenceSource,
  PaymentOperationStatus,
  SecurityDepositSettlementLegRole,
  SecurityDepositSettlementStatus,
  type PrismaClient,
} from '@carrental/database';
import type { Prisma } from '@carrental/database';
import {
  reconcilePaymentOperationEvidence,
  type PaymentProvider,
  type ProviderPaymentStatus,
} from '@carrental/payments';

const RETRY_DELAY_MS = 30_000;
const WEBHOOK_REMAP_MAX_ATTEMPTS = 8;

function evidenceKey(parts: readonly (string | bigint | null | undefined)[]): string {
  return createHash('sha256')
    .update(parts.map((part) => String(part ?? '')).join('|'))
    .digest('hex');
}

function aggregateAmount(operationType: string, truth: ProviderPaymentStatus): bigint | undefined {
  if (operationType === 'AUTHORIZE') return truth.authorizedAmountMinor;
  if (operationType === 'CAPTURE') return truth.capturedAmountMinor;
  if (operationType === 'REFUND') return truth.refundedAmountMinor;
  return undefined;
}

export async function reconcilePaymentOperationEvidenceSweep(
  database: PrismaClient,
  provider: PaymentProvider,
  environment: WorkerEnvironment,
): Promise<{ manualReview: number; reconciled: number; remapped: number }> {
  const remapped = await remapPaymentWebhookEvidence(database);
  const operations = await database.paymentOperation.findMany({
    include: {
      payment: { include: { operationEvidence: true, operations: true } },
      securityDepositSettlementLeg: { include: { settlement: true } },
    },
    take: 50,
    where: {
      securityDepositSettlementLeg: { isNot: null },
      status: { in: [PaymentOperationStatus.PROCESSING, PaymentOperationStatus.UNKNOWN] },
      OR: [{ nextReconcileAt: null }, { nextReconcileAt: { lte: new Date() } }],
    },
  });
  let reconciled = 0;
  let manualReview = 0;
  for (const operation of operations) {
    const claimed = await database.paymentOperation.updateMany({
      data: {
        nextReconcileAt: new Date(Date.now() + RETRY_DELAY_MS),
        reconciliationAttemptCount: { increment: 1 },
      },
      where: {
        id: operation.id,
        status: { in: [PaymentOperationStatus.PROCESSING, PaymentOperationStatus.UNKNOWN] },
        OR: [{ nextReconcileAt: null }, { nextReconcileAt: { lte: new Date() } }],
      },
    });
    if (!claimed.count) continue;

    let truth: ProviderPaymentStatus | null = null;
    try {
      truth = operation.payment.externalPaymentId
        ? await provider.retrievePayment(operation.payment.externalPaymentId)
        : provider.capabilities.evidence.supportsRequestReferenceRetrieval === 'SUPPORTED'
          ? await provider.retrievePaymentByRequestReference(operation.providerRequestReference)
          : null;
    } catch {
      truth = null;
    }
    if (truth?.externalPaymentId) {
      const amountMinor = aggregateAmount(operation.type, truth);
      await database.paymentOperationEvidence.upsert({
        create: {
          ...(amountMinor === undefined ? {} : { amountMinor }),
          attribution: PaymentEvidenceAttribution.AMBIGUOUS,
          ...(truth.currency ? { currency: truth.currency } : {}),
          evidenceKey: evidenceKey([
            'retrieval',
            operation.paymentId,
            truth.externalPaymentId,
            truth.providerState,
            amountMinor,
          ]),
          paymentId: operation.paymentId,
          providerPaymentId: truth.externalPaymentId,
          providerStatus: truth.providerState,
          reason: 'Aggregate provider retrieval; operation identity is not assumed.',
          source: operation.payment.externalPaymentId
            ? PaymentOperationEvidenceSource.RETRIEVAL
            : PaymentOperationEvidenceSource.REQUEST_REFERENCE_LOOKUP,
        },
        update: {},
        where: {
          paymentId_evidenceKey: {
            evidenceKey: evidenceKey([
              'retrieval',
              operation.paymentId,
              truth.externalPaymentId,
              truth.providerState,
              amountMinor,
            ]),
            paymentId: operation.paymentId,
          },
        },
      });
    }

    const current = await database.paymentOperation.findUniqueOrThrow({
      include: {
        payment: { include: { operationEvidence: true, operations: true } },
        securityDepositSettlementLeg: { include: { settlement: true } },
      },
      where: { id: operation.id },
    });
    const decision = reconcilePaymentOperationEvidence({
      capabilities: provider.capabilities.evidence,
      evidence: current.payment.operationEvidence.map((item) => ({
        amountMinor: item.amountMinor,
        attribution: item.attribution,
        currency: item.currency,
        providerOperationId: item.providerOperationId,
        providerStatus: item.providerStatus,
        requestReference: item.requestReference,
      })),
      operation: current,
      siblingOperations: current.payment.operations,
    });

    if (decision.state === 'SUCCEEDED') {
      await finalizeProvenSettlementOperation(database, current, decision);
      reconciled += 1;
      continue;
    }
    const shouldEscalate =
      decision.state === 'MANUAL_REVIEW' ||
      decision.state === 'FAILED' ||
      current.reconciliationAttemptCount >=
        environment.PAYMENT_OPERATION_RECONCILIATION_MANUAL_REVIEW_ATTEMPTS;
    await database.$transaction(async (transaction) => {
      await transaction.paymentOperation.update({
        data: {
          lastReconciledAt: new Date(),
          manualReviewRequiredAt: shouldEscalate ? new Date() : null,
          nextReconcileAt: shouldEscalate ? null : new Date(Date.now() + RETRY_DELAY_MS),
          reconciliationReason: decision.reason,
          status:
            decision.state === 'FAILED'
              ? PaymentOperationStatus.FAILED
              : PaymentOperationStatus.UNKNOWN,
        },
        where: { id: current.id },
      });
      const leg = current.securityDepositSettlementLeg;
      if (shouldEscalate && leg) {
        const changed = await transaction.securityDepositSettlement.updateMany({
          data: {
            manualReviewReason: decision.reason,
            reconciliationRequiredAt: new Date(),
            status: SecurityDepositSettlementStatus.MANUAL_REVIEW,
          },
          where: {
            id: leg.settlementId,
            status: { not: SecurityDepositSettlementStatus.MANUAL_REVIEW },
          },
        });
        if (changed.count) {
          if (decision.attribution === 'CONFLICTING')
            await transaction.outboxEvent.create({
              data: {
                aggregateId: current.id,
                aggregateType: 'PAYMENT_OPERATION',
                eventType: 'PAYMENT_OPERATION_EVIDENCE_CONFLICT',
                payload: { settlementId: leg.settlementId },
              },
            });
          await transaction.outboxEvent.create({
            data: {
              aggregateId: leg.settlementId,
              aggregateType: 'SECURITY_DEPOSIT_SETTLEMENT',
              eventType: 'PAYMENT_OPERATION_MANUAL_REVIEW_REQUIRED',
              payload: { operationId: current.id, reason: decision.reason },
            },
          });
        }
      }
    });
    if (shouldEscalate) manualReview += 1;
  }
  return { manualReview, reconciled, remapped };
}

async function finalizeProvenSettlementOperation(
  database: PrismaClient,
  operation: Prisma.PaymentOperationGetPayload<{
    include: { securityDepositSettlementLeg: { include: { settlement: true } } };
  }>,
  decision: { attribution: string; reason: string },
) {
  const leg = operation.securityDepositSettlementLeg;
  if (!leg) return;
  const settlementStatus =
    leg.role === SecurityDepositSettlementLegRole.RELEASE &&
    leg.settlement.approvedDeductionMinor === 0n
      ? SecurityDepositSettlementStatus.RELEASED
      : SecurityDepositSettlementStatus.CAPTURED_RELEASE_PENDING;
  await database.$transaction(async (transaction) => {
    const changed = await transaction.paymentOperation.updateMany({
      data: {
        completedAt: new Date(),
        lastReconciledAt: new Date(),
        manualReviewRequiredAt: null,
        nextReconcileAt: null,
        reconciliationReason: decision.reason,
        status: PaymentOperationStatus.SUCCEEDED,
      },
      where: {
        id: operation.id,
        status: { in: [PaymentOperationStatus.PROCESSING, PaymentOperationStatus.UNKNOWN] },
      },
    });
    if (!changed.count) return;
    await transaction.securityDepositSettlement.update({
      data: {
        completedAt:
          settlementStatus === SecurityDepositSettlementStatus.RELEASED ? new Date() : null,
        reconciliationRequiredAt: null,
        status: settlementStatus,
      },
      where: { id: leg.settlementId },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateId: operation.id,
        aggregateType: 'PAYMENT_OPERATION',
        eventType: 'PAYMENT_OPERATION_RECONCILED',
        payload: { attribution: decision.attribution, settlementId: leg.settlementId },
      },
    });
  });
}

export async function remapPaymentWebhookEvidence(database: PrismaClient): Promise<number> {
  const events = await database.paymentWebhookEvent.findMany({
    take: 50,
    where: {
      paymentId: null,
      permanentlyUnmappableAt: null,
      OR: [{ nextRemapAt: null }, { nextRemapAt: { lte: new Date() } }],
    },
  });
  let remapped = 0;
  for (const event of events) {
    const payment = await database.payment.findUnique({
      where: {
        provider_externalPaymentId: {
          externalPaymentId: event.providerPaymentId,
          provider: event.provider,
        },
      },
    });
    if (!payment) {
      const attempts = event.remapAttemptCount + 1;
      await database.paymentWebhookEvent.update({
        data: {
          remapAttemptCount: attempts,
          ...(attempts >= WEBHOOK_REMAP_MAX_ATTEMPTS
            ? { permanentlyUnmappableAt: new Date(), nextRemapAt: null }
            : { nextRemapAt: new Date(Date.now() + RETRY_DELAY_MS) }),
        },
        where: { id: event.id },
      });
      continue;
    }
    await database.$transaction(async (transaction) => {
      const mapped = await transaction.paymentWebhookEvent.updateMany({
        data: {
          mappedAt: new Date(),
          nextRemapAt: null,
          paymentId: payment.id,
          remapAttemptCount: { increment: 1 },
        },
        where: { id: event.id, paymentId: null },
      });
      if (!mapped.count) return;
      await transaction.paymentOperationEvidence.upsert({
        create: {
          attribution: PaymentEvidenceAttribution.AMBIGUOUS,
          evidenceKey: `webhook:${event.id}`,
          paymentId: payment.id,
          providerPaymentId: event.providerPaymentId,
          providerStatus: event.eventType,
          reason: 'Webhook proves aggregate payment evidence; operation identity is not assumed.',
          sanitizedMetadata: { eventType: event.eventType },
          source: PaymentOperationEvidenceSource.WEBHOOK,
          webhookEventId: event.id,
        },
        update: {},
        where: {
          paymentId_evidenceKey: { evidenceKey: `webhook:${event.id}`, paymentId: payment.id },
        },
      });
      await transaction.payment.update({
        data: { reconcileAfter: new Date(), reconciliationRequired: true },
        where: { id: payment.id },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: payment.id,
          aggregateType: 'PAYMENT',
          eventType: 'PAYMENT_WEBHOOK_REMAPPED',
          payload: { webhookEventId: event.id },
        },
      });
    });
    remapped += 1;
  }
  return remapped;
}
