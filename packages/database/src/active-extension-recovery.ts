import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentScope,
  BookingAmendmentStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
} from './generated/prisma/client';

export const ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON =
  'ACTIVE_EXTENSION_CAPTURE_RECOVERY' as const;
export const ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON =
  'ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE' as const;

/**
 * Called while the booking aggregate is locked, immediately before ACTIVE ->
 * RETURN_PENDING. A captured extension charge becomes a durable refund
 * obligation; an uncaptured attempt terminates without financial recovery.
 */
export async function terminateActiveExtensionForReturn(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  evaluatedAt = new Date(),
): Promise<'NONE' | 'FAILED' | 'PAYMENT_PENDING' | 'RECOVERY_PENDING'> {
  const amendment = await transaction.bookingAmendment.findFirst({
    include: {
      holds: true,
      settlement: true,
    },
    orderBy: { createdAt: 'desc' },
    where: {
      bookingId,
      scope: BookingAmendmentScope.ACTIVE_EXTENSION,
      status: {
        in: [
          BookingAmendmentStatus.PENDING_OWNER,
          BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
          BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        ],
      },
    },
  });
  if (!amendment) return 'NONE';

  const paymentId = amendment.settlement?.additionalPaymentId;
  if (paymentId) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${paymentId}::uuid FOR UPDATE`,
    );
  }
  const payment = paymentId
    ? await transaction.payment.findUnique({ where: { id: paymentId } })
    : null;
  const captured =
    payment?.purpose === PaymentPurpose.ADDITIONAL_CHARGE &&
    payment.status === PaymentStatus.CAPTURED &&
    payment.capturedAmountMinor === payment.amountMinor &&
    amendment.settlement?.direction === BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT &&
    amendment.settlement.financialDeltaMinor === payment.amountMinor;
  const paymentPending = Boolean(payment && !captured);
  const toStatus = captured
    ? BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING
    : paymentPending
      ? amendment.status
      : BookingAmendmentStatus.FAILED;
  const reasonCode = captured
    ? ACTIVE_EXTENSION_CAPTURE_RECOVERY_REASON
    : ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE_REASON;

  await transaction.bookingAmendment.update({
    data: {
      ...(!captured && !paymentPending ? { failedAt: evaluatedAt } : {}),
      operationallyExpiredAt: evaluatedAt,
      paymentDeadlineAt: null,
      reasonCode,
      status: toStatus,
    },
    where: { id: amendment.id },
  });
  await transaction.$queryRaw(Prisma.sql`
    SELECT "release_booking_amendment_holds"(
      ${amendment.id}::uuid,
      'RELEASED'::"BookingAmendmentHoldStatus",
      ${reasonCode}
    )
  `);
  if (toStatus !== amendment.status)
    await transaction.bookingAmendmentStatusHistory.upsert({
      create: {
        actorType: BookingActorType.SYSTEM,
        amendmentId: amendment.id,
        correlationId: amendment.correlationId ?? amendment.id,
        fromStatus: amendment.status,
        idempotencyKey: `active-extension-return-recovery:${amendment.id}:v1`,
        reasonCode,
        toStatus,
      },
      update: {},
      where: { idempotencyKey: `active-extension-return-recovery:${amendment.id}:v1` },
    });
  const eventType = captured
    ? 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_RECOVERY_PENDING'
    : paymentPending
      ? 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_OPERATIONALLY_EXPIRED'
      : 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_FAILED';
  const existingEvent = await transaction.outboxEvent.findFirst({
    select: { id: true },
    where: {
      aggregateId: bookingId,
      eventType,
      payload: { path: ['amendmentId'], equals: amendment.id },
    },
  });
  if (!existingEvent)
    await transaction.outboxEvent.create({
      data: {
        aggregateId: bookingId,
        aggregateType: 'BOOKING_AMENDMENT',
        eventType,
        payload: { amendmentId: amendment.id, bookingId, reasonCode },
      },
    });
  return captured ? 'RECOVERY_PENDING' : paymentPending ? 'PAYMENT_PENDING' : 'FAILED';
}
