import { randomUUID } from 'node:crypto';
import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentSettlementStatus,
  BookingAmendmentStatus,
  FinancialAccountType,
  LedgerTransactionType,
  PaymentFailureCategory,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from './generated/prisma/client';
import { ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON } from './active-extension-recovery';
import type { PrismaClient } from './generated/prisma/client';

const OPERATION_RETRY_DELAY_MS = 15_000;
const ELIGIBLE_STATUSES = [
  BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
  BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
] as const;

export interface AmendmentRefundProviderResult {
  externalOperationId?: string;
  failureCode?: string;
  failureMessage?: string;
  kind: 'SUCCEEDED' | 'DECLINED' | 'UNKNOWN' | 'ACTION_REQUIRED';
  providerState?: string;
  safeMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AmendmentRefundProvider {
  refund(input: {
    amountMinor: bigint;
    currency: string;
    externalPaymentId: string;
    idempotencyKey: string;
    reason: string;
    requestReference: string;
  }): Promise<AmendmentRefundProviderResult>;
}

export interface ExecuteBookingAmendmentRefundOptions {
  allowReplay?: boolean;
  now?: Date;
  unknownGraceMinutes: number;
}

export async function executeBookingAmendmentRefund(
  database: PrismaClient,
  provider: AmendmentRefundProvider,
  amendmentId: string,
  options: ExecuteBookingAmendmentRefundOptions,
) {
  const now = options.now ?? new Date();
  const prepared = await prepareWithSerializationRetry(
    database,
    amendmentId,
    now,
    options.allowReplay ?? false,
    options.unknownGraceMinutes,
  );
  if (!prepared.callProvider)
    return refundProjection(database, amendmentId, prepared.reason ?? 'ALREADY_PREPARED');

  let result: AmendmentRefundProviderResult;
  try {
    result = await provider.refund({
      amountMinor: prepared.amountMinor,
      currency: prepared.currency,
      externalPaymentId: prepared.externalPaymentId,
      idempotencyKey: prepared.idempotencyKey,
      reason: `Accepted booking amendment ${amendmentId}`,
      requestReference: prepared.providerRequestReference,
    });
  } catch (error) {
    await markUnknown(database, prepared, options.unknownGraceMinutes, now, error);
    return refundProjection(database, amendmentId, 'UNKNOWN');
  }
  if (result.kind === 'SUCCEEDED') {
    await finalizeSuccess(database, prepared, result, now);
    return refundProjection(database, amendmentId, 'COMPLETED');
  }
  if (result.kind === 'DECLINED') {
    await finalizeFailure(database, prepared, result, now);
    return refundProjection(database, amendmentId, 'DEFINITIVE_FAILURE');
  }
  await markUnknown(database, prepared, options.unknownGraceMinutes, now, undefined, result);
  return refundProjection(database, amendmentId, 'UNKNOWN');
}

async function prepareWithSerializationRetry(
  database: PrismaClient,
  amendmentId: string,
  now: Date,
  allowReplay: boolean,
  exactReplayWindowMinutes: number,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prepare(database, amendmentId, now, allowReplay, exactReplayWindowMinutes);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (
        attempt >= 2 ||
        (!message.includes('P2034') &&
          !message.includes('P2002') &&
          !message.includes('40001') &&
          !message.includes('could not serialize') &&
          !message.includes('write conflict'))
      )
        throw error;
    }
  }
}

