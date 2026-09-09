import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingStatus,
  FinancialAccountType,
  LedgerTransactionType,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import {
  OWNER_ANALYTICS_DEFINITION_VERSION,
  OWNER_ANALYTICS_TIMEZONE,
  resolveOwnerAnalyticsPeriod,
  type OwnerAnalyticsPeriod,
} from './owner-analytics.period';

const CAPTURED_STATUSES = [
  PaymentStatus.CAPTURED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
] as const;

type CurrencyTotals = Map<string, bigint>;

@Injectable()
export class OwnerAnalyticsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async overview(input: {
    period: OwnerAnalyticsPeriod;
    startDate?: string;
    endDate?: string;
    now?: Date;
  }) {
    const range = resolveOwnerAnalyticsPeriod(input);
    const generatedAt = input.now ?? new Date();
    const [current, previous, activeRentalsNow] = await Promise.all([
      this.periodMetrics(range.startInclusive, range.endExclusive),
      this.periodMetrics(range.comparisonStartInclusive, range.comparisonEndExclusive),
      this.database.client.booking.count({
        where: { status: { in: [BookingStatus.ACTIVE, BookingStatus.RETURN_PENDING] } },
      }),
    ]);
    const environment = this.configuration.getOrThrow('APP_ENV', { infer: true });
    return {
      metadata: {
        comparisonEndExclusive: range.comparisonEndExclusive.toISOString(),
        comparisonStartInclusive: range.comparisonStartInclusive.toISOString(),
        currency: 'GROUPED_BY_CURRENCY',
        definitionVersion: OWNER_ANALYTICS_DEFINITION_VERSION,
        endExclusive: range.endExclusive.toISOString(),
        environment,
        generatedAt: generatedAt.toISOString(),
        period: range.period,
        startInclusive: range.startInclusive.toISOString(),
        syntheticData: environment !== 'production',
        timezone: OWNER_ANALYTICS_TIMEZONE,
      },
      metrics: {
        activeRentalsNow: {
          classification: 'pointInTime',
          definition: 'Current bookings in ACTIVE or RETURN_PENDING.',
          generatedAt: generatedAt.toISOString(),
          source: ['Booking.status'],
          value: activeRentalsNow,
        },
        bookingsCreated: comparisonMetric(current.bookingsCreated, previous.bookingsCreated, [
          'Booking.createdAt',
        ]),
        capturedRentalGbv: currencyMetric(current.capturedRentalGbv, previous.capturedRentalGbv, [
          'BookingPricingSnapshot.totalMinor',
          'Payment.capturedAt',
        ]),
        completedRefunds: currencyMetric(current.completedRefunds, previous.completedRefunds, [
          'Refund.amountMinor',
          'Refund.completedAt',
        ]),
        completedRentals: comparisonMetric(current.completedRentals, previous.completedRentals, [
          'BookingStatusHistory.toStatus=COMPLETED',
          'BookingStatusHistory.occurredAt',
        ]),
        confirmedBookings: comparisonMetric(current.confirmedBookings, previous.confirmedBookings, [
          'BookingStatusHistory.toStatus=CONFIRMED',
          'BookingStatusHistory.occurredAt',
        ]),
        recognizedCarShareCommission: currencyMetric(
          current.recognizedCommission,
          previous.recognizedCommission,
          ['LedgerEntry.amountMinor', 'LedgerTransaction.postedAt'],
        ),
      },
      reconciliation: {
        capturedRentalPaymentsChecked: current.capturedRentalPaymentsChecked,
        status: 'PASS',
      },
    };
  }

  private async periodMetrics(startInclusive: Date, endExclusive: Date) {
    const dateRange = { gte: startInclusive, lt: endExclusive };
    const [payments, ledgerTransactions, refunds, bookingsCreated, confirmed, completed] =
      await Promise.all([
        this.database.client.payment.findMany({
          include: { booking: { include: { pricingSnapshot: true } }, commission: true },
          orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
          where: {
            capturedAt: dateRange,
            purpose: PaymentPurpose.RENTAL,
            reconciliationRequired: false,
            status: { in: [...CAPTURED_STATUSES] },
          },
        }),
        this.database.client.ledgerTransaction.findMany({
          include: {
            entries: {
              include: { account: true },
              where: { account: { type: FinancialAccountType.PLATFORM_COMMISSION_REVENUE } },
            },
          },
          where: { postedAt: dateRange },
        }),
        this.database.client.refund.findMany({
          select: { amountMinor: true, currency: true },
          where: { completedAt: dateRange, status: RefundStatus.COMPLETED },
        }),
        this.database.client.booking.count({ where: { createdAt: dateRange } }),
        this.firstTransitions(BookingStatus.CONFIRMED, startInclusive, endExclusive),
        this.firstTransitions(BookingStatus.COMPLETED, startInclusive, endExclusive),
      ]);

    const firstPaymentByBooking = new Map<string, (typeof payments)[number]>();
    for (const payment of payments)
      if (!firstPaymentByBooking.has(payment.bookingId))
        firstPaymentByBooking.set(payment.bookingId, payment);

    const capturedRentalGbv: CurrencyTotals = new Map();
    for (const payment of firstPaymentByBooking.values()) {
      const snapshot = payment.booking.pricingSnapshot;
      if (!snapshot) throw new Error('OWNER_ANALYTICS_MISSING_PRICING_SNAPSHOT');
      add(capturedRentalGbv, snapshot.currency, BigInt(snapshot.totalMinor));
    }

    this.assertCaptureCommissionReconciliation(firstPaymentByBooking, ledgerTransactions);

    const recognizedCommission: CurrencyTotals = new Map();
    for (const transaction of ledgerTransactions)
      for (const entry of transaction.entries)
        add(recognizedCommission, entry.currency, -entry.amountMinor);

    const completedRefunds: CurrencyTotals = new Map();
    for (const refund of refunds) add(completedRefunds, refund.currency, refund.amountMinor);

    return {
      bookingsCreated,
      capturedRentalGbv,
      capturedRentalPaymentsChecked: firstPaymentByBooking.size,
      completedRefunds,
      completedRentals: completed,
      confirmedBookings: confirmed,
      recognizedCommission,
    };
  }

  private async firstTransitions(status: BookingStatus, startInclusive: Date, endExclusive: Date) {
    const rows = await this.database.client.bookingStatusHistory.groupBy({
      _min: { occurredAt: true },
      by: ['bookingId'],
      having: { occurredAt: { _min: { gte: startInclusive, lt: endExclusive } } },
      where: { toStatus: status },
    });
    return rows.length;
  }

  private assertCaptureCommissionReconciliation(
    payments: Map<string, { id: string; commission: { calculatedCommissionMinor: bigint } | null }>,
    ledgerTransactions: Array<{
      sourceId: string;
      type: LedgerTransactionType;
      entries: Array<{ amountMinor: bigint; account: { type: FinancialAccountType } }>;
    }>,
  ) {
    const allocations = new Map(
      ledgerTransactions
        .filter(({ type }) => type === LedgerTransactionType.CAPTURE_ALLOCATION)
        .map((transaction) => [transaction.sourceId, transaction]),
    );
    for (const payment of payments.values()) {
      if (!payment.commission) throw new Error('OWNER_ANALYTICS_MISSING_COMMISSION_SNAPSHOT');
      const allocation = allocations.get(payment.id);
      const ledgerCommission = allocation?.entries.reduce(
        (total, entry) => total - entry.amountMinor,
        0n,
      );
      if (ledgerCommission !== payment.commission.calculatedCommissionMinor)
        throw new Error('OWNER_ANALYTICS_COMMISSION_RECONCILIATION_FAILED');
    }
  }
}

