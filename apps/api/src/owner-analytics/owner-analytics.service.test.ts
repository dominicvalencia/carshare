import { describe, expect, it, vi } from 'vitest';
import {
  FinancialAccountType,
  LedgerTransactionType,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
} from '@carrental/database';
import { OwnerAnalyticsService } from './owner-analytics.service';

function payment(input: {
  id: string;
  bookingId: string;
  amount: number;
  commission: bigint;
  currency?: string;
}) {
  return {
    booking: {
      pricingSnapshot: { currency: input.currency ?? 'PHP', totalMinor: input.amount },
    },
    bookingId: input.bookingId,
    commission: { calculatedCommissionMinor: input.commission },
    id: input.id,
  };
}

function allocation(id: string, amount: bigint, currency = 'PHP') {
  return {
    entries: [
      {
        account: { type: FinancialAccountType.PLATFORM_COMMISSION_REVENUE },
        amountMinor: -amount,
        currency,
      },
    ],
    sourceId: id,
    type: LedgerTransactionType.CAPTURE_ALLOCATION,
  };
}

function service(input: {
  currentPayments?: ReturnType<typeof payment>[];
  previousPayments?: ReturnType<typeof payment>[];
  currentLedger?: ReturnType<typeof allocation>[];
  previousLedger?: ReturnType<typeof allocation>[];
  currentRefunds?: Array<{ amountMinor: bigint; currency: string }>;
  previousRefunds?: Array<{ amountMinor: bigint; currency: string }>;
  counts?: number[];
  transitions?: Array<Array<{ bookingId: string; _min: { occurredAt: Date | null } }>>;
}) {
  const paymentFindMany = vi
    .fn()
    .mockResolvedValueOnce(input.currentPayments ?? [])
    .mockResolvedValueOnce(input.previousPayments ?? []);
  const ledgerFindMany = vi
    .fn()
    .mockResolvedValueOnce(input.currentLedger ?? [])
    .mockResolvedValueOnce(input.previousLedger ?? []);
  const refundFindMany = vi
    .fn()
    .mockResolvedValueOnce(input.currentRefunds ?? [])
    .mockResolvedValueOnce(input.previousRefunds ?? []);
  const bookingCount = vi.fn();
  for (const count of input.counts ?? [2, 1, 2]) bookingCount.mockResolvedValueOnce(count);
  const transitionFindMany = vi.fn();
  for (const rows of input.transitions ?? [[], [], [], []])
    transitionFindMany.mockResolvedValueOnce(rows);
  const instance = new OwnerAnalyticsService(
    {
      client: {
        booking: { count: bookingCount },
        bookingStatusHistory: { groupBy: transitionFindMany },
        ledgerTransaction: { findMany: ledgerFindMany },
        payment: { findMany: paymentFindMany },
        refund: { findMany: refundFindMany },
      },
    } as never,
    { getOrThrow: vi.fn().mockReturnValue('local') } as never,
  );
  return { bookingCount, instance, paymentFindMany, refundFindMany, transitionFindMany };
}

