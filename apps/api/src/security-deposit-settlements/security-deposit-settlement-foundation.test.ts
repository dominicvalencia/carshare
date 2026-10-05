import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  new URL('./security-deposit-settlements.service.ts', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('./security-deposit-settlements.controller.ts', import.meta.url),
  'utf8',
);
const payoutEligibility = readFileSync(
  new URL('../payouts/payout-eligibility.service.ts', import.meta.url),
  'utf8',
);
const payouts = readFileSync(new URL('../payouts/payouts.service.ts', import.meta.url), 'utf8');
const configuration = readFileSync(
  new URL('../../../../packages/config/src/index.ts', import.meta.url),
  'utf8',
);

describe('Security Deposit settlement foundation boundaries', () => {
  it('exposes read-only participant projections and audited admin decisions', () => {
    expect(controller).toContain("@Get(':reference/security-deposit/settlement')");
    expect(controller).toContain("@Get('bookings/:reference/security-deposit/settlements')");
    expect(controller).toContain("@Post('security-deposit/settlements/:id/approve')");
    expect(controller).toContain("@Post('security-deposit/settlements/:id/manual-review')");
    expect(service).toContain('executionAvailable: false');
    expect(service).toContain('adminAuditLog.create');
  });

  it('creates immutable claim snapshots only from deposit-eligible approved charges', () => {
    expect(service).toContain('calculation?.policy.depositEligible');
    expect(service).toContain('PostReturnClaimStatus.PAYMENT_PENDING');
    expect(service).toContain('ClaimAdjudicationOutcome.PARTIALLY_APPROVED');
    expect(service).toContain('descriptionSnapshot: claim.description');
    expect(service).toContain('policyVersion: calculation.policy.version');
  });

  it('does not inject or invoke a payment provider or create settlement operations', () => {
    expect(service).not.toContain('PAYMENT_PROVIDER');
    expect(service).not.toContain('.capture(');
    expect(service).not.toContain('.voidAuthorization(');
    expect(service).not.toContain('.refund(');
    expect(service).not.toContain('paymentOperation.create');
    expect(configuration).toContain('SECURITY_DEPOSIT_SETTLEMENT_EXECUTION_ENABLED');
    expect(configuration).toContain(
      'Security Deposit settlement provider execution is unavailable in the Phase 4 foundation.',
    );
  });

  it('blocks payout selection and rechecks already allocated payouts before submission', () => {
    expect(payoutEligibility).toContain('SECURITY_DEPOSIT_SETTLEMENT_PENDING');
    expect(payoutEligibility).toContain('security_deposit_settlements');
    expect(payouts).toContain('PAYOUT_SECURITY_DEPOSIT_SETTLEMENT_PENDING');
  });

  it('emits only Phase 4 foundation facts, never provider movement events', () => {
    expect(service).toContain('SECURITY_DEPOSIT_SETTLEMENT_REVIEW_STARTED');
    expect(service).toContain('SECURITY_DEPOSIT_SETTLEMENT_APPROVED');
    expect(service).toContain('SECURITY_DEPOSIT_MANUAL_REVIEW_REQUIRED');
    expect(service).not.toContain("'SECURITY_DEPOSIT_RELEASED'");
    expect(service).not.toContain("'SECURITY_DEPOSIT_USED'");
    expect(service).not.toContain("'SECURITY_DEPOSIT_CAPTURED'");
  });
});
