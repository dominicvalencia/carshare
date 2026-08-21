import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AvailabilityPolicyType,
  FileAssetStatus,
  FileClassification,
  MileagePolicyType,
  Prisma,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VehiclePhotoPerspective,
  VehiclePowertrain,
  VerificationStatus,
} from '@carrental/database';
import { VehicleErrorCode } from '@carrental/api-contracts';
import { AuditService } from '../audit/audit.service';
import { OccupancyService } from '../bookings/occupancy.service';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { OwnersService } from '../owners/owners.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata } from '../security/security-context';
import type {
  AddVehicleDocumentDto,
  AddVehiclePhotoDto,
  ChangeOperationalStatusDto,
  CreateVehicleBlockDto,
  CreateVehicleDto,
  CreateVehiclePolicyVersionDto,
  ReorderVehiclePhotosDto,
  SetVehicleFeaturesDto,
  SetVehicleLocationDto,
  UpdateVehicleDto,
} from './vehicles.dto';

const MATERIAL_EDITABLE: readonly VehicleLifecycleStatus[] = [
  VehicleLifecycleStatus.DRAFT,
  VehicleLifecycleStatus.CHANGES_REQUIRED,
  VehicleLifecycleStatus.REJECTED,
];
const POLICY_EDITABLE: readonly VehicleLifecycleStatus[] = [
  ...MATERIAL_EDITABLE,
  VehicleLifecycleStatus.APPROVED,
];
const TURNAROUND_PRESETS = new Set([120, 240, 360, 720, 1440]);
const REQUIRED_PERSPECTIVES: readonly VehiclePhotoPerspective[] = [
  VehiclePhotoPerspective.FRONT,
  VehiclePhotoPerspective.REAR,
  VehiclePhotoPerspective.DRIVER_SIDE,
  VehiclePhotoPerspective.PASSENGER_SIDE,
  VehiclePhotoPerspective.INTERIOR_DASHBOARD,
];
const safeFileSelect = {
  checksum: true,
  classification: true,
  createdAt: true,
  id: true,
  mimeType: true,
  originalName: true,
  size: true,
  status: true,
  updatedAt: true,
};

const ownerVehicleInclude = {
  category: true,
  documents: {
    include: { definition: true, fileAsset: { select: safeFileSelect } },
    orderBy: [{ definition: { sortOrder: 'asc' as const } }, { version: 'desc' as const }],
  },
  features: { include: { feature: true } },
  location: true,
  photos: {
    include: { fileAsset: { select: safeFileSelect } },
    orderBy: { displayOrder: 'asc' as const },
    where: { removedAt: null },
  },
  policyVersions: { orderBy: { version: 'desc' as const } },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
};

