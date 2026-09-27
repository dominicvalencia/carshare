import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = readFileSync(new URL('./payouts.service.ts', import.meta.url), 'utf8');

describe('Task 17C-3 payout recovery wiring', () => {
  it('reserves only after eligibility and applies recovery at settlement', () => {
    expect(service.indexOf('eligibleSelectionSql')).toBeLessThan(
      service.indexOf('payoutAdjustment.groupBy'),
    );
    expect(service).toContain("status: 'RESERVED'");
    expect(service).toContain('applyPenaltyAdjustments(transaction, payout, request)');
    expect(service).toContain('OWNER_PENALTY_RECOVERY');
    expect(service).toContain('OWNER_PENALTY_RECEIVABLE');
  });

  it('settles zero net payouts internally without provider submission', () => {
    expect(service).toContain('if (payout.amountMinor === 0n)');
    expect(service).toContain('providerSubmissionSkipped: true');
    expect(service.indexOf('if (payout.amountMinor === 0n)')).toBeLessThan(
      service.indexOf('input: this.providerInput(included)'),
    );
  });

  it('releases unapplied reservations with failed or cancelled allocations', () => {
    expect(service).toContain("status: 'RELEASED'");
    expect(service).toContain("where: { payoutId: payout.id, status: 'RESERVED' }");
  });
});
