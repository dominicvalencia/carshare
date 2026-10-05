import { describe, expect, it } from 'vitest';
import { VehicleErrorCode } from '@carrental/api-contracts';
import type { CreateVehiclePolicyVersionDto } from './vehicles.dto';
import { VehiclesService } from './vehicles.service';

const validate = Reflect.get(VehiclesService.prototype, 'validateSecurityDeposit') as (
  input: CreateVehiclePolicyVersionDto,
) => unknown;

describe('owner vehicle security deposit policy validation', () => {
  it('accepts an approved required tier', () => {
    expect(
      validate.call(
        {} as VehiclesService,
        {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'php',
          securityDepositRequired: true,
        } as CreateVehiclePolicyVersionDto,
      ),
    ).toEqual({ amountMinor: 500_000, currency: 'PHP', required: true });
  });

  it('rejects arbitrary owner-entered amounts with a stable code', () => {
    expect.assertions(1);
    try {
      validate.call(
        {} as VehiclesService,
        {
          securityDepositAmountMinor: 501_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
        } as CreateVehiclePolicyVersionDto,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: VehicleErrorCode.SECURITY_DEPOSIT_AMOUNT_NOT_ALLOWED });
    }
  });

  it('rejects unsupported currency with a stable code', () => {
    expect.assertions(1);
    try {
      validate.call(
        {} as VehiclesService,
        {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'USD',
          securityDepositRequired: true,
        } as CreateVehiclePolicyVersionDto,
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: VehicleErrorCode.SECURITY_DEPOSIT_CURRENCY_UNSUPPORTED,
      });
    }
  });

  it('rejects stray money fields on a no-deposit policy', () => {
    expect.assertions(1);
    try {
      validate.call(
        {} as VehiclesService,
        {
          securityDepositAmountMinor: 500_000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: false,
        } as CreateVehiclePolicyVersionDto,
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: VehicleErrorCode.SECURITY_DEPOSIT_INVALID_CONFIGURATION,
      });
    }
  });
});
