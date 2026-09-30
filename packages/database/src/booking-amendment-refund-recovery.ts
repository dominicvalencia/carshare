import { createHash } from 'node:crypto';
import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentScope,
  BookingAmendmentSettlementStatus,
  BookingAmendmentStatus,
  BookingStatus,
  FinancialAccountType,
  LedgerTransactionType,
  PaymentOperationStatus,
  PaymentStatus,
  Prisma,
  RefundStatus,
  type PrismaClient,
} from './generated/prisma/client';
import { ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON } from './active-extension-recovery';
import {
  AmendmentRefundEvidenceOutcome,
  type AmendmentRefundEvidenceType,
  type PaymentProviderCode,
} from './generated/prisma/client';

export const AMENDMENT_REFUND_OPERATIONAL_EXPIRY_REASON = 'OPERATIONAL_EXPIRY_FINANCIAL_RECOVERY';

export function amendmentOperationalExpiryBoundary(input: {
  originalRentalStart: Date;
  pickupWindowStart: Date | null;
  proposedRentalStart: Date;
}): Date {
  const originalPickupBoundary = input.pickupWindowStart ?? input.originalRentalStart;
  return new Date(Math.min(input.proposedRentalStart.getTime(), originalPickupBoundary.getTime()));
}

export function isRefundOperationalExpiryEligible(input: {
  amendmentStatus: BookingAmendmentStatus;
  bookingStatus: BookingStatus;
  direction: BookingAmendmentFinancialDirection;
  financialDeltaMinor: bigint;
  now: Date;
  operationalBoundary: Date;
  scope: BookingAmendmentScope;
  settlementStatus: BookingAmendmentSettlementStatus;
}): boolean {
  return (
    input.scope === BookingAmendmentScope.PRE_TRIP &&
    input.amendmentStatus === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING &&
    input.direction === BookingAmendmentFinancialDirection.REFUND &&
    input.financialDeltaMinor < 0n &&
    input.settlementStatus !== BookingAmendmentSettlementStatus.COMPLETED &&
    [BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP].includes(
      input.bookingStatus as never,
    ) &&
    input.now.getTime() >= input.operationalBoundary.getTime()
  );
}

export function refundAmendmentCanApplyOperationally(status: BookingAmendmentStatus): boolean {
  return status !== BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING;
}

export async function expireBookingRefundAmendmentForBooking(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  now: Date,
): Promise<boolean> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE
  `);
  const candidate = await transaction.bookingAmendment.findFirst({
    include: { booking: true, settlement: true },
    orderBy: { createdAt: 'desc' },
    where: {
      bookingId,
      scope: BookingAmendmentScope.PRE_TRIP,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      settlement: {
        is: {
          direction: BookingAmendmentFinancialDirection.REFUND,
          financialDeltaMinor: { lt: 0n },
          status: { not: BookingAmendmentSettlementStatus.COMPLETED },
        },
      },
    },
  });
  if (!candidate?.settlement) return false;
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "booking_amendments" WHERE "id" = ${candidate.id}::uuid FOR UPDATE
  `);
  const boundary = amendmentOperationalExpiryBoundary({
    originalRentalStart: candidate.booking.rentalStart,
    pickupWindowStart: candidate.booking.pickupWindowStart,
    proposedRentalStart: candidate.proposedRentalStart,
  });
  if (
    !isRefundOperationalExpiryEligible({
      amendmentStatus: candidate.status,
      bookingStatus: candidate.booking.status,
      direction: candidate.settlement.direction,
      financialDeltaMinor: candidate.settlement.financialDeltaMinor,
      now,
      operationalBoundary: boundary,
      scope: candidate.scope,
      settlementStatus: candidate.settlement.status,
    })
  )
    return false;

  await transaction.bookingAmendment.update({
    data: {
      operationallyExpiredAt: now,
      reasonCode: AMENDMENT_REFUND_OPERATIONAL_EXPIRY_REASON,
      status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    },
    where: { id: candidate.id, status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING },
  });
  await transaction.$queryRaw(Prisma.sql`
    SELECT "release_booking_amendment_holds"(
      ${candidate.id}::uuid,
      'RELEASED'::"BookingAmendmentHoldStatus",
      ${AMENDMENT_REFUND_OPERATIONAL_EXPIRY_REASON}
    )
  `);
  await transaction.bookingAmendmentStatusHistory.upsert({
    create: {
      actorType: BookingActorType.WORKER,
      amendmentId: candidate.id,
      correlationId: candidate.correlationId ?? candidate.id,
      fromStatus: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      idempotencyKey: `booking-amendment-operational-expiry:${candidate.id}:v1`,
      reasonCode: AMENDMENT_REFUND_OPERATIONAL_EXPIRY_REASON,
      toStatus: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    },
    update: {},
    where: { idempotencyKey: `booking-amendment-operational-expiry:${candidate.id}:v1` },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateId: candidate.bookingId,
      aggregateType: 'BOOKING_AMENDMENT',
      eventType: 'BOOKING_AMENDMENT_FINANCIAL_RECOVERY_PENDING',
      payload: {
        amendmentId: candidate.id,
        bookingId: candidate.bookingId,
        operationalBoundary: boundary.toISOString(),
        reasonCode: AMENDMENT_REFUND_OPERATIONAL_EXPIRY_REASON,
      },
    },
  });
  return true;
}

