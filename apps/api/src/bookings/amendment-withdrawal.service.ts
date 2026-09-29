import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingErrorCode } from '@carrental/api-contracts';
import { BookingActorType, BookingAmendmentStatus, Prisma } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import { OutboxService } from './outbox.service';

type LockedAmendment = {
  bookingId: string;
  correlationId: string | null;
  id: string;
  requesterUserId: string;
  status: BookingAmendmentStatus;
  withdrawnAt: Date | null;
};

@Injectable()
export class AmendmentWithdrawalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly outbox: OutboxService,
  ) {}

  async withdrawRenter(
    renterUserId: string,
    bookingReference: string,
    amendmentReference: string,
    request: RequestMetadata,
  ) {
    let amendmentId: string;
    try {
      amendmentId = await this.database.client.$transaction(
        async (transaction) => {
          const rows = await transaction.$queryRaw<LockedAmendment[]>(Prisma.sql`
          SELECT
            amendment."id",
            amendment."booking_id" AS "bookingId",
            amendment."requester_user_id" AS "requesterUserId",
            amendment."status",
            amendment."withdrawn_at" AS "withdrawnAt",
            amendment."correlation_id" AS "correlationId"
          FROM "booking_amendments" amendment
          INNER JOIN "bookings" booking ON booking."id" = amendment."booking_id"
          WHERE amendment."id" = ${amendmentReference}::uuid
            AND booking."public_reference" = ${bookingReference}
            AND booking."renter_user_id" = ${renterUserId}::uuid
            AND amendment."requester_user_id" = ${renterUserId}::uuid
          FOR UPDATE OF amendment
        `);
          const amendment = rows[0];
          if (!amendment) this.notFound();
          if (amendment.status === BookingAmendmentStatus.WITHDRAWN) return amendment.id;
          if (amendment.status !== BookingAmendmentStatus.PENDING_OWNER)
            throw new ApplicationException(
              BookingErrorCode.BOOKING_INVALID_STATE,
              'This change request can no longer be withdrawn.',
              HttpStatus.CONFLICT,
            );

          const withdrawnAt = new Date();
          await transaction.bookingAmendment.update({
            data: {
              reasonCode: 'RENTER_WITHDREW_REQUEST',
              status: BookingAmendmentStatus.WITHDRAWN,
              withdrawnAt,
            },
            where: { id: amendment.id },
          });
          await transaction.$queryRaw(Prisma.sql`
          SELECT "release_booking_amendment_holds"(
            ${amendment.id}::uuid,
            'RELEASED'::"BookingAmendmentHoldStatus",
            'RENTER_WITHDREW_REQUEST'
          )
        `);
          const correlationId = request.correlationId ?? amendment.correlationId ?? amendment.id;
          await transaction.bookingAmendmentStatusHistory.create({
            data: {
              actorType: BookingActorType.USER,
              actorUserId: renterUserId,
              amendmentId: amendment.id,
              correlationId,
              fromStatus: BookingAmendmentStatus.PENDING_OWNER,
              idempotencyKey: `booking-amendment-withdrawal:${amendment.id}`,
              reasonCode: 'RENTER_WITHDREW_REQUEST',
              toStatus: BookingAmendmentStatus.WITHDRAWN,
            },
          });
          await this.outbox.write(transaction, {
            aggregateId: amendment.bookingId,
            eventType: 'BOOKING_AMENDMENT_WITHDRAWN',
            payload: {
              amendmentId: amendment.id,
              bookingId: amendment.bookingId,
              correlationId,
              requesterUserId: renterUserId,
              status: BookingAmendmentStatus.WITHDRAWN,
            },
          });
          return amendment.id;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );
    } catch (error) {
      if (this.isSerializationFailure(error))
        throw new ApplicationException(
          BookingErrorCode.BOOKING_INVALID_STATE,
          'This change request was decided concurrently. Refresh to see its current state.',
          HttpStatus.CONFLICT,
        );
      throw error;
    }
    const result = await this.database.client.bookingAmendment.findUniqueOrThrow({
      select: { id: true, status: true, updatedAt: true, withdrawnAt: true },
      where: { id: amendmentId },
    });
    return {
      amendmentReference: result.id,
      status: result.status,
      updatedAt: result.updatedAt.toISOString(),
      withdrawnAt: result.withdrawnAt?.toISOString() ?? null,
    };
  }

  private notFound(): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_NOT_FOUND,
      'Booking change request not found.',
      HttpStatus.NOT_FOUND,
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
}