async function prepare(
  database: PrismaClient,
  amendmentId: string,
  now: Date,
  allowReplay: boolean,
  exactReplayWindowMinutes: number,
) {
  return database.$transaction(
    async (transaction) => {
      const identity = await transaction.bookingAmendment.findUniqueOrThrow({
        select: { bookingId: true },
        where: { id: amendmentId },
      });
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${identity.bookingId}::uuid FOR UPDATE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${amendmentId}::uuid FOR UPDATE`,
      );
      const amendment = await transaction.bookingAmendment.findUniqueOrThrow({
        include: {
          booking: {
            include: {
              payments: {
                include: { refunds: true },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
          holds: { include: { occupancy: true } },
          settlement: { include: { refund: { include: { operation: true } } } },
        },
        where: { id: amendmentId },
      });
      const settlement = amendment.settlement;
      const activeExtensionRecovery =
        amendment.scope === 'ACTIVE_EXTENSION' &&
        amendment.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING &&
        amendment.reasonCode === ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON &&
        settlement?.direction === BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT;
      const amountMinor = settlement
        ? activeExtensionRecovery
          ? settlement.financialDeltaMinor
          : -settlement.financialDeltaMinor
        : 0n;
      if (
        !ELIGIBLE_STATUSES.includes(amendment.status as (typeof ELIGIBLE_STATUSES)[number]) ||
        !settlement ||
        (!activeExtensionRecovery &&
          (amendment.scope !== 'PRE_TRIP' ||
            settlement.direction !== BookingAmendmentFinancialDirection.REFUND)) ||
        amountMinor <= 0n ||
        settlement.currency.length !== 3
      )
        throw new Error('BOOKING_AMENDMENT_REFUND_NOT_ELIGIBLE');
      if (
        amendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING &&
        amendment.holds.some((hold) => hold.status !== 'ACTIVE' || !hold.occupancy.active)
      )
        throw new Error('BOOKING_AMENDMENT_REFUND_HOLD_INVALID');
      if (
        settlement.refund?.status === RefundStatus.COMPLETED &&
        settlement.refund.operation?.status === PaymentOperationStatus.SUCCEEDED
      ) {
        const completedPayment = amendment.booking.payments.find(
          (item) => item.id === settlement.refund?.paymentId,
        );
        if (!completedPayment?.externalPaymentId)
          throw new Error('BOOKING_AMENDMENT_REFUND_PAYMENT_INVALID');
        return result(
          false,
          amendment,
          completedPayment,
          settlement.refund,
          settlement.id,
          'COMPLETED',
          activeExtensionRecovery,
        );
      }
      const payment = activeExtensionRecovery
        ? amendment.booking.payments.find(
            (item) =>
              item.id === settlement.additionalPaymentId &&
              item.purpose === PaymentPurpose.ADDITIONAL_CHARGE &&
              (item.status === PaymentStatus.CAPTURED ||
                item.status === PaymentStatus.PARTIALLY_REFUNDED ||
                item.status === PaymentStatus.REFUNDED),
          )
        : amendment.booking.payments.find(
            (item) =>
              item.purpose === PaymentPurpose.RENTAL &&
              (item.status === PaymentStatus.CAPTURED ||
                item.status === PaymentStatus.PARTIALLY_REFUNDED),
          );
      if (!payment?.externalPaymentId || payment.currency !== settlement.currency)
        throw new Error('BOOKING_AMENDMENT_REFUND_PAYMENT_INVALID');
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${payment.id}::uuid FOR UPDATE`,
      );
      const committedRefunds = payment.refunds
        .filter(
          (refund) => refund.status !== RefundStatus.FAILED && refund.id !== settlement.refundId,
        )
        .reduce((sum, refund) => sum + refund.amountMinor, 0n);
      if (
        committedRefunds > payment.capturedAmountMinor ||
        amountMinor > payment.capturedAmountMinor - committedRefunds
      )
        throw new Error('BOOKING_AMENDMENT_REFUND_BALANCE_INSUFFICIENT');

      await recognizeObligation(
        transaction,
        amendment.id,
        settlement.currency,
        amountMinor,
        amendment.correlationId,
        activeExtensionRecovery,
      );
      let refund = settlement.refund;
      let created = false;
      if (!refund) {
        const providerRequestReference = randomUUID();
        const operation = await transaction.paymentOperation.create({
          data: {
            amountMinor,
            attemptCount: 1,
            currency: settlement.currency,
            idempotencyKey: `booking-amendment:${amendment.id}:refund:v1`,
            nextAttemptAt: new Date(now.getTime() + OPERATION_RETRY_DELAY_MS),
            paymentId: payment.id,
            providerRequestReference,
            startedAt: now,
            status: PaymentOperationStatus.PROCESSING,
            type: PaymentOperationType.REFUND,
          },
        });
        refund = await transaction.refund.create({
          data: {
            amountMinor,
            currency: settlement.currency,
            operationId: operation.id,
            paymentId: payment.id,
            reason: activeExtensionRecovery
              ? `Unapplied active extension ${amendment.id}`
              : `Accepted booking amendment ${amendment.id}`,
            status: RefundStatus.PROCESSING,
          },
          include: { operation: true },
        });
        await transaction.bookingAmendmentSettlement.update({
          data: {
            reconciliationRequired: false,
            refundId: refund.id,
            status: BookingAmendmentSettlementStatus.PROCESSING,
          },
          where: { id: settlement.id },
        });
        created = true;
      }
      if (
        refund.paymentId !== payment.id ||
        refund.amountMinor !== amountMinor ||
        refund.currency !== settlement.currency ||
        !refund.operation ||
        refund.operation.paymentId !== payment.id ||
        refund.operation.amountMinor !== amountMinor ||
        refund.operation.currency !== settlement.currency
      )
        throw new Error('BOOKING_AMENDMENT_REFUND_CORRELATION_INVALID');
      if (
        refund.status === RefundStatus.COMPLETED ||
        refund.operation.status === PaymentOperationStatus.SUCCEEDED
      )
        return result(
          false,
          amendment,
          payment,
          refund,
          settlement.id,
          'COMPLETED',
          activeExtensionRecovery,
        );
      const replayableStatuses: readonly PaymentOperationStatus[] = [
        PaymentOperationStatus.PROCESSING,
        PaymentOperationStatus.UNKNOWN,
        PaymentOperationStatus.PENDING,
      ];
      const replayable =
        allowReplay &&
        refund.operation.nextAttemptAt !== null &&
        refund.operation.nextAttemptAt <= now &&
        refund.operation.createdAt.getTime() + exactReplayWindowMinutes * 60_000 > now.getTime() &&
        replayableStatuses.includes(refund.operation.status);
      if (!created && !replayable)
        return result(
          false,
          amendment,
          payment,
          refund,
          settlement.id,
          'IN_PROGRESS',
          activeExtensionRecovery,
        );
      if (replayable)
        await transaction.paymentOperation.update({
          data: {
            attemptCount: { increment: 1 },
            nextAttemptAt: new Date(now.getTime() + OPERATION_RETRY_DELAY_MS),
            startedAt: now,
            status: PaymentOperationStatus.PROCESSING,
          },
          where: { id: refund.operation.id },
        });
      return result(
        true,
        amendment,
        payment,
        refund,
        settlement.id,
        undefined,
        activeExtensionRecovery,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 20_000,
    },
  );
}

