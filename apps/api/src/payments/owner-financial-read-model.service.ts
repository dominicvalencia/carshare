import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OwnerFinancialActivityScope,
  OwnerFinancialErrorCode,
  type OwnerEarningDetail,
  type OwnerEarningsSummary,
  type OwnerFinancialActivityItem,
  type OwnerFinancialActivityPage,
} from '@carrental/api-contracts';
import {
  LedgerTransactionType,
  OwnerEarningStatus,
  PayoutStatus,
  Prisma,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { PayoutEligibilityService } from '../payouts/payout-eligibility.service';
import type { OwnerFinancialActivityQueryDto } from './owner-financial-read-model.dto';

const ACTIVE_PAYOUT_STATUSES = [
  PayoutStatus.PENDING_APPROVAL,
  PayoutStatus.APPROVED,
  PayoutStatus.SUBMITTING,
  PayoutStatus.PROCESSING,
] as const;

type SummaryRow = {
  availableMinor: bigint;
  currency: string;
  heldMinor: bigint;
  malformedCount: bigint;
  pendingMinor: bigint;
};

@Injectable()
export class OwnerFinancialReadModelService {
  constructor(
    private readonly database: DatabaseService,
    private readonly payoutEligibility: PayoutEligibilityService,
  ) {}

  async summary(ownerUserId: string): Promise<OwnerEarningsSummary> {
    const owner = await this.owner(ownerUserId);
    const rows = await this.database.client.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT e."currency",
        COALESCE(SUM(CASE WHEN e."status" = 'AVAILABLE' THEN total.amount - holds.amount ELSE 0 END), 0)::bigint AS "availableMinor",
        COALESCE(SUM(CASE WHEN e."status" IN ('PENDING', 'HELD') THEN total.amount - holds.amount ELSE 0 END), 0)::bigint AS "pendingMinor",
        COALESCE(SUM(holds.amount), 0)::bigint AS "heldMinor",
        COUNT(*) FILTER (WHERE total.amount < 0 OR holds.amount < 0 OR holds.amount > total.amount)::bigint AS "malformedCount"
      FROM "owner_earnings" e
      CROSS JOIN LATERAL (
        SELECT e."net_earning_amount_minor" + e."delivery_earning_minor" +
          e."collection_earning_minor" + e."additional_compensation_minor" +
          e."adjustment_amount_minor" AS amount
      ) total
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(h."amount_minor"), 0)::bigint AS amount
        FROM "earning_holds" h
        WHERE h."owner_earning_id" = e."id" AND h."status" = 'ACTIVE'
      ) holds
      WHERE e."owner_profile_id" = ${owner.id}::uuid
        AND e."status" <> 'PAID' AND e."status" <> 'REVERSED'
      GROUP BY e."currency"
      ORDER BY e."currency"
    `);
    if (rows.length > 1)
      this.inconsistent('Owner earnings contain multiple currencies; a single summary is unsafe.');
    const row = rows[0];
    if (row?.malformedCount)
      this.inconsistent('Owner earnings or active holds do not reconcile to a valid total.');

    const readiness = await this.payoutEligibility.ownerReadiness(owner.id);
    const eligible = readiness.blockers.length
      ? []
      : await this.database.client.$queryRaw<Array<{ amountMinor: bigint; currency: string }>>(
          this.payoutEligibility.eligibleAggregateSql(owner.id),
        );
    if (eligible.length > 1)
      this.inconsistent('Payout-ready earnings contain multiple currencies.');

    const upcoming = await this.database.client.payout.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        amountMinor: true,
        currency: true,
        destinationChannel: true,
        destinationMasked: true,
        id: true,
        publicReference: true,
        status: true,
      },
      where: { ownerProfileId: owner.id, status: { in: [...ACTIVE_PAYOUT_STATUSES] } },
    });
    const currency = row?.currency ?? eligible[0]?.currency ?? upcoming?.currency ?? 'PHP';
    if (
      (eligible[0] && eligible[0].currency !== currency) ||
      (upcoming && upcoming.currency !== currency)
    )
      this.inconsistent('Owner summary and payout currencies do not match.');
    return {
      availableMinor: this.minor(row?.availableMinor ?? 0n),
      currency,
      heldMinor: this.minor(row?.heldMinor ?? 0n),
      payoutReadyMinor: this.minor(eligible[0]?.amountMinor ?? 0n),
      pendingMinor: this.minor(row?.pendingMinor ?? 0n),
      upcomingPayout: upcoming
        ? {
            amountMinor: this.minor(upcoming.amountMinor),
            currency: upcoming.currency,
            expectedAt: null,
            id: upcoming.id,
            method: {
              channel: upcoming.destinationChannel,
              maskedIdentifier: upcoming.destinationMasked,
            },
            publicReference: upcoming.publicReference,
            status: upcoming.status,
          }
        : null,
    };
  }

  async activity(
    ownerUserId: string,
    query: OwnerFinancialActivityQueryDto,
  ): Promise<OwnerFinancialActivityPage> {
    const owner = await this.owner(ownerUserId);
    const window = query.page * query.pageSize + 1;
    let items: OwnerFinancialActivityItem[];
    if (query.scope === OwnerFinancialActivityScope.UPCOMING) {
      const [earnings, payouts] = await Promise.all([
        this.database.client.ownerEarning.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: this.earningActivitySelect(),
          take: window,
          where: {
            ownerProfileId: owner.id,
            payoutItems: { none: { activeAllocation: true } },
            status: {
              in: [
                OwnerEarningStatus.PENDING,
                OwnerEarningStatus.HELD,
                OwnerEarningStatus.AVAILABLE,
              ],
            },
          },
        }),
        this.database.client.payout.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            amountMinor: true,
            createdAt: true,
            currency: true,
            id: true,
            publicReference: true,
            status: true,
          },
          take: window,
          where: { ownerProfileId: owner.id, status: { in: [...ACTIVE_PAYOUT_STATUSES] } },
        }),
      ]);
      items = [
        ...earnings.map((earning) => this.earningActivity(earning)),
        ...payouts.map((payout) => this.payoutActivity(payout)),
      ];
    } else if (query.scope === OwnerFinancialActivityScope.PAID) {
      const payouts = await this.database.client.payout.findMany({
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        select: {
          amountMinor: true,
          createdAt: true,
          currency: true,
          id: true,
          paidAt: true,
          publicReference: true,
          status: true,
        },
        take: window,
        where: { ownerProfileId: owner.id, status: PayoutStatus.PAID },
      });
      items = payouts.map((payout) => this.payoutActivity(payout, payout.paidAt));
    } else {
      items = await this.adjustmentActivity(owner.id, window);
    }

    items.sort((left, right) => {
      const byDate = right.occurredAt.localeCompare(left.occurredAt);
      return byDate || right.id.localeCompare(left.id);
    });
    const start = (query.page - 1) * query.pageSize;
    const pageItems = items.slice(start, start + query.pageSize);
    return {
      items: pageItems,
      nextPage: items.length > start + query.pageSize ? query.page + 1 : null,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async earningDetail(ownerUserId: string, earningId: string): Promise<OwnerEarningDetail> {
    const earning = await this.database.client.ownerEarning.findFirst({
      include: {
        booking: {
          select: {
            publicReference: true,
            rentalEnd: true,
            rentalStart: true,
            renter: { select: { profile: { select: { displayName: true } } } },
            vehicle: { select: { make: true, model: true } },
          },
        },
        holds: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        payoutItems: {
          include: { payout: { select: { id: true, publicReference: true, status: true } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      where: { id: earningId, ownerProfile: { userId: ownerUserId } },
    });
    if (!earning)
      throw new ApplicationException(
        OwnerFinancialErrorCode.EARNING_NOT_FOUND,
        'Owner earning was not found.',
        HttpStatus.NOT_FOUND,
      );
    const total = this.earningTotal(earning);
    const activeHeld = earning.holds
      .filter(({ status }) => status === 'ACTIVE')
      .reduce((sum, hold) => sum + hold.amountMinor, 0n);
    if (total < 0n || activeHeld < 0n || activeHeld > total)
      this.inconsistent('Owner earning and hold amounts do not reconcile.');
    const payout = earning.payoutItems[0]?.payout ?? null;
    return {
      additionalCompensationMinor: this.minor(earning.additionalCompensationMinor),
      adjustmentAmountMinor: this.minor(earning.adjustmentAmountMinor),
      booking: {
        publicReference: earning.booking.publicReference,
        renterDisplayName: earning.booking.renter.profile?.displayName ?? 'Renter',
        rentalEnd: earning.booking.rentalEnd.toISOString(),
        rentalStart: earning.booking.rentalStart.toISOString(),
        vehicleSummary: this.vehicle(earning.booking.vehicle),
      },
      collectionEarningMinor: this.minor(earning.collectionEarningMinor),
      commissionAmountMinor: this.minor(earning.commissionAmountMinor),
      currency: earning.currency,
      deliveryEarningMinor: this.minor(earning.deliveryEarningMinor),
      grossRentalAmountMinor: this.minor(earning.grossRentalAmountMinor),
      heldAmountMinor: this.minor(activeHeld),
      holds: earning.holds.map((hold) => ({
        amountMinor: this.minor(hold.amountMinor),
        reason: hold.reason,
        status: hold.status,
      })),
      id: earning.id,
      netEarningAmountMinor: this.minor(earning.netEarningAmountMinor),
      payout,
      projectedTotalMinor: this.minor(total),
      status: earning.status,
    };
  }

  private async adjustmentActivity(ownerProfileId: string, take: number) {
    const [earnings, obligations] = await Promise.all([
      this.database.client.ownerEarning.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: this.earningActivitySelect(),
        take,
        where: {
          ownerProfileId,
          OR: [
            { additionalCompensationMinor: { not: 0n } },
            { adjustmentAmountMinor: { not: 0n } },
            { status: OwnerEarningStatus.REVERSED },
          ],
        },
      }),
      this.database.client.ownerFinancialObligation.findMany({
        include: {
          sourceCancellation: {
            select: { booking: { select: { publicReference: true } } },
          },
        },
        orderBy: [{ effectiveAt: 'desc' }, { id: 'desc' }],
        take,
        where: { ownerProfileId, type: 'CANCELLATION_PENALTY' },
      }),
    ]);
    const penaltyIds = obligations.map(({ id }) => id);
    const ledger = penaltyIds.length
      ? await this.database.client.ledgerTransaction.findMany({
          include: { entries: { include: { account: true } } },
          where: {
            sourceId: { in: penaltyIds },
            sourceType: 'OWNER_FINANCIAL_OBLIGATION',
            type: LedgerTransactionType.OWNER_PENALTY_RECOGNITION,
          },
        })
      : [];
    const recognized = new Map(ledger.map((transaction) => [transaction.sourceId, transaction]));
    for (const obligation of obligations) {
      const transaction = recognized.get(obligation.id);
      const balanced =
        transaction?.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) === 0n;
      const receivable = transaction?.entries.find(
        ({ account }) => account.type === 'OWNER_PENALTY_RECEIVABLE',
      )?.amountMinor;
      if (!balanced || receivable !== obligation.originalAmountMinor)
        this.inconsistent('Owner penalty does not reconcile to its recognition ledger entry.');
    }
    const adjusted = earnings.flatMap((earning): OwnerFinancialActivityItem[] => {
      if (earning.status === OwnerEarningStatus.REVERSED) {
        const total = this.earningTotal(earning);
        if (total === 0n) return [];
        return [
          this.earningComponentActivity(
            earning,
            'REVERSAL',
            -this.absolute(total),
            'Reversed earning',
          ),
        ];
      }
      const amount = earning.additionalCompensationMinor + earning.adjustmentAmountMinor;
      if (amount === 0n) return [];
      return [
        this.earningComponentActivity(
          earning,
          earning.additionalCompensationMinor !== 0n ? 'COMPENSATION' : 'ADJUSTMENT',
          amount,
          earning.additionalCompensationMinor !== 0n
            ? 'Additional compensation'
            : 'Earning adjustment',
        ),
      ];
    });
    return [
      ...adjusted,
      ...obligations.map((obligation): OwnerFinancialActivityItem => ({
        amountMinor: -this.minor(obligation.originalAmountMinor),
        bookingReference: obligation.sourceCancellation.booking.publicReference,
        currency: obligation.currency,
        detailTarget: null,
        id: `penalty:${obligation.id}`,
        occurredAt: obligation.effectiveAt.toISOString(),
        reasonCode: obligation.reasonCode,
        status: obligation.status,
        subtitle: this.ownerSafeReason(obligation.reasonCode),
        title: 'Owner cancellation penalty',
        type: 'PENALTY',
      })),
    ];
  }

  private earningActivitySelect() {
    return {
      additionalCompensationMinor: true,
      adjustmentAmountMinor: true,
      booking: {
        select: {
          publicReference: true,
          renter: { select: { profile: { select: { displayName: true } } } },
          vehicle: { select: { make: true, model: true } },
        },
      },
      collectionEarningMinor: true,
      createdAt: true,
      currency: true,
      deliveryEarningMinor: true,
      id: true,
      lastFinancialResolutionAt: true,
      netEarningAmountMinor: true,
      status: true,
    } satisfies Prisma.OwnerEarningSelect;
  }

  private earningActivity(earning: ReturnTypeProjection): OwnerFinancialActivityItem {
    return {
      amountMinor: this.minor(this.earningTotal(earning)),
      bookingReference: earning.booking.publicReference,
      currency: earning.currency,
      detailTarget: { id: earning.id, resource: 'EARNING' },
      id: `earning:${earning.id}`,
      occurredAt: earning.createdAt.toISOString(),
      status: earning.status,
      subtitle: `${earning.booking.renter.profile?.displayName ?? 'Renter'} · ${earning.booking.publicReference}`,
      title: this.vehicle(earning.booking.vehicle),
      type: 'EARNING',
      vehicleSummary: this.vehicle(earning.booking.vehicle),
    };
  }

  private earningComponentActivity(
    earning: ReturnTypeProjection,
    type: 'ADJUSTMENT' | 'COMPENSATION' | 'REVERSAL',
    amount: bigint,
    title: string,
  ): OwnerFinancialActivityItem {
    return {
      amountMinor: this.minor(amount),
      bookingReference: earning.booking.publicReference,
      currency: earning.currency,
      detailTarget: { id: earning.id, resource: 'EARNING' },
      id: `${type.toLowerCase()}:${earning.id}`,
      occurredAt: (earning.lastFinancialResolutionAt ?? earning.createdAt).toISOString(),
      status: earning.status,
      subtitle: `${this.vehicle(earning.booking.vehicle)} · ${earning.booking.publicReference}`,
      title,
      type,
      vehicleSummary: this.vehicle(earning.booking.vehicle),
    };
  }

  private payoutActivity(
    payout: {
      amountMinor: bigint;
      createdAt: Date;
      currency: string;
      id: string;
      publicReference: string;
      status: string;
    },
    occurredAt?: Date | null,
  ): OwnerFinancialActivityItem {
    return {
      amountMinor: this.minor(payout.amountMinor),
      currency: payout.currency,
      detailTarget: { id: payout.id, resource: 'PAYOUT' },
      id: `payout:${payout.id}`,
      occurredAt: (occurredAt ?? payout.createdAt).toISOString(),
      payoutReference: payout.publicReference,
      status: payout.status,
      subtitle: payout.publicReference,
      title: payout.status === PayoutStatus.PAID ? 'Payout paid' : 'Upcoming payout',
      type: 'PAYOUT',
    };
  }

  private earningTotal(earning: {
    additionalCompensationMinor: bigint;
    adjustmentAmountMinor: bigint;
    collectionEarningMinor: bigint;
    deliveryEarningMinor: bigint;
    netEarningAmountMinor: bigint;
  }) {
    return (
      earning.netEarningAmountMinor +
      earning.deliveryEarningMinor +
      earning.collectionEarningMinor +
      earning.additionalCompensationMinor +
      earning.adjustmentAmountMinor
    );
  }

  private async owner(userId: string) {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: { id: true },
      where: { userId },
    });
    if (!owner)
      throw new ApplicationException(
        OwnerFinancialErrorCode.EARNING_NOT_FOUND,
        'Owner profile was not found.',
        HttpStatus.NOT_FOUND,
      );
    return owner;
  }

  private inconsistent(message: string): never {
    throw new ApplicationException(
      OwnerFinancialErrorCode.AUTHORITY_INCONSISTENT,
      message,
      HttpStatus.CONFLICT,
    );
  }

  private minor(value: bigint) {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      this.inconsistent('Financial amount exceeds safe transport range.');
    return number;
  }

  private absolute(value: bigint) {
    return value < 0n ? -value : value;
  }

  private vehicle(vehicle: { make: string | null; model: string | null }) {
    return [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
  }

  private ownerSafeReason(value: string) {
    return value
      .toLowerCase()
      .split('_')
      .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
      .join(' ');
  }
}

type ReturnTypeProjection = Prisma.OwnerEarningGetPayload<{
  select: ReturnType<OwnerFinancialReadModelService['earningActivitySelect']>;
}>;
