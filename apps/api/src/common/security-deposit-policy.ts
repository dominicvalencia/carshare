export const SECURITY_DEPOSIT_TIERS = Object.freeze({
  PHP: Object.freeze([300_000, 500_000, 1_000_000, 1_500_000, 2_500_000]),
});

export type SecurityDepositCurrency = keyof typeof SECURITY_DEPOSIT_TIERS;

export interface SecurityDepositConfiguration {
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly required: boolean;
}

export function securityDepositConfiguration(input: {
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  readonly required?: boolean;
}): SecurityDepositConfiguration {
  const required = input.required ?? false;
  return {
    amountMinor: required ? (input.amountMinor ?? null) : null,
    currency: required ? (input.currency?.toUpperCase() ?? null) : null,
    required,
  };
}

export function isSecurityDepositCurrency(value: string): value is SecurityDepositCurrency {
  return Object.hasOwn(SECURITY_DEPOSIT_TIERS, value);
}

export function isAllowedSecurityDepositTier(currency: string, amountMinor: number): boolean {
  return (
    isSecurityDepositCurrency(currency) &&
    (SECURITY_DEPOSIT_TIERS[currency] as readonly number[]).includes(amountMinor)
  );
}

export function securityDepositProjection(input: {
  readonly securityDepositAmountMinor: number | null;
  readonly securityDepositCurrency: string | null;
  readonly securityDepositRequired: boolean;
}) {
  return {
    amountMinor: input.securityDepositRequired ? input.securityDepositAmountMinor : null,
    currency: input.securityDepositRequired ? input.securityDepositCurrency : null,
    required: input.securityDepositRequired,
  };
}
