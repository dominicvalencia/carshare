import { describe, expect, it, vi } from 'vitest';
import {
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  PaymentPurpose,
  PaymentStatus,
} from '@carrental/database';
import { OWNER_REVENUE_DEFINITION_VERSION, OwnerRevenueService } from './owner-revenue.service';

const earning = {
  additionalCompensationMinor: 0n,
  adjustmentAmountMinor: 0n,
  commissionAmountMinor: 110n,
  currency: 'PHP',
  grossRentalAmountMinor: 1_000n,
  id: 'earning-1',
  netEarningAmountMinor: 890n,
  status: OwnerEarningStatus.AVAILABLE,
};

function rental(overrides: Record<string, unknown> = {}) {
  return {
    booking: { pricingSnapshot: { currency: 'PHP', totalMinor: 1_000 } },
    bookingId: 'booking-1',
    capturedAmountMinor: 1_000n,
    commission: {
      calculatedCommissionMinor: 110n,
      commissionableBaseMinor: 1_000n,
      currency: 'PHP',
    },
    currency: 'PHP',
    id: 'payment-1',
    ownerEarning: earning,
    purpose: PaymentPurpose.RENTAL,
    ...overrides,
  };
}

function transaction(
  type: LedgerTransactionType,
  entries: Array<[FinancialAccountType, bigint]>,
  sourceId = 'payment-1',
  currency = 'PHP',
) {
  return {
    entries: entries.map(([accountType, amountMinor]) => ({
      account: { type: accountType },
      amountMinor,
      currency,
    })),
    sourceId,
    sourceType: 'PAYMENT',
    type,
  };
}

function standardTransactions(sourceId = 'payment-1', currency = 'PHP') {
  return [
    transaction(
      LedgerTransactionType.CAPTURE_RECOGNITION,
      [
        [FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE, 1_000n],
        [FinancialAccountType.CUSTOMER_FUNDS_HELD, -1_000n],
      ],
      sourceId,
      currency,
    ),
    transaction(
      LedgerTransactionType.CAPTURE_ALLOCATION,
      [
        [FinancialAccountType.CUSTOMER_FUNDS_HELD, 1_000n],
        [FinancialAccountType.OWNER_PAYABLE, -890n],
        [FinancialAccountType.PLATFORM_COMMISSION_REVENUE, -110n],
      ],
      sourceId,
      currency,
    ),
  ];
}

function makeService(
  payments = [rental()],
  excluded = 1,
  ledgerTransactions = standardTransactions(),
) {
  const client = {
    additionalCharge: { findMany: vi.fn().mockResolvedValue([]) },
    ledgerEntry: {
      groupBy: vi
        .fn()
        .mockResolvedValue([
          { _count: { _all: 1 }, _sum: { amountMinor: -890n }, currency: 'PHP' },
        ]),
    },
    ledgerTransaction: { findMany: vi.fn().mockResolvedValue(ledgerTransactions) },
    ownerEarning: {
      findMany: vi.fn().mockResolvedValue([earning]),
      groupBy: vi.fn().mockResolvedValue([
        {
          _count: { _all: 1 },
          _sum: {
            additionalCompensationMinor: 0n,
            adjustmentAmountMinor: 0n,
            netEarningAmountMinor: 890n,
          },
          currency: 'PHP',
          status: OwnerEarningStatus.AVAILABLE,
        },
      ]),
    },
    payment: {
      count: vi.fn().mockResolvedValue(excluded),
      findMany: vi.fn().mockResolvedValueOnce(payments).mockResolvedValueOnce([]),
    },
    payout: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    payoutItem: { groupBy: vi.fn().mockResolvedValue([]) },
    refund: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([{ amountMinor: 890n, count: 1, currency: 'PHP' }]),
  };
  return {
    client,
    service: new OwnerRevenueService(
      { client } as never,
      { getOrThrow: vi.fn().mockReturnValue('local') } as never,
      { eligibleAggregateSql: vi.fn().mockReturnValue({}) } as never,
    ),
  };
}

describe('OwnerRevenueService', () => {
  it('returns authoritative period activity and distinct point-in-time balances', async () => {
    const { service } = makeService();
    const result = await service.summary({
      now: new Date('2026-09-09T04:00:00.000Z'),
      period: 'TODAY',
    });

    expect(result.metadata).toMatchObject({
      definitionVersion: OWNER_REVENUE_DEFINITION_VERSION,
      environment: 'local',
      syntheticData: true,
      timezone: 'Asia/Manila',
    });
    expect(result.periodActivity.capturedCollections.rental).toEqual([
      { amountMinor: '1000', currency: 'PHP' },
    ]);
    expect(result.periodActivity.rentalGbv.values).toEqual([
      { amountMinor: '1000', currency: 'PHP' },
    ]);
    expect(result.periodActivity.recognizedCarShareCommission.values).toEqual([
      { amountMinor: '110', currency: 'PHP' },
    ]);
    expect(result.periodActivity.ownerEarnings.byStatus.AVAILABLE).toEqual([
      { amountMinor: '890', currency: 'PHP' },
    ]);
    expect(result.pointInTime.ownerPayableLiability.values).toEqual([
      { amountMinor: '890', currency: 'PHP' },
    ]);
    expect(result.pointInTime.availableForPayout.values).toEqual([
      { amountMinor: '890', currency: 'PHP' },
    ]);
    expect(result.integrity).toEqual({
      authoritativeTotalsComplete: false,
      excludedReconciliationRequiredCount: 1,
      financialIntegrityWarning: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/email|destination|providerRequest|ledgerEntries/u);
  });

  it('keeps currencies separate and serializes bigint amounts as strings', async () => {
    const second = rental({ bookingId: 'booking-2', currency: 'USD', id: 'payment-2' });
    second.booking = { pricingSnapshot: { currency: 'USD', totalMinor: 1_000 } };
    second.commission = { ...second.commission, currency: 'USD' };
    second.ownerEarning = { ...earning, currency: 'USD', id: 'earning-2' };
    const { service } = makeService([rental(), second], 0, [
      ...standardTransactions(),
      ...standardTransactions('payment-2', 'USD'),
    ]);
    const result = await service.summary({ period: 'TODAY' });
    expect(result.periodActivity.capturedCollections.rental).toEqual([
      { amountMinor: '1000', currency: 'PHP' },
      { amountMinor: '1000', currency: 'USD' },
    ]);
  });

  it('fails closed for duplicate logical captures and reconciliation mismatches', async () => {
    await expect(
      makeService([rental(), rental({ id: 'payment-retry' })], 0, [
        ...standardTransactions(),
        ...standardTransactions('payment-retry'),
      ]).service.summary({ period: 'TODAY' }),
    ).rejects.toThrow('OWNER_REVENUE_DUPLICATE_LOGICAL_CAPTURE');
    await expect(
      makeService([rental({ booking: { pricingSnapshot: null } })]).service.summary({
        period: 'TODAY',
      }),
    ).rejects.toThrow('OWNER_REVENUE_MISSING_PRICING_SNAPSHOT');
    await expect(
      makeService([rental({ capturedAmountMinor: 999n })]).service.summary({ period: 'TODAY' }),
    ).rejects.toThrow('OWNER_REVENUE_CAPTURE_RECONCILIATION_FAILED');
  });

  it('queries only captured, reconciled payments and completed refunds', async () => {
    const { client, service } = makeService();
    await service.summary({ period: 'THIS_MONTH' });
    expect(client.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          reconciliationRequired: false,
          status: {
            in: [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED],
          },
        }),
      }),
    );
    expect(client.refund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED' }) }),
    );
  });
});
