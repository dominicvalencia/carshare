import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentScope,
  BookingAmendmentStatus,
  BookingStatus,
  FinancialAccountType,
  LedgerTransactionType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
  VehicleOccupancyType,
} from './generated/prisma/client';
import type { PrismaClient } from './generated/prisma/client';
import { hasBookingAmendmentPaidApplicationAuthority } from './booking-amendment-payment';

const APPLICATION_INCLUDE = {
  booking: {
    include: {
      cancellationSettlement: true,
      commissionSnapshot: true,
      fulfillmentSnapshot: true,
      occupancy: true,
      ownerEarning: { include: { payoutItems: { where: { activeAllocation: true } } } },
      payments: true,
      pickupChallenges: { select: { consumedAt: true } },
      policySnapshot: true,
      postReturnClaims: true,
      disputes: true,
    },
  },
  fulfillmentSnapshot: true,
  holds: { include: { occupancy: true }, orderBy: { protectedStart: 'asc' as const } },
  pricingSnapshot: true,
  settlement: {
    include: {
      refund: { include: { operation: true } },
      refunds: { include: { operation: true } },
    },
  },
} satisfies Prisma.BookingAmendmentInclude;

type ApplicationRecord = Prisma.BookingAmendmentGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

export class BookingAmendmentApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BookingAmendmentApplicationError';
  }
}

export interface AppliedBookingAmendmentResult {
  amendmentId: string;
  appliedAt: Date;
  bookingId: string;
  bookingReference: string;
  rentalEnd: Date;
  rentalStart: Date;
  status: 'APPLIED';
}

export type BookingAmendmentApplicationFailurePoint =
  | 'AFTER_BOOKING_MUTATION'
  | 'AFTER_OCCUPANCY_CONVERSION'
  | 'AFTER_FINANCIAL_APPLICATION'
  | 'AFTER_OWNER_EARNINGS'
  | 'AFTER_SETTLEMENT_FINALIZATION'
  | 'AFTER_APPLIED_HISTORY_OUTBOX'
  | 'BEFORE_FINALIZE';

