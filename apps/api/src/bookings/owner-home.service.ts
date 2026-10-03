import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingAmendmentStatus,
  BookingStatus,
  FileAssetStatus,
  FileClassification,
  Prisma,
  type EndFulfillmentMethod,
  type StartFulfillmentMethod,
} from '@carrental/database';
import { OwnersService } from '../owners/owners.service';
import { manilaTodayWindow, OWNER_AVAILABILITY_TIMEZONE } from '../vehicles/owner-availability';
import { workflowCompliance } from '../rentals/workflow-compliance';
import type { OwnerHomeUpcomingQueryDto } from './owner-home.dto';
import {
  ownerActionableAmendmentWhere,
  ownerActionableBookingWhere,
} from './owner-request-actionability';
import { DatabaseService } from '../infrastructure/database/database.service';
import { FilesService } from '../files/files.service';

const TODAY_CARD_LIMIT = 20;
const operationalStatuses = [
  BookingStatus.CONFIRMED,
  BookingStatus.READY_FOR_PICKUP,
  BookingStatus.ACTIVE,
  BookingStatus.RETURN_PENDING,
] as const;
const upcomingStatuses = [BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP] as const;

const ownerHomeBookingInclude = {
  disputes: { select: { blocksCompletion: true, status: true } },
  fulfillmentSnapshot: true,
  handoverEvidenceWaivers: { select: { phase: true } },
  handoverTravelEvents: { select: { phase: true, status: true } },
  inspections: {
    include: {
      confirmations: {
        include: {
          discrepancyResponses: {
            include: { resolutionReview: { include: { operationsResolution: true } } },
            orderBy: { roundNumber: 'asc' as const },
          },
        },
      },
    },
    orderBy: { version: 'asc' as const },
    where: { status: 'FINALIZED' as const },
  },
  pickupHandoverResponse: { select: { decision: true } },
  rentalIncidents: { select: { blocksCompletion: true, status: true } },
  renter: { select: { profile: { select: { displayName: true, firstName: true } } } },
  vehicle: { select: { make: true, model: true, operationalStatus: true } },
} satisfies Prisma.BookingInclude;

const ownerHomeUpcomingInclude = {
  ...ownerHomeBookingInclude,
  vehicle: {
    select: {
      ...ownerHomeBookingInclude.vehicle.select,
      photos: {
        orderBy: [{ displayOrder: 'asc' as const }, { id: 'asc' as const }],
        select: {
          fileAsset: { select: { classification: true, id: true, status: true } },
        },
        take: 1,
        where: { isCover: true, removedAt: null },
      },
    },
  },
} satisfies Prisma.BookingInclude;

type OwnerHomeBooking = Prisma.BookingGetPayload<{ include: typeof ownerHomeBookingInclude }>;
type OwnerHomeAttention = {
  bookingReference: string;
  deepLinkTarget: { bookingReference: string; route: 'Booking' };
  renterDisplayName: string;
  severity: 'WARNING';
  timestamp: Date | null;
  titleCode: string;
  type: 'OVERDUE_PICKUP' | 'OVERDUE_RETURN' | 'OPERATIONAL_HOLD' | 'FINANCIAL_RECOVERY';
  vehicleMake: string;
  vehicleModel: string;
};