function add(totals: CurrencyTotals, currency: string, value: bigint) {
  totals.set(currency, (totals.get(currency) ?? 0n) + value);
}

function comparisonMetric(current: number, previous: number, source: string[]) {
  const difference = current - previous;
  return {
    absoluteChange: difference,
    classification: 'period' as const,
    comparisonAvailable: previous !== 0,
    current,
    percentageChange: previous === 0 ? null : percentage(BigInt(difference), BigInt(previous)),
    previous,
    source,
  };
}

function currencyMetric(current: CurrencyTotals, previous: CurrencyTotals, source: string[]) {
  const currencies = [...new Set([...current.keys(), ...previous.keys()])].sort();
  return {
    classification: 'period' as const,
    source,
    values: currencies.map((currency) => {
      const currentValue = current.get(currency) ?? 0n;
      const previousValue = previous.get(currency) ?? 0n;
      const difference = currentValue - previousValue;
      return {
        absoluteChangeMinor: difference.toString(),
        comparisonAvailable: previousValue !== 0n,
        currency,
        currentMinor: currentValue.toString(),
        percentageChange: previousValue === 0n ? null : percentage(difference, previousValue),
        previousMinor: previousValue.toString(),
      };
    }),
  };
}

function percentage(numerator: bigint, denominator: bigint): string {
  const hundredths = (numerator * 10_000n) / denominator;
  const sign = hundredths < 0n ? '-' : '';
  const absolute = hundredths < 0n ? -hundredths : hundredths;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