export async function applyZeroDeltaBookingAmendment(
  database: PrismaClient,
  amendmentId: string,
  options: { evaluatedAt?: Date; failurePoint?: BookingAmendmentApplicationFailurePoint } = {},
): Promise<AppliedBookingAmendmentResult> {
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const identity = await database.bookingAmendment.findUnique({
    select: { bookingId: true },
    where: { id: amendmentId },
  });
  if (!identity)
    throw new BookingAmendmentApplicationError('AMENDMENT_NOT_FOUND', 'Change not found.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await applyInTransaction(
        database,
        identity.bookingId,
        amendmentId,
        evaluatedAt,
        options,
      );
    } catch (error) {
      if (attempt === 0 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
  throw new BookingAmendmentApplicationError(
    'APPLICATION_RETRY_EXHAUSTED',
    'Application did not converge.',
  );
}

export async function applyPaidBookingAmendment(
  database: PrismaClient,
  amendmentId: string,
  options: {
    evaluatedAt?: Date;
    failurePoint?: BookingAmendmentApplicationFailurePoint;
  } = {},
): Promise<AppliedBookingAmendmentResult> {
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const identity = await database.bookingAmendment.findUnique({
    select: { bookingId: true },
    where: { id: amendmentId },
  });
  if (!identity)
    throw new BookingAmendmentApplicationError('AMENDMENT_NOT_FOUND', 'Change not found.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await applyInTransaction(
        database,
        identity.bookingId,
        amendmentId,
        evaluatedAt,
        options,
        'PAID',
      );
    } catch (error) {
      if (attempt === 0 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
  throw new BookingAmendmentApplicationError(
    'APPLICATION_RETRY_EXHAUSTED',
    'Application did not converge.',
  );
}

export async function applyRefundBookingAmendment(
  database: PrismaClient,
  amendmentId: string,
  options: {
    evaluatedAt?: Date;
    failurePoint?: BookingAmendmentApplicationFailurePoint;
  } = {},
): Promise<AppliedBookingAmendmentResult> {
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const identity = await database.bookingAmendment.findUnique({
    select: { bookingId: true },
    where: { id: amendmentId },
  });
  if (!identity)
    throw new BookingAmendmentApplicationError('AMENDMENT_NOT_FOUND', 'Change not found.');

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await applyInTransaction(
        database,
        identity.bookingId,
        amendmentId,
        evaluatedAt,
        options,
        'REFUND',
      );
    } catch (error) {
      if (attempt === 0 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
  throw new BookingAmendmentApplicationError(
    'APPLICATION_RETRY_EXHAUSTED',
    'Application did not converge.',
  );
}

async function applyInTransaction(
  database: PrismaClient,
  bookingId: string,
  amendmentId: string,
  evaluatedAt: Date,
  options: { failurePoint?: BookingAmendmentApplicationFailurePoint },
  mode: 'PAID' | 'REFUND' | 'ZERO_DELTA' = 'ZERO_DELTA',
): Promise<AppliedBookingAmendmentResult> {
  return database.$transaction(
    async (transaction) => {
      // Booking is the aggregate lock. Taking it before the amendment gives
      // cancellation and application one deterministic serialization point.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "bookings"
        WHERE "id" = ${bookingId}::uuid
        FOR UPDATE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "booking_amendments"
        WHERE "id" = ${amendmentId}::uuid AND "booking_id" = ${bookingId}::uuid
        FOR UPDATE
      `);
      const amendment = await transaction.bookingAmendment.findUnique({
        include: APPLICATION_INCLUDE,
        where: { id: amendmentId },
      });
      if (!amendment)
        throw new BookingAmendmentApplicationError('AMENDMENT_NOT_FOUND', 'Change not found.');
      if (amendment.status === BookingAmendmentStatus.APPLIED) return appliedResult(amendment);
      await assertEligible(transaction, amendment, evaluatedAt, mode);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id" FROM "vehicle_occupancies"
        WHERE "booking_id" = ${amendment.bookingId}::uuid
        FOR UPDATE
      `);

      const activeHolds = amendment.holds.filter((hold) => hold.status === 'ACTIVE');
      assertHolds(amendment, activeHolds);
      const occupancy = amendment.booking.occupancy;
      if (!occupancy?.active || occupancy.type !== VehicleOccupancyType.BOOKING_RESERVATION)
        fail('BOOKING_OCCUPANCY_INVALID', 'Booking inventory authority is unavailable.');

      const turnaroundMinutes = amendment.booking.policySnapshot?.turnaroundMinutes;
      if (turnaroundMinutes === null || turnaroundMinutes === undefined)
        fail('BOOKING_POLICY_INVALID', 'Booking policy authority is unavailable.');
      const proposedOccupiedEnd = new Date(
        amendment.proposedRentalEnd.getTime() + turnaroundMinutes * 60_000,
      );

      // Terminalize temporary protection first inside the same transaction. If
      // the canonical occupancy update fails, the complete transaction rolls back.
      await transaction.$queryRaw(Prisma.sql`
        SELECT "convert_booking_amendment_holds"(
          ${amendment.id}::uuid,
          'AMENDMENT_APPLIED'
        )
      `);
      await transaction.vehicleOccupancy.update({
        data: {
          occupiedEnd: proposedOccupiedEnd,
          occupiedStart: amendment.proposedRentalStart,
        },
        where: { id: occupancy.id },
      });
      injectFailure(options, 'AFTER_OCCUPANCY_CONVERSION');
      await transaction.booking.update({
        data: {
          rentalEnd: amendment.proposedRentalEnd,
          ...(amendment.scope === BookingAmendmentScope.PRE_TRIP
            ? { rentalStart: amendment.proposedRentalStart }
            : {}),
          updatedAt: evaluatedAt,
        },
        where: { id: amendment.bookingId },
      });
      injectFailure(options, 'AFTER_BOOKING_MUTATION');

      await applyOwnerFinancialAuthority(transaction, amendment, evaluatedAt, mode, options);
      injectFailure(options, 'AFTER_FINANCIAL_APPLICATION');
      await transaction.bookingAmendmentSettlement.update({
        data: {
          completedAt: evaluatedAt,
          reconciliationRequired: false,
          status: 'COMPLETED',
        },
        where: { amendmentId: amendment.id },
      });
      injectFailure(options, 'AFTER_SETTLEMENT_FINALIZATION');

      if (options.failurePoint === 'BEFORE_FINALIZE')
        fail('APPLICATION_FAILURE_INJECTED', 'Application did not complete.');

      await transaction.bookingAmendment.update({
        data: { appliedAt: evaluatedAt, paymentDeadlineAt: null, status: 'APPLIED' },
        where: { id: amendment.id },
      });
      await transaction.bookingAmendmentStatusHistory.create({
        data: {
          actorType: BookingActorType.WORKER,
          amendmentId: amendment.id,
          correlationId: amendment.correlationId ?? amendment.id,
          fromStatus:
            mode === 'PAID'
              ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
              : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
          idempotencyKey: `booking-amendment-application:${amendment.id}:v1`,
          reasonCode:
            mode === 'PAID'
              ? 'ADDITIONAL_PAYMENT_APPLIED'
              : mode === 'REFUND'
                ? 'REFUND_APPLIED'
                : 'ZERO_DELTA_APPLIED',
          toStatus: BookingAmendmentStatus.APPLIED,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: amendment.bookingId,
          aggregateType: 'BOOKING_AMENDMENT',
          eventType: 'BOOKING_AMENDMENT_APPLIED',
          payload: {
            amendmentId: amendment.id,
            bookingId: amendment.bookingId,
            bookingReference: amendment.booking.publicReference,
            rentalEnd: amendment.proposedRentalEnd.toISOString(),
            rentalStart: amendment.proposedRentalStart.toISOString(),
            renterUserId: amendment.requesterUserId,
          },
        },
      });
      injectFailure(options, 'AFTER_APPLIED_HISTORY_OUTBOX');
      return {
        amendmentId: amendment.id,
        appliedAt: evaluatedAt,
        bookingId: amendment.bookingId,
        bookingReference: amendment.booking.publicReference,
        rentalEnd: amendment.proposedRentalEnd,
        rentalStart: amendment.proposedRentalStart,
        status: 'APPLIED',
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 10_000,
      timeout: 20_000,
    },
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export async function reconcileZeroDeltaBookingAmendments(
  database: PrismaClient,
  limit = 50,
): Promise<{ applied: number; failed: number; skipped: number }> {
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT amendment."id"
    FROM "booking_amendments" amendment
    INNER JOIN "booking_amendment_settlements" settlement
      ON settlement."amendment_id" = amendment."id"
    WHERE amendment."status" = 'OWNER_ACCEPTED_PROCESSING'
      AND settlement."direction" = 'NONE'
      AND settlement."financial_delta_minor" = 0
    ORDER BY amendment."accepted_at" DESC, amendment."id" DESC
    LIMIT ${limit}
  `);
  let applied = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await applyZeroDeltaBookingAmendment(database, row.id);
      applied += 1;
    } catch {
      // Durable processing remains retryable; a malformed row must not block
      // unrelated eligible amendments in the same sweep.
      failed += 1;
    }
  }
  return { applied, failed, skipped: 0 };
}

export async function reconcilePaidBookingAmendments(
  database: PrismaClient,
  limit = 50,
): Promise<{ applied: number; failed: number; skipped: number }> {
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT amendment."id"
    FROM "booking_amendments" amendment
    INNER JOIN "booking_amendment_settlements" settlement
      ON settlement."amendment_id" = amendment."id"
    INNER JOIN "payments" payment
      ON payment."id" = settlement."additional_payment_id"
    WHERE amendment."status" = 'OWNER_ACCEPTED_PAYMENT_PENDING'
      AND settlement."direction" = 'ADDITIONAL_PAYMENT'
      AND payment."status" = 'CAPTURED'
    ORDER BY payment."captured_at" ASC NULLS LAST, amendment."id" ASC
    LIMIT ${limit}
  `);
  let applied = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await applyPaidBookingAmendment(database, row.id);
      applied += 1;
    } catch {
      failed += 1;
    }
  }
  return { applied, failed, skipped: 0 };
}

export async function reconcileRefundBookingAmendments(
  database: PrismaClient,
  limit = 50,
): Promise<{ applied: number; failed: number; skipped: number }> {
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT amendment."id"
    FROM "booking_amendments" amendment
    INNER JOIN "booking_amendment_settlements" settlement
      ON settlement."amendment_id" = amendment."id"
    INNER JOIN "refunds" refund
      ON refund."id" = settlement."refund_id"
    WHERE amendment."status" = 'OWNER_ACCEPTED_PROCESSING'
      AND settlement."direction" = 'REFUND'
      AND settlement."status" = 'COMPLETED'
      AND refund."status" = 'COMPLETED'
    ORDER BY refund."completed_at" ASC NULLS LAST, amendment."id" ASC
    LIMIT ${limit}
  `);
  let applied = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await applyRefundBookingAmendment(database, row.id);
      applied += 1;
    } catch {
      failed += 1;
    }
  }
  return { applied, failed, skipped: 0 };
}

async function assertEligible(
  transaction: Prisma.TransactionClient,
  amendment: ApplicationRecord,
  evaluatedAt: Date,
  mode: 'PAID' | 'REFUND' | 'ZERO_DELTA',
) {
  if (
    amendment.status !==
    (mode === 'PAID'
      ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
      : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING)
  )
    fail(
      'AMENDMENT_NOT_APPLICABLE',
      `Change is not eligible for ${mode} application from ${amendment.status}.`,
    );
  const pricing = amendment.pricingSnapshot;
  const settlement = amendment.settlement;
  const zeroDeltaInvalid =
    mode === 'ZERO_DELTA' &&
    (settlement?.direction !== BookingAmendmentFinancialDirection.NONE ||
      settlement?.financialDeltaMinor !== 0n ||
      Boolean(settlement?.additionalPaymentId) ||
      Boolean(settlement?.refundId) ||
      Boolean(settlement?.ledgerTransactionId) ||
      pricing?.renterFinancialDeltaMinor !== 0n);
  const paidAuthority =
    mode === 'PAID' && settlement?.additionalPaymentId
      ? await paidApplicationAuthority(transaction, amendment)
      : false;
  const refundAuthority =
    mode === 'REFUND' ? await refundApplicationAuthority(transaction, amendment) : false;
  if (
    !pricing ||
    !amendment.fulfillmentSnapshot ||
    !settlement ||
    settlement.currency !== pricing.currency ||
    settlement.currentTotalMinor !== pricing.currentTotalMinor ||
    settlement.proposedTotalMinor !== pricing.proposedTotalMinor ||
    zeroDeltaInvalid ||
    (mode === 'PAID' && !paidAuthority) ||
    (mode === 'REFUND' && !refundAuthority)
  )
    fail('AMENDMENT_FINANCIAL_INVALID', 'Change financial authority is inconsistent.');
  const booking = amendment.booking;
  const activeExtension = amendment.scope === BookingAmendmentScope.ACTIVE_EXTENSION;
  if (
    activeExtension
      ? booking.status !== BookingStatus.ACTIVE ||
        !booking.actualPickupAt ||
        amendment.proposedRentalStart.getTime() !== booking.rentalStart.getTime() ||
        amendment.proposedRentalEnd <= booking.rentalEnd ||
        mode === 'REFUND'
      : ![BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP].includes(booking.status as never)
  )
    fail('BOOKING_LIFECYCLE_CONFLICT', 'Booking lifecycle no longer permits this change.');
  if (
    (!activeExtension && booking.actualPickupAt) ||
    booking.operationalHold ||
    booking.cancellationSettlement ||
    (!activeExtension && booking.pickupChallenges.some((item) => item.consumedAt)) ||
    booking.disputes.length ||
    booking.postReturnClaims.length ||
    (!activeExtension && evaluatedAt >= amendment.proposedRentalStart)
  )
    fail('BOOKING_LIFECYCLE_CONFLICT', 'Booking lifecycle no longer permits this change.');
  if (!booking.commissionSnapshot || !booking.ownerEarning)
    fail('BOOKING_FINANCIAL_INVALID', 'Booking financial authority is unavailable.');
  if (booking.ownerEarning.status !== 'PENDING' || booking.ownerEarning.payoutItems.length)
    fail('BOOKING_EARNING_ALREADY_ALLOCATED', 'Owner earning is no longer amendable.');
}

async function refundApplicationAuthority(
  transaction: Prisma.TransactionClient,
  amendment: ApplicationRecord,
) {
  const settlement = amendment.settlement;
  const pricing = amendment.pricingSnapshot;
  const refunds = settlement?.refunds.length
    ? settlement.refunds
    : settlement?.refund
      ? [settlement.refund]
      : [];
  const refundTotal = refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n);
  const sourcePaymentsValid = refunds.every((refund) => {
    const payment = amendment.booking.payments.find((item) => item.id === refund.paymentId);
    return (
      payment &&
      (payment.purpose === PaymentPurpose.RENTAL ||
        payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) &&
      new Set<PaymentStatus>([
        PaymentStatus.CAPTURED,
        PaymentStatus.PARTIALLY_REFUNDED,
        PaymentStatus.REFUNDED,
      ]).has(payment.status)
    );
  });
  if (
    amendment.status !== BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING ||
    amendment.operationallyExpiredAt ||
    !settlement ||
    !pricing ||
    settlement.direction !== BookingAmendmentFinancialDirection.REFUND ||
    settlement.financialDeltaMinor >= 0n ||
    settlement.status !== 'COMPLETED' ||
    !refunds.length ||
    refundTotal !== -settlement.financialDeltaMinor ||
    refundTotal !== -pricing.renterFinancialDeltaMinor ||
    refunds.some(
      (refund) =>
        refund.status !== RefundStatus.COMPLETED ||
        refund.currency !== settlement.currency ||
        refund.currency !== pricing.currency ||
        !refund.operation ||
        refund.operation.status !== 'SUCCEEDED',
    ) ||
    !sourcePaymentsValid
  )
    return false;
  const providerSettlements = await transaction.ledgerTransaction.findMany({
    where: {
      currency: settlement.currency,
      OR: [
        { sourceId: { in: refunds.map((refund) => refund.id) } },
        ...(settlement.refundId ? [{ sourceId: settlement.id }] : []),
      ],
      sourceType: 'BOOKING_AMENDMENT_REFUND',
      type: LedgerTransactionType.REFUND,
    },
  });
  const obligation = await transaction.ledgerTransaction.findFirst({
    where: {
      currency: settlement.currency,
      sourceId: amendment.id,
      sourceType: 'BOOKING_AMENDMENT_REFUND_OBLIGATION',
      type: LedgerTransactionType.ADJUSTMENT,
    },
  });
  return Boolean(providerSettlements.length === refunds.length && obligation);
}

async function paidApplicationAuthority(
  transaction: Prisma.TransactionClient,
  amendment: ApplicationRecord,
) {
  const settlement = amendment.settlement!;
  const pricing = amendment.pricingSnapshot!;
  if (!settlement.additionalPaymentId || !settlement.ledgerTransactionId) return false;
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "payments"
    WHERE "id" = ${settlement.additionalPaymentId!}::uuid
    FOR UPDATE
  `);
  const payment = await transaction.payment.findUnique({
    include: { operations: true },
    where: { id: settlement.additionalPaymentId! },
  });
  const authorized = hasBookingAmendmentPaidApplicationAuthority({
    amendmentBookingId: amendment.bookingId,
    amendmentStatus: amendment.status,
    direction: settlement.direction,
    payment,
    pricingCurrency: pricing.currency,
    pricingDeltaMinor: pricing.renterFinancialDeltaMinor,
    settlementCurrency: settlement.currency,
    settlementDeltaMinor: settlement.financialDeltaMinor,
  });
  if (!authorized || !payment) return false;
  const recognition = await transaction.ledgerTransaction.findFirst({
    where: {
      id: settlement.ledgerTransactionId,
      sourceId: payment.id,
      sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
      type: LedgerTransactionType.CAPTURE_RECOGNITION,
    },
  });
  return Boolean(recognition);
}

function assertHolds(amendment: ApplicationRecord, activeHolds: ApplicationRecord['holds']) {
  const current = amendment.booking.occupancy;
  if (!current) fail('BOOKING_OCCUPANCY_INVALID', 'Booking inventory authority is unavailable.');
  const expands =
    amendment.proposedRentalStart < current.occupiedStart ||
    amendment.proposedRentalEnd > current.occupiedEnd;
  if (expands && !activeHolds.length)
    fail('AMENDMENT_HOLD_MISSING', 'Required inventory protection is unavailable.');
  if (
    activeHolds.some(
      (hold) =>
        !hold.occupancy.active ||
        hold.occupancy.type !== VehicleOccupancyType.AMENDMENT_HOLD ||
        hold.occupancy.expiresAt?.getTime() !== hold.expiresAt.getTime(),
    )
  )
    fail('AMENDMENT_HOLD_INVALID', 'Required inventory protection is unavailable.');
}

async function applyOwnerFinancialAuthority(
  transaction: Prisma.TransactionClient,
  amendment: ApplicationRecord,
  evaluatedAt: Date,
  mode: 'PAID' | 'REFUND' | 'ZERO_DELTA',
  options: { failurePoint?: BookingAmendmentApplicationFailurePoint },
) {
  const pricing = amendment.pricingSnapshot!;
  const fulfillment = amendment.fulfillmentSnapshot!;
  const ownerEarning = amendment.booking.ownerEarning!;
  const evidence = jsonRecord(fulfillment.serviceabilitySnapshot);
  const delivery =
    amendment.proposedStartMethod === 'OWNER_DELIVERY'
      ? (bigintFromJson(evidence?.proposedDeliveryFeeMinor) ?? 0n)
      : 0n;
  const collection =
    amendment.proposedEndMethod === 'OWNER_COLLECTION'
      ? (bigintFromJson(evidence?.proposedCollectionFeeMinor) ?? 0n)
      : 0n;
  const rentalNet = pricing.proposedRentalSubtotalMinor - pricing.proposedCommissionMinor;
  if (rentalNet + delivery + collection !== pricing.proposedOwnerEarningsMinor)
    fail('AMENDMENT_FINANCIAL_INVALID', 'Owner earnings authority is inconsistent.');

  const commissionDelta = pricing.proposedCommissionMinor - pricing.currentCommissionMinor;
  const earningDelta = pricing.proposedOwnerEarningsMinor - pricing.currentOwnerEarningsMinor;
  const expectedDelta = mode === 'ZERO_DELTA' ? 0n : amendment.settlement!.financialDeltaMinor;
  if (commissionDelta + earningDelta !== expectedDelta)
    fail('AMENDMENT_FINANCIAL_INVALID', 'Amendment allocation does not conserve value.');
  if (commissionDelta !== 0n || earningDelta !== 0n || mode === 'PAID') {
    const accounts = await transaction.financialAccount.findMany({
      where: {
        active: true,
        currency: pricing.currency,
        type: {
          in: [
            ...(mode === 'REFUND' ? [FinancialAccountType.AMENDMENT_REFUND_SUSPENSE] : []),
            ...(mode === 'PAID' ? [FinancialAccountType.CUSTOMER_FUNDS_HELD] : []),
            FinancialAccountType.OWNER_PAYABLE,
            FinancialAccountType.PLATFORM_COMMISSION_REVENUE,
          ],
        },
      },
    });
    const account = (type: FinancialAccountType) => {
      const found = accounts.find((candidate) => candidate.type === type);
      if (!found)
        fail('FINANCIAL_ACCOUNT_MISSING', 'Financial allocation authority is unavailable.');
      return found.id;
    };
    await transaction.ledgerTransaction.create({
      data: {
        correlationId: amendment.correlationId ?? amendment.id,
        currency: pricing.currency,
        description:
          mode === 'PAID'
            ? 'Captured amendment payment allocated to owner and platform'
            : 'Zero-delta booking amendment allocation',
        entries: {
          create: [
            ...(mode === 'PAID'
              ? [
                  {
                    accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                    amountMinor: expectedDelta,
                    currency: pricing.currency,
                    memo: 'Allocate held amendment customer funds',
                  },
                ]
              : mode === 'REFUND'
                ? [
                    {
                      accountId: account(FinancialAccountType.AMENDMENT_REFUND_SUSPENSE),
                      amountMinor: expectedDelta,
                      currency: pricing.currency,
                      memo: 'Clear applied amendment refund suspense',
                    },
                  ]
                : []),
            {
              accountId: account(FinancialAccountType.OWNER_PAYABLE),
              amountMinor: -earningDelta,
              currency: pricing.currency,
              memo: 'Apply amended Owner earning authority',
            },
            {
              accountId: account(FinancialAccountType.PLATFORM_COMMISSION_REVENUE),
              amountMinor: -commissionDelta,
              currency: pricing.currency,
              memo: 'Apply amended commission authority',
            },
          ],
        },
        sourceId: amendment.id,
        sourceType: 'BOOKING_AMENDMENT',
        type:
          mode === 'PAID'
            ? LedgerTransactionType.CAPTURE_ALLOCATION
            : LedgerTransactionType.ADJUSTMENT,
      },
    });
  }
  await transaction.ownerEarning.update({
    data: {
      // The captured rental evidence is immutable. Amendments affect the
      // payout-facing total through the existing adjustment authority.
      adjustmentAmountMinor: { increment: earningDelta },
      lastFinancialResolutionAt: evaluatedAt,
    },
    where: { id: ownerEarning.id },
  });
  injectFailure(options, 'AFTER_OWNER_EARNINGS');
}

function injectFailure(
  options: { failurePoint?: BookingAmendmentApplicationFailurePoint },
  point: BookingAmendmentApplicationFailurePoint,
) {
  if (options.failurePoint === point)
    fail('APPLICATION_FAILURE_INJECTED', `Application failed at ${point}.`);
}

function appliedResult(amendment: ApplicationRecord): AppliedBookingAmendmentResult {
  if (!amendment.appliedAt)
    fail('AMENDMENT_APPLIED_INVALID', 'Applied change is missing its application timestamp.');
  return {
    amendmentId: amendment.id,
    appliedAt: amendment.appliedAt,
    bookingId: amendment.bookingId,
    bookingReference: amendment.booking.publicReference,
    rentalEnd: amendment.proposedRentalEnd,
    rentalStart: amendment.proposedRentalStart,
    status: 'APPLIED',
  };
}

function jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function bigintFromJson(value: Prisma.JsonValue | undefined): bigint | null {
  if (typeof value === 'string' && /^-?\d+$/u.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

function fail(code: string, message: string): never {
  throw new BookingAmendmentApplicationError(code, message);
}