describe('OwnerAnalyticsService', () => {
  it('deduplicates captured rental GBV, preserves it after refunds, and separates ledger revenue', async () => {
    const first = payment({
      bookingId: 'booking-1',
      commission: 12_345n,
      id: 'payment-1',
      amount: 123_456,
    });
    const duplicate = payment({
      bookingId: 'booking-1',
      commission: 12_345n,
      id: 'payment-retry',
      amount: 123_456,
    });
    const { instance, paymentFindMany, refundFindMany } = service({
      currentLedger: [
        allocation('payment-1', 12_345n),
        {
          entries: [
            {
              account: { type: FinancialAccountType.PLATFORM_COMMISSION_REVENUE },
              amountMinor: 2_345n,
              currency: 'PHP',
            },
          ],
          sourceId: 'refund-1',
          type: LedgerTransactionType.REFUND,
        },
      ],
      currentPayments: [first, duplicate],
      currentRefunds: [{ amountMinor: 23_456n, currency: 'PHP' }],
    });
    const result = await instance.overview({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });

    expect(result.metrics.capturedRentalGbv.values).toEqual([
      expect.objectContaining({ currency: 'PHP', currentMinor: '123456' }),
    ]);
    expect(result.metrics.completedRefunds.values).toEqual([
      expect.objectContaining({ currentMinor: '23456' }),
    ]);
    expect(result.metrics.recognizedCarShareCommission.values).toEqual([
      expect.objectContaining({ currentMinor: '10000' }),
    ]);
    expect(result.reconciliation).toEqual({ capturedRentalPaymentsChecked: 1, status: 'PASS' });
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purpose: PaymentPurpose.RENTAL,
          reconciliationRequired: false,
          status: {
            in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
          },
        }),
      }),
    );
    expect(refundFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: RefundStatus.COMPLETED }),
      }),
    );
    expect(result.metadata).toMatchObject({
      definitionVersion: 'owner-analytics-v1',
      currency: 'GROUPED_BY_CURRENCY',
      environment: 'local',
      syntheticData: true,
      timezone: 'Asia/Manila',
    });
  });

  it('keeps currencies separate and serializes large integer values without floating point', async () => {
    const { instance } = service({
      currentLedger: [
        allocation('php-payment', 9_007_199_254_740_993n),
        allocation('usd-payment', 25n, 'USD'),
      ],
      currentPayments: [
        payment({
          bookingId: 'php-booking',
          commission: 9_007_199_254_740_993n,
          id: 'php-payment',
          amount: 100,
          currency: 'PHP',
        }),
        payment({
          bookingId: 'usd-booking',
          commission: 25n,
          id: 'usd-payment',
          amount: 200,
          currency: 'USD',
        }),
      ],
    });
    const result = await instance.overview({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });
    expect(result.metrics.recognizedCarShareCommission.values).toEqual([
      expect.objectContaining({ currency: 'PHP', currentMinor: '9007199254740993' }),
      expect.objectContaining({ currency: 'USD', currentMinor: '25' }),
    ]);
  });

  it('counts only first lifecycle transitions inside inclusive/exclusive bounds', async () => {
    const start = new Date('2026-09-08T16:00:00.000Z');
    const end = new Date('2026-09-09T16:00:00.000Z');
    const { instance, transitionFindMany } = service({
      counts: [4, 2, 2],
      transitions: [
        [
          { bookingId: 'before', _min: { occurredAt: new Date(start.getTime() - 1) } },
          { bookingId: 'start', _min: { occurredAt: start } },
          { bookingId: 'end', _min: { occurredAt: end } },
        ],
        [{ bookingId: 'completed', _min: { occurredAt: new Date('2026-09-09T00:00:00.000Z') } }],
        [],
        [],
      ],
    });
    const result = await instance.overview({ now: start, period: 'TODAY' });
    expect(result.metrics.bookingsCreated.current).toBe(4);
    expect(result.metrics.confirmedBookings.current).toBe(3);
    expect(result.metrics.completedRentals.current).toBe(1);
    expect(result.metrics.activeRentalsNow).toMatchObject({
      classification: 'pointInTime',
      value: 2,
    });
    expect(transitionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        having: { occurredAt: { _min: { gte: start, lt: end } } },
      }),
    );
    expect(result.metrics.bookingsCreated).toMatchObject({
      absoluteChange: 2,
      comparisonAvailable: true,
      percentageChange: '100.00',
      previous: 2,
    });
  });

  it('returns unavailable percentage comparison when the previous value is zero', async () => {
    const { instance } = service({ counts: [3, 0, 0] });
    const result = await instance.overview({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });
    expect(result.metrics.bookingsCreated).toMatchObject({
      absoluteChange: 3,
      comparisonAvailable: false,
      percentageChange: null,
    });
  });

  it('fails safely when capture, immutable snapshot, and ledger disagree', async () => {
    const captured = payment({
      bookingId: 'booking-1',
      commission: 500n,
      id: 'payment-1',
      amount: 1_000,
    });
    await expect(
      service({
        currentLedger: [allocation('payment-1', 499n)],
        currentPayments: [captured],
      }).instance.overview({
        now: new Date('2026-09-09T04:00:00.000Z'),
        period: 'TODAY',
      }),
    ).rejects.toThrow('OWNER_ANALYTICS_COMMISSION_RECONCILIATION_FAILED');

    await expect(
      service({
        currentPayments: [{ ...captured, booking: { pricingSnapshot: null } }] as never,
      }).instance.overview({
        now: new Date('2026-09-09T04:00:00.000Z'),
        period: 'TODAY',
      }),
    ).rejects.toThrow('OWNER_ANALYTICS_MISSING_PRICING_SNAPSHOT');
  });
});
