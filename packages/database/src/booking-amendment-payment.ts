import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentSettlementStatus,
  BookingAmendmentStatus,
  FinancialAccountType,
  LedgerTransactionType,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
} from './generated/prisma/client';
import {
  ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
  ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON,
} from './active-extension-recovery';

export async function finalizeBookingAmendmentPaymentCapture(
  transaction: Prisma.TransactionClient,
  input: {
    paymentId: string;
    operationId?: string;
    providerState: string;
    externalOperationId?: string;
    correlationId?: string;
  },
): Promise<boolean> {
  const settlement = await transaction.bookingAmendmentSettlement.findUnique({
    include: { amendment: { include: { pricingSnapshot: true } } },
    where: { additionalPaymentId: input.paymentId },
  });
  if (!settlement) return false;
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${settlement.amendment.bookingId}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${settlement.amendmentId}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${input.paymentId}::uuid FOR UPDATE`,
  );
  const currentAmendment = await transaction.bookingAmendment.findUniqueOrThrow({
    where: { id: settlement.amendmentId },
  });
  const payment = await transaction.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
  const pricing = settlement.amendment.pricingSnapshot;
  if (
    payment.purpose !== PaymentPurpose.ADDITIONAL_CHARGE ||
    payment.bookingId !== settlement.amendment.bookingId ||
    settlement.direction !== BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT ||
    settlement.financialDeltaMinor <= 0n ||
    payment.amountMinor !== settlement.financialDeltaMinor ||
    payment.currency !== settlement.currency ||
    !pricing ||
    pricing.renterFinancialDeltaMinor !== settlement.financialDeltaMinor ||
    pricing.currency !== settlement.currency
  ) {
    throw new Error('AMENDMENT_PAYMENT_CORRELATION_INVALID');
  }
  if (payment.status === PaymentStatus.CAPTURED) return true;
  if (input.operationId) {
    const operation = await transaction.paymentOperation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    if (
      operation.paymentId !== payment.id ||
      operation.type !== PaymentOperationType.CAPTURE ||
      operation.amountMinor !== payment.amountMinor ||
      operation.currency !== payment.currency
    )
      throw new Error('AMENDMENT_CAPTURE_OPERATION_INVALID');
    await transaction.paymentOperation.update({
      data: {
        completedAt: new Date(),
        externalOperationId: input.externalOperationId ?? null,
        failureCategory: null,
        status: PaymentOperationStatus.SUCCEEDED,
      },
      where: { id: operation.id },
    });
  }
  await transaction.payment.update({
    data: {
      capturedAmountMinor: payment.amountMinor,
      capturedAt: new Date(),
      providerState: input.providerState,
      reconcileAfter: null,
      reconciliationRequired: false,
      status: PaymentStatus.CAPTURED,
      unknownExpiresAt: null,
    },
    where: { id: payment.id },
  });
  let recognition = await transaction.ledgerTransaction.findFirst({
    where: {
      sourceId: payment.id,
      sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
      type: LedgerTransactionType.CAPTURE_RECOGNITION,
    },
  });
  if (!recognition) {
    const accounts = await transaction.financialAccount.findMany({
      where: { active: true, currency: payment.currency },
    });
    const account = (type: FinancialAccountType) => {
      const found = accounts.find((candidate) => candidate.type === type);
      if (!found) throw new Error(`Financial account ${type} is missing.`);
      return found.id;
    };
    recognition = await transaction.ledgerTransaction.create({
      data: {
        correlationId: input.correlationId ?? null,
        currency: payment.currency,
        description: 'Amendment additional payment capture recognized',
        entries: {
          create: [
            {
              accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
              amountMinor: payment.amountMinor,
              currency: payment.currency,
              memo: 'Provider receivable',
            },
            {
              accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
              amountMinor: -payment.amountMinor,
              currency: payment.currency,
              memo: 'Customer funds held pending amendment application',
            },
          ],
        },
        sourceId: payment.id,
        sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
        type: LedgerTransactionType.CAPTURE_RECOGNITION,
      },
    });
  }
  await transaction.bookingAmendmentSettlement.update({
    data: {
      ledgerTransactionId: recognition.id,
      reconciliationRequired: false,
      status: BookingAmendmentSettlementStatus.PROCESSING,
    },
    where: { id: settlement.id },
  });
  if (
    currentAmendment.scope === 'ACTIVE_EXTENSION' &&
    (currentAmendment.status === BookingAmendmentStatus.FAILED ||
      currentAmendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING) &&
    currentAmendment.reasonCode === ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON
  ) {
    await transaction.bookingAmendment.update({
      data: {
        failedAt: null,
        reasonCode: ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
        status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      },
      where: { id: settlement.amendmentId },
    });
    await transaction.bookingAmendmentStatusHistory.create({
      data: {
        actorType: 'SYSTEM',
        amendmentId: settlement.amendmentId,
        correlationId: input.correlationId ?? currentAmendment.correlationId,
        fromStatus: currentAmendment.status,
        idempotencyKey: `active-extension-captured-after-return:${settlement.amendmentId}:v1`,
        reasonCode: ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
        toStatus: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        aggregateId: settlement.amendment.bookingId,
        aggregateType: 'BOOKING_AMENDMENT',
        eventType: 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_RECOVERY_PENDING',
        payload: {
          amendmentId: settlement.amendmentId,
          bookingId: settlement.amendment.bookingId,
          reasonCode: ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON,
        },
      },
    });
  }
  return true;
}

export async function isBookingAmendmentReadyForPaidApplication(
  transaction: Prisma.TransactionClient,
  amendmentId: string,
): Promise<boolean> {
  const amendment = await transaction.bookingAmendment.findUnique({
    include: {
      pricingSnapshot: true,
      settlement: true,
    },
    where: { id: amendmentId },
  });
  if (
    !amendment ||
    amendment.status !== BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING ||
    !amendment.settlement?.additionalPaymentId ||
    amendment.settlement.direction !== BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT ||
    amendment.settlement.financialDeltaMinor <= 0n ||
    !amendment.pricingSnapshot
  )
    return false;
  const payment = await transaction.payment.findUnique({
    include: { operations: true },
    where: { id: amendment.settlement.additionalPaymentId },
  });
  return hasBookingAmendmentPaidApplicationAuthority({
    amendmentBookingId: amendment.bookingId,
    amendmentStatus: amendment.status,
    direction: amendment.settlement.direction,
    payment,
    pricingCurrency: amendment.pricingSnapshot.currency,
    pricingDeltaMinor: amendment.pricingSnapshot.renterFinancialDeltaMinor,
    settlementCurrency: amendment.settlement.currency,
    settlementDeltaMinor: amendment.settlement.financialDeltaMinor,
  });
}

export function hasBookingAmendmentPaidApplicationAuthority(input: {
  amendmentBookingId: string;
  amendmentStatus: BookingAmendmentStatus;
  direction: BookingAmendmentFinancialDirection;
  payment: {
    amountMinor: bigint;
    bookingId: string;
    currency: string;
    purpose: PaymentPurpose;
    status: PaymentStatus;
    operations: Array<{
      amountMinor: bigint;
      currency: string;
      status: PaymentOperationStatus;
      type: PaymentOperationType;
    }>;
  } | null;
  pricingCurrency: string;
  pricingDeltaMinor: bigint;
  settlementCurrency: string;
  settlementDeltaMinor: bigint;
}): boolean {
  const payment = input.payment;
  return Boolean(
    input.amendmentStatus === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING &&
    input.direction === BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT &&
    input.settlementDeltaMinor > 0n &&
    payment &&
    payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE &&
    payment.bookingId === input.amendmentBookingId &&
    payment.status === PaymentStatus.CAPTURED &&
    payment.amountMinor === input.settlementDeltaMinor &&
    payment.currency === input.settlementCurrency &&
    input.pricingDeltaMinor === payment.amountMinor &&
    input.pricingCurrency === payment.currency &&
    payment.operations.some(
      (operation) =>
        operation.type === PaymentOperationType.CAPTURE &&
        operation.status === PaymentOperationStatus.SUCCEEDED &&
        operation.amountMinor === payment.amountMinor &&
        operation.currency === payment.currency,
    ),
  );
}
