import { HttpStatus } from '@nestjs/common';
import { OwnerFinancialActivityScope, OwnerFinancialErrorCode } from '@carrental/api-contracts';
import { OwnerEarningStatus, PayoutStatus } from '@carrental/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationException } from '../common/errors/application.exception';
import { OwnerFinancialReadModelService } from './owner-financial-read-model.service';

const NOW = new Date('2026-10-03T04:00:00.000Z');

describe('Owner financial read model', () => {
  const queryRaw = vi.fn();
  const ownerFind = vi.fn();
  const earningFind = vi.fn();
  const payoutFind = vi.fn();
  const payoutFindFirst = vi.fn();
  const obligationFind = vi.fn();
  const ledgerFind = vi.fn();
  const database = {
    client: {
      $queryRaw: queryRaw,
      ledgerTransaction: { findMany: ledgerFind },
      ownerEarning: { findFirst: earningFind, findMany: earningFind },
      ownerFinancialObligation: { findMany: obligationFind },
      ownerProfile: { findUnique: ownerFind },
      payout: { findFirst: payoutFindFirst, findMany: payoutFind },
    },
  };
  const readiness = vi.fn();
  const eligibleAggregateSql = vi.fn().mockReturnValue('eligible');
  const service = new OwnerFinancialReadModelService(
    database as never,
    {
      eligibleAggregateSql,
      ownerReadiness: readiness,
    } as never,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    ownerFind.mockResolvedValue({ id: 'owner-a' });
    payoutFindFirst.mockResolvedValue(null);
    payoutFind.mockResolvedValue([]);
    earningFind.mockResolvedValue([]);
    obligationFind.mockResolvedValue([]);
    ledgerFind.mockResolvedValue([]);
    readiness.mockResolvedValue({ blockers: [] });
  });

  it('separates available, pending, held, and payout-ready authority', async () => {
    queryRaw
      .mockResolvedValueOnce([
        {
          availableMinor: 700n,
          currency: 'PHP',
          heldMinor: 300n,
          malformedCount: 0n,
          pendingMinor: 900n,
        },
      ])
      .mockResolvedValueOnce([{ amountMinor: 500n, currency: 'PHP' }]);

    await expect(service.summary('user-a')).resolves.toMatchObject({
      availableMinor: 700,
      currency: 'PHP',
      heldMinor: 300,
      payoutReadyMinor: 500,
      pendingMinor: 900,
    });
    expect(ownerFind).toHaveBeenCalledWith({ select: { id: true }, where: { userId: 'user-a' } });
    expect(eligibleAggregateSql).toHaveBeenCalledWith('owner-a');
  });

  it('returns authoritative active payout data without fabricating an expected date', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    payoutFindFirst.mockResolvedValue({
      amountMinor: 8925n,
      currency: 'PHP',
      destinationChannel: 'PH_BPI',
      destinationMasked: '••••1234',
      id: 'payout-a',
      publicReference: 'PO-ONE',
      status: PayoutStatus.PROCESSING,
    });
    const result = await service.summary('user-a');
    expect(result.upcomingPayout).toEqual({
      amountMinor: 8925,
      currency: 'PHP',
      expectedAt: null,
      id: 'payout-a',
      method: { channel: 'PH_BPI', maskedIdentifier: '••••1234' },
      publicReference: 'PO-ONE',
      status: PayoutStatus.PROCESSING,
    });
  });

  it('fails safely when holds exceed the earning authority', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        availableMinor: -1n,
        currency: 'PHP',
        heldMinor: 1001n,
        malformedCount: 1n,
        pendingMinor: 0n,
      },
    ]);
    await expect(service.summary('user-a')).rejects.toMatchObject({
      code: OwnerFinancialErrorCode.AUTHORITY_INCONSISTENT,
      status: HttpStatus.CONFLICT,
    });
  });

  it('orders compact upcoming activity deterministically and paginates without duplicates', async () => {
    earningFind.mockResolvedValue([
      earning({ createdAt: new Date('2026-10-02T00:00:00.000Z'), id: 'earning-a' }),
    ]);
    payoutFind.mockResolvedValue([
      {
        amountMinor: 2000n,
        createdAt: new Date('2026-10-03T00:00:00.000Z'),
        currency: 'PHP',
        id: 'payout-a',
        publicReference: 'PO-ONE',
        status: PayoutStatus.PROCESSING,
      },
      {
        amountMinor: 1500n,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
        currency: 'PHP',
        id: 'payout-b',
        publicReference: 'PO-TWO',
        status: PayoutStatus.APPROVED,
      },
    ]);
    const first = await service.activity('user-a', {
      page: 1,
      pageSize: 2,
      scope: OwnerFinancialActivityScope.UPCOMING,
    });
    const second = await service.activity('user-a', {
      page: 2,
      pageSize: 2,
      scope: OwnerFinancialActivityScope.UPCOMING,
    });
    expect(first.items.map(({ id }) => id)).toEqual(['payout:payout-a', 'earning:earning-a']);
    expect(first.nextPage).toBe(2);
    expect(second.items.map(({ id }) => id)).toEqual(['payout:payout-b']);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size).toBe(3);
  });

  it('projects signed compensation once and reconciled penalties explicitly', async () => {
    earningFind.mockResolvedValue([earning({ additionalCompensationMinor: 400n })]);
    obligationFind.mockResolvedValue([
      {
        currency: 'PHP',
        effectiveAt: NOW,
        id: 'penalty-a',
        originalAmountMinor: 500n,
        reasonCode: 'OWNER_CHANGED_PLANS',
        sourceCancellation: { booking: { publicReference: 'CR-PENALTY' } },
        status: 'OUTSTANDING',
      },
    ]);
    ledgerFind.mockResolvedValue([
      {
        entries: [
          { account: { type: 'OWNER_PENALTY_RECEIVABLE' }, amountMinor: 500n },
          { account: { type: 'PLATFORM_CANCELLATION_REVENUE' }, amountMinor: -500n },
        ],
        sourceId: 'penalty-a',
      },
    ]);
    const result = await service.activity('user-a', {
      page: 1,
      pageSize: 20,
      scope: OwnerFinancialActivityScope.ADJUSTMENTS,
    });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amountMinor: 400, type: 'COMPENSATION' }),
        expect.objectContaining({
          amountMinor: -500,
          bookingReference: 'CR-PENALTY',
          reasonCode: 'OWNER_CHANGED_PLANS',
          subtitle: 'Owner Changed Plans',
          type: 'PENALTY',
        }),
      ]),
    );
  });

  it('rejects a penalty whose accounting recognition is missing', async () => {
    obligationFind.mockResolvedValue([
      {
        currency: 'PHP',
        effectiveAt: NOW,
        id: 'penalty-a',
        originalAmountMinor: 500n,
        reasonCode: 'OWNER_CHANGED_PLANS',
        sourceCancellation: { booking: { publicReference: 'CR-PENALTY' } },
        status: 'OUTSTANDING',
      },
    ]);
    await expect(
      service.activity('user-a', {
        page: 1,
        pageSize: 20,
        scope: OwnerFinancialActivityScope.ADJUSTMENTS,
      }),
    ).rejects.toBeInstanceOf(ApplicationException);
  });

  it('uses authenticated Owner scope and returns not found for another Owner earning', async () => {
    earningFind.mockResolvedValue(null);
    await expect(service.earningDetail('owner-a-user', 'owner-b-earning')).rejects.toMatchObject({
      code: OwnerFinancialErrorCode.EARNING_NOT_FOUND,
      status: HttpStatus.NOT_FOUND,
    });
    expect(earningFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'owner-b-earning', ownerProfile: { userId: 'owner-a-user' } },
      }),
    );
  });

  it('omits zero-value reversal noise', async () => {
    earningFind.mockResolvedValue([
      earning({
        adjustmentAmountMinor: -1000n,
        netEarningAmountMinor: 1000n,
        status: OwnerEarningStatus.REVERSED,
      }),
    ]);
    const result = await service.activity('user-a', {
      page: 1,
      pageSize: 20,
      scope: OwnerFinancialActivityScope.ADJUSTMENTS,
    });
    expect(result.items).toEqual([]);
  });
});

function earning(overrides: Record<string, unknown> = {}) {
  return {
    additionalCompensationMinor: 0n,
    adjustmentAmountMinor: 0n,
    booking: {
      publicReference: 'CR-ONE',
      renter: { profile: { displayName: 'Mika Santos' } },
      vehicle: { make: 'Honda', model: 'City' },
    },
    collectionEarningMinor: 0n,
    createdAt: NOW,
    currency: 'PHP',
    deliveryEarningMinor: 0n,
    id: 'earning-a',
    lastFinancialResolutionAt: null,
    netEarningAmountMinor: 1000n,
    status: OwnerEarningStatus.PENDING,
    ...overrides,
  };
}