@Injectable()
export class OwnerHomeService {
  constructor(
    private readonly database: DatabaseService,
    private readonly owners: OwnersService,
    private readonly files: FilesService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async today(ownerUserId: string, now = new Date()) {
    await this.owners.assertOperational(ownerUserId);
    const { startInclusive, endExclusive } = manilaTodayWindow(now);
    const returnGraceMinutes = this.configuration.getOrThrow('RETURN_CONFIRMATION_GRACE_MINUTES', {
      infer: true,
    });
    const returnOverdueBefore = new Date(now.getTime() - returnGraceMinutes * 60_000);
    const base = { ownerUserId } as const;
    const [pickupRows, activeRows, returnRows, attentionRows, recoveryRows, requestCounts, next] =
      await Promise.all([
        this.database.client.booking.findMany({
          include: ownerHomeBookingInclude,
          orderBy: [{ rentalStart: 'asc' }, { id: 'asc' }],
          take: TODAY_CARD_LIMIT,
          where: {
            ...base,
            actualPickupAt: null,
            rentalStart: { gte: startInclusive, lt: endExclusive },
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP] },
          },
        }),
        this.database.client.booking.findMany({
          include: ownerHomeBookingInclude,
          orderBy: [{ rentalEnd: 'asc' }, { id: 'asc' }],
          take: TODAY_CARD_LIMIT,
          where: {
            ...base,
            actualReturnAt: null,
            rentalEnd: { gte: endExclusive },
            status: BookingStatus.ACTIVE,
          },
        }),
        this.database.client.booking.findMany({
          include: ownerHomeBookingInclude,
          orderBy: [{ rentalEnd: 'asc' }, { id: 'asc' }],
          take: TODAY_CARD_LIMIT,
          where: {
            ...base,
            actualReturnAt: null,
            OR: [
              {
                rentalEnd: { gte: startInclusive, lt: endExclusive },
                status: BookingStatus.ACTIVE,
              },
              { status: BookingStatus.RETURN_PENDING },
            ],
          },
        }),
        this.database.client.booking.findMany({
          include: ownerHomeBookingInclude,
          orderBy: [{ rentalEnd: 'asc' }, { id: 'asc' }],
          take: TODAY_CARD_LIMIT,
          where: {
            ...base,
            status: { in: [...operationalStatuses] },
            OR: [
              { operationalHold: true },
              {
                actualPickupAt: null,
                pickupWindowEnd: { lt: now },
                status: { in: [BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP] },
              },
              {
                actualReturnAt: null,
                rentalEnd: { lt: returnOverdueBefore },
                status: { in: [BookingStatus.ACTIVE, BookingStatus.RETURN_PENDING] },
              },
              {
                rentalIncidents: {
                  some: { blocksCompletion: true, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
                },
              },
              {
                disputes: {
                  some: {
                    blocksCompletion: true,
                    status: { in: ['OPEN', 'EVIDENCE_COLLECTION', 'UNDER_REVIEW'] },
                  },
                },
              },
            ],
          },
        }),
        this.database.client.bookingAmendment.findMany({
          orderBy: [{ operationallyExpiredAt: 'asc' }, { id: 'asc' }],
          select: {
            booking: {
              select: {
                publicReference: true,
                renter: {
                  select: { profile: { select: { displayName: true, firstName: true } } },
                },
                vehicle: { select: { make: true, model: true } },
              },
            },
            id: true,
            operationallyExpiredAt: true,
          },
          take: TODAY_CARD_LIMIT,
          where: {
            booking: { ownerUserId },
            status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
          },
        }),
        this.requestCounts(ownerUserId),
        this.database.client.booking.findFirst({
          include: ownerHomeBookingInclude,
          orderBy: [{ rentalStart: 'asc' }, { id: 'asc' }],
          where: {
            ...base,
            rentalStart: { gte: endExclusive },
            status: { in: [...upcomingStatuses] },
          },
        }),
      ]);

    const compliance = (booking: OwnerHomeBooking) =>
      workflowCompliance(booking, returnGraceMinutes, null, now);
    const attention = new Map<string, OwnerHomeAttention>();
    for (const booking of [...attentionRows, ...pickupRows, ...returnRows]) {
      const state = compliance(booking);
      const card = this.attentionCard(booking, state);
      if (card && !attention.has(booking.publicReference))
        attention.set(booking.publicReference, card);
    }
    for (const recovery of recoveryRows) {
      const reference = recovery.booking.publicReference;
      if (!attention.has(reference))
        attention.set(reference, {
          bookingReference: reference,
          deepLinkTarget: { bookingReference: reference, route: 'Booking' as const },
          renterDisplayName:
            recovery.booking.renter.profile?.displayName ??
            recovery.booking.renter.profile?.firstName ??
            'Renter',
          severity: 'WARNING' as const,
          timestamp: recovery.operationallyExpiredAt,
          titleCode: 'AMENDMENT_FINANCIAL_RECOVERY',
          type: 'FINANCIAL_RECOVERY' as const,
          vehicleMake: recovery.booking.vehicle.make ?? 'Vehicle',
          vehicleModel: recovery.booking.vehicle.model ?? '',
        });
    }
    const attentionReferences = new Set(attention.keys());
    const returnReferences = new Set(returnRows.map(({ publicReference }) => publicReference));
    const pickups = pickupRows
      .filter(({ publicReference }) => !attentionReferences.has(publicReference))
      .map((booking) => this.card(booking, compliance(booking)));
    const returns = returnRows
      .filter(({ publicReference }) => !attentionReferences.has(publicReference))
      .map((booking) => this.card(booking, compliance(booking)));
    const activeRentals = activeRows
      .filter(
        ({ publicReference }) =>
          !attentionReferences.has(publicReference) && !returnReferences.has(publicReference),
      )
      .map((booking) => this.card(booking, compliance(booking)));
    const attentionItems = [...attention.values()].slice(0, TODAY_CARD_LIMIT);
    return {
      asOf: now.toISOString(),
      requests: requestCounts,
      timezone: OWNER_AVAILABILITY_TIMEZONE,
      today: {
        activeRentals,
        attention: attentionItems,
        counts: {
          actionableRequestsCount: requestCounts.totalRequestsCount,
          activeRentalsCount: activeRentals.length,
          needsAttentionCount: attentionItems.length,
          pickupsTodayCount: pickups.length,
          returnsTodayCount: returns.length,
        },
        endExclusive: endExclusive.toISOString(),
        nextUpcoming: next ? this.card(next, compliance(next)) : null,
        pickups,
        returns,
        startInclusive: startInclusive.toISOString(),
      },
    };
  }