export async function reconcileOperationallyExpiredRefundAmendments(
  database: PrismaClient,
  now = new Date(),
  limit = 50,
): Promise<{ failed: number; transitioned: number }> {
  const candidates = await database.$queryRaw<Array<{ bookingId: string }>>(Prisma.sql`
    SELECT amendment."booking_id" AS "bookingId"
    FROM "booking_amendments" amendment
    INNER JOIN "booking_amendment_settlements" settlement
      ON settlement."amendment_id" = amendment."id"
    INNER JOIN "bookings" booking ON booking."id" = amendment."booking_id"
    WHERE amendment."scope" = 'PRE_TRIP'
      AND amendment."status" = 'OWNER_ACCEPTED_PROCESSING'
      AND settlement."direction" = 'REFUND'
      AND settlement."financial_delta_minor" < 0
      AND settlement."status" <> 'COMPLETED'
      AND booking."status" IN ('CONFIRMED', 'READY_FOR_PICKUP')
      AND LEAST(
        amendment."proposed_rental_start",
        COALESCE(booking."pickup_window_start", booking."rental_start")
      ) <= ${now}
    ORDER BY amendment."accepted_at" ASC NULLS FIRST, amendment."id" ASC
    LIMIT ${limit}
  `);
  let transitioned = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const changed = await database.$transaction(
        (transaction) =>
          expireBookingRefundAmendmentForBooking(transaction, candidate.bookingId, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      if (changed) transitioned += 1;
    } catch {
      failed += 1;
    }
  }
  return { failed, transitioned };
}

export interface AmendmentRefundResolutionEvidenceInput {
  actorType: BookingActorType;
  actorUserId?: string;
  amendmentSettlementId: string;
  currency: string;
  evidenceAt: Date;
  evidenceType: AmendmentRefundEvidenceType;
  externalReference: string;
  idempotencyKey: string;
  outcome: AmendmentRefundEvidenceOutcome;
  provider: PaymentProviderCode;
  resolutionNote: string;
  resolvedAmountMinor: bigint;
}

export interface ResolveAmendmentRefundManuallyInput extends AmendmentRefundResolutionEvidenceInput {
  amendmentId: string;
  originalPaymentId: string;
  refundId: string;
}

