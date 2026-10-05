import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('security deposit foundation boundaries', () => {
  it('snapshots terms from the quote policy without changing rental totals', () => {
    const bookings = source('src/bookings/bookings.service.ts');
    expect(bookings).toContain(
      'securityDepositAmountMinor: quote.policyVersion.securityDepositAmountMinor',
    );
    expect(bookings).toContain(
      'securityDepositCurrency: quote.policyVersion.securityDepositCurrency',
    );
    expect(bookings).toContain(
      'securityDepositRequired: quote.policyVersion.securityDepositRequired',
    );
    expect(bookings).not.toMatch(/totalMinor:\s*quote\.totalMinor\s*\+/u);
  });

  it('keeps amendment services away from immutable deposit snapshot fields', () => {
    for (const path of [
      'src/bookings/amendment-submission.service.ts',
      'src/bookings/amendment-owner-decision.service.ts',
      'src/bookings/amendment-preview.service.ts',
    ]) {
      expect(source(path)).not.toContain('securityDepositAmountMinor');
      expect(source(path)).not.toContain('securityDepositCurrency');
      expect(source(path)).not.toContain('securityDepositRequired');
    }
  });

  it('keeps Phase 3 deposit execution purpose-specific and capability-gated', () => {
    const payments = source('src/payments/payments.service.ts');
    const rentals = source('src/rentals/rentals.service.ts');
    expect(payments).toContain('purpose: PaymentPurpose.SECURITY_DEPOSIT');
    expect(payments).toContain("authorizationType: 'PREAUTHORIZATION'");
    expect(payments).toContain("'SECURITY_DEPOSIT_EXECUTION_ENABLED'");
    expect(rentals).toContain('securityDepositBlocksHandover({');
    expect(rentals).toContain('executionEnabled: this.securityDepositExecutionEnabled');
    expect(rentals).toContain("'SECURITY_DEPOSIT_REQUIRED_BEFORE_HANDOVER'");
  });
});