  async upcoming(ownerUserId: string, query: OwnerHomeUpcomingQueryDto, now = new Date()) {
    await this.owners.assertOperational(ownerUserId);
    const { endExclusive } = manilaTodayWindow(now);
    const where: Prisma.BookingWhereInput = {
      ownerUserId,
      rentalStart: { gte: endExclusive },
      status: { in: [...upcomingStatuses] },
    };
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.booking.count({ where }),
      this.database.client.booking.findMany({
        include: ownerHomeUpcomingInclude,
        orderBy: [{ rentalStart: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        where,
      }),
    ]);
    const returnGraceMinutes = this.configuration.getOrThrow('RETURN_CONFIRMATION_GRACE_MINUTES', {
      infer: true,
    });
    return {
      asOf: now.toISOString(),
      items: rows.map((booking) => {
        const card = this.card(booking, workflowCompliance(booking, returnGraceMinutes, null, now));
        const photo = booking.vehicle.photos[0]?.fileAsset;
        return {
          ...card,
          vehicle: {
            ...card.vehicle,
            coverPhoto:
              photo?.classification === FileClassification.PUBLIC &&
              photo.status === FileAssetStatus.READY
                ? { contentPath: this.files.trustedPublicGrant(photo.id).contentPath }
                : null,
          },
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      timezone: OWNER_AVAILABILITY_TIMEZONE,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private async requestCounts(ownerUserId: string) {
    const [bookingRequestsCount, amendmentRequestsCount] = await Promise.all([
      this.database.client.booking.count({ where: ownerActionableBookingWhere(ownerUserId) }),
      this.database.client.bookingAmendment.count({
        where: ownerActionableAmendmentWhere(ownerUserId),
      }),
    ]);
    return {
      amendmentRequestsCount,
      bookingRequestsCount,
      totalRequestsCount: bookingRequestsCount + amendmentRequestsCount,
    };
  }

  private card(booking: OwnerHomeBooking, state: ReturnType<typeof workflowCompliance>) {
    const fulfillment = booking.fulfillmentSnapshot;
    return {
      bookingReference: booking.publicReference,
      deepLinkTarget: { bookingReference: booking.publicReference, route: 'Booking' as const },
      pickup: {
        at: booking.rentalStart,
        handoverStatus: state.start.outstandingStep,
        location: fulfillment ? this.locationSummary(fulfillment, 'start') : null,
        method: (fulfillment?.startMethod ?? 'RENTER_PICKUP') as StartFulfillmentMethod,
      },
      renterDisplayName:
        booking.renter.profile?.displayName ?? booking.renter.profile?.firstName ?? 'Renter',
      return: {
        at: booking.rentalEnd,
        method: (fulfillment?.endMethod ?? 'RENTER_RETURN') as EndFulfillmentMethod,
        workflowStatus: state.return.outstandingStep,
      },
      status: booking.status,
      vehicle: { make: booking.vehicle.make, model: booking.vehicle.model },
    };
  }

  private attentionCard(
    booking: OwnerHomeBooking,
    state: ReturnType<typeof workflowCompliance>,
  ): OwnerHomeAttention | null {
    const base = {
      bookingReference: booking.publicReference,
      deepLinkTarget: { bookingReference: booking.publicReference, route: 'Booking' as const },
      renterDisplayName:
        booking.renter.profile?.displayName ?? booking.renter.profile?.firstName ?? 'Renter',
      severity: 'WARNING' as const,
      vehicleMake: booking.vehicle.make ?? 'Vehicle',
      vehicleModel: booking.vehicle.model ?? '',
    };
    if (state.return.overdue)
      return {
        ...base,
        timestamp: state.return.graceBoundary,
        titleCode: 'RETURN_OVERDUE',
        type: 'OVERDUE_RETURN' as const,
      };
    if (state.start.overdue)
      return {
        ...base,
        timestamp: state.start.graceBoundary,
        titleCode: state.start.outstandingStep ?? 'PICKUP_OVERDUE',
        type: 'OVERDUE_PICKUP' as const,
      };
    if (
      booking.operationalHold ||
      state.start.outstandingStep === 'OPERATIONS_HOLD' ||
      state.start.outstandingStep === 'DISCREPANCY_RESOLUTION_REQUIRED' ||
      state.return.outstandingStep === 'RETURN_DISPUTE_OR_HOLD'
    )
      return {
        ...base,
        timestamp: booking.updatedAt,
        titleCode:
          state.start.outstandingStep === 'DISCREPANCY_RESOLUTION_REQUIRED'
            ? 'PICKUP_DISCREPANCY'
            : 'OPERATIONAL_HOLD',
        type: 'OPERATIONAL_HOLD' as const,
      };
    return null;
  }

  private locationSummary(
    fulfillment: NonNullable<OwnerHomeBooking['fulfillmentSnapshot']>,
    prefix: 'start' | 'end',
  ) {
    return [
      fulfillment[`${prefix}AddressLine1`],
      fulfillment[`${prefix}City`],
      fulfillment[`${prefix}Province`],
    ]
      .filter(Boolean)
      .join(', ');
  }
}
