import { describe, expect, it } from 'vitest';
import {
  DisputeStatus,
  PostReturnClaimStatus,
  SecurityDepositSettlementStatus,
} from '@carrental/database';
import {
  allocateSecurityDepositSettlement,
  assertSettlementDecisionEligible,
  assertSecurityDepositSettlementTransition,
  canTransitionSecurityDepositSettlement,
  financiallyTerminalSettlementStatuses,
} from './security-deposit-settlement.domain';

describe('Security Deposit settlement domain', () => {
  it('aggregates claims in stable order and caps deposit use at the remaining authorization', () => {
    const result = allocateSecurityDepositSettlement(300_000n, 0n, [
      { approvedAmountMinor: 100_000n, id: 'claim-a' },
      { approvedAmountMinor: 250_000n, id: 'claim-b' },
    ]);

    expect(result).toEqual({
      allocations: [
        {
          approvedAmountMinor: 100_000n,
          depositAppliedMinor: 100_000n,
          excessAmountMinor: 0n,
          id: 'claim-a',
        },
        {
          approvedAmountMinor: 250_000n,
          depositAppliedMinor: 200_000n,
          excessAmountMinor: 50_000n,
          id: 'claim-b',
        },
      ],
      approvedDeductionMinor: 300_000n,
      releaseAmountMinor: 0n,
      remainingAuthorizedAmountMinor: 300_000n,
    });
  });

  it('calculates the release amount after prior proven use', () => {
    expect(allocateSecurityDepositSettlement(500_000n, 100_000n, []).releaseAmountMinor).toBe(
      400_000n,
    );
  });

  it('keeps UNKNOWN distinct and limits transitions through explicit authority', () => {
    expect(
      canTransitionSecurityDepositSettlement(
        SecurityDepositSettlementStatus.CAPTURE_PENDING,
        SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
      ),
    ).toBe(true);
    expect(
      canTransitionSecurityDepositSettlement(
        SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
        SecurityDepositSettlementStatus.USED,
      ),
    ).toBe(true);
    expect(() =>
      assertSecurityDepositSettlementTransition(
        SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
        SecurityDepositSettlementStatus.APPROVED,
      ),
    ).toThrow('cannot transition');
  });

  it('does not treat review, approved, uncertainty, or manual review as financially terminal', () => {
    for (const status of [
      SecurityDepositSettlementStatus.SETTLEMENT_REVIEW,
      SecurityDepositSettlementStatus.APPROVED,
      SecurityDepositSettlementStatus.SETTLEMENT_UNKNOWN,
      SecurityDepositSettlementStatus.MANUAL_REVIEW,
    ]) {
      expect(financiallyTerminalSettlementStatuses.has(status)).toBe(false);
    }
    expect(
      financiallyTerminalSettlementStatuses.has(SecurityDepositSettlementStatus.RELEASED),
    ).toBe(true);
  });

  it('blocks decisions while the claim window is open or a claim is unresolved', () => {
    const now = new Date('2026-10-05T00:00:00.000Z');
    expect(() =>
      assertSettlementDecisionEligible({
        claimDeadlineAt: new Date('2026-10-06T00:00:00.000Z'),
        claims: [],
        now,
      }),
    ).toThrow('claim window');
    expect(() =>
      assertSettlementDecisionEligible({
        claimDeadlineAt: new Date('2026-10-04T00:00:00.000Z'),
        claims: [{ disputes: [], status: PostReturnClaimStatus.UNDER_ADMIN_REVIEW }],
        now,
      }),
    ).toThrow('final adjudication');
  });

  it('blocks open disputes and accepts terminal claim/dispute states', () => {
    const input = {
      claimDeadlineAt: new Date('2026-10-04T00:00:00.000Z'),
      claims: [
        {
          disputes: [{ status: DisputeStatus.OPEN }],
          status: PostReturnClaimStatus.PAYMENT_PENDING,
        },
      ],
      now: new Date('2026-10-05T00:00:00.000Z'),
    } as const;
    expect(() => assertSettlementDecisionEligible(input)).toThrow('open dispute');
    expect(() =>
      assertSettlementDecisionEligible({
        ...input,
        claims: [
          {
            disputes: [{ status: DisputeStatus.RESOLVED_FOR_OWNER }],
            status: PostReturnClaimStatus.PAYMENT_PENDING,
          },
        ],
      }),
    ).not.toThrow();
  });
});
