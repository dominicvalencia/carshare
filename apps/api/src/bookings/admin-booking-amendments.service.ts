import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingAmendmentStatus, Prisma } from '@carrental/database';
import { BookingErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { AdminBookingAmendmentQueryDto } from './admin-booking-amendments.dto';

const person = {
  email: true,
  id: true,
  profile: { select: { displayName: true, firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as T;
}

@Injectable()
export class AdminBookingAmendmentsService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: AdminBookingAmendmentQueryDto) {
    const search = query.query?.trim();
    const searchIsUuid = Boolean(
      search &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search),
    );
    const where: Prisma.BookingAmendmentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.bookingStatus ? { booking: { status: query.bookingStatus } } : {}),
      ...(query.direction || query.reconciliationRequired !== undefined
        ? {
            settlement: {
              ...(query.direction ? { direction: query.direction } : {}),
              ...(query.reconciliationRequired !== undefined
                ? { reconciliationRequired: query.reconciliationRequired === 'true' }
                : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              ...(searchIsUuid ? [{ id: { equals: search } }] : []),
              { booking: { publicReference: { contains: search, mode: 'insensitive' } } },
              { booking: { renter: { email: { contains: search, mode: 'insensitive' } } } },
              {
                booking: {
                  renter: { profile: { displayName: { contains: search, mode: 'insensitive' } } },
                },
              },
              { booking: { owner: { email: { contains: search, mode: 'insensitive' } } } },
              {
                booking: {
                  owner: { profile: { displayName: { contains: search, mode: 'insensitive' } } },
                },
              },
              { booking: { vehicle: { make: { contains: search, mode: 'insensitive' } } } },
              { booking: { vehicle: { model: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, items] = await this.database.client.$transaction([
      this.database.client.bookingAmendment.count({ where }),
      this.database.client.bookingAmendment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
        select: {
          acceptedAt: true,
          booking: {
            select: {
              owner: { select: person },
              publicReference: true,
              renter: { select: person },
              status: true,
              vehicle: { select: { id: true, make: true, model: true, modelYear: true } },
            },
          },
          createdAt: true,
          id: true,
          operationallyExpiredAt: true,
          scope: true,
          settlement: { select: { direction: true, reconciliationRequired: true, status: true } },
          status: true,
        },
      }),
    ]);
    return serialize({
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    });
  }

  async detail(id: string) {
    const amendment = await this.database.client.bookingAmendment.findUnique({
      where: { id },
      include: {
        booking: {
          include: {
            cancellationSettlement: true,
            fulfillmentSnapshot: true,
            owner: { select: person },
            ownerEarning: {
              include: {
                holds: true,
                payoutItems: {
                  include: {
                    payout: { select: { id: true, publicReference: true, status: true } },
                  },
                },
              },
            },
            pricingSnapshot: true,
            renter: { select: person },
            vehicle: { select: { id: true, make: true, model: true, modelYear: true } },
          },
        },
        fulfillmentSnapshot: true,
        holds: { include: { occupancy: true }, orderBy: { createdAt: 'asc' } },
        pricingSnapshot: true,
        requester: { select: person },
        settlement: {
          include: {
            refund: { include: { operation: true, payment: true } },
            refunds: {
              include: { operation: true, payment: true },
              orderBy: { amendmentAllocationIndex: 'asc' },
            },
            refundResolutionEvidence: { orderBy: { evidenceAt: 'asc' } },
          },
        },
        statusHistory: {
          include: { actorUser: { select: person } },
          orderBy: { occurredAt: 'asc' },
        },
      },
    });
    if (!amendment)
      throw new ApplicationException(
        BookingErrorCode.BOOKING_NOT_FOUND,
        'Booking amendment not found.',
        HttpStatus.NOT_FOUND,
      );

    const additionalPayment = amendment.settlement?.additionalPaymentId
      ? await this.database.client.payment.findUnique({
          where: { id: amendment.settlement.additionalPaymentId },
          include: { operations: { orderBy: { createdAt: 'asc' } } },
        })
      : null;
    const ledgerIds = [amendment.settlement?.ledgerTransactionId].filter((id): id is string =>
      Boolean(id),
    );
    const ledger = await this.database.client.ledgerTransaction.findMany({
      where: {
        OR: [
          ...(ledgerIds.length ? [{ id: { in: ledgerIds } }] : []),
          { sourceId: amendment.id },
          ...(amendment.settlement?.refundId ? [{ sourceId: amendment.settlement.refundId }] : []),
          ...(amendment.settlement?.refunds.length
            ? [{ sourceId: { in: amendment.settlement.refunds.map((refund) => refund.id) } }]
            : []),
        ],
      },
      include: { entries: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: { postedAt: 'asc' },
    });
    const manualResolutionEligible = Boolean(
      (amendment.settlement?.refundId || amendment.settlement?.refunds.length) &&
      amendment.settlement.reconciliationRequired &&
      amendment.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    );
    return serialize({ additionalPayment, amendment, ledger, manualResolutionEligible });
  }
}
