import {
  DisputeStatus,
  PostReturnClaimStatus,
  SecurityDepositSettlementStatus,
} from '@carrental/database';

const finalClaimStatuses = new Set<PostReturnClaimStatus>([
  PostReturnClaimStatus.PAYMENT_PENDING,
  PostReturnClaimStatus.RESOLVED,
  PostReturnClaimStatus.WITHDRAWN,
]);
const terminalDisputeStatuses = new Set<DisputeStatus>([
  DisputeStatus.RESOLVED_FOR_RENTER,
  DisputeStatus.RESOLVED_FOR_OWNER,
  DisputeStatus.PARTIALLY_RESOLVED,
  DisputeStatus.CLOSED,
]);

const transitions: Readonly<
  Record<SecurityDepositSettlementStatus, readonly SecurityDepositSettlementStatus[]>
> = {
  APPROVED: [
    SecurityDepositSettlementStatus.RELEASE_PENDING,
    SecurityDepositSettlementStatus.CAPTURE_PENDING,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  CAPTURED_RELEASE_PENDING: [
    SecurityDepositSettlementStatus.PARTIALLY_USED,
    SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  CAPTURE_PENDING: [
    SecurityDepositSettlementStatus.CAPTURED_RELEASE_PENDING,
    SecurityDepositSettlementStatus.USED,
    SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  DISPUTED: [
    SecurityDepositSettlementStatus.SETTLEMENT_REVIEW,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  MANUAL_REVIEW: [SecurityDepositSettlementStatus.SETTLEMENT_REVIEW],
  PARTIALLY_USED: [
    SecurityDepositSettlementStatus.REVERSED,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  RELEASED: [SecurityDepositSettlementStatus.MANUAL_REVIEW],
  RELEASE_PENDING: [
    SecurityDepositSettlementStatus.RELEASED,
    SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  REVERSED: [],
  SETTLEMENT_REVIEW: [
    SecurityDepositSettlementStatus.DISPUTED,
    SecurityDepositSettlementStatus.APPROVED,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  SETTLEMENT_UNKNOWN: [
    SecurityDepositSettlementStatus.RELEASED,
    SecurityDepositSettlementStatus.PARTIALLY_USED,
    SecurityDepositSettlementStatus.USED,
    SecurityDepositSettlementStatus.MANUAL_REVIEW,
  ],
  USED: [SecurityDepositSettlementStatus.REVERSED, SecurityDepositSettlementStatus.MANUAL_REVIEW],
};

export const financiallyTerminalSettlementStatuses = new Set<SecurityDepositSettlementStatus>([
  SecurityDepositSettlementStatus.RELEASED,
  SecurityDepositSettlementStatus.PARTIALLY_USED,
  SecurityDepositSettlementStatus.USED,
  SecurityDepositSettlementStatus.REVERSED,
]);

export function canTransitionSecurityDepositSettlement(
  from: SecurityDepositSettlementStatus,
  to: SecurityDepositSettlementStatus,
): boolean {
  return transitions[from].includes(to);
}

export function assertSecurityDepositSettlementTransition(
  from: SecurityDepositSettlementStatus,
  to: SecurityDepositSettlementStatus,
): void {
  if (!canTransitionSecurityDepositSettlement(from, to)) {
    throw new Error(`Security Deposit settlement cannot transition from ${from} to ${to}.`);
  }
}

export function assertSettlementDecisionEligible(input: {
  readonly claimDeadlineAt: Date | null;
  readonly claims: readonly {
    readonly status: PostReturnClaimStatus;
    readonly disputes: readonly { readonly status: DisputeStatus }[];
  }[];
  readonly bookingDisputes?: readonly { readonly status: DisputeStatus }[];
  readonly now: Date;
}): void {
  if (!input.claimDeadlineAt || input.claimDeadlineAt > input.now)
    throw new Error('The claim window must close before settlement approval.');
  if (input.claims.some((claim) => !finalClaimStatuses.has(claim.status)))
    throw new Error('All claims must reach a final adjudication state before settlement approval.');
  if (
    input.claims.some((claim) =>
      claim.disputes.some((dispute) => !terminalDisputeStatuses.has(dispute.status)),
    ) ||
    input.bookingDisputes?.some((dispute) => !terminalDisputeStatuses.has(dispute.status))
  )
    throw new Error('An open dispute blocks settlement approval.');
}

export interface SettlementAllocationInput {
  readonly id: string;
  readonly approvedAmountMinor: bigint;
}

export interface SettlementAllocation extends SettlementAllocationInput {
  readonly depositAppliedMinor: bigint;
  readonly excessAmountMinor: bigint;
}

export function allocateSecurityDepositSettlement(
  authorizedAmountMinor: bigint,
  alreadyUsedAmountMinor: bigint,
  items: readonly SettlementAllocationInput[],
) {
  if (authorizedAmountMinor < 0n || alreadyUsedAmountMinor < 0n)
    throw new Error('Security Deposit amounts cannot be negative.');
  let remaining = authorizedAmountMinor - alreadyUsedAmountMinor;
  if (remaining < 0n) remaining = 0n;
  const allocations: SettlementAllocation[] = [];
  let approvedDeductionMinor = 0n;
  for (const item of items) {
    if (item.approvedAmountMinor < 0n) throw new Error('Approved claim amount cannot be negative.');
    const depositAppliedMinor =
      item.approvedAmountMinor < remaining ? item.approvedAmountMinor : remaining;
    remaining -= depositAppliedMinor;
    approvedDeductionMinor += depositAppliedMinor;
    allocations.push({
      ...item,
      depositAppliedMinor,
      excessAmountMinor: item.approvedAmountMinor - depositAppliedMinor,
    });
  }
  return {
    allocations,
    approvedDeductionMinor,
    releaseAmountMinor: remaining,
    remainingAuthorizedAmountMinor:
      authorizedAmountMinor - alreadyUsedAmountMinor < 0n
        ? 0n
        : authorizedAmountMinor - alreadyUsedAmountMinor,
  };
}
