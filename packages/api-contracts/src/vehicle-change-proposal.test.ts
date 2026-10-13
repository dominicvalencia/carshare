import { describe, expect, it } from 'vitest';
import {
  assertVehicleChangeProposalFresh,
  classifyVehicleChangedFields,
  diffVehicleChangeProposalSnapshots,
  type VehicleChangeProposalSnapshotV1,
  validateVehicleChangeProposalSnapshotV1,
} from './vehicle-change-proposal';

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

function snapshot(): VehicleChangeProposalSnapshotV1 {
  return {
    schemaVersion: 1,
    vehicle: {
      categoryId: id('1'),
      color: 'White',
      description: 'Clean vehicle',
      doorCount: 4,
      fuelType: 'GASOLINE',
      make: 'Honda',
      model: 'Civic',
      modelYear: 2024,
      plateNumber: 'ABC 1234',
      powertrain: 'ICE',
      rentalRequirements: 'Valid licence',
      seatCount: 5,
      transmission: 'AUTOMATIC',
      variant: 'V',
      vin: 'VIN123',
    },
    featureIds: [id('2'), id('3')],
    photos: [{ displayOrder: 0, fileAssetId: id('4'), isCover: true, perspective: 'FRONT' }],
    documents: [
      {
        definitionId: id('5'),
        documentType: 'REGISTRATION',
        expiresAt: null,
        fileAssetId: id('6'),
      },
    ],
    location: {
      addressLine1: 'Private address',
      addressScopeCode: null,
      barangay: 'Barangay 1',
      barangayCode: null,
      city: 'Manila',
      cityMunicipalityCode: null,
      country: 'PH',
      landmark: null,
      latitude: '14.599500',
      longitude: '120.984200',
      pickupAreaLabel: 'Manila',
      province: 'Metro Manila',
      provinceCode: null,
      regionCode: null,
      timezone: 'Asia/Manila',
    },
    policy: {
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
    },
  };
}

describe('vehicle change proposal snapshot policy', () => {
  it.each([
    ['description', ['vehicle.description']],
    ['price', ['policy.dailyRateMinor']],
    ['deposit', ['policy.securityDepositRequired', 'policy.securityDepositAmountMinor']],
    ['policy', ['policy.minimumRentalDays']],
  ])('classifies %s-only changes as Owner approval only', (_name, fields) => {
    expect(classifyVehicleChangedFields(fields as never)).toBe('OWNER_APPROVAL_ONLY');
  });

  it.each([
    ['year', ['vehicle.year']],
    ['photos', ['photos']],
    ['VIN', ['vehicle.vin']],
    ['registration', ['documents.registration']],
    ['private location', ['location']],
    ['mixed', ['vehicle.description', 'vehicle.year']],
  ])('classifies %s changes as requiring platform review', (_name, fields) => {
    expect(classifyVehicleChangedFields(fields as never)).toBe('PLATFORM_REVIEW_REQUIRED');
  });

  it('diffs configuration deterministically while treating features as a set', () => {
    const live = snapshot();
    const proposed = {
      ...live,
      featureIds: [...live.featureIds].reverse(),
      policy: { ...live.policy, dailyRateMinor: 275000 },
      vehicle: { ...live.vehicle, description: 'Updated description', modelYear: 2025 },
    };
    expect(diffVehicleChangeProposalSnapshots(live, proposed)).toEqual([
      'policy.dailyRateMinor',
      'vehicle.description',
      'vehicle.year',
    ]);
  });

  it('detects photo order/cover and ignores document array ordering', () => {
    const live = snapshot();
    const extra = {
      definitionId: id('7'),
      documentType: 'INSURANCE',
      expiresAt: null,
      fileAssetId: id('8'),
    };
    const withDocuments = { ...live, documents: [...live.documents, extra] };
    expect(
      diffVehicleChangeProposalSnapshots(withDocuments, {
        ...withDocuments,
        documents: [...withDocuments.documents].reverse(),
      }),
    ).toEqual([]);
    expect(
      diffVehicleChangeProposalSnapshots(live, {
        ...live,
        photos: live.photos.map((photo) => ({ ...photo, isCover: false })),
      }),
    ).toEqual(['photos']);
    expect(diffVehicleChangeProposalSnapshots(live, { ...live, documents: [] })).toEqual([
      'documents.registration',
    ]);
  });

  it('validates complete snapshots and rejects invalid policy/specification data', () => {
    expect(validateVehicleChangeProposalSnapshotV1(snapshot())).toEqual([]);
    const invalid = snapshot();
    expect(
      validateVehicleChangeProposalSnapshotV1({
        ...invalid,
        policy: { ...invalid.policy, dailyRateMinor: 0, maximumRentalDays: 0 },
        vehicle: { ...invalid.vehicle, modelYear: 1800 },
      }),
    ).toEqual(
      expect.arrayContaining([
        'Vehicle year is invalid.',
        'Daily price must be positive.',
        'Rental duration policy is invalid.',
      ]),
    );
  });

  it('rejects fields outside canonical V1 instead of persisting Owner-only injection', () => {
    expect(
      validateVehicleChangeProposalSnapshotV1({
        ...snapshot(),
        ownerProfileId: id('99'),
      } as VehicleChangeProposalSnapshotV1),
    ).toContain('Unknown snapshot field: ownerProfileId.');
  });

  it('exposes a stable stale-proposal error without applying anything', () => {
    expect(() => assertVehicleChangeProposalFresh(7, 7)).not.toThrow();
    expect(() => assertVehicleChangeProposalFresh(7, 8)).toThrowError(
      expect.objectContaining({ code: 'VEHICLE_CHANGE_PROPOSAL_STALE' }),
    );
  });
});
