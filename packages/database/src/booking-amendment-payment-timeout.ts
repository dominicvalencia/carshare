import {
  BookingActorType,
  BookingAmendmentHoldStatus,
  BookingAmendmentStatus,
  PaymentOperationStatus,
  PaymentStatus,
  Prisma,
  type PrismaClient,
} from './generated/prisma/client';

export const AMENDMENT_PAYMENT_TIMEOUT_REASON = 'RENTER_PAYMENT_DEADLINE_EXPIRED';

const UNRESOLVED_PAYMENT_STATUSES = [
  PaymentStatus.PENDING,
  PaymentStatus.AUTHORIZING,
  PaymentStatus.CAPTURING,
  PaymentStatus.VOID_PENDING,
] as const;

const UNRESOLVED_OPERATION_STATUSES = [
  PaymentOperationStatus.PENDING,
  PaymentOperationStatus.PROCESSING,
  PaymentOperationStatus.UNKNOWN,
] as const;

export function isAmendmentPaymentTimeoutEligible(input: {
  paymentInitiatedAt: Date | null;
  payment: {
    reconciliationRequired: boolean;
    status: PaymentStatus;
    operations: Array<{ status: PaymentOperationStatus }>;
  } | null;
}): boolean {
  const payment = input.payment;
  if (!payment) return input.paymentInitiatedAt === null;
  if (payment.status === PaymentStatus.CAPTURED || payment.reconciliationRequired) return false;
  if (
    UNRESOLVED_PAYMENT_STATUSES.includes(
      payment.status as (typeof UNRESOLVED_PAYMENT_STATUSES)[number],
    )
  )
    return false;
  return !payment.operations.some((operation) =>
    UNRESOLVED_OPERATION_STATUSES.includes(
      operation.status as (typeof UNRESOLVED_OPERATION_STATUSES)[number],
    ),
  );
}

export async function expireDueBookingAmendmentPayments(
  database: PrismaClient,
  evaluatedAt = new Date(),
  batchSize = 50,
): Promise<number> {
  const candidates = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "booking_amendments"
    WHERE "status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'
      AND "payment_deadline_at" <= ${evaluatedAt}
    ORDER BY "payment_deadline_at", "id"
    LIMIT ${batchSize}
  `);
  let expired = 0;
  for (const candidate of candidates) {
    const didExpire = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`,
      );
      const amendment = await transaction.bookingAmendment.findUnique({
        include: { settlement: true },
        where: { id: candidate.id },
      });
      if (
        !amendment ||
        amendment.status !== BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING ||
        !amendment.paymentDeadlineAt ||
        evaluatedAt < amendment.paymentDeadlineAt
      )
        return false;
      const payment = amendment.settlement?.additionalPaymentId
        ? await transaction.payment.findUnique({
            include: { operations: true },
            where: { id: amendment.settlement.additionalPaymentId },
          })
        : null;
      if (
        !isAmendmentPaymentTimeoutEligible({
          payment,
          paymentInitiatedAt: amendment.paymentInitiatedAt,
        })
      )
        return false;

      const transitioned = await transaction.bookingAmendment.updateMany({
        data: {
          failedAt: evaluatedAt,
          failureCode: AMENDMENT_PAYMENT_TIMEOUT_REASON,
          status: BookingAmendmentStatus.FAILED,
        },
        where: {
          id: amendment.id,
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
        },
      });
      if (!transitioned.count) return false;
      await transaction.$queryRaw(Prisma.sql`
        SELECT "release_booking_amendment_holds"(
          ${amendment.id}::uuid,
          ${BookingAmendmentHoldStatus.EXPIRED}::"BookingAmendmentHoldStatus",
          ${AMENDMENT_PAYMENT_TIMEOUT_REASON}
        )
      `);
      await transaction.bookingAmendmentStatusHistory.upsert({
        create: {
          actorType: BookingActorType.SYSTEM,
          amendmentId: amendment.id,
          correlationId: amendment.correlationId,
          fromStatus: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
          idempotencyKey: `booking-amendment-expiry:${amendment.id}:FAILED`,
          occurredAt: evaluatedAt,
          reasonCode: AMENDMENT_PAYMENT_TIMEOUT_REASON,
          toStatus: BookingAmendmentStatus.FAILED,
        },
        update: {},
        where: { idempotencyKey: `booking-amendment-expiry:${amendment.id}:FAILED` },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: amendment.id,
          aggregateType: 'BOOKING_AMENDMENT',
          eventType: 'BOOKING_AMENDMENT_TERMINATED',
          occurredAt: evaluatedAt,
          payload: {
            amendmentId: amendment.id,
            bookingId: amendment.bookingId,
            reasonCode: AMENDMENT_PAYMENT_TIMEOUT_REASON,
            status: BookingAmendmentStatus.FAILED,
          },
        },
      });
      return true;
    });
    if (didExpire) expired += 1;
  }
  return expired;
}

export async function findEscalatedUnknownAmendmentPayments(
  database: PrismaClient,
  evaluatedAt = new Date(),
  batchSize = 50,
) {
  const ids = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id"
    FROM "payments" p
    JOIN "booking_amendment_settlements" s ON s."additional_payment_id" = p."id"
    JOIN "booking_amendments" a ON a."id" = s."amendment_id"
    WHERE p."reconciliation_required" = TRUE
      AND p."unknown_expires_at" <= ${evaluatedAt}
      AND p."status" IN ('PENDING', 'AUTHORIZING', 'AUTHORIZED', 'CAPTURING', 'VOID_PENDING')
      AND a."status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'
      AND EXISTS (
        SELECT 1 FROM "payment_operations" o
        WHERE o."payment_id" = p."id" AND o."status" = 'UNKNOWN'
      )
    ORDER BY p."unknown_expires_at", p."id"
    LIMIT ${batchSize}
  `);
  return database.payment.findMany({
    include: { operations: true },
    where: { id: { in: ids.map(({ id }) => id) } },
  });
}
