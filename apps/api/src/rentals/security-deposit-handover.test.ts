import { SecurityDepositStatus } from '@carrental/database';
import { describe, expect, it } from 'vitest';
import { securityDepositBlocksHandover } from './rentals.service';

const required = {
  authorizedAmountMinor: 0n,
  executionEnabled: true,
  required: true,
  requiredAmountMinor: 500_000,
};

describe('security deposit handover authority', () => {
  it.each([
    SecurityDepositStatus.PENDING,
    SecurityDepositStatus.AUTHORIZING,
    SecurityDepositStatus.FAILED,
    SecurityDepositStatus.RELEASED,
  ])('blocks required deposits in %s', (status) => {
    expect(securityDepositBlocksHandover({ ...required, status })).toBe(true);
  });

  it('allows a fully authorized required deposit', () => {
    expect(
      securityDepositBlocksHandover({
        ...required,
        authorizedAmountMinor: 500_000n,
        status: SecurityDepositStatus.AUTHORIZED,
      }),
    ).toBe(false);
  });

  it('still blocks an under-authorized hold', () => {
    expect(
      securityDepositBlocksHandover({
        ...required,
        authorizedAmountMinor: 499_999n,
        status: SecurityDepositStatus.AUTHORIZED,
      }),
    ).toBe(true);
  });

  it('preserves handover for no-deposit and execution-disabled bookings', () => {
    expect(
      securityDepositBlocksHandover({ ...required, executionEnabled: false, status: null }),
    ).toBe(false);
    expect(securityDepositBlocksHandover({ ...required, required: false, status: null })).toBe(
      false,
    );
  });
});