function result(
  callProvider: boolean,
  amendment: {
    booking: { id: string; renterUserId: string };
    id: string;
    status: BookingAmendmentStatus;
  },
  payment: { externalPaymentId: string | null; id: string },
  refund: {
    amountMinor: bigint;
    currency: string;
    id: string;
    operation: null | { id: string; idempotencyKey: string; providerRequestReference: string };
  },
  settlementId: string,
  reason?: string,
  activeExtensionRecovery = false,
) {
  return {
    amendmentId: amendment.id,
    amendmentStatus: amendment.status,
    activeExtensionRecovery,
    amountMinor: refund.amountMinor,
    bookingId: amendment.booking.id,
    callProvider,
    currency: refund.currency,
    externalPaymentId: payment.externalPaymentId!,
    idempotencyKey: refund.operation!.idempotencyKey,
    operationId: refund.operation!.id,
    originalPaymentId: payment.id,
    providerRequestReference: refund.operation!.providerRequestReference,
    recipientUserId: amendment.booking.renterUserId,
    reason,
    refundId: refund.id,
    settlementId,
  };
}

async function recognizeObligation(
  transaction: Prisma.TransactionClient,
  amendmentId: string,
  currency: string,
  amountMinor: bigint,
  correlationId: string | null,
  activeExtensionRecovery: boolean,
) {
  const accounts = await transaction.financialAccount.findMany({
    where: {
      active: true,
      currency,
      type: {
        in: [
          activeExtensionRecovery
            ? FinancialAccountType.CUSTOMER_FUNDS_HELD
            : FinancialAccountType.AMENDMENT_REFUND_SUSPENSE,
          FinancialAccountType.REFUND_PAYABLE,
        ],
      },
    },
  });
  const account = (type: FinancialAccountType) => {
    const found = accounts.find((item) => item.type === type);
    if (!found) throw new Error(`Financial account ${type} is missing.`);
    return found.id;
  };
  const sourceType = activeExtensionRecovery
    ? 'ACTIVE_EXTENSION_CAPTURE_RECOVERY_OBLIGATION'
    : 'BOOKING_AMENDMENT_REFUND_OBLIGATION';
  const sourceAccount = activeExtensionRecovery
    ? FinancialAccountType.CUSTOMER_FUNDS_HELD
    : FinancialAccountType.AMENDMENT_REFUND_SUSPENSE;
  await transaction.ledgerTransaction.upsert({
    create: {
      correlationId,
      currency,
      description: activeExtensionRecovery
        ? 'Recognize unapplied active extension refund obligation'
        : 'Recognize accepted booking amendment refund obligation',
      entries: {
        create: [
          {
            accountId: account(sourceAccount),
            amountMinor,
            currency,
          },
          {
            accountId: account(FinancialAccountType.REFUND_PAYABLE),
            amountMinor: -amountMinor,
            currency,
          },
        ],
      },
      sourceId: amendmentId,
      sourceType,
      type: LedgerTransactionType.ADJUSTMENT,
    },
    update: {},
    where: {
      sourceType_sourceId_type_currency: {
        currency,
        sourceId: amendmentId,
        sourceType,
        type: LedgerTransactionType.ADJUSTMENT,
      },
    },
  });
}

