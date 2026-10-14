import { Injectable } from '@nestjs/common';
import type { Prisma } from '@carrental/database';
import {
  VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_VERSION,
  type VehicleChangeProposalSnapshotV1,
  validateVehicleChangeProposalSnapshotV1,
} from '@carrental/api-contracts';
import { DatabaseService } from '../infrastructure/database/database.service';

const liveVehicleSnapshotSelect = {
  categoryId: true,
  color: true,
  description: true,
  doorCount: true,
  features: { select: { featureId: true } },
  fuelType: true,
  location: true,
  make: true,
  knownIssues: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      category: true,
      classification: true,
      description: true,
      id: true,
      status: true,
      vehicleArea: true,
    },
  },
  model: true,
  modelYear: true,
  photos: {
    orderBy: { displayOrder: 'asc' as const },
    select: {
      displayOrder: true,
      fileAssetId: true,
      isCover: true,
      perspective: true,
    },
    where: { removedAt: null },
  },
  documents: {
    orderBy: [{ definition: { sortOrder: 'asc' as const } }, { version: 'desc' as const }],
    select: {
      definition: { select: { code: true } },
      definitionId: true,
      expiresAt: true,
      fileAssetId: true,
    },
    where: { replacedAt: null },
  },
  plateNumber: true,
  policyVersions: { orderBy: { version: 'desc' as const }, take: 1 },
  powertrain: true,
  rentalRequirements: true,
  revision: true,
  seatCount: true,
  transmission: true,
  variant: true,
  vin: true,
} satisfies Prisma.VehicleSelect;

type LiveVehicleSnapshotRecord = Prisma.VehicleGetPayload<{
  select: typeof liveVehicleSnapshotSelect;
}>;

export class VehicleChangeProposalSnapshotInvalidError extends Error {
  readonly code = 'VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_INVALID';

  constructor(readonly validationErrors: readonly string[]) {
    super('The live vehicle does not form a complete valid proposal snapshot.');
  }
}

@Injectable()
export class VehicleChangeProposalSnapshotService {
  constructor(private readonly database: DatabaseService) {}

  async buildFromLiveVehicle(
    vehicleId: string,
    ownerProfileId: string,
    client: Pick<Prisma.TransactionClient, 'vehicle'> = this.database.client,
  ) {
    const vehicle = await client.vehicle.findFirst({
      select: liveVehicleSnapshotSelect,
      where: { id: vehicleId, ownerProfileId },
    });
    if (!vehicle) return null;
    return {
      baseVehicleRevision: vehicle.revision,
      snapshot: this.toSnapshot(vehicle),
    };
  }