export async function resolveAmendmentRefundManually(
  database: PrismaClient,
  input: ResolveAmendmentRefundManuallyInput,
) {
  return database.$transaction(
    async (transaction) => {
      const settlement = await transaction.bookingAmendmentSettlement.findUniqueOrThrow({
        include: { amendment: true, refund: { include: { operation: true, payment: true } } },
        where: { id: input.amendmentSettlementId },
      });
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "bookings" WHERE "id" = ${settlement.amendment.bookingId}::uuid FOR UPDATE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "booking_amendments" WHERE "id" = ${settlement.amendmentId}::uuid FOR UPDATE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "payments" WHERE "id" = ${input.originalPaymentId}::uuid FOR UPDATE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "refunds" WHERE "id" = ${input.refundId}::uuid FOR UPDATE
      `);

      const current = await transaction.bookingAmendmentSettlement.findUniqueOrThrow({
        include: { amendment: true, refund: { include: { operation: true, payment: true } } },
        where: { id: input.amendmentSettlementId },
      });
      const refund = current.refund;
      const activeExtensionRecovery =
        current.amendment.scope === BookingAmendmentScope.ACTIVE_EXTENSION &&
        current.amendment.reasonCode === ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON &&
        current.direction === BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT;
      if (
        current.amendmentId !== input.amendmentId ||
        current.amendment.status !== BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING ||
        (!activeExtensionRecovery &&
          (current.direction !== BookingAmendmentFinancialDirection.REFUND ||
            current.financialDeltaMinor >= 0n)) ||
        !refund ||
        refund.id !== input.refundId ||
        refund.paymentId !== input.originalPaymentId ||
        refund.payment.bookingId !== current.amendment.bookingId ||
        refund.amountMinor !==
          (activeExtensionRecovery ? current.financialDeltaMinor : -current.financialDeltaMinor) ||
        refund.amountMinor !== input.resolvedAmountMinor ||
        refund.currency !== current.currency ||
        refund.currency !== input.currency ||
        refund.payment.provider !== input.provider ||
        !input.externalReference.trim()
      )
        throw new Error('AMENDMENT_REFUND_MANUAL_RESOLUTION_AUTHORITY_MISMATCH');

      const priorResolution = await transaction.bookingAmendmentRefundResolutionEvidence.findFirst({
        where: {
          amendmentSettlementId: current.id,
          outcome: {
            in: [
              AmendmentRefundEvidenceOutcome.SUCCEEDED,
              AmendmentRefundEvidenceOutcome.DEFINITIVE_FAILURE,
            ],
          },
        },
      });
      if (priorResolution && priorResolution.idempotencyKey !== input.idempotencyKey)
        throw new Error('AMENDMENT_REFUND_AUTHORITATIVE_EVIDENCE_CONFLICT');
      const evidence = await recordAmendmentRefundResolutionEvidence(transaction, input);
      if (input.outcome !== AmendmentRefundEvidenceOutcome.SUCCEEDED)
        return { evidence, refundStatus: refund.status, settlementStatus: current.status };

      if (refund.status === RefundStatus.COMPLETED)
        return { evidence, refundStatus: refund.status, settlementStatus: current.status };
      if (!refund.operation) throw new Error('AMENDMENT_REFUND_PAYMENT_OPERATION_REQUIRED');

      const accounts = await transaction.financialAccount.findMany({
        where: { active: true, currency: current.currency },
      });
      const account = (type: FinancialAccountType) => {
        const found = accounts.find((item) => item.type === type);
        if (!found) throw new Error(`Financial account ${type} is missing.`);
        return found.id;
      };
      const ledger = await transaction.ledgerTransaction.upsert({
        create: {
          correlationId: current.amendment.correlationId,
          currency: current.currency,
          description: 'Manually reconciled booking amendment refund settlement',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.REFUND_PAYABLE),
                amountMinor: refund.amountMinor,
                currency: current.currency,
                memo: 'Settle amendment refund payable',
              },
              {
                accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
                amountMinor: -refund.amountMinor,
                currency: current.currency,
                memo: 'Provider-settled amendment refund',
              },
            ],
          },
          sourceId: current.id,
          sourceType: 'BOOKING_AMENDMENT_REFUND',
          type: LedgerTransactionType.REFUND,
        },
        update: {},
        where: {
          sourceType_sourceId_type_currency: {
            currency: current.currency,
            sourceId: current.id,
            sourceType: 'BOOKING_AMENDMENT_REFUND',
            type: LedgerTransactionType.REFUND,
          },
        },
      });
      const completedAt = input.evidenceAt;
      await transaction.paymentOperation.update({
        data: {
          completedAt,
          externalOperationId: input.externalReference,
          failureCategory: null,
          failureCode: null,
          failureMessage: null,
          nextAttemptAt: null,
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: refund.operation.id },
      });
      await transaction.refund.update({
        data: {
          completedAt,
          externalRefundId: input.externalReference,
          status: RefundStatus.COMPLETED,
        },
        where: { id: refund.id },
      });
      const refundedAmountMinor = refund.payment.refundedAmountMinor + refund.amountMinor;
      await transaction.payment.update({
        data: {
          reconcileAfter: null,
          reconciliationRequired: false,
          refundedAmountMinor,
          status:
            refundedAmountMinor === refund.payment.capturedAmountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
          unknownExpiresAt: null,
        },
        where: { id: refund.paymentId },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: {
          completedAt,
          ledgerTransactionId: ledger.id,
          reconciliationRequired: false,
          status: BookingAmendmentSettlementStatus.COMPLETED,
        },
        where: { id: current.id },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: current.amendment.bookingId,
          aggregateType: 'BOOKING_AMENDMENT',
          eventType: 'BOOKING_AMENDMENT_REFUND_MANUALLY_RECONCILED',
          payload: {
            amendmentId: current.amendmentId,
            evidenceId: evidence.id,
            refundId: refund.id,
            settlementId: current.id,
          },
        },
      });
      return {
        evidence,
        refundStatus: RefundStatus.COMPLETED,
        settlementStatus: BookingAmendmentSettlementStatus.COMPLETED,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function recordAmendmentRefundResolutionEvidence(
  database: PrismaClient | Prisma.TransactionClient,
  input: AmendmentRefundResolutionEvidenceInput,
) {
  const evidenceHash = hashEvidence(input);
  const existing = await database.bookingAmendmentRefundResolutionEvidence.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.evidenceHash !== evidenceHash)
      throw new Error('AMENDMENT_REFUND_EVIDENCE_IDEMPOTENCY_CONFLICT');
    return existing;
  }
  return database.bookingAmendmentRefundResolutionEvidence.create({
    data: {
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      amendmentSettlementId: input.amendmentSettlementId,
      currency: input.currency,
      evidenceAt: input.evidenceAt,
      evidenceHash,
      evidenceType: input.evidenceType,
      externalReference: input.externalReference,
      idempotencyKey: input.idempotencyKey,
      outcome: input.outcome,
      provider: input.provider,
      resolutionNote: input.resolutionNote,
      resolvedAmountMinor: input.resolvedAmountMinor,
    },
  });
}

function hashEvidence(input: AmendmentRefundResolutionEvidenceInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        actorUserId: input.actorUserId ?? null,
        evidenceAt: input.evidenceAt.toISOString(),
        resolvedAmountMinor: input.resolvedAmountMinor.toString(),
      }),
    )
    .digest('hex');
}