async function finalizeSuccess(
  database: PrismaClient,
  prepared: Awaited<ReturnType<typeof prepare>>,
  provider: AmendmentRefundProviderResult,
  completedAt: Date,
) {
  await database.$transaction(
    async (transaction) => {
      await lockRefundAuthority(transaction, prepared);
      const refund = await transaction.refund.findUniqueOrThrow({
        where: { id: prepared.refundId },
      });
      if (refund.status === RefundStatus.COMPLETED) return;
      const accounts = await transaction.financialAccount.findMany({
        where: {
          active: true,
          currency: prepared.currency,
          type: {
            in: [
              FinancialAccountType.REFUND_PAYABLE,
              FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
            ],
          },
        },
      });
      const account = (type: FinancialAccountType) =>
        accounts.find((item) => item.type === type)?.id;
      const payable = account(FinancialAccountType.REFUND_PAYABLE);
      const receivable = account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE);
      if (!payable || !receivable) throw new Error('AMENDMENT_REFUND_SETTLEMENT_ACCOUNTS_MISSING');
      const ledger = await transaction.ledgerTransaction.upsert({
        create: {
          currency: prepared.currency,
          description: 'Settle booking amendment refund with payment provider',
          entries: {
            create: [
              {
                accountId: payable,
                amountMinor: prepared.amountMinor,
                currency: prepared.currency,
              },
              {
                accountId: receivable,
                amountMinor: -prepared.amountMinor,
                currency: prepared.currency,
              },
            ],
          },
          sourceId: prepared.settlementId,
          sourceType: 'BOOKING_AMENDMENT_REFUND',
          type: LedgerTransactionType.REFUND,
        },
        update: {},
        where: {
          sourceType_sourceId_type_currency: {
            currency: prepared.currency,
            sourceId: prepared.settlementId,
            sourceType: 'BOOKING_AMENDMENT_REFUND',
            type: LedgerTransactionType.REFUND,
          },
        },
      });
      await transaction.paymentOperation.update({
        data: {
          completedAt,
          externalOperationId: provider.externalOperationId ?? prepared.providerRequestReference,
          failureCategory: null,
          failureCode: null,
          failureMessage: null,
          nextAttemptAt: null,
          ...(provider.safeMetadata
            ? { safeProviderMetadata: provider.safeMetadata as Prisma.InputJsonValue }
            : {}),
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: prepared.operationId },
      });
      await transaction.refund.update({
        data: {
          completedAt,
          externalRefundId: provider.externalOperationId ?? prepared.providerRequestReference,
          status: RefundStatus.COMPLETED,
        },
        where: { id: prepared.refundId },
      });
      const payment = await transaction.payment.findUniqueOrThrow({
        where: { id: prepared.originalPaymentId },
      });
      const refundedAmountMinor = payment.refundedAmountMinor + prepared.amountMinor;
      if (refundedAmountMinor > payment.capturedAmountMinor)
        throw new Error('PAYMENT_OVER_REFUND_REJECTED');
      await transaction.payment.update({
        data: {
          reconcileAfter: null,
          reconciliationRequired: false,
          refundedAmountMinor,
          status:
            refundedAmountMinor === payment.capturedAmountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
          unknownExpiresAt: null,
        },
        where: { id: payment.id },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: {
          completedAt,
          ledgerTransactionId: ledger.id,
          reconciliationRequired: false,
          status: BookingAmendmentSettlementStatus.COMPLETED,
        },
        where: { amendmentId: prepared.amendmentId },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: prepared.bookingId,
          aggregateType: 'BOOKING_AMENDMENT',
          eventType: prepared.activeExtensionRecovery
            ? 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_RECOVERY_COMPLETED'
            : prepared.amendmentStatus === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING
              ? 'BOOKING_AMENDMENT_FINANCIAL_RECOVERY_REFUND_COMPLETED'
              : 'BOOKING_AMENDMENT_REFUND_COMPLETED_AWAITING_APPLICATION',
          payload: {
            amendmentId: prepared.amendmentId,
            bookingId: prepared.bookingId,
            recipientUserId: prepared.recipientUserId,
            refundId: prepared.refundId,
          },
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function finalizeFailure(
  database: PrismaClient,
  prepared: Awaited<ReturnType<typeof prepare>>,
  provider: AmendmentRefundProviderResult,
  completedAt: Date,
) {
  await database.$transaction(
    async (transaction) => {
      await lockRefundAuthority(transaction, prepared);
      await transaction.paymentOperation.update({
        data: {
          completedAt,
          failureCategory: PaymentFailureCategory.DEFINITIVE,
          failureCode: provider.failureCode ?? 'PROVIDER_DECLINED',
          failureMessage: provider.failureMessage ?? null,
          nextAttemptAt: null,
          status: PaymentOperationStatus.FAILED,
        },
        where: { id: prepared.operationId },
      });
      await transaction.refund.update({
        data: { status: RefundStatus.FAILED },
        where: { id: prepared.refundId },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: {
          reconciliationRequired: true,
          status: BookingAmendmentSettlementStatus.RECONCILIATION_REQUIRED,
        },
        where: { amendmentId: prepared.amendmentId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function markUnknown(
  database: PrismaClient,
  prepared: Awaited<ReturnType<typeof prepare>>,
  graceMinutes: number,
  now: Date,
  error?: unknown,
  provider?: AmendmentRefundProviderResult,
) {
  await database.$transaction(
    async (transaction) => {
      await lockRefundAuthority(transaction, prepared);
      await transaction.paymentOperation.update({
        data: {
          failureCategory: PaymentFailureCategory.PROVIDER_UNAVAILABLE,
          failureCode: provider?.failureCode ?? null,
          failureMessage:
            provider?.failureMessage ??
            (error instanceof Error ? error.message.slice(0, 500) : null),
          nextAttemptAt: new Date(now.getTime() + OPERATION_RETRY_DELAY_MS),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: prepared.operationId },
      });
      await transaction.payment.update({
        data: {
          reconcileAfter: new Date(now.getTime() + OPERATION_RETRY_DELAY_MS),
          reconciliationRequired: true,
          unknownExpiresAt: new Date(now.getTime() + graceMinutes * 60_000),
        },
        where: { id: prepared.originalPaymentId },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: {
          reconciliationRequired: true,
          status: BookingAmendmentSettlementStatus.RECONCILIATION_REQUIRED,
        },
        where: { amendmentId: prepared.amendmentId },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function lockRefundAuthority(
  transaction: Prisma.TransactionClient,
  prepared: Awaited<ReturnType<typeof prepare>>,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${prepared.amendmentId}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${prepared.originalPaymentId}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "refunds" WHERE "id" = ${prepared.refundId}::uuid FOR UPDATE`,
  );
}

async function refundProjection(database: PrismaClient, amendmentId: string, outcome: string) {
  const amendment = await database.bookingAmendment.findUniqueOrThrow({
    include: { settlement: { include: { refund: { include: { operation: true } } } } },
    where: { id: amendmentId },
  });
  return {
    amendmentId,
    amendmentStatus: amendment.status,
    fiveC2Eligible:
      amendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING &&
      amendment.settlement?.status === BookingAmendmentSettlementStatus.COMPLETED,
    outcome,
    refund: amendment.settlement?.refund
      ? {
          amountMinor: amendment.settlement.refund.amountMinor.toString(),
          operationStatus: amendment.settlement.refund.operation?.status ?? null,
          status: amendment.settlement.refund.status,
        }
      : null,
    settlementStatus: amendment.settlement?.status ?? null,
  };
}

export async function findRecoverableBookingAmendmentRefunds(database: PrismaClient, limit = 50) {
  const rows = await database.$queryRaw<Array<{ amendmentId: string }>>(Prisma.sql`
    SELECT s."amendment_id" AS "amendmentId"
    FROM "booking_amendment_settlements" s
    JOIN "booking_amendments" a ON a."id" = s."amendment_id"
    LEFT JOIN "refunds" r ON r."id" = s."refund_id"
    LEFT JOIN "payment_operations" o ON o."id" = r."operation_id"
    WHERE (
        (
          s."direction" = 'REFUND'
          AND s."financial_delta_minor" < 0
          AND a."scope" = 'PRE_TRIP'
          AND a."status" IN ('OWNER_ACCEPTED_PROCESSING', 'FINANCIAL_RECOVERY_PENDING')
        )
        OR (
          s."direction" = 'ADDITIONAL_PAYMENT'
          AND s."financial_delta_minor" > 0
          AND a."scope" = 'ACTIVE_EXTENSION'
          AND a."status" = 'FINANCIAL_RECOVERY_PENDING'
          AND a."reason_code" = 'ACTIVE_EXTENSION_CAPTURE_RECOVERY'
        )
      )
      AND (
        s."refund_id" IS NULL
        OR (
          r."status" = 'PROCESSING'
          AND o."status" IN ('PENDING', 'PROCESSING', 'UNKNOWN')
          AND (o."next_attempt_at" IS NULL OR o."next_attempt_at" <= clock_timestamp())
        )
      )
    ORDER BY COALESCE(o."created_at", s."created_at")
    LIMIT ${limit}
  `);
  return rows.map((row) => row.amendmentId);
}

export async function finalizeBookingAmendmentRefundFromProviderEvidence(
  database: PrismaClient,
  amendmentId: string,
  externalOperationId: string,
  completedAt = new Date(),
) {
  const amendment = await database.bookingAmendment.findUniqueOrThrow({
    include: {
      booking: { include: { payments: true } },
      settlement: { include: { refund: { include: { operation: true } } } },
    },
    where: { id: amendmentId },
  });
  const settlement = amendment.settlement;
  const refund = settlement?.refund;
  const operation = refund?.operation;
  const activeExtensionRecovery =
    amendment.scope === 'ACTIVE_EXTENSION' &&
    amendment.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING &&
    amendment.reasonCode === ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON;
  const payment = amendment.booking.payments.find((item) => item.id === refund?.paymentId);
  if (
    !settlement ||
    !refund ||
    !operation ||
    !payment?.externalPaymentId ||
    (activeExtensionRecovery
      ? settlement.direction !== BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT ||
        payment.purpose !== PaymentPurpose.ADDITIONAL_CHARGE ||
        refund.amountMinor !== settlement.financialDeltaMinor
      : settlement.direction !== BookingAmendmentFinancialDirection.REFUND ||
        payment.purpose !== PaymentPurpose.RENTAL ||
        refund.amountMinor !== -settlement.financialDeltaMinor) ||
    refund.currency !== settlement.currency
  )
    throw new Error('BOOKING_AMENDMENT_REFUND_CORRELATION_INVALID');
  const prepared = {
    amendmentId,
    amendmentStatus: amendment.status,
    activeExtensionRecovery,
    amountMinor: refund.amountMinor,
    bookingId: amendment.booking.id,
    callProvider: false,
    currency: refund.currency,
    externalPaymentId: payment.externalPaymentId,
    idempotencyKey: operation.idempotencyKey,
    operationId: operation.id,
    originalPaymentId: payment.id,
    providerRequestReference: operation.providerRequestReference,
    recipientUserId: amendment.booking.renterUserId,
    reason: undefined,
    refundId: refund.id,
    settlementId: settlement.id,
  } satisfies Awaited<ReturnType<typeof prepare>>;
  await finalizeSuccess(
    database,
    prepared,
    { externalOperationId, kind: 'SUCCEEDED', providerState: 'REFUNDED' },
    completedAt,
  );
}
