export type OwnerObligationStatus = 'OUTSTANDING' | 'PARTIALLY_RECOVERED' | 'SATISFIED' | 'WAIVED';

export interface OwnerObligationBalance {
  originalAmountMinor: bigint;
  recoveredAmountMinor: bigint;
  remainingAmountMinor: bigint;
  waivedAmountMinor: bigint;
  currency: string;
  status: OwnerObligationStatus;
}

export interface PenaltyLedgerEntry {
  account: 'OWNER_PAYABLE' | 'OWNER_PENALTY_RECEIVABLE' | 'PLATFORM_CANCELLATION_REVENUE';
  amountMinor: bigint;
}

export function planOwnerObligationRecoveries(
  obligations: readonly { id: string; remainingAmountMinor: bigint }[],
  eligibleAmountMinor: bigint,
) {
  let capacity = eligibleAmountMinor;
  return obligations.flatMap((obligation) => {
    if (capacity <= 0n || obligation.remainingAmountMinor <= 0n) return [];
    const amountMinor =
      obligation.remainingAmountMinor < capacity ? obligation.remainingAmountMinor : capacity;
    capacity -= amountMinor;
    return [{ amountMinor, obligationId: obligation.id }];
  });
}

function assertCurrency(currency: string) {
  if (!/^[A-Z]{3}$/u.test(currency)) throw new Error('Currency must be a three-letter ISO code.');
}

function assertConserved(balance: OwnerObligationBalance) {
  if (
    balance.originalAmountMinor < 0n ||
    balance.recoveredAmountMinor < 0n ||
    balance.remainingAmountMinor < 0n ||
    balance.waivedAmountMinor < 0n ||
    balance.recoveredAmountMinor + balance.remainingAmountMinor + balance.waivedAmountMinor !==
      balance.originalAmountMinor
  ) {
    throw new Error('Owner obligation amounts must be non-negative and conserved.');
  }
}

export function createCancellationPenaltyBalance(input: {
  commissionAmountMinor: bigint;
  commissionCurrency: string;
  obligationCurrency: string;
}): OwnerObligationBalance {
  assertCurrency(input.commissionCurrency);
  assertCurrency(input.obligationCurrency);
  if (input.commissionCurrency !== input.obligationCurrency)
    throw new Error('Owner obligation currency must match the commission snapshot.');
  if (input.commissionAmountMinor < 0n)
    throw new Error('Owner cancellation penalty cannot be negative.');

  return {
    currency: input.obligationCurrency,
    originalAmountMinor: input.commissionAmountMinor,
    recoveredAmountMinor: 0n,
    remainingAmountMinor: input.commissionAmountMinor,
    status: 'OUTSTANDING',
    waivedAmountMinor: 0n,
  };
}

export function applyOwnerObligationRecovery(
  balance: OwnerObligationBalance,
  input: { amountMinor: bigint; currency: string; payoutGrossEarningMinor: bigint },
): OwnerObligationBalance {
  assertConserved(balance);
  if (input.currency !== balance.currency) throw new Error('Recovery currency mismatch.');
  if (input.amountMinor <= 0n) throw new Error('Recovery amount must be positive.');
  if (input.amountMinor > balance.remainingAmountMinor)
    throw new Error('Recovery exceeds the remaining obligation.');
  if (input.amountMinor > input.payoutGrossEarningMinor)
    throw new Error('Recovery cannot make the Owner payout negative.');

  const next = {
    ...balance,
    recoveredAmountMinor: balance.recoveredAmountMinor + input.amountMinor,
    remainingAmountMinor: balance.remainingAmountMinor - input.amountMinor,
    status: (balance.remainingAmountMinor === input.amountMinor
      ? 'SATISFIED'
      : 'PARTIALLY_RECOVERED') as OwnerObligationStatus,
  };
  assertConserved(next);
  return next;
}

export function applyOwnerObligationWaiver(
  balance: OwnerObligationBalance,
  input: { amountMinor: bigint; currency: string },
): OwnerObligationBalance {
  assertConserved(balance);
  if (input.currency !== balance.currency) throw new Error('Waiver currency mismatch.');
  if (input.amountMinor <= 0n) throw new Error('Waiver amount must be positive.');
  if (input.amountMinor > balance.remainingAmountMinor)
    throw new Error('Waiver exceeds the remaining obligation.');

  const remainingAmountMinor = balance.remainingAmountMinor - input.amountMinor;
  const next = {
    ...balance,
    remainingAmountMinor,
    waivedAmountMinor: balance.waivedAmountMinor + input.amountMinor,
    status: (remainingAmountMinor === 0n
      ? balance.recoveredAmountMinor === 0n
        ? 'WAIVED'
        : 'SATISFIED'
      : balance.recoveredAmountMinor > 0n
        ? 'PARTIALLY_RECOVERED'
        : 'OUTSTANDING') as OwnerObligationStatus,
  };
  assertConserved(next);
  return next;
}

export function ownerPenaltyLedgerEntries(
  type: 'OWNER_PENALTY_RECOGNITION' | 'OWNER_PENALTY_RECOVERY' | 'OWNER_PENALTY_WAIVER',
  amountMinor: bigint,
): PenaltyLedgerEntry[] {
  if (amountMinor <= 0n) throw new Error('Ledger amount must be positive.');
  if (type === 'OWNER_PENALTY_RECOGNITION')
    return [
      { account: 'OWNER_PENALTY_RECEIVABLE', amountMinor },
      { account: 'PLATFORM_CANCELLATION_REVENUE', amountMinor: -amountMinor },
    ];
  if (type === 'OWNER_PENALTY_RECOVERY')
    return [
      { account: 'OWNER_PAYABLE', amountMinor },
      { account: 'OWNER_PENALTY_RECEIVABLE', amountMinor: -amountMinor },
    ];
  return [
    { account: 'PLATFORM_CANCELLATION_REVENUE', amountMinor },
    { account: 'OWNER_PENALTY_RECEIVABLE', amountMinor: -amountMinor },
  ];
}
