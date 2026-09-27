import { describe, expect, it } from 'vitest';
import {
  applyOwnerObligationRecovery,
  applyOwnerObligationWaiver,
  createCancellationPenaltyBalance,
  ownerPenaltyLedgerEntries,
} from './owner-financial-obligations';

describe('Owner financial obligation primitives', () => {
  it('creates a fully outstanding penalty from the immutable commission amount', () => {
    expect(
      createCancellationPenaltyBalance({
        commissionAmountMinor: 1_500n,
        commissionCurrency: 'PHP',
        obligationCurrency: 'PHP',
      }),
    ).toEqual({
      currency: 'PHP',
      originalAmountMinor: 1_500n,
      recoveredAmountMinor: 0n,
      remainingAmountMinor: 1_500n,
      status: 'OUTSTANDING',
      waivedAmountMinor: 0n,
    });
  });

  it('represents partial multi-payout recovery and carry-forward without negative payout', () => {
    const original = createCancellationPenaltyBalance({
      commissionAmountMinor: 1_500n,
      commissionCurrency: 'PHP',
      obligationCurrency: 'PHP',
    });
    const partial = applyOwnerObligationRecovery(original, {
      amountMinor: 1_000n,
      currency: 'PHP',
      payoutGrossEarningMinor: 1_000n,
    });
    expect(partial).toMatchObject({
      recoveredAmountMinor: 1_000n,
      remainingAmountMinor: 500n,
      status: 'PARTIALLY_RECOVERED',
    });
    expect(
      applyOwnerObligationRecovery(partial, {
        amountMinor: 500n,
        currency: 'PHP',
        payoutGrossEarningMinor: 900n,
      }),
    ).toMatchObject({
      recoveredAmountMinor: 1_500n,
      remainingAmountMinor: 0n,
      status: 'SATISFIED',
    });
    expect(() =>
      applyOwnerObligationRecovery(original, {
        amountMinor: 1_001n,
        currency: 'PHP',
        payoutGrossEarningMinor: 1_000n,
      }),
    ).toThrow('cannot make the Owner payout negative');
  });

  it('supports partial and full waivers while conserving the original amount', () => {
    const original = createCancellationPenaltyBalance({
      commissionAmountMinor: 1_500n,
      commissionCurrency: 'PHP',
      obligationCurrency: 'PHP',
    });
    const partial = applyOwnerObligationWaiver(original, { amountMinor: 500n, currency: 'PHP' });
    expect(partial).toMatchObject({
      remainingAmountMinor: 1_000n,
      status: 'OUTSTANDING',
      waivedAmountMinor: 500n,
    });
    expect(
      applyOwnerObligationWaiver(partial, { amountMinor: 1_000n, currency: 'PHP' }),
    ).toMatchObject({ remainingAmountMinor: 0n, status: 'WAIVED', waivedAmountMinor: 1_500n });
  });

  it('rejects amount and currency invariant violations', () => {
    const balance = createCancellationPenaltyBalance({
      commissionAmountMinor: 500n,
      commissionCurrency: 'PHP',
      obligationCurrency: 'PHP',
    });
    expect(() =>
      createCancellationPenaltyBalance({
        commissionAmountMinor: 500n,
        commissionCurrency: 'PHP',
        obligationCurrency: 'USD',
      }),
    ).toThrow('currency must match');
    expect(() =>
      applyOwnerObligationRecovery(balance, {
        amountMinor: 0n,
        currency: 'PHP',
        payoutGrossEarningMinor: 500n,
      }),
    ).toThrow('must be positive');
    expect(() =>
      applyOwnerObligationWaiver(balance, { amountMinor: 600n, currency: 'PHP' }),
    ).toThrow('exceeds the remaining obligation');
  });

  it.each(['OWNER_PENALTY_RECOGNITION', 'OWNER_PENALTY_RECOVERY', 'OWNER_PENALTY_WAIVER'] as const)(
    'builds a balanced %s transaction',
    (type) => {
      const entries = ownerPenaltyLedgerEntries(type, 1_500n);
      expect(entries.reduce((total, entry) => total + entry.amountMinor, 0n)).toBe(0n);
    },
  );

  it('keeps normal commission separate from penalty ledger entries', () => {
    const accounts = ownerPenaltyLedgerEntries('OWNER_PENALTY_RECOGNITION', 500n).map(
      ({ account }) => account,
    );
    expect(accounts).toContain('PLATFORM_CANCELLATION_REVENUE');
    expect(accounts).not.toContain('PLATFORM_COMMISSION_REVENUE');
  });
});
