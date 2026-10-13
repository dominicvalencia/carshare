import { describe, expect, it, vi } from 'vitest';
import { VehicleChangeProposalSnapshotService } from './vehicle-change-proposal-snapshot.service';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('VehicleChangeProposalSnapshotService', () => {
  it('builds a complete V1 snapshot from the live aggregate without writing live data', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      categoryId: id('1'),
      color: 'White',
      description: 'Description',
      doorCount: 4,
      documents: [
        {
          definition: { code: 'REGISTRATION' },
          definitionId: id('5'),
          expiresAt: new Date('2027-01-02T00:00:00.000Z'),
          fileAssetId: id('6'),
        },
      ],
      features: [{ featureId: id('3') }, { featureId: id('2') }, { featureId: id('2') }],
      fuelType: 'GASOLINE',
      location: {
        addressLine1: 'Private address',
        addressScopeCode: null,
        barangay: 'Barangay 1',
        barangayCode: null,
        city: 'Manila',
        cityMunicipalityCode: null,
        country: 'PH',
        landmark: null,
        latitude: { toString: () => '14.599500' },
        longitude: { toString: () => '120.984200' },
        pickupAreaLabel: 'Manila',
        province: 'Metro Manila',
        provinceCode: null,
        regionCode: null,
        timezone: 'Asia/Manila',
      },
      make: 'Honda',
      model: 'Civic',
      modelYear: 2024,
      photos: [{ displayOrder: 0, fileAssetId: id('4'), isCover: true, perspective: 'FRONT' }],
      plateNumber: 'ABC 1234',
      policyVersions: [
        {
          availabilityPolicy: 'EVERY_DAY',
          collectionFeeMinor: null,
          currency: 'PHP',
          dailyRateMinor: 250000,
          deliveryFeeMinor: null,
          evCalculationPolicyRef: null,
          evRequiredPercentage: null,
          evReturnPolicy: null,
          evTolerancePercent: null,
          excessKilometerRateMinor: null,
          extendedTripDiscountBps: null,
          friday: true,
          fuelCalculationPolicyRef: 'PH_FUEL_DEFICIENCY_MVP_V1',
          fuelReturnPolicy: 'FULL_TO_FULL',
          fuelTolerancePercent: 5,
          fulfillmentMinimumNoticeMinutes: 120,
          fulfillmentServiceRadiusMeters: null,
          includedKilometersPerDay: null,
          maximumRentalDays: 30,
          mileagePolicy: 'UNLIMITED',
          minimumRentalDays: 1,
          monday: true,
          monthlyDiscountBps: null,
          saturday: true,
          securityDepositAmountMinor: 500000,
          securityDepositCurrency: 'PHP',
          securityDepositRequired: true,
          shortDurationDiscountBps: null,
          sunday: true,
          supportsOwnerCollection: false,
          supportsOwnerDelivery: false,
          supportsRenterPickup: true,
          supportsRenterReturn: true,
          thursday: true,
          turnaroundMinutes: 120,
          tuesday: true,
          wednesday: true,
          weeklyDiscountBps: 500,
          version: 9,
        },
      ],
      powertrain: 'ICE',
      rentalRequirements: 'Valid licence',
      revision: 7,
      seatCount: 5,
      transmission: 'AUTOMATIC',
      variant: 'V',
      vin: 'VIN123',
    });
    const client = {
      vehicle: { findFirst },
      vehicleChangeProposal: { create: vi.fn() },
      vehiclePolicyVersion: { create: vi.fn() },
      vehiclePhoto: { create: vi.fn() },
      vehicleDocument: { create: vi.fn() },
      vehicleLocation: { upsert: vi.fn() },
    };
    const service = new VehicleChangeProposalSnapshotService({ client } as never);

    const result = await service.buildFromLiveVehicle('vehicle-a', 'owner-a');

    expect(result).toMatchObject({
      baseVehicleRevision: 7,
      snapshot: {
        schemaVersion: 1,
        featureIds: [id('2'), id('3')],
        photos: [{ displayOrder: 0, isCover: true }],
        documents: [{ documentType: 'REGISTRATION', expiresAt: '2027-01-02' }],
        location: { addressLine1: 'Private address', latitude: '14.599500' },
        policy: { dailyRateMinor: 250000, weeklyDiscountBps: 500 },
      },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'vehicle-a', ownerProfileId: 'owner-a' } }),
    );
    expect(client.vehicleChangeProposal.create).not.toHaveBeenCalled();
    expect(client.vehiclePolicyVersion.create).not.toHaveBeenCalled();
    expect(client.vehiclePhoto.create).not.toHaveBeenCalled();
    expect(client.vehicleDocument.create).not.toHaveBeenCalled();
    expect(client.vehicleLocation.upsert).not.toHaveBeenCalled();
    expect(result?.snapshot.vehicle).not.toHaveProperty('ownerUserId');
    expect(result?.snapshot.vehicle).not.toHaveProperty('status');
  });
});
