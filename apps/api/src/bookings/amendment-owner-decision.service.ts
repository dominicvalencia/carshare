import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingAmendmentStatus,
  BookingStatus,
  Prisma,
} from '@carrental/database';
import { BookingErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import { amendmentPaymentDeadline } from './booking-amendment-foundation';
import { OutboxService } from './outbox.service';
import {
  OwnerAmendmentListScope,
  type OwnerBookingAmendmentQueryDto,
} from './owner-booking-amendments.dto';

const OWNER_AMENDMENT_INCLUDE = {
  booking: {
    select: {
      id: true,
      actualPickupAt: true,
      ownerUserId: true,
      publicReference: true,
      rentalEnd: true,
      rentalStart: true,
      renter: { select: { profile: { select: { displayName: true, firstName: true } } } },
      status: true,
      vehicle: { select: { make: true, model: true } },
    },
  },
  fulfillmentSnapshot: true,
  holds: { include: { occupancy: true }, orderBy: { protectedStart: 'asc' as const } },
  pricingSnapshot: true,
  settlement: { include: { refund: { include: { operation: true } } } },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
} satisfies Prisma.BookingAmendmentInclude;

type OwnerAmendment = Prisma.BookingAmendmentGetPayload<{
  include: typeof OWNER_AMENDMENT_INCLUDE;
}>;
type Decision = 'ACCEPT' | 'DECLINE';

export const ownerVisibleAmendmentStatuses: readonly BookingAmendmentStatus[] = [
  BookingAmendmentStatus.PENDING_OWNER,
  BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
  BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
  BookingAmendmentStatus.APPLIED,
  BookingAmendmentStatus.DECLINED,
  BookingAmendmentStatus.WITHDRAWN,
  BookingAmendmentStatus.EXPIRED,
  BookingAmendmentStatus.FAILED,
  BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
];

export const ownerUpcomingAmendmentStatuses: readonly BookingAmendmentStatus[] = [
  BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
  BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
  BookingAmendmentStatus.APPLIED,
  BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
];

export const ownerUpcomingBookingStatuses: readonly BookingStatus[] = [
  BookingStatus.CAPTURE_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.READY_FOR_PICKUP,
  BookingStatus.ACTIVE,
  BookingStatus.RETURN_PENDING,
];

@Injectable()
export class AmendmentOwnerDecisionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly outbox: OutboxService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async list(ownerUserId: string) {
    const records = await this.database.client.bookingAmendment.findMany({
      include: OWNER_AMENDMENT_INCLUDE,
      where: {
        booking: { ownerUserId },
        fulfillmentSnapshot: { isNot: null },
        pricingSnapshot: { isNot: null },
        settlement: { isNot: null },
        status: BookingAmendmentStatus.PENDING_OWNER,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { items: await Promise.all(records.map((record) => this.project(record))) };
  }

  async listOwnerHistory(ownerUserId: string, query: OwnerBookingAmendmentQueryDto) {
    const where: Prisma.BookingAmendmentWhereInput = {
      booking: {
        ownerUserId,
        ...(query.scope === OwnerAmendmentListScope.UPCOMING
          ? { status: { in: [...ownerUpcomingBookingStatuses] } }
          : {}),
      },
      fulfillmentSnapshot: { isNot: null },
      pricingSnapshot: { isNot: null },
      settlement: { isNot: null },
      ...(query.scope === OwnerAmendmentListScope.NEEDS_RESPONSE
        ? { status: BookingAmendmentStatus.PENDING_OWNER }
        : query.scope === OwnerAmendmentListScope.UPCOMING
          ? { status: { in: [...ownerUpcomingAmendmentStatuses] } }
          : { status: { in: [...ownerVisibleAmendmentStatuses] } }),
    };
    const [total, records] = await this.database.client.$transaction([
      this.database.client.bookingAmendment.count({ where }),
      this.database.client.bookingAmendment.findMany({
        include: OWNER_AMENDMENT_INCLUDE,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
    ]);
    return {
      items: await Promise.all(records.map((record) => this.project(record))),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async detail(ownerUserId: string, bookingReference: string, amendmentId: string) {
    const record = await this.findOwned(ownerUserId, bookingReference, amendmentId);
    if (!record) this.notFound();
    return this.project(record);
  }

  accept(
    ownerUserId: string,
    bookingReference: string,
    amendmentId: string,
    idempotencyKey: string,
    request: RequestMetadata,
    evaluatedAt = new Date(),
  ) {
    return this.decide(
      ownerUserId,
      bookingReference,
      amendmentId,
      idempotencyKey,
      'ACCEPT',
      null,
      request,
      evaluatedAt,
    );
  }

  decline(
    ownerUserId: string,
    bookingReference: string,
    amendmentId: string,
    idempotencyKey: string,
    reasonCode: string,
    request: RequestMetadata,
    evaluatedAt = new Date(),
  ) {
    return this.decide(
      ownerUserId,
      bookingReference,
      amendmentId,
      idempotencyKey,
      'DECLINE',
      reasonCode,
      request,
      evaluatedAt,
    );
  }

  private async decide(
    ownerUserId: string,
    bookingReference: string,
    amendmentId: string,
    idempotencyKey: string,
    decision: Decision,
    declineReason: string | null,
    request: RequestMetadata,
    evaluatedAt: Date,
    serializationAttempt = 0,
  ): Promise<ReturnType<AmendmentOwnerDecisionService['project']>> {
    const historyKey = `booking-amendment-owner-decision:${amendmentId}:${idempotencyKey}`;
    let outcome: { id: string; staleExpired: boolean };
    try {
      outcome = await this.database.client.$transaction(
        async (transaction) => {
          const lockedBookings = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT booking."id"
          FROM "bookings" booking
          WHERE booking."public_reference" = ${bookingReference}
            AND booking."owner_user_id" = ${ownerUserId}::uuid
          FOR UPDATE
        `);
          if (!lockedBookings[0]) this.notFound();
          await transaction.$queryRaw(Prisma.sql`
          SELECT amendment."id"
          FROM "booking_amendments" amendment
          WHERE amendment."id" = ${amendmentId}::uuid
            AND amendment."booking_id" = ${lockedBookings[0].id}::uuid
          FOR UPDATE
        `);
          const amendment = await transaction.bookingAmendment.findFirst({
            include: OWNER_AMENDMENT_INCLUDE,
            where: { id: amendmentId, booking: { ownerUserId, publicReference: bookingReference } },
          });
          if (!amendment) this.notFound();

          const replay = amendment.statusHistory.find((item) => item.idempotencyKey === historyKey);
          if (replay) {
            const replayDecision =
              replay.toStatus === BookingAmendmentStatus.DECLINED ? 'DECLINE' : 'ACCEPT';
            if (
              replayDecision !== decision ||
              (decision === 'DECLINE' && replay.reasonCode !== declineReason)
            )
              this.idempotencyConflict();
            return { id: amendment.id, staleExpired: false };
          }
          if (amendment.status !== BookingAmendmentStatus.PENDING_OWNER)
            throw new ApplicationException(
              BookingErrorCode.BOOKING_INVALID_STATE,
              'This change request is no longer awaiting an Owner decision.',
              HttpStatus.CONFLICT,
            );
          const activeExtension = amendment.scope === 'ACTIVE_EXTENSION';
          if (
            activeExtension
              ? amendment.booking.status !== BookingStatus.ACTIVE ||
                !amendment.booking.actualPickupAt ||
                amendment.proposedRentalStart.getTime() !==
                  amendment.booking.rentalStart.getTime() ||
                amendment.proposedRentalEnd <= amendment.booking.rentalEnd
              : (amendment.booking.status !== BookingStatus.CONFIRMED &&
                  amendment.booking.status !== BookingStatus.READY_FOR_PICKUP) ||
                Boolean(amendment.booking.actualPickupAt)
          )
            throw new ApplicationException(
              BookingErrorCode.BOOKING_INVALID_STATE,
              'This booking can no longer accept the requested change.',
              HttpStatus.CONFLICT,
            );

          if (evaluatedAt.getTime() >= amendment.expiresAt.getTime()) {
            await transaction.bookingAmendment.update({
              data: {
                expiredAt: evaluatedAt,
                reasonCode: 'OWNER_RESPONSE_DEADLINE_EXPIRED',
                status: BookingAmendmentStatus.EXPIRED,
              },
              where: { id: amendment.id },
            });
            await transaction.$queryRaw(Prisma.sql`
            SELECT "release_booking_amendment_holds"(
              ${amendment.id}::uuid,
              'EXPIRED'::"BookingAmendmentHoldStatus",
              'OWNER_RESPONSE_DEADLINE_EXPIRED'
            )
          `);
            await transaction.bookingAmendmentStatusHistory.create({
              data: {
                actorType: BookingActorType.SYSTEM,
                amendmentId: amendment.id,
                correlationId: request.correlationId ?? amendment.correlationId,
                fromStatus: BookingAmendmentStatus.PENDING_OWNER,
                idempotencyKey: `booking-amendment-expiry:${amendment.id}:EXPIRED`,
                reasonCode: 'OWNER_RESPONSE_DEADLINE_EXPIRED',
                toStatus: BookingAmendmentStatus.EXPIRED,
              },
            });
            await this.outbox.write(transaction, {
              aggregateId: amendment.bookingId,
              eventType: 'BOOKING_AMENDMENT_TERMINATED',
              payload: {
                amendmentId: amendment.id,
                bookingId: amendment.bookingId,
                reasonCode: 'OWNER_RESPONSE_DEADLINE_EXPIRED',
                status: BookingAmendmentStatus.EXPIRED,
              },
            });
            return { id: amendment.id, staleExpired: true };
          }

          const correlationId = request.correlationId ?? amendment.correlationId ?? amendment.id;
          if (decision === 'DECLINE') {
            await transaction.bookingAmendment.update({
              data: {
                declinedAt: evaluatedAt,
                reasonCode: declineReason,
                status: BookingAmendmentStatus.DECLINED,
              },
              where: { id: amendment.id },
            });
            await transaction.$queryRaw(Prisma.sql`
            SELECT "release_booking_amendment_holds"(
              ${amendment.id}::uuid,
              'RELEASED'::"BookingAmendmentHoldStatus",
              'OWNER_DECLINED_AMENDMENT'
            )
          `);
            await this.recordDecision(
              transaction,
              amendment,
              BookingAmendmentStatus.DECLINED,
              declineReason,
              historyKey,
              correlationId,
              ownerUserId,
            );
            return { id: amendment.id, staleExpired: false };
          }

          const financial = this.classify(amendment);
          if (activeExtension && financial === 'REFUND') this.corruptFinancialAuthority();
          const nextStatus =
            financial === 'ADDITIONAL_PAYMENT'
              ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
              : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING;
          const paymentDeadlineAt =
            financial === 'ADDITIONAL_PAYMENT'
              ? new Date(
                  Math.min(
                    amendmentPaymentDeadline(
                      evaluatedAt,
                      this.configuration.getOrThrow('AMENDMENT_PAYMENT_DEADLINE_MINUTES', {
                        infer: true,
                      }),
                    ).getTime(),
                    activeExtension
                      ? amendment.booking.rentalEnd.getTime()
                      : Number.POSITIVE_INFINITY,
                  ),
                )
              : null;

          this.assertRequiredHolds(amendment);
          if (paymentDeadlineAt) {
            const activeHolds = amendment.holds.filter((hold) => hold.status === 'ACTIVE');
            for (const hold of activeHolds) {
              await transaction.vehicleOccupancy.update({
                data: { expiresAt: paymentDeadlineAt },
                where: { id: hold.occupancyId },
              });
              await transaction.bookingAmendmentHold.update({
                data: { expiresAt: paymentDeadlineAt },
                where: { id: hold.id },
              });
            }
          }
          await transaction.bookingAmendment.update({
            data: { acceptedAt: evaluatedAt, paymentDeadlineAt, status: nextStatus },
            where: { id: amendment.id },
          });
          await this.recordDecision(
            transaction,
            amendment,
            nextStatus,
            financial === 'ADDITIONAL_PAYMENT'
              ? 'OWNER_ACCEPTED_PAYMENT_REQUIRED'
              : 'OWNER_ACCEPTED_PROCESSING',
            historyKey,
            correlationId,
            ownerUserId,
            financial,
            paymentDeadlineAt,
          );
          return { id: amendment.id, staleExpired: false };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );
    } catch (error) {
      if (this.isSerializationFailure(error) && serializationAttempt === 0)
        return this.decide(
          ownerUserId,
          bookingReference,
          amendmentId,
          idempotencyKey,
          decision,
          declineReason,
          request,
          evaluatedAt,
          serializationAttempt + 1,
        );
      if (this.isSerializationFailure(error))
        throw new ApplicationException(
          BookingErrorCode.BOOKING_INVALID_STATE,
          'This change request was decided concurrently. Refresh to see its current state.',
          HttpStatus.CONFLICT,
        );
      throw error;
    }

    if (outcome.staleExpired)
      throw new ApplicationException(
        BookingErrorCode.BOOKING_INVALID_STATE,
        'This change request expired before the Owner decision was received.',
        HttpStatus.CONFLICT,
      );
    const record = await this.database.client.bookingAmendment.findUniqueOrThrow({
      include: OWNER_AMENDMENT_INCLUDE,
      where: { id: outcome.id },
    });
    return this.project(record);
  }

  private async recordDecision(
    transaction: Prisma.TransactionClient,
    amendment: OwnerAmendment,
    toStatus: BookingAmendmentStatus,
    reasonCode: string | null,
    historyKey: string,
    correlationId: string,
    ownerUserId: string,
    financialOutcome?: 'ADDITIONAL_PAYMENT' | 'REFUND' | 'ZERO_DELTA',
    paymentDeadlineAt?: Date | null,
  ) {
    await transaction.bookingAmendmentStatusHistory.create({
      data: {
        actorType: BookingActorType.USER,
        actorUserId: ownerUserId,
        amendmentId: amendment.id,
        correlationId,
        fromStatus: BookingAmendmentStatus.PENDING_OWNER,
        idempotencyKey: historyKey,
        reasonCode,
        toStatus,
      },
    });
    await this.outbox.write(transaction, {
      aggregateId: amendment.bookingId,
      eventType:
        toStatus === BookingAmendmentStatus.DECLINED
          ? 'BOOKING_AMENDMENT_DECLINED'
          : 'BOOKING_AMENDMENT_ACCEPTED',
      payload: {
        amendmentId: amendment.id,
        bookingId: amendment.bookingId,
        correlationId,
        ...(financialOutcome ? { financialOutcome } : {}),
        ...(paymentDeadlineAt ? { paymentDeadlineAt: paymentDeadlineAt.toISOString() } : {}),
        status: toStatus,
      },
    });
  }

  private classify(amendment: OwnerAmendment) {
    const settlement = amendment.settlement;
    if (
      !settlement ||
      settlement.financialDeltaMinor !==
        settlement.proposedTotalMinor - settlement.currentTotalMinor
    )
      this.corruptFinancialAuthority();
    if (settlement.financialDeltaMinor > 0n && settlement.direction === 'ADDITIONAL_PAYMENT')
      return 'ADDITIONAL_PAYMENT' as const;
    if (settlement.financialDeltaMinor < 0n && settlement.direction === 'REFUND')
      return 'REFUND' as const;
    if (settlement.financialDeltaMinor === 0n && settlement.direction === 'NONE')
      return 'ZERO_DELTA' as const;
    return this.corruptFinancialAuthority();
  }

  private assertRequiredHolds(amendment: OwnerAmendment) {
    const requiresStart = amendment.proposedRentalStart < amendment.booking.rentalStart;
    const requiresEnd = amendment.proposedRentalEnd > amendment.booking.rentalEnd;
    if (!requiresStart && !requiresEnd) return;
    const active = amendment.holds.filter((hold) => hold.status === 'ACTIVE');
    if (
      !active.length ||
      active.some(
        (hold) =>
          !hold.occupancy.active ||
          hold.occupancy.expiresAt?.getTime() !== hold.expiresAt.getTime(),
      )
    )
      throw new ApplicationException(
        BookingErrorCode.BOOKING_INVALID_STATE,
        'The inventory protection for this change request is no longer valid.',
        HttpStatus.CONFLICT,
      );
  }

  private isSerializationFailure(error: unknown) {
    const value = String(
      error instanceof Error ? `${error.name} ${error.message} ${JSON.stringify(error)}` : error,
    );
    return (
      value.includes('40001') ||
      value.includes('P2034') ||
      value.includes('could not serialize') ||
      value.includes('write conflict') ||
      value.includes('deadlock') ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
    );
  }

  private findOwned(ownerUserId: string, bookingReference: string, amendmentId: string) {
    return this.database.client.bookingAmendment.findFirst({
      include: OWNER_AMENDMENT_INCLUDE,
      where: { id: amendmentId, booking: { ownerUserId, publicReference: bookingReference } },
    });
  }

  private async project(record: OwnerAmendment) {
    const payment = record.settlement?.additionalPaymentId
      ? await this.database.client.payment.findUnique({
          select: { reconciliationRequired: true, status: true },
          where: { id: record.settlement.additionalPaymentId },
        })
      : null;
    const delta = record.settlement!.financialDeltaMinor;
    return {
      acceptedAt: record.acceptedAt?.toISOString() ?? null,
      appliedAt: record.appliedAt?.toISOString() ?? null,
      actionable: record.status === BookingAmendmentStatus.PENDING_OWNER,
      amendmentReference: record.id,
      bookingReference: record.booking.publicReference,
      bookingStatus: record.booking.status,
      renterDisplayName:
        record.booking.renter.profile?.displayName ??
        record.booking.renter.profile?.firstName ??
        'Renter',
      vehicleName:
        [record.booking.vehicle.make, record.booking.vehicle.model].filter(Boolean).join(' ') ||
        'Vehicle',
      createdAt: record.createdAt.toISOString(),
      closedAt:
        record.declinedAt?.toISOString() ??
        record.withdrawnAt?.toISOString() ??
        record.expiredAt?.toISOString() ??
        record.failedAt?.toISOString() ??
        null,
      current: {
        fulfillmentTotalMinor: record.fulfillmentSnapshot!.currentFulfillmentTotalMinor.toString(),
        rentalEnd: record.booking.rentalEnd.toISOString(),
        rentalStart: record.booking.rentalStart.toISOString(),
        startMethod: record.fulfillmentSnapshot!.currentStartMethod,
        endMethod: record.fulfillmentSnapshot!.currentEndMethod,
        totalMinor: record.pricingSnapshot!.currentTotalMinor.toString(),
      },
      expiresAt: record.expiresAt.toISOString(),
      financial: {
        additionalPaymentMinor: delta > 0n ? delta.toString() : '0',
        currency: record.settlement!.currency,
        currentOwnerEarningsMinor: record.pricingSnapshot!.currentOwnerEarningsMinor.toString(),
        expectedRefundMinor: delta < 0n ? (-delta).toString() : '0',
        ownerEarningsDeltaMinor: record.pricingSnapshot!.ownerEarningsDeltaMinor.toString(),
        proposedOwnerEarningsMinor: record.pricingSnapshot!.proposedOwnerEarningsMinor.toString(),
      },
      paymentDeadlineAt: record.paymentDeadlineAt?.toISOString() ?? null,
      paymentInitiationAllowed: false,
      paymentState:
        record.status === BookingAmendmentStatus.APPLIED
          ? null
          : payment?.status === 'CAPTURED'
            ? 'PAYMENT_RECEIVED_AWAITING_APPLICATION'
            : payment
              ? payment.reconciliationRequired
                ? 'PAYMENT_VERIFYING'
                : 'PAYMENT_PROCESSING'
              : null,
      refundState:
        delta >= 0n || record.status === BookingAmendmentStatus.APPLIED
          ? null
          : record.settlement?.refund?.status === 'COMPLETED'
            ? record.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING
              ? 'FINANCIAL_RECOVERY_SETTLED'
              : 'REFUND_COMPLETED_AWAITING_APPLICATION'
            : record.settlement?.refund?.operation?.status === 'UNKNOWN'
              ? 'REFUND_VERIFYING'
              : record.settlement?.refund?.operation?.status === 'FAILED'
                ? 'MANUAL_RECONCILIATION_REQUIRED'
                : 'REFUND_PROCESSING',
      proposed: {
        fulfillmentTotalMinor: record.fulfillmentSnapshot!.proposedFulfillmentTotalMinor.toString(),
        rentalEnd: record.proposedRentalEnd.toISOString(),
        rentalStart: record.proposedRentalStart.toISOString(),
        startMethod: record.proposedStartMethod,
        endMethod: record.proposedEndMethod,
        totalMinor: record.pricingSnapshot!.proposedTotalMinor.toString(),
      },
      reasonCode: record.reasonCode,
      scope: record.scope,
      status: record.status,
      history: record.statusHistory.map((item) => ({
        actorType: item.actorType,
        fromStatus: item.fromStatus,
        occurredAt: item.occurredAt.toISOString(),
        reasonCode: item.reasonCode,
        toStatus: item.toStatus,
      })),
    };
  }

  private notFound(): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_NOT_FOUND,
      'Booking change request not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private idempotencyConflict(): never {
    throw new ApplicationException(
      BookingErrorCode.IDEMPOTENCY_KEY_CONFLICT,
      'This idempotency key was already used with a different decision.',
      HttpStatus.CONFLICT,
    );
  }

  private corruptFinancialAuthority(): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_INVALID_STATE,
      'The submitted financial authority is inconsistent.',
      HttpStatus.CONFLICT,
    );
  }
}
