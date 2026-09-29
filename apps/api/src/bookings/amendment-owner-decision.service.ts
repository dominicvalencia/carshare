import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { BookingActorType, BookingAmendmentStatus, Prisma } from '@carrental/database';
import { BookingErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import { amendmentPaymentDeadline } from './booking-amendment-foundation';
import { OutboxService } from './outbox.service';

const OWNER_AMENDMENT_INCLUDE = {
  booking: {
    select: {
      id: true,
      ownerUserId: true,
      publicReference: true,
      rentalEnd: true,
      rentalStart: true,
    },
  },
  fulfillmentSnapshot: true,
  holds: { include: { occupancy: true }, orderBy: { protectedStart: 'asc' as const } },
  pricingSnapshot: true,
  settlement: true,
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
} satisfies Prisma.BookingAmendmentInclude;

type OwnerAmendment = Prisma.BookingAmendmentGetPayload<{
  include: typeof OWNER_AMENDMENT_INCLUDE;
}>;
type Decision = 'ACCEPT' | 'DECLINE';

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
    return { items: records.map((record) => this.project(record)) };
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
          await transaction.$queryRaw(Prisma.sql`
          SELECT amendment."id"
          FROM "booking_amendments" amendment
          INNER JOIN "bookings" booking ON booking."id" = amendment."booking_id"
          WHERE amendment."id" = ${amendmentId}::uuid
            AND booking."public_reference" = ${bookingReference}
            AND booking."owner_user_id" = ${ownerUserId}::uuid
          FOR UPDATE OF amendment
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
          const nextStatus =
            financial === 'ADDITIONAL_PAYMENT'
              ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
              : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING;
          const paymentDeadlineAt =
            financial === 'ADDITIONAL_PAYMENT'
              ? amendmentPaymentDeadline(
                  evaluatedAt,
                  this.configuration.getOrThrow('AMENDMENT_PAYMENT_DEADLINE_MINUTES', {
                    infer: true,
                  }),
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

  private project(record: OwnerAmendment) {
    const delta = record.settlement!.financialDeltaMinor;
    return {
      acceptedAt: record.acceptedAt?.toISOString() ?? null,
      actionable: record.status === BookingAmendmentStatus.PENDING_OWNER,
      amendmentReference: record.id,
      bookingReference: record.booking.publicReference,
      createdAt: record.createdAt.toISOString(),
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
      proposed: {
        fulfillmentTotalMinor: record.fulfillmentSnapshot!.proposedFulfillmentTotalMinor.toString(),
        rentalEnd: record.proposedRentalEnd.toISOString(),
        rentalStart: record.proposedRentalStart.toISOString(),
        startMethod: record.proposedStartMethod,
        endMethod: record.proposedEndMethod,
        totalMinor: record.pricingSnapshot!.proposedTotalMinor.toString(),
      },
      reasonCode: record.reasonCode,
      status: record.status,
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
