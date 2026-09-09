import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  PaymentPurpose,
  PaymentStatus,
  PayoutStatus,
  RefundStatus,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { PayoutEligibilityService } from '../payouts/payout-eligibility.service';
import {
  OWNER_ANALYTICS_TIMEZONE,
  resolveOwnerAnalyticsPeriod,
  type OwnerAnalyticsPeriod,
} from './owner-analytics.period';

export const OWNER_REVENUE_DEFINITION_VERSION = 'owner-revenue-v1';
const CAPTURED = [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];

type Totals = Map<string, bigint>;
type Counts = Map<string, number>;
type AggregateRow = {
  currency: string;
  _count: { _all: number };
  _sum: {
    amountMinor?: bigint | null;
    netEarningAmountMinor?: bigint | null;
    additionalCompensationMinor?: bigint | null;
    adjustmentAmountMinor?: bigint | null;
  };
};
type EligibleAggregateRow = { currency: string; count: number; amountMinor: bigint };
type EarningRow = {
  id: string;
  status: OwnerEarningStatus;
  currency: string;
  netEarningAmountMinor: bigint;
  additionalCompensationMinor: bigint;
  adjustmentAmountMinor: bigint;
};
type LedgerTransactionRow = {
  sourceId: string;
  sourceType: string;
  type: LedgerTransactionType;
  entries: Array<{
    amountMinor: bigint;
    currency: string;
    account: { type: FinancialAccountType };
  }>;
};
type RentalPaymentRow = {
  id: string;
  bookingId: string;
  purpose: PaymentPurpose;
  currency: string;
  capturedAmountMinor: bigint;
  booking: { pricingSnapshot: { currency: string; totalMinor: number } | null };
  commission: {
    currency: string;
    commissionableBaseMinor: bigint;
    calculatedCommissionMinor: bigint;
  } | null;
  ownerEarning:
    | ({
        currency: string;
        grossRentalAmountMinor: bigint;
        commissionAmountMinor: bigint;
        netEarningAmountMinor: bigint;
      } & EarningRow)
    | null;
};
type AdditionalChargeRow = {
  currency: string;
  approvedAt: Date;
  paidAt: Date | null;
  approvedAmountMinor: bigint;
  collectedAmountMinor: bigint;
  refundedAmountMinor: bigint;
  ownerCompensationMinor: bigint;
  platformShareMinor: bigint;
  payment: { refunds: Array<{ amountMinor: bigint; completedAt: Date | null }> } | null;
};
type PayoutRow = {
  currency: string;
  amountMinor: bigint;
  createdAt: Date;
  approvedAt: Date | null;
  submittedAt: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  reversedAt: Date | null;
};