@Injectable()
export class VehiclesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly owners: OwnersService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly occupancy: OccupancyService,
  ) {}

  categories() {
    return this.database.client.vehicleCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      where: { active: true },
    });
  }

  features() {
    return this.database.client.vehicleFeature.findMany({
      orderBy: { sortOrder: 'asc' },
      where: { active: true },
    });
  }

  documentDefinitions() {
    return this.database.client.vehicleDocumentDefinition.findMany({
      orderBy: { sortOrder: 'asc' },
      where: { active: true, jurisdiction: 'PH' },
    });
  }

  async create(userId: string, input: CreateVehicleDto, request: RequestMetadata) {
    await this.owners.assertOperational(userId);
    const owner = await this.database.client.ownerProfile.findUniqueOrThrow({ where: { userId } });
    if (input.categoryId) await this.assertCategory(input.categoryId);
    const vehicle = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.vehicle.create({
        data: {
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          ...(input.make === undefined ? {} : { make: input.make.trim() || null }),
          ...(input.model === undefined ? {} : { model: input.model.trim() || null }),
          ownerProfileId: owner.id,
          ownerUserId: userId,
        },
      });
      await transaction.vehicleStatusHistory.create({
        data: {
          actorUserId: userId,
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
          newStatus: VehicleLifecycleStatus.DRAFT,
          vehicleId: created.id,
        },
      });
      return created;
    });
    return this.getOwned(userId, vehicle.id);
  }

  listOwned(userId: string) {
    return this.database.client.vehicle.findMany({
      include: {
        category: true,
        photos: {
          include: { fileAsset: { select: safeFileSelect } },
          orderBy: { displayOrder: 'asc' },
          take: 1,
          where: { isCover: true, removedAt: null },
        },
        policyVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      where: { ownerUserId: userId },
    });
  }

  async getOwned(userId: string, id: string) {
    const vehicle = await this.database.client.vehicle.findFirst({
      include: ownerVehicleInclude,
      where: { id, ownerUserId: userId },
    });
    if (!vehicle) this.notFound();
    return vehicle;
  }

  async update(userId: string, id: string, input: UpdateVehicleDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    const keys = Object.keys(input).filter(
      (key) => input[key as keyof UpdateVehicleDto] !== undefined,
    );
    const lowRisk = new Set(['description', 'rentalRequirements', 'lastCompletedSection']);
    if (
      !MATERIAL_EDITABLE.includes(vehicle.status) &&
      !(vehicle.status === VehicleLifecycleStatus.APPROVED && keys.every((key) => lowRisk.has(key)))
    ) {
      this.invalidState('Material vehicle details are locked in this listing state.');
    }
    if (input.categoryId) await this.assertCategory(input.categoryId);
    if (input.modelYear && input.modelYear > new Date().getUTCFullYear() + 1) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_VEHICLE_SPECIFICATION,
        'Model year cannot be later than next year.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const powertrain = input.powertrain ?? vehicle.powertrain;
    const fuelType = input.fuelType ?? vehicle.fuelType;
    if (
      (powertrain === VehiclePowertrain.BATTERY_ELECTRIC && fuelType !== 'ELECTRIC') ||
      (powertrain !== null &&
        powertrain !== VehiclePowertrain.BATTERY_ELECTRIC &&
        fuelType === 'ELECTRIC')
    ) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_VEHICLE_SPECIFICATION,
        'Fuel type is incompatible with the selected powertrain.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const data: Prisma.VehicleUpdateInput = {
      ...(input.categoryId ? { category: { connect: { id: input.categoryId } } } : {}),
      ...this.stringUpdates(input, [
        'make',
        'model',
        'variant',
        'color',
        'description',
        'rentalRequirements',
        'lastCompletedSection',
      ]),
      ...(input.modelYear === undefined ? {} : { modelYear: input.modelYear }),
      ...(input.transmission === undefined ? {} : { transmission: input.transmission }),
      ...(input.powertrain === undefined ? {} : { powertrain: input.powertrain }),
      ...(input.fuelType === undefined ? {} : { fuelType: input.fuelType }),
      ...(input.seatCount === undefined ? {} : { seatCount: input.seatCount }),
      ...(input.doorCount === undefined ? {} : { doorCount: input.doorCount }),
    };
    if (input.plateNumber !== undefined) {
      const value = this.normalizeIdentifier(input.plateNumber);
      data.plateNumber = input.plateNumber.trim() || null;
      data.plateHash = value ? this.crypto.hashIdentifier(`vehicle-plate:${value}`) : null;
    }
    if (input.vin !== undefined) {
      const value = this.normalizeIdentifier(input.vin);
      data.vin = input.vin.trim() || null;
      data.vinHash = value ? this.crypto.hashIdentifier(`vehicle-vin:${value}`) : null;
    }
    try {
      await this.database.client.vehicle.update({ data, where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationException(
          VehicleErrorCode.DUPLICATE_VEHICLE_IDENTIFIER,
          'This plate or chassis identifier is already registered.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
    return this.getOwned(userId, id);
  }

  async setFeatures(userId: string, id: string, input: SetVehicleFeaturesDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, POLICY_EDITABLE, 'Features cannot be changed in this state.');
    const unique = [...new Set(input.featureIds)];
    const count = await this.database.client.vehicleFeature.count({
      where: { active: true, id: { in: unique } },
    });
    if (count !== unique.length) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_FEATURE,
        'One or more vehicle features are invalid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      await transaction.vehicleFeatureAssignment.deleteMany({ where: { vehicleId: id } });
      if (unique.length) {
        await transaction.vehicleFeatureAssignment.createMany({
          data: unique.map((featureId) => ({ featureId, vehicleId: id })),
        });
      }
    });
    return this.getOwned(userId, id);
  }

  async addPhoto(userId: string, id: string, input: AddVehiclePhotoDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, MATERIAL_EDITABLE, 'Photos cannot be changed in this state.');
    const file = await this.database.client.fileAsset.findFirst({
      where: {
        classification: FileClassification.PRIVATE,
        id: input.fileAssetId,
        mimeType: { startsWith: 'image/' },
        status: FileAssetStatus.READY,
        uploadedById: userId,
      },
    });
    if (!file) this.invalidFile('Attach a ready private image uploaded by this owner.');
    await this.database.client.$transaction(async (transaction) => {
      const currentCover = await transaction.vehiclePhoto.findFirst({
        where: { isCover: true, removedAt: null, vehicleId: id },
      });
      const makeCover = input.isCover === true || !currentCover;
      if (makeCover && currentCover) {
        await transaction.vehiclePhoto.updateMany({
          data: { isCover: false },
          where: { isCover: true, removedAt: null, vehicleId: id },
        });
      }
      await transaction.vehiclePhoto.create({
        data: { ...input, isCover: makeCover, vehicleId: id },
      });
    });
    return this.getOwned(userId, id);
  }

  async reorderPhotos(userId: string, id: string, input: ReorderVehiclePhotosDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, MATERIAL_EDITABLE, 'Photos cannot be changed in this state.');
    const active = await this.database.client.vehiclePhoto.findMany({
      where: { removedAt: null, vehicleId: id },
    });
    if (
      input.photos.length !== active.length ||
      new Set(input.photos.map(({ photoId }) => photoId)).size !== active.length ||
      !input.photos.every(({ photoId }) => active.some(({ id: value }) => value === photoId)) ||
      new Set(input.photos.map(({ displayOrder }) => displayOrder)).size !== active.length ||
      input.photos.filter(({ isCover }) => isCover).length !== 1
    ) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_PHOTO_ORDER,
        'Provide every active photo once, unique display orders, and exactly one cover.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      for (const photo of active) {
        await transaction.vehiclePhoto.update({
          data: { displayOrder: photo.displayOrder + 1000, isCover: false },
          where: { id: photo.id },
        });
      }
      for (const photo of input.photos) {
        await transaction.vehiclePhoto.update({
          data: { displayOrder: photo.displayOrder, isCover: photo.isCover ?? false },
          where: { id: photo.photoId },
        });
      }
    });
    return this.getOwned(userId, id);
  }

  async removePhoto(userId: string, id: string, photoId: string) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, MATERIAL_EDITABLE, 'Photos cannot be changed in this state.');
    const result = await this.database.client.vehiclePhoto.updateMany({
      data: { isCover: false, removedAt: new Date() },
      where: { id: photoId, removedAt: null, vehicleId: id },
    });
    if (!result.count) this.notFound();
  }

  async addDocument(userId: string, id: string, input: AddVehicleDocumentDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(
      vehicle.status,
      MATERIAL_EDITABLE,
      'Documents cannot be changed in this state.',
    );
    const [definition, file] = await Promise.all([
      this.database.client.vehicleDocumentDefinition.findFirst({
        where: { active: true, id: input.definitionId, jurisdiction: 'PH' },
      }),
      this.database.client.fileAsset.findFirst({
        where: {
          classification: FileClassification.SENSITIVE,
          id: input.fileAssetId,
          OR: [{ mimeType: 'application/pdf' }, { mimeType: { startsWith: 'image/' } }],
          status: FileAssetStatus.READY,
          uploadedById: userId,
        },
      }),
    ]);
    if (!definition || !file) this.invalidFile('Attach a valid sensitive vehicle document.');
    const current = await this.database.client.vehicleDocument.findFirst({
      orderBy: { version: 'desc' },
      where: { definitionId: input.definitionId, replacedAt: null, vehicleId: id },
    });
    if (current && input.replacesDocumentId !== current.id) {
      throw new ApplicationException(
        VehicleErrorCode.DOCUMENT_REPLACEMENT_REQUIRED,
        'Replace the current document explicitly.',
        HttpStatus.CONFLICT,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      if (current) {
        await transaction.vehicleDocument.update({
          data: { replacedAt: new Date(), status: VerificationStatus.EXPIRED },
          where: { id: current.id },
        });
      }
      await transaction.vehicleDocument.create({
        data: {
          definitionId: input.definitionId,
          ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
          fileAssetId: input.fileAssetId,
          ...(current ? { replacesDocumentId: current.id } : {}),
          vehicleId: id,
          version: (current?.version ?? 0) + 1,
        },
      });
    });
    return this.getOwned(userId, id);
  }

  async setLocation(userId: string, id: string, input: SetVehicleLocationDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(
      vehicle.status,
      MATERIAL_EDITABLE,
      'Location cannot be changed in this state.',
    );
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_LOCATION,
        'Latitude and longitude are invalid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.vehicleLocation.upsert({
      create: {
        city: input.city.trim(),
        country: (input.country ?? 'PH').toUpperCase(),
        latitude,
        longitude,
        pickupAreaLabel: this.clean(input.pickupAreaLabel) ?? null,
        province: input.province.trim(),
        timezone: input.timezone ?? 'Asia/Manila',
        vehicleId: id,
      },
      update: {
        city: input.city.trim(),
        country: (input.country ?? 'PH').toUpperCase(),
        latitude,
        longitude,
        pickupAreaLabel: this.clean(input.pickupAreaLabel) ?? null,
        province: input.province.trim(),
        timezone: input.timezone ?? 'Asia/Manila',
      },
      where: { vehicleId: id },
    });
    return this.getOwned(userId, id);
  }

  async createPolicyVersion(userId: string, id: string, input: CreateVehiclePolicyVersionDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, POLICY_EDITABLE, 'Policies cannot be changed in this state.');
    this.validatePolicy(vehicle.powertrain, input);
    const latest = await this.database.client.vehiclePolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      where: { vehicleId: id },
    });
    await this.database.client.vehiclePolicyVersion.create({
      data: {
        availabilityPolicy: input.availabilityPolicy,
        createdByUserId: userId,
        currency: 'PHP',
        dailyRateMinor: input.dailyRateMinor,
        evCalculationPolicyRef: input.evReturnPolicy ? 'PH_EV_DEFICIENCY_MVP_V1' : null,
        evRequiredPercentage: input.evRequiredPercentage ?? null,
        evReturnPolicy: input.evReturnPolicy ?? null,
        evTolerancePercent: input.evTolerancePercent ?? null,
        excessKilometerRateMinor:
          input.mileagePolicy === MileagePolicyType.LIMITED
            ? (input.excessKilometerRateMinor ?? null)
            : null,
        friday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.friday === true,
        fuelCalculationPolicyRef: input.fuelReturnPolicy ? 'PH_FUEL_DEFICIENCY_MVP_V1' : null,
        fuelReturnPolicy: input.fuelReturnPolicy ?? null,
        fuelTolerancePercent: input.fuelTolerancePercent ?? null,
        includedKilometersPerDay:
          input.mileagePolicy === MileagePolicyType.LIMITED
            ? (input.includedKilometersPerDay ?? null)
            : null,
        maximumRentalDays: input.maximumRentalDays,
        mileagePolicy: input.mileagePolicy,
        minimumRentalDays: input.minimumRentalDays,
        monday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.monday === true,
        saturday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.saturday === true,
        sunday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.sunday === true,
        thursday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.thursday === true,
        turnaroundMinutes: input.turnaroundMinutes,
        tuesday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.tuesday === true,
        vehicleId: id,
        version: (latest?.version ?? 0) + 1,
        wednesday:
          input.availabilityPolicy === AvailabilityPolicyType.EVERY_DAY || input.wednesday === true,
      },
    });
    return this.getOwned(userId, id);
  }

  async addBlockedPeriod(userId: string, id: string, input: CreateVehicleBlockDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(
      vehicle.status,
      POLICY_EDITABLE,
      'Availability cannot be changed in this state.',
    );
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (startsAt >= endsAt) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_BLOCKED_PERIOD,
        'Blocked period start must be before its end.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const occupancy = await this.occupancy.createOwnerBlock(transaction, {
          endsAt,
          startsAt,
          vehicleId: id,
        });
        return transaction.vehicleBlockedPeriod.create({
          data: {
            createdByUserId: userId,
            endsAt,
            occupancyId: occupancy.id,
            privateNote: this.clean(input.privateNote) ?? null,
            reason: input.reason,
            startsAt,
            vehicleId: id,
          },
        });
      });
    } catch (error) {
      if (!this.occupancy.isExclusionConflict(error)) throw error;
      throw new ApplicationException(
        VehicleErrorCode.BLOCKED_PERIOD_OVERLAP,
        'This period conflicts with another vehicle block.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async blockedPeriods(userId: string, id: string) {
    await this.ownedRecord(userId, id);
    return this.database.client.vehicleBlockedPeriod.findMany({
      orderBy: { startsAt: 'asc' },
      where: { removedAt: null, vehicleId: id },
    });
  }

  async removeBlockedPeriod(userId: string, id: string, blockId: string) {
    await this.owners.assertOperational(userId);
    await this.ownedRecord(userId, id);
    const result = await this.database.client.$transaction(async (transaction) => {
      const block = await transaction.vehicleBlockedPeriod.findFirst({
        where: { id: blockId, removedAt: null, vehicleId: id },
      });
      if (!block) return 0;
      await this.occupancy.release(transaction, block.occupancyId, 'OWNER_BLOCK_REMOVED');
      await transaction.vehicleBlockedPeriod.update({
        data: { removedAt: new Date() },
        where: { id: block.id },
      });
      return 1;
    });
    if (!result) this.notFound();
  }

  async submit(userId: string, id: string, request: RequestMetadata) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.getOwned(userId, id);
    this.assertState(vehicle.status, MATERIAL_EDITABLE, 'This vehicle cannot be submitted.');
    const failures = await this.readinessFailures(vehicle);
    if (failures.length) {
      throw new ApplicationException(
        VehicleErrorCode.VEHICLE_INCOMPLETE,
        'Complete the required vehicle sections before submission.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        failures,
      );
    }
    await this.transition(
      id,
      userId,
      vehicle.status,
      VehicleLifecycleStatus.PENDING_APPROVAL,
      undefined,
      request,
      { reviewReason: null, submittedAt: new Date() },
    );
    return this.getOwned(userId, id);
  }

  async archive(userId: string, id: string, request: RequestMetadata) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(
      vehicle.status,
      [
        VehicleLifecycleStatus.DRAFT,
        VehicleLifecycleStatus.CHANGES_REQUIRED,
        VehicleLifecycleStatus.REJECTED,
        VehicleLifecycleStatus.APPROVED,
        VehicleLifecycleStatus.SUSPENDED,
      ],
      'This vehicle cannot be archived.',
    );
    await this.occupancy.assertNoFutureBooking(id);
    await this.transition(
      id,
      userId,
      vehicle.status,
      VehicleLifecycleStatus.ARCHIVED,
      'Archived by owner',
      request,
      {
        archivedAt: new Date(),
        operationalStatus: VehicleOperationalStatus.TEMPORARILY_UNAVAILABLE,
      },
    );
    await this.setPhotoClassification(id, FileClassification.PRIVATE);
  }

  async changeOperationalStatus(userId: string, id: string, input: ChangeOperationalStatusDto) {
    await this.owners.assertOperational(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(
      vehicle.status,
      [VehicleLifecycleStatus.APPROVED],
      'Only approved listings can change operational availability.',
    );
    if (input.status !== VehicleOperationalStatus.AVAILABLE) {
      await this.occupancy.assertNoFutureBooking(id);
    }
    return this.database.client.vehicle.update({
      data: { operationalStatus: input.status },
      where: { id },
    });
  }

  listAdmin(status?: VehicleLifecycleStatus) {
    return this.database.client.vehicle.findMany({
      include: {
        category: true,
        ownerProfile: { include: { user: { include: { profile: true } } } },
        photos: {
          include: { fileAsset: { select: safeFileSelect } },
          take: 1,
          where: { isCover: true, removedAt: null },
        },
      },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      ...(status ? { where: { status } } : {}),
    });
  }

  async adminDetail(id: string) {
    const [vehicle, auditLogs] = await Promise.all([
      this.database.client.vehicle.findUniqueOrThrow({
        include: {
          ...ownerVehicleInclude,
          ownerProfile: { include: { user: { include: { profile: true } } } },
        },
        where: { id },
      }),
      this.database.client.auditLog.findMany({
        orderBy: { occurredAt: 'asc' },
        where: { targetId: id, targetType: 'VEHICLE' },
      }),
    ]);
    return { ...vehicle, auditLogs };
  }

  async approve(id: string, actorUserId: string, request: RequestMetadata) {
    const vehicle = await this.adminRecord(id);
    this.assertState(
      vehicle.status,
      [VehicleLifecycleStatus.PENDING_APPROVAL],
      'Only pending vehicles can be approved.',
    );
    const detail = await this.adminDetail(id);
    const failures = await this.readinessFailures(detail);
    if (failures.length) {
      throw new ApplicationException(
        VehicleErrorCode.VEHICLE_INCOMPLETE,
        'The vehicle is no longer approval-ready.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        failures,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      await transaction.vehicleDocument.updateMany({
        data: {
          reviewedAt: new Date(),
          reviewedByUserId: actorUserId,
          status: VerificationStatus.VERIFIED,
        },
        where: { replacedAt: null, vehicleId: id },
      });
      await this.transitionInTransaction(
        transaction,
        id,
        actorUserId,
        vehicle.status,
        VehicleLifecycleStatus.APPROVED,
        undefined,
        request,
        { approvedAt: new Date(), reviewReason: null },
      );
    });
    await this.setPhotoClassification(id, FileClassification.PUBLIC);
    await this.recordAdmin('VEHICLE_APPROVED', id, actorUserId, request);
    return this.adminDetail(id);
  }

  requestChanges(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.adminTransition(
      id,
      actorUserId,
      [VehicleLifecycleStatus.PENDING_APPROVAL, VehicleLifecycleStatus.APPROVED],
      VehicleLifecycleStatus.CHANGES_REQUIRED,
      reason,
      request,
      'VEHICLE_CHANGES_REQUIRED',
    );
  }

  reject(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.adminTransition(
      id,
      actorUserId,
      [VehicleLifecycleStatus.PENDING_APPROVAL],
      VehicleLifecycleStatus.REJECTED,
      reason,
      request,
      'VEHICLE_REJECTED',
    );
  }

  suspend(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.adminTransition(
      id,
      actorUserId,
      [VehicleLifecycleStatus.APPROVED],
      VehicleLifecycleStatus.SUSPENDED,
      reason,
      request,
      'VEHICLE_SUSPENDED',
    );
  }

  restore(id: string, reason: string, actorUserId: string, request: RequestMetadata) {
    return this.adminTransition(
      id,
      actorUserId,
      [VehicleLifecycleStatus.SUSPENDED],
      VehicleLifecycleStatus.APPROVED,
      reason,
      request,
      'VEHICLE_RESTORED',
    );
  }

  private async adminTransition(
    id: string,
    actorUserId: string,
    allowed: readonly VehicleLifecycleStatus[],
    next: VehicleLifecycleStatus,
    reason: string,
    request: RequestMetadata,
    action: string,
  ) {
    if (next !== VehicleLifecycleStatus.APPROVED) {
      await this.occupancy.assertNoFutureBooking(id);
    }
    const vehicle = await this.adminRecord(id);
    this.assertState(vehicle.status, allowed, `Vehicle cannot transition to ${next}.`);
    await this.transition(id, actorUserId, vehicle.status, next, reason, request, {
      ...(next === VehicleLifecycleStatus.SUSPENDED
        ? { operationalStatus: VehicleOperationalStatus.TEMPORARILY_UNAVAILABLE }
        : {}),
      reviewReason: reason,
    });
    await this.setPhotoClassification(
      id,
      next === VehicleLifecycleStatus.APPROVED
        ? FileClassification.PUBLIC
        : FileClassification.PRIVATE,
    );
    await this.recordAdmin(action, id, actorUserId, request, reason);
    return this.adminDetail(id);
  }

  private async readinessFailures(vehicle: Awaited<ReturnType<VehiclesService['getOwned']>>) {
    const failures: { field: string; issue: string }[] = [];
    if (
      !vehicle.categoryId ||
      !vehicle.make ||
      !vehicle.model ||
      !vehicle.modelYear ||
      !vehicle.transmission ||
      !vehicle.powertrain ||
      !vehicle.fuelType ||
      !vehicle.seatCount ||
      !vehicle.doorCount ||
      !vehicle.color ||
      !vehicle.plateHash
    )
      failures.push({ field: 'details', issue: 'Complete all required vehicle specifications.' });
    const activePhotos = vehicle.photos.filter(({ removedAt }) => !removedAt);
    if (activePhotos.length < 5)
      failures.push({ field: 'photos', issue: 'At least five vehicle photos are required.' });
    if (!activePhotos.some(({ isCover }) => isCover))
      failures.push({ field: 'photos', issue: 'Select one cover photo.' });
    for (const perspective of REQUIRED_PERSPECTIVES) {
      if (!activePhotos.some((photo) => photo.perspective === perspective)) {
        failures.push({ field: 'photos', issue: `Missing required ${perspective} photo.` });
      }
    }
    const requiredDefinitions = await this.database.client.vehicleDocumentDefinition.findMany({
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    const activeDocuments = vehicle.documents.filter(({ replacedAt }) => !replacedAt);
    for (const definition of requiredDefinitions) {
      if (!activeDocuments.some(({ definitionId }) => definitionId === definition.id)) {
        failures.push({ field: 'documents', issue: `${definition.name} is required.` });
      }
    }
    if (
      activeDocuments.some(
        ({ expiresAt }) => expiresAt && expiresAt.getTime() < new Date().setUTCHours(0, 0, 0, 0),
      )
    ) {
      failures.push({ field: 'documents', issue: 'Replace expired vehicle documents.' });
    }
    if (!vehicle.location)
      failures.push({ field: 'location', issue: 'Set the private vehicle location.' });
    const policy = vehicle.policyVersions[0];
    if (!policy)
      failures.push({ field: 'policies', issue: 'Configure vehicle pricing and policies.' });
    if (
      (vehicle.powertrain === VehiclePowertrain.BATTERY_ELECTRIC &&
        vehicle.fuelType !== 'ELECTRIC') ||
      (vehicle.powertrain !== VehiclePowertrain.BATTERY_ELECTRIC && vehicle.fuelType === 'ELECTRIC')
    ) {
      failures.push({ field: 'details', issue: 'Powertrain and fuel type are incompatible.' });
    }
    if (policy && vehicle.powertrain === VehiclePowertrain.BATTERY_ELECTRIC) {
      if (!policy.evReturnPolicy || policy.fuelReturnPolicy)
        failures.push({ field: 'policies', issue: 'Configure a compatible EV battery policy.' });
    } else if (policy && (!policy.fuelReturnPolicy || policy.evReturnPolicy)) {
      failures.push({ field: 'policies', issue: 'Configure a compatible fuel return policy.' });
    }
    return failures;
  }

  private validatePolicy(
    powertrain: VehiclePowertrain | null,
    input: CreateVehiclePolicyVersionDto,
  ) {
    if (input.currency && input.currency.toUpperCase() !== 'PHP') {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_PRICING,
        'Phase 3 vehicle pricing must use PHP.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (input.maximumRentalDays < input.minimumRentalDays) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_PRICING,
        'Maximum rental duration must not be shorter than the minimum.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!TURNAROUND_PRESETS.has(input.turnaroundMinutes)) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_TURNAROUND,
        'Select an approved turnaround preset.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.mileagePolicy === MileagePolicyType.LIMITED &&
      (!input.includedKilometersPerDay || !input.excessKilometerRateMinor)
    ) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_MILEAGE_POLICY,
        'Limited mileage requires included kilometers and an excess rate.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (input.availabilityPolicy === AvailabilityPolicyType.WEEKLY) {
      const values = [
        input.monday,
        input.tuesday,
        input.wednesday,
        input.thursday,
        input.friday,
        input.saturday,
        input.sunday,
      ];
      if (!values.some((value) => value === true)) {
        throw new ApplicationException(
          VehicleErrorCode.INVALID_AVAILABILITY,
          'Weekly availability must include at least one day.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const electric = powertrain === VehiclePowertrain.BATTERY_ELECTRIC;
    if (electric) {
      if (!input.evReturnPolicy || input.fuelReturnPolicy) {
        throw new ApplicationException(
          VehicleErrorCode.INVALID_EV_POLICY,
          'Battery-electric vehicles require an EV policy and cannot use a fuel policy.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (
        input.evReturnPolicy === 'MINIMUM_PERCENTAGE' &&
        input.evRequiredPercentage === undefined
      ) {
        throw new ApplicationException(
          VehicleErrorCode.INVALID_EV_POLICY,
          'Minimum-percentage EV policy requires the return percentage.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    } else if (!input.fuelReturnPolicy || input.evReturnPolicy) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_FUEL_POLICY,
        'Combustion and hybrid vehicles require a fuel policy and cannot use an EV-only policy.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private async transition(
    id: string,
    actorUserId: string,
    previousStatus: VehicleLifecycleStatus,
    newStatus: VehicleLifecycleStatus,
    reason: string | undefined,
    request: RequestMetadata,
    data: Prisma.VehicleUpdateInput,
  ) {
    await this.database.client.$transaction((transaction) =>
      this.transitionInTransaction(
        transaction,
        id,
        actorUserId,
        previousStatus,
        newStatus,
        reason,
        request,
        data,
      ),
    );
  }

  private async transitionInTransaction(
    transaction: Prisma.TransactionClient,
    id: string,
    actorUserId: string,
    previousStatus: VehicleLifecycleStatus,
    newStatus: VehicleLifecycleStatus,
    reason: string | undefined,
    request: RequestMetadata,
    data: Prisma.VehicleUpdateInput,
  ) {
    await transaction.vehicle.update({ data: { ...data, status: newStatus }, where: { id } });
    await transaction.vehicleStatusHistory.create({
      data: {
        actorUserId,
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        newStatus,
        previousStatus,
        ...(reason ? { reason } : {}),
        vehicleId: id,
      },
    });
  }

  private async setPhotoClassification(id: string, classification: FileClassification) {
    const photos = await this.database.client.vehiclePhoto.findMany({
      select: { fileAssetId: true },
      where: { removedAt: null, vehicleId: id },
    });
    if (photos.length) {
      await this.database.client.fileAsset.updateMany({
        data: { classification },
        where: { id: { in: photos.map(({ fileAssetId }) => fileAssetId) } },
      });
    }
  }

  private recordAdmin(
    action: string,
    id: string,
    actorUserId: string,
    request: RequestMetadata,
    reason?: string,
  ) {
    return this.audit.record({
      action,
      actorUserId,
      ...(reason ? { reason } : {}),
      request,
      targetId: id,
      targetType: 'VEHICLE',
    });
  }

  private ownedRecord(userId: string, id: string) {
    return this.database.client.vehicle
      .findFirstOrThrow({ where: { id, ownerUserId: userId } })
      .catch(() => this.notFound());
  }

  private adminRecord(id: string) {
    return this.database.client.vehicle.findUniqueOrThrow({ where: { id } });
  }

  private async assertCategory(id: string) {
    const category = await this.database.client.vehicleCategory.findFirst({
      where: { active: true, id },
    });
    if (!category) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_CATEGORY,
        'Vehicle category is invalid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private assertState(
    current: VehicleLifecycleStatus,
    allowed: readonly VehicleLifecycleStatus[],
    message: string,
  ) {
    if (!allowed.includes(current)) this.invalidState(message);
  }

  private invalidState(message: string): never {
    throw new ApplicationException(
      VehicleErrorCode.INVALID_VEHICLE_STATE,
      message,
      HttpStatus.CONFLICT,
    );
  }

  private invalidFile(message: string): never {
    throw new ApplicationException(
      VehicleErrorCode.INVALID_VEHICLE_FILE,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private notFound(): never {
    throw new ApplicationException(
      VehicleErrorCode.VEHICLE_NOT_FOUND,
      'Vehicle was not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private clean(value: string | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    const cleaned = value.trim();
    return cleaned || null;
  }

  private normalizeIdentifier(value: string): string {
    return value.toUpperCase().replaceAll(/[^A-Z0-9]/g, '');
  }

  private stringUpdates<T extends object>(input: T, keys: readonly (keyof T)[]) {
    return Object.fromEntries(
      keys
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, this.clean(input[key] as string | undefined)]),
    );
  }
}
