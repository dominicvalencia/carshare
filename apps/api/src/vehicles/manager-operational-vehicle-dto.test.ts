import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  ManagerVehicleOperationalDetailsDto,
  ManagerVehicleOperationalPolicyDto,
} from './vehicles.dto';

describe('Manager vehicle operational DTO allowlist', () => {
  it.each([
    'dailyRateMinor',
    'weeklyDiscountBps',
    'deliveryFeeMinor',
    'collectionFeeMinor',
    'excessKilometerRateMinor',
    'securityDepositRequired',
    'securityDepositAmountMinor',
    'plateNumber',
    'vin',
    'make',
    'model',
    'modelYear',
    'categoryId',
    'ownerProfileId',
    'ownerUserId',
    'createdByUserId',
    'status',
    'revision',
  ])('rejects forbidden injected field %s', async (field) => {
    const dto = plainToInstance(ManagerVehicleOperationalDetailsDto, {
      description: 'Allowed',
      expectedRevision: 2,
      [field]: 'injected',
    });
    const errors = await validate(dto, { forbidNonWhitelisted: true, whitelist: true });
    expect(errors.some(({ property }) => property === field)).toBe(true);
  });

  it('accepts only the operational policy shape without financial values', async () => {
    const dto = plainToInstance(ManagerVehicleOperationalPolicyDto, {
      availabilityPolicy: 'EVERY_DAY',
      expectedRevision: 2,
      maximumRentalDays: 30,
      mileagePolicy: 'LIMITED',
      minimumRentalDays: 1,
      turnaroundMinutes: 120,
    });
    await expect(validate(dto, { forbidNonWhitelisted: true, whitelist: true })).resolves.toEqual(
      [],
    );
  });
});
