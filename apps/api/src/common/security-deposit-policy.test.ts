import { describe, expect, it } from 'vitest';
import {
  isAllowedSecurityDepositTier,
  isSecurityDepositCurrency,
  SECURITY_DEPOSIT_TIERS,
  securityDepositConfiguration,
  securityDepositProjection,
} from './security-deposit-policy';

describe('security deposit policy authority', () => {
  it('owns the currency-aware PHP tier catalog', () => {
    expect(SECURITY_DEPOSIT_TIERS).toEqual({
      PHP: [300_000, 500_000, 1_000_000, 1_500_000, 2_500_000],
    });
    expect(isSecurityDepositCurrency('PHP')).toBe(true);
    expect(isSecurityDepositCurrency('USD')).toBe(false);
    expect(isAllowedSecurityDepositTier('PHP', 500_000)).toBe(true);
    expect(isAllowedSecurityDepositTier('PHP', 501_000)).toBe(false);
  });

  it('normalizes no-deposit terms without fabricating money fields', () => {
    expect(securityDepositConfiguration({ required: false })).toEqual({
      amountMinor: null,
      currency: null,
      required: false,
    });
  });

  it('projects required terms separately from rental pricing', () => {
    expect(
      securityDepositProjection({
        securityDepositAmountMinor: 500_000,
        securityDepositCurrency: 'PHP',
        securityDepositRequired: true,
      }),
    ).toEqual({ amountMinor: 500_000, currency: 'PHP', required: true });
  });
});