@Injectable()
export class OwnerRevenueService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly payoutEligibility: PayoutEligibilityService,
  ) {}

  async summary(input: {
    period: OwnerAnalyticsPeriod;
    startDate?: string;
    endDate?: string;
    now?: Date;
  }) {
    const period = resolveOwnerAnalyticsPeriod(input);
    const generatedAt = input.now ?? new Date();
    const dateRange = { gte: period.startInclusive, lt: period.endExclusive };

    const [
      payments,
      commissions,
      earnings,
      refunds,
      charges,
      payouts,
      payableRows,
      earningRows,
      activeAllocationRows,
      processingRows,
      eligibleRows,
      excludedReconciliation,
      reconciliationPaymentIds,
    ] = await Promise.all([
      this.database.client.payment.findMany({
        include: {
          booking: { include: { pricingSnapshot: true } },
          commission: true,
          ownerEarning: true,
        },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        where: { capturedAt: dateRange, reconciliationRequired: false, status: { in: CAPTURED } },
      }),
      this.database.client.ledgerTransaction.findMany({
        include: { entries: { include: { account: true } } },
        where: { postedAt: dateRange },
      }),
      this.database.client.ownerEarning.findMany({
        where: { createdAt: dateRange, payment: { reconciliationRequired: false } },
      }),
      this.database.client.refund.findMany({
        where: { completedAt: dateRange, status: RefundStatus.COMPLETED },
      }),
      this.database.client.additionalCharge.findMany({
        include: {
          payment: {
            include: {
              refunds: { where: { completedAt: dateRange, status: RefundStatus.COMPLETED } },
            },
          },
        },
        where: {
          OR: [
            { approvedAt: dateRange },
            { paidAt: dateRange },
            {
              payment: {
                is: {
                  refunds: { some: { completedAt: dateRange, status: RefundStatus.COMPLETED } },
                },
              },
            },
          ],
        },
      }),
      this.database.client.payout.findMany({
        where: {
          OR: [
            { createdAt: dateRange },
            { approvedAt: dateRange },
            { submittedAt: dateRange },
            { paidAt: dateRange },
            { failedAt: dateRange },
            { reversedAt: dateRange },
          ],
        },
      }),
      this.database.client.ledgerEntry.groupBy({
        _count: { _all: true },
        _sum: { amountMinor: true },
        by: ['currency'],
        where: {
          account: { type: FinancialAccountType.OWNER_PAYABLE },
          transaction: { postedAt: { lte: generatedAt } },
        },
      }),
      this.database.client.ownerEarning.groupBy({
        _count: { _all: true },
        _sum: {
          netEarningAmountMinor: true,
          additionalCompensationMinor: true,
          adjustmentAmountMinor: true,
        },
        by: ['status', 'currency'],
      }),
      this.database.client.payoutItem.groupBy({
        _count: { _all: true },
        _sum: { amountMinor: true },
        by: ['currency'],
        where: { activeAllocation: true },
      }),
      this.database.client.payout.groupBy({
        _count: { _all: true },
        _sum: { amountMinor: true },
        by: ['currency'],
        where: { status: { in: [PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING] } },
      }),
      this.database.client.$queryRaw<EligibleAggregateRow[]>(
        this.payoutEligibility.eligibleAggregateSql(),
      ),
      this.database.client.payment.count({
        where: { capturedAt: dateRange, reconciliationRequired: true, status: { in: CAPTURED } },
      }),
      this.database.client.payment.findMany({
        select: { id: true },
        where: { reconciliationRequired: true, status: { in: CAPTURED } },
      }),
    ]);

    const rentalPaymentIds = payments
      .filter(({ purpose }) => purpose === PaymentPurpose.RENTAL)
      .map(({ id }) => id);
    const integrityTransactions = rentalPaymentIds.length
      ? await this.database.client.ledgerTransaction.findMany({
          include: { entries: { include: { account: true } } },
          where: {
            sourceId: { in: rentalPaymentIds },
            sourceType: 'PAYMENT',
            type: {
              in: [
                LedgerTransactionType.CAPTURE_RECOGNITION,
                LedgerTransactionType.CAPTURE_ALLOCATION,
              ],
            },
          },
        })
      : [];

    this.assertRentalIntegrity(payments, integrityTransactions);
    this.assertBalancedTransactions(commissions);

    const rentalCollections: Totals = new Map();
    const additionalCollections: Totals = new Map();
    const rentalGbv: Totals = new Map();
    const seenRentalBookings = new Set<string>();
    for (const payment of payments) {
      if (payment.purpose === PaymentPurpose.RENTAL) {
        if (seenRentalBookings.has(payment.bookingId))
          throw new Error('OWNER_REVENUE_DUPLICATE_LOGICAL_CAPTURE');
        seenRentalBookings.add(payment.bookingId);
        add(rentalCollections, payment.currency, payment.capturedAmountMinor);
        add(
          rentalGbv,
          payment.booking.pricingSnapshot!.currency,
          BigInt(payment.booking.pricingSnapshot!.totalMinor),
        );
      } else if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        add(additionalCollections, payment.currency, payment.capturedAmountMinor);
      }
      // SECURITY_DEPOSIT authorization/usage has no proven capture-ledger baseline in C1.
    }

    const commissionTotals: Totals = new Map();
    const excludedPaymentIds = new Set(reconciliationPaymentIds.map(({ id }) => id));
    for (const transaction of commissions) {
      if (transaction.sourceType === 'PAYMENT' && excludedPaymentIds.has(transaction.sourceId))
        continue;
      for (const entry of transaction.entries)
        if (entry.account.type === FinancialAccountType.PLATFORM_COMMISSION_REVENUE)
          add(commissionTotals, entry.currency, -entry.amountMinor);
    }

    const earningByStatus = groupedEarningTotals(earningRows);
    const periodEarnings = statusTotals(earnings, (e) => earningAmount(e));
    const refundTotals = totals(refunds, (r) => r.amountMinor);
    const payable = aggregateTotals(payableRows, true);
    const allocationTotals = aggregateTotals(activeAllocationRows);
    const processingTotals = aggregateTotals(processingRows);
    const availableForPayout = new Map(eligibleRows.map((row) => [row.currency, row.amountMinor]));

    const environment = this.configuration.getOrThrow('APP_ENV', { infer: true });
    return {
      metadata: {
        classification: 'GROUPED_BY_CURRENCY',
        definitionVersion: OWNER_REVENUE_DEFINITION_VERSION,
        environment,
        generatedAt: generatedAt.toISOString(),
        period: period.period,
        startInclusive: period.startInclusive.toISOString(),
        endExclusive: period.endExclusive.toISOString(),
        syntheticData: environment !== 'production',
        timezone: OWNER_ANALYTICS_TIMEZONE,
      },
      periodActivity: {
        capturedCollections: {
          rental: money(rentalCollections),
          additionalCharge: money(additionalCollections),
          securityDeposit: [],
          classification: 'PERIOD',
        },
        rentalGbv: metric(rentalGbv, 'PERIOD'),
        recognizedCarShareCommission: metric(commissionTotals, 'PERIOD'),
        ownerEarnings: {
          classification: 'PERIOD',
          byStatus: statusMoney(periodEarnings),
          total: metric(sumStatus(periodEarnings), 'PERIOD'),
        },
        completedRefunds: metric(refundTotals, 'PERIOD'),
        additionalCharges: this.additionalChargeActivity(
          charges,
          period.startInclusive,
          period.endExclusive,
        ),
        payouts: this.payoutActivity(payouts, period.startInclusive, period.endExclusive),
      },
      pointInTime: {
        ownerPayableLiability: metric(payable, 'POINT_IN_TIME'),
        availableForPayout: metric(availableForPayout, 'POINT_IN_TIME'),
        earnings: { classification: 'POINT_IN_TIME', byStatus: statusMoney(earningByStatus) },
        activePayoutAllocations: countedMetric(
          allocationTotals,
          aggregateCounts(activeAllocationRows),
        ),
        processingPayouts: countedMetric(processingTotals, aggregateCounts(processingRows)),
      },
      integrity: {
        authoritativeTotalsComplete: excludedReconciliation === 0,
        excludedReconciliationRequiredCount: excludedReconciliation,
        financialIntegrityWarning: excludedReconciliation > 0,
      },
      unavailable: [
        'trueNetPlatformRevenue',
        'profit',
        'paymentProviderFees',
        'taxes',
        'withholding',
        'cancellationRevenue',
        'chargebacks',
        'fxConvertedTotals',
        'settlementBankReconciliation',
        'ownerTaxReporting',
      ],
    };
  }

  private assertRentalIntegrity(
    payments: RentalPaymentRow[],
    transactions: LedgerTransactionRow[],
  ) {
    const allocations = new Map(
      transactions
        .filter((t) => t.type === LedgerTransactionType.CAPTURE_ALLOCATION)
        .map((t) => [t.sourceId, t]),
    );
    const recognitions = new Map(
      transactions
        .filter((t) => t.type === LedgerTransactionType.CAPTURE_RECOGNITION)
        .map((t) => [t.sourceId, t]),
    );
    for (const payment of payments.filter((p) => p.purpose === PaymentPurpose.RENTAL)) {
      const snapshot = payment.booking.pricingSnapshot;
      if (!snapshot) throw new Error('OWNER_REVENUE_MISSING_PRICING_SNAPSHOT');
      if (!payment.commission) throw new Error('OWNER_REVENUE_MISSING_COMMISSION_SNAPSHOT');
      if (!payment.ownerEarning) throw new Error('OWNER_REVENUE_MISSING_OWNER_EARNING');
      if (
        payment.currency !== snapshot.currency ||
        payment.currency !== payment.commission.currency ||
        payment.currency !== payment.ownerEarning.currency
      )
        throw new Error('OWNER_REVENUE_CURRENCY_MISMATCH');
      if (
        payment.capturedAmountMinor !== BigInt(snapshot.totalMinor) ||
        payment.capturedAmountMinor !== payment.commission.commissionableBaseMinor
      )
        throw new Error('OWNER_REVENUE_CAPTURE_RECONCILIATION_FAILED');
      const earning = payment.ownerEarning;
      if (
        earning.grossRentalAmountMinor - earning.commissionAmountMinor !==
          earning.netEarningAmountMinor ||
        earning.grossRentalAmountMinor !== payment.capturedAmountMinor
      )
        throw new Error('OWNER_REVENUE_EARNING_RECONCILIATION_FAILED');
      const allocation = allocations.get(payment.id);
      const recognition = recognitions.get(payment.id);
      if (!recognition) throw new Error('OWNER_REVENUE_MISSING_CAPTURE_RECOGNITION');
      if (!allocation) throw new Error('OWNER_REVENUE_MISSING_CAPTURE_ALLOCATION');
      const ledgerCommission = allocation?.entries
        .filter((entry) => entry.account.type === FinancialAccountType.PLATFORM_COMMISSION_REVENUE)
        .reduce((sum, entry) => sum - entry.amountMinor, 0n);
      if (ledgerCommission !== payment.commission.calculatedCommissionMinor)
        throw new Error('OWNER_REVENUE_COMMISSION_RECONCILIATION_FAILED');
      const allocatedOwner = -allocation.entries
        .filter((entry) => entry.account.type === FinancialAccountType.OWNER_PAYABLE)
        .reduce((sum, entry) => sum + entry.amountMinor, 0n);
      if (allocatedOwner !== earningAmount(earning))
        throw new Error('OWNER_REVENUE_OWNER_ALLOCATION_RECONCILIATION_FAILED');
    }
  }

  private assertBalancedTransactions(transactions: LedgerTransactionRow[]) {
    for (const transaction of transactions) {
      if (transaction.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) !== 0n)
        throw new Error('OWNER_REVENUE_UNBALANCED_LEDGER_TRANSACTION');
    }
  }

  private additionalChargeActivity(charges: AdditionalChargeRow[], start: Date, end: Date) {
    const inRange = (date: Date | null) => Boolean(date && date >= start && date < end);
    const approved = charges.filter((charge) => inRange(charge.approvedAt));
    const collected = charges.filter((charge) => inRange(charge.paidAt));
    const refunded: Totals = new Map();
    for (const charge of charges)
      for (const refund of charge.payment?.refunds ?? [])
        if (inRange(refund.completedAt)) add(refunded, charge.currency, refund.amountMinor);
    return {
      classification: 'PERIOD',
      approved: metric(
        totals(approved, (charge) => charge.approvedAmountMinor),
        'PERIOD',
      ),
      collected: metric(
        totals(collected, (charge) => charge.collectedAmountMinor),
        'PERIOD',
      ),
      refunded: metric(refunded, 'PERIOD'),
      ownerCompensation: metric(
        totals(approved, (charge) => charge.ownerCompensationMinor),
        'PERIOD',
      ),
      platformShare: metric(
        totals(approved, (charge) => charge.platformShareMinor),
        'PERIOD',
      ),
    };
  }

  private payoutActivity(payouts: PayoutRow[], start: Date, end: Date) {
    const inRange = (date: Date | null) => date && date >= start && date < end;
    const item = (
      field: keyof Pick<
        PayoutRow,
        'createdAt' | 'approvedAt' | 'submittedAt' | 'paidAt' | 'failedAt' | 'reversedAt'
      >,
    ) => {
      const rows = payouts.filter((p) => inRange(p[field]));
      return countedMetric(
        totals(rows, (p) => p.amountMinor),
        countByCurrency(rows),
        'PERIOD',
      );
    };
    return {
      classification: 'PERIOD',
      created: item('createdAt'),
      approved: item('approvedAt'),
      submitted: item('submittedAt'),
      paid: item('paidAt'),
      failed: item('failedAt'),
      reversed: item('reversedAt'),
    };
  }
}