  toSnapshot(vehicle: LiveVehicleSnapshotRecord): VehicleChangeProposalSnapshotV1 {
    const policy = vehicle.policyVersions[0];
    if (!policy)
      throw new VehicleChangeProposalSnapshotInvalidError([
        'A current vehicle policy is required.',
      ]);
    const snapshot: VehicleChangeProposalSnapshotV1 = {
      schemaVersion: VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_VERSION,
      vehicle: {
        categoryId: vehicle.categoryId,
        color: vehicle.color,
        description: vehicle.description,
        doorCount: vehicle.doorCount,
        fuelType: vehicle.fuelType,
        make: vehicle.make,
        model: vehicle.model,
        modelYear: vehicle.modelYear,
        plateNumber: vehicle.plateNumber,
        powertrain: vehicle.powertrain,
        rentalRequirements: vehicle.rentalRequirements,
        seatCount: vehicle.seatCount,
        transmission: vehicle.transmission,
        variant: vehicle.variant,
        vin: vehicle.vin,
      },
      featureIds: [...new Set(vehicle.features.map(({ featureId }) => featureId))].sort(),
      photos: vehicle.photos.map((photo) => ({
        displayOrder: photo.displayOrder,
        fileAssetId: photo.fileAssetId,
        isCover: photo.isCover,
        perspective: photo.perspective,
      })),
      documents: vehicle.documents.map((document) => ({
        definitionId: document.definitionId,
        documentType: document.definition.code,
        expiresAt: document.expiresAt?.toISOString().slice(0, 10) ?? null,
        fileAssetId: document.fileAssetId,
      })),
      knownIssues: (vehicle.knownIssues ?? []).map((issue) => ({
        category: issue.category,
        classification: issue.classification,
        description: issue.description,
        id: issue.id,
        status: issue.status,
        vehicleArea: issue.vehicleArea,
      })),
      location: vehicle.location
        ? {
            addressLine1: vehicle.location.addressLine1,
            addressScopeCode: vehicle.location.addressScopeCode,
            barangay: vehicle.location.barangay,
            barangayCode: vehicle.location.barangayCode,
            city: vehicle.location.city,
            cityMunicipalityCode: vehicle.location.cityMunicipalityCode,
            country: vehicle.location.country,
            landmark: vehicle.location.landmark,
            latitude: vehicle.location.latitude.toString(),
            longitude: vehicle.location.longitude.toString(),
            pickupAreaLabel: vehicle.location.pickupAreaLabel,
            province: vehicle.location.province,
            provinceCode: vehicle.location.provinceCode,
            regionCode: vehicle.location.regionCode,
            timezone: vehicle.location.timezone,
          }
        : null,
      policy: {
        availabilityPolicy: policy.availabilityPolicy,
        collectionFeeMinor: policy.collectionFeeMinor,
        currency: policy.currency,
        dailyRateMinor: policy.dailyRateMinor,
        deliveryFeeMinor: policy.deliveryFeeMinor,
        evCalculationPolicyRef: policy.evCalculationPolicyRef,
        evRequiredPercentage: policy.evRequiredPercentage,
        evReturnPolicy: policy.evReturnPolicy,
        evTolerancePercent: policy.evTolerancePercent,
        excessKilometerRateMinor: policy.excessKilometerRateMinor,
        extendedTripDiscountBps: policy.extendedTripDiscountBps,
        friday: policy.friday,
        fuelCalculationPolicyRef: policy.fuelCalculationPolicyRef,
        fuelReturnPolicy: policy.fuelReturnPolicy,
        fuelTolerancePercent: policy.fuelTolerancePercent,
        fulfillmentMinimumNoticeMinutes: policy.fulfillmentMinimumNoticeMinutes,
        fulfillmentServiceRadiusMeters: policy.fulfillmentServiceRadiusMeters,
        includedKilometersPerDay: policy.includedKilometersPerDay,
        maximumRentalDays: policy.maximumRentalDays,
        mileagePolicy: policy.mileagePolicy,
        minimumRentalDays: policy.minimumRentalDays,
        monday: policy.monday,
        monthlyDiscountBps: policy.monthlyDiscountBps,
        saturday: policy.saturday,
        securityDepositAmountMinor: policy.securityDepositAmountMinor,
        securityDepositCurrency: policy.securityDepositCurrency,
        securityDepositRequired: policy.securityDepositRequired,
        shortDurationDiscountBps: policy.shortDurationDiscountBps,
        sunday: policy.sunday,
        supportsOwnerCollection: policy.supportsOwnerCollection,
        supportsOwnerDelivery: policy.supportsOwnerDelivery,
        supportsRenterPickup: policy.supportsRenterPickup,
        supportsRenterReturn: policy.supportsRenterReturn,
        thursday: policy.thursday,
        turnaroundMinutes: policy.turnaroundMinutes,
        tuesday: policy.tuesday,
        wednesday: policy.wednesday,
        weeklyDiscountBps: policy.weeklyDiscountBps,
      },
    };
    const errors = validateVehicleChangeProposalSnapshotV1(snapshot);
    if (errors.length) throw new VehicleChangeProposalSnapshotInvalidError(errors);
    return snapshot;
  }
}