function earningAmount(e: EarningRow): bigint {
  return e.netEarningAmountMinor + e.additionalCompensationMinor + e.adjustmentAmountMinor;
}
function add(map: Totals, currency: string, amount: bigint) {
  map.set(currency, (map.get(currency) ?? 0n) + amount);
}
function totals<T extends { currency: string }>(rows: T[], value: (row: T) => bigint): Totals {
  const result = new Map<string, bigint>();
  for (const row of rows) add(result, row.currency, value(row));
  return result;
}
function money(values: Totals) {
  return [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amountMinor: amount.toString() }));
}
function metric(values: Totals, classification: 'PERIOD' | 'POINT_IN_TIME') {
  return { classification, values: money(values) };
}
function countByCurrency<T extends { currency: string }>(rows: T[]) {
  const result: Counts = new Map();
  for (const row of rows) result.set(row.currency, (result.get(row.currency) ?? 0) + 1);
  return result;
}
function countedMetric(
  values: Totals,
  counts: Counts,
  classification: 'PERIOD' | 'POINT_IN_TIME' = 'POINT_IN_TIME',
) {
  const currencies = [...new Set([...values.keys(), ...counts.keys()])].sort();
  return {
    classification,
    values: currencies.map((currency) => ({
      currency,
      amountMinor: (values.get(currency) ?? 0n).toString(),
      count: counts.get(currency) ?? 0,
    })),
  };
}
function statusTotals(rows: EarningRow[], value: (row: EarningRow) => bigint) {
  const result = new Map<OwnerEarningStatus, Totals>();
  for (const status of Object.values(OwnerEarningStatus)) result.set(status, new Map());
  for (const row of rows) add(result.get(row.status)!, row.currency, value(row));
  return result;
}
function statusMoney(values: Map<OwnerEarningStatus, Totals>) {
  return Object.fromEntries([...values].map(([status, totals]) => [status, money(totals)]));
}
function sumStatus(values: Map<OwnerEarningStatus, Totals>) {
  const result: Totals = new Map();
  for (const byCurrency of values.values())
    for (const [currency, amount] of byCurrency) add(result, currency, amount);
  return result;
}
function aggregateTotals(rows: AggregateRow[], negate = false) {
  return new Map(
    rows.map((row) => [row.currency, (row._sum.amountMinor ?? 0n) * (negate ? -1n : 1n)]),
  );
}
function aggregateCounts(rows: AggregateRow[]) {
  return new Map(rows.map((row) => [row.currency, row._count._all]));
}
function groupedEarningTotals(rows: Array<AggregateRow & { status: OwnerEarningStatus }>) {
  const result = new Map<OwnerEarningStatus, Totals>();
  for (const status of Object.values(OwnerEarningStatus)) result.set(status, new Map());
  for (const row of rows)
    add(
      result.get(row.status)!,
      row.currency,
      (row._sum.netEarningAmountMinor ?? 0n) +
        (row._sum.additionalCompensationMinor ?? 0n) +
        (row._sum.adjustmentAmountMinor ?? 0n),
    );
  return result;
}
