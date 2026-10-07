import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AvailabilityPolicyType,
  BookingStatus,
  DisputeStatus,
  FileAssetStatus,
  FileClassification,
  InspectionConditionClassification,
  MileagePolicyType,
  PostReturnClaimStatus,
  Prisma,
  ReviewType,
  SecurityDepositSettlementStatus,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VehiclePhotoPerspective,
  VehiclePowertrain,
  VehicleKnownIssueStatus,
  VerificationStatus,
} from '@carrental/database';
import { VehicleErrorCode } from '@carrental/api-contracts';
import { AuditService } from '../audit/audit.service';
import { OccupancyService } from '../bookings/occupancy.service';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { FilesService } from '../files/files.service';
import { GeographyService } from '../geography/geography.service';
import { OwnersService } from '../owners/owners.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata } from '../security/security-context';
import type {
  AddVehicleDocumentDto,
  AddVehiclePhotoDto,
  ChangeOperationalStatusDto,
  CreateVehicleKnownIssueDto,
  CreateVehicleBlockDto,
  CreateVehicleDto,
  CreateVehiclePolicyVersionDto,
  ReorderVehiclePhotosDto,
  RemoveVehicleDto,
  SetVehicleFeaturesDto,
  SetVehicleLocationDto,
  UpdateVehicleDto,
  UpdateVehicleKnownIssueDto,
} from './vehicles.dto';
import { validateDurationDiscounts } from '../discovery/duration-discounts';
import {
  normalizeFulfillmentPolicy,
  validateFulfillmentPolicy,
} from '../fulfillment/fulfillment-policy';
import { manilaTodayWindow, ownerAvailabilityToday } from './owner-availability';
import {
  isAllowedSecurityDepositTier,
  isSecurityDepositCurrency,
  securityDepositConfiguration,
  securityDepositProjection,
} from '../common/security-deposit-policy';

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
  knownIssues: {
    include: { evidence: { include: { fileAsset: { select: safeFileSelect } } } },
    orderBy: { createdAt: 'desc' as const },
  },
  photos: {
    include: { fileAsset: { select: safeFileSelect } },
    orderBy: { displayOrder: 'asc' as const },
    where: { removedAt: null },
  },
  policyVersions: { orderBy: { version: 'desc' as const } },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
};
type OwnerVehicleRecord = Prisma.VehicleGetPayload<{ include: typeof ownerVehicleInclude }>;
type VehicleDeleteBlocker = {
  readonly code:
    | 'ONGOING_RENTAL'
    | 'FUTURE_BOOKING'
    | 'RETURN_PENDING'
    | 'OPEN_CLAIM'
    | 'OPEN_DISPUTE'
    | 'FINANCIAL_SETTLEMENT_PENDING';
  readonly bookingReference?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
};

@Injectable()
export class VehiclesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly owners: OwnersService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly occupancy: OccupancyService,
    private readonly files: FilesService,
    private readonly geography: GeographyService,
  ) {}

  categories() {
    return this.database.client.vehicleCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      where: { active: true },
    });
  }

  makes() {
    return this.database.client.vehicleMake.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      where: { active: true },
    });
  }

  models(makeId: string) {
    return this.database.client.vehicleModel.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      where: { active: true, makeId },
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
    await this.owners.assertDraftCapable(userId);
    const owner = await this.database.client.ownerProfile.findUniqueOrThrow({ where: { userId } });
    if (input.categoryId) await this.assertCategory(input.categoryId);
    const make = input.make === undefined ? undefined : await this.canonicalMake(input.make);
    const vehicle = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.vehicle.create({
        data: {
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          ...(make === undefined ? {} : { make }),
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

  async listOwned(userId: string) {
    const vehicles = await this.database.client.vehicle.findMany({
      include: {
        category: true,
        location: true,
        photos: {
          include: { fileAsset: { select: safeFileSelect } },
          orderBy: { displayOrder: 'asc' },
          take: 1,
          where: { isCover: true, removedAt: null },
        },
        policyVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      where: { ownerUserId: userId, status: { not: VehicleLifecycleStatus.ARCHIVED } },
    });
    const { endExclusive, startInclusive } = manilaTodayWindow();
    const vehicleIds = vehicles.map(({ id }) => id);
    const [occupancies, blocks] = vehicleIds.length
      ? await Promise.all([
          this.database.client.vehicleOccupancy.findMany({
            select: { type: true, vehicleId: true },
            where: {
              active: true,
              occupiedEnd: { gt: startInclusive },
              occupiedStart: { lt: endExclusive },
              vehicleId: { in: vehicleIds },
            },
          }),
          this.database.client.vehicleBlockedPeriod.findMany({
            select: { endsAt: true, reason: true, vehicleId: true },
            where: {
              endsAt: { gt: startInclusive },
              removedAt: null,
              startsAt: { lt: endExclusive },
              vehicleId: { in: vehicleIds },
            },
          }),
        ])
      : [[], []];
    return vehicles.map((vehicle) => ({
      ...this.withOwnerPhotoGrants(vehicle),
      availabilityToday: ownerAvailabilityToday({
        blocks: blocks.filter(({ vehicleId }) => vehicleId === vehicle.id),
        lifecycleStatus: vehicle.status,
        occupancies: occupancies.filter(({ vehicleId }) => vehicleId === vehicle.id),
        operationalStatus: vehicle.operationalStatus,
      }),
    }));
  }

  async ownerDashboardSummary(userId: string) {
    await this.owners.assertDraftCapable(userId);
    const { endExclusive, startInclusive } = manilaTodayWindow();
    const rows = await this.database.client.vehicleBlockedPeriod.findMany({
      distinct: ['vehicleId'],
      select: { vehicleId: true },
      where: {
        endsAt: { gt: startInclusive },
        removedAt: null,
        startsAt: { lt: endExclusive },
        vehicle: { ownerUserId: userId },
      },
    });
    return {
      asOf: new Date().toISOString(),
      ownerBlockedVehiclesToday: rows.length,
      timezone: 'Asia/Manila',
    };
  }

  async getOwned(userId: string, id: string) {
    const vehicle = await this.database.client.vehicle.findFirst({
      include: ownerVehicleInclude,
      where: { id, ownerUserId: userId },
    });
    if (!vehicle) this.notFound();
    const { endExclusive, startInclusive } = manilaTodayWindow();
    const [occupancies, blocks] = await Promise.all([
      this.database.client.vehicleOccupancy.findMany({
        select: { type: true },
        where: {
          active: true,
          occupiedEnd: { gt: startInclusive },
          occupiedStart: { lt: endExclusive },
          vehicleId: id,
        },
      }),
      this.database.client.vehicleBlockedPeriod.findMany({
        select: { endsAt: true, reason: true },
        where: {
          endsAt: { gt: startInclusive },
          removedAt: null,
          startsAt: { lt: endExclusive },
          vehicleId: id,
        },
      }),
    ]);
    return {
      ...this.withOwnerPhotoGrants(vehicle),
      knownIssues: this.withKnownIssueEvidenceGrants(vehicle.knownIssues),
      availabilityToday: ownerAvailabilityToday({
        blocks,
        lifecycleStatus: vehicle.status,
        occupancies,
        operationalStatus: vehicle.operationalStatus,
      }),
    };
  }

  async deleteEligibility(userId: string, id: string) {
    await this.ownedRecord(userId, id);
    return this.deleteEligibilityWithClient(this.database.client, id);
  }

  async removeFromFleet(
    userId: string,
    id: string,
    input: RemoveVehicleDto,
    request: RequestMetadata,
  ) {
    await this.owners.assertDraftCapable(userId);
    const otherReason = input.otherReason?.trim() || null;
    if (input.reason !== 'OTHER' && otherReason) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_VEHICLE_SPECIFICATION,
        'Additional removal details are only accepted when Other is selected.',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM vehicles WHERE id = ${id}::uuid FOR UPDATE`;
      const vehicle = await transaction.vehicle.findFirst({
        select: { id: true, status: true },
        where: { id, ownerUserId: userId },
      });
      if (!vehicle) this.notFound();
      if (vehicle.status === VehicleLifecycleStatus.ARCHIVED) return;
      const eligibility = await this.deleteEligibilityWithClient(transaction, id);
      if (!eligibility.allowed) {
        throw new ApplicationException(
          VehicleErrorCode.VEHICLE_DELETE_BLOCKED,
          this.deleteBlockedMessage(eligibility.blockers[0]),
          HttpStatus.CONFLICT,
          eligibility.blockers.map((blocker) => ({
            field: blocker.code,
            issue: this.deleteBlockedMessage(blocker),
          })),
        );
      }
      await this.transitionInTransaction(
        transaction,
        id,
        userId,
        vehicle.status,
        VehicleLifecycleStatus.ARCHIVED,
        'Removed from fleet by owner',
        request,
        {
          archivedAt: new Date(),
          archivedByUser: { connect: { id: userId } },
          operationalStatus: VehicleOperationalStatus.TEMPORARILY_UNAVAILABLE,
          removalOtherReason: input.reason === 'OTHER' ? otherReason : null,
          removalReason: input.reason,
        },
      );
      await transaction.auditLog.create({
        data: {
          action: 'VEHICLE_REMOVED_FROM_FLEET',
          actorUserId: userId,
          metadata: {
            otherReason: input.reason === 'OTHER' ? otherReason : null,
            reason: input.reason,
          },
          reason: 'Owner requested removal',
          targetId: id,
          targetType: 'VEHICLE',
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
          ...(request.ipAddress ? { ipAddress: request.ipAddress } : {}),
        },
      });
    });
    await this.setPhotoClassification(id, FileClassification.PRIVATE);
  }

  private async deleteEligibilityWithClient(
    client: Prisma.TransactionClient | DatabaseService['client'],
    vehicleId: string,
  ): Promise<{ allowed: boolean; blockers: VehicleDeleteBlocker[]; retentionMode: 'ARCHIVE' }> {
    const bookings = await client.booking.findMany({
      select: {
        publicReference: true,
        rentalEnd: true,
        rentalStart: true,
        status: true,
        postReturnClaims: { select: { status: true } },
        disputes: { select: { status: true } },
        securityDepositSettlements: { select: { status: true } },
      },
      where: { vehicleId },
    });
    const blockers: VehicleDeleteBlocker[] = [];
    const now = new Date();
    for (const booking of bookings) {
      const detail = {
        bookingReference: booking.publicReference,
        endsAt: booking.rentalEnd.toISOString(),
        startsAt: booking.rentalStart.toISOString(),
      };
      if (
        [BookingStatus.ACTIVE, BookingStatus.READY_FOR_PICKUP].includes(booking.status as never)
      ) {
        blockers.push({ code: 'ONGOING_RENTAL', ...detail });
      } else if (
        [BookingStatus.RETURN_PENDING, BookingStatus.RETURNED].includes(booking.status as never)
      ) {
        blockers.push({ code: 'RETURN_PENDING', ...detail });
      } else if (
        [BookingStatus.CAPTURE_PENDING, BookingStatus.CONFIRMED].includes(
          booking.status as never,
        ) &&
        booking.rentalEnd > now
      ) {
        blockers.push({ code: 'FUTURE_BOOKING', ...detail });
      }
      if (
        booking.postReturnClaims.some(
          ({ status }) =>
            ![PostReturnClaimStatus.WITHDRAWN, PostReturnClaimStatus.RESOLVED].includes(
              status as never,
            ),
        )
      )
        blockers.push({ code: 'OPEN_CLAIM', ...detail });
      if (
        booking.disputes.some(
          ({ status }) =>
            ![
              DisputeStatus.RESOLVED_FOR_RENTER,
              DisputeStatus.RESOLVED_FOR_OWNER,
              DisputeStatus.PARTIALLY_RESOLVED,
              DisputeStatus.CLOSED,
            ].includes(status as never),
        )
      )
        blockers.push({ code: 'OPEN_DISPUTE', ...detail });
      if (
        booking.securityDepositSettlements.some(
          ({ status }) =>
            ![
              SecurityDepositSettlementStatus.RELEASED,
              SecurityDepositSettlementStatus.PARTIALLY_USED,
              SecurityDepositSettlementStatus.USED,
              SecurityDepositSettlementStatus.REVERSED,
            ].includes(status as never),
        )
      )
        blockers.push({ code: 'FINANCIAL_SETTLEMENT_PENDING', ...detail });
    }
    return { allowed: blockers.length === 0, blockers, retentionMode: 'ARCHIVE' };
  }

  private deleteBlockedMessage(blocker?: VehicleDeleteBlocker): string {
    if (!blocker) return 'This vehicle cannot be removed right now.';
    if (blocker.code === 'ONGOING_RENTAL')
      return "This vehicle can't be removed while a rental is in progress.";
    if (blocker.code === 'FUTURE_BOOKING')
      return "This vehicle can't be removed because it has an upcoming booking.";
    if (blocker.code === 'RETURN_PENDING')
      return "This vehicle can't be removed until the return workflow is complete.";
    if (blocker.code === 'OPEN_CLAIM')
      return "This vehicle can't be removed while a claim is open.";
    if (blocker.code === 'OPEN_DISPUTE')
      return "This vehicle can't be removed while a dispute is open.";
    return "This vehicle can't be removed while a security deposit settlement is pending.";
  }

  async listKnownIssues(userId: string, id: string) {
    await this.ownedRecord(userId, id);
    const issues = await this.database.client.vehicleKnownIssue.findMany({
      include: { evidence: { include: { fileAsset: { select: safeFileSelect } } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      where: { vehicleId: id },
    });
    return this.withKnownIssueEvidenceGrants(issues);
  }

  async createKnownIssue(userId: string, id: string, input: CreateVehicleKnownIssueDto) {
    await this.owners.assertOperational(userId);
    await this.ownedRecord(userId, id);
    await this.assertKnownIssueEvidence(userId, input.evidenceFileAssetIds ?? []);
    const issue = await this.database.client.$transaction(async (transaction) => {
      const created = await transaction.vehicleKnownIssue.create({
        data: {
          category: input.category,
          classification: input.classification,
          createdByUserId: userId,
          description: input.description.trim(),
          status: VehicleKnownIssueStatus.ACTIVE,
          vehicleArea: input.vehicleArea,
          vehicleId: id,
        },
      });
      if (input.evidenceFileAssetIds?.length) {
        await transaction.vehicleKnownIssueEvidence.createMany({
          data: [...new Set(input.evidenceFileAssetIds)].map((fileAssetId) => ({
            fileAssetId,
            issueId: created.id,
            uploadedByUserId: userId,
          })),
        });
      }
      if (input.classification !== InspectionConditionClassification.COSMETIC) {
        await transaction.vehicle.update({
          data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
          where: { id },
        });
      }
      return created;
    });
    return (await this.listKnownIssues(userId, id)).find(({ id: value }) => value === issue.id);
  }

  async updateKnownIssue(
    userId: string,
    id: string,
    issueId: string,
    input: UpdateVehicleKnownIssueDto,
  ) {
    await this.owners.assertOperational(userId);
    await this.ownedRecord(userId, id);
    const existing = await this.database.client.vehicleKnownIssue.findFirst({
      where: { id: issueId, status: VehicleKnownIssueStatus.ACTIVE, vehicleId: id },
    });
    if (!existing) this.notFound();
    await this.assertKnownIssueEvidence(userId, input.evidenceFileAssetIds ?? []);
    await this.database.client.$transaction(async (transaction) => {
      await transaction.vehicleKnownIssue.update({
        data: {
          category: input.category,
          classification: input.classification,
          description: input.description.trim(),
          vehicleArea: input.vehicleArea,
        },
        where: { id: issueId },
      });
      if (input.evidenceFileAssetIds?.length) {
        await transaction.vehicleKnownIssueEvidence.createMany({
          data: [...new Set(input.evidenceFileAssetIds)].map((fileAssetId) => ({
            fileAssetId,
            issueId,
            uploadedByUserId: userId,
          })),
          skipDuplicates: true,
        });
      }
      if (input.classification !== InspectionConditionClassification.COSMETIC) {
        await transaction.vehicle.update({
          data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
          where: { id },
        });
      }
    });
    return (await this.listKnownIssues(userId, id)).find(({ id: value }) => value === issueId);
  }

  async resolveKnownIssue(userId: string, id: string, issueId: string) {
    await this.owners.assertOperational(userId);
    await this.ownedRecord(userId, id);
    const result = await this.database.client.vehicleKnownIssue.updateMany({
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: userId,
        status: VehicleKnownIssueStatus.RESOLVED,
      },
      where: { id: issueId, status: VehicleKnownIssueStatus.ACTIVE, vehicleId: id },
    });
    if (!result.count) this.notFound();
    // Availability is intentionally not restored here; other maintenance and eligibility
    // authorities must be reviewed before an Owner explicitly makes the vehicle available.
    return (await this.listKnownIssues(userId, id)).find(({ id: value }) => value === issueId);
  }

  async update(userId: string, id: string, input: UpdateVehicleDto) {
    await this.owners.assertDraftCapable(userId);
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
    const make = input.make === undefined ? undefined : await this.canonicalMake(input.make);
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
    if (make !== undefined) data.make = make;
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
    await this.owners.assertDraftCapable(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, POLICY_EDITABLE, 'Features cannot be changed in this state.');
    const unique = [...new Set(input.featureIds)];
    const count = await this.database.client.vehicleFeature.count({
      where: {
        id: { in: unique },
        OR: [{ active: true }, { assignments: { some: { vehicleId: id } } }],
      },
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
    await this.owners.assertDraftCapable(userId);
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
    await this.owners.assertDraftCapable(userId);
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
    await this.owners.assertDraftCapable(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, MATERIAL_EDITABLE, 'Photos cannot be changed in this state.');
    const result = await this.database.client.vehiclePhoto.updateMany({
      data: { isCover: false, removedAt: new Date() },
      where: { id: photoId, removedAt: null, vehicleId: id },
    });
    if (!result.count) this.notFound();
  }

  async addDocument(userId: string, id: string, input: AddVehicleDocumentDto) {
    await this.owners.assertDraftCapable(userId);
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
    await this.owners.assertDraftCapable(userId);
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
    const hasStructuredAddress = Boolean(
      input.regionCode ||
      input.addressScopeCode ||
      input.cityMunicipalityCode ||
      input.barangayCode,
    );
    const address = hasStructuredAddress
      ? await this.geography.validateAddress({
          regionCode: input.regionCode ?? '',
          addressScopeCode: input.addressScopeCode ?? '',
          ...(input.provinceCode ? { provinceCode: input.provinceCode } : {}),
          cityMunicipalityCode: input.cityMunicipalityCode ?? '',
          barangayCode: input.barangayCode ?? '',
        })
      : null;
    const city = address?.city.name ?? input.city.trim();
    const province = address?.province?.name ?? address?.scope.name ?? input.province.trim();
    const structured = address
      ? {
          addressScopeCode: address.scope.code,
          barangay: address.barangay.name,
          barangayCode: address.barangay.code,
          cityMunicipalityCode: address.city.code,
          provinceCode: address.province?.code ?? null,
          regionCode: address.region.code,
        }
      : {
          addressScopeCode: null,
          barangayCode: null,
          cityMunicipalityCode: null,
          provinceCode: null,
          regionCode: null,
        };
    await this.database.client.vehicleLocation.upsert({
      create: {
        ...structured,
        addressLine1: this.clean(input.addressLine1) ?? null,
        barangay: address?.barangay.name ?? this.clean(input.barangay) ?? null,
        city,
        country: (input.country ?? 'PH').toUpperCase(),
        latitude,
        longitude,
        pickupAreaLabel: this.clean(input.pickupAreaLabel) ?? null,
        landmark: this.clean(input.landmark) ?? null,
        province,
        timezone: input.timezone ?? 'Asia/Manila',
        vehicleId: id,
      },
      update: {
        ...structured,
        addressLine1: this.clean(input.addressLine1) ?? null,
        barangay: address?.barangay.name ?? this.clean(input.barangay) ?? null,
        city,
        country: (input.country ?? 'PH').toUpperCase(),
        latitude,
        longitude,
        pickupAreaLabel: this.clean(input.pickupAreaLabel) ?? null,
        landmark: this.clean(input.landmark) ?? null,
        province,
        timezone: input.timezone ?? 'Asia/Manila',
      },
      where: { vehicleId: id },
    });
    return this.getOwned(userId, id);
  }

  async createPolicyVersion(userId: string, id: string, input: CreateVehiclePolicyVersionDto) {
    await this.owners.assertDraftCapable(userId);
    const vehicle = await this.ownedRecord(userId, id);
    this.assertState(vehicle.status, POLICY_EDITABLE, 'Policies cannot be changed in this state.');
    this.validatePolicy(vehicle.powertrain, input);
    const securityDeposit = this.validateSecurityDeposit(input);
    const fulfillment = normalizeFulfillmentPolicy(input);
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
        shortDurationDiscountBps: input.shortDurationDiscountBps ?? null,
        weeklyDiscountBps: input.weeklyDiscountBps ?? null,
        extendedTripDiscountBps: input.extendedTripDiscountBps ?? null,
        monthlyDiscountBps: input.monthlyDiscountBps ?? null,
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
        ...fulfillment,
        securityDepositAmountMinor: securityDeposit.amountMinor,
        securityDepositCurrency: securityDeposit.currency,
        securityDepositRequired: securityDeposit.required,
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
    await this.owners.assertDraftCapable(userId);
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
    await this.owners.assertDraftCapable(userId);
    await this.ownedRecord(userId, id);
    const result = await this.database.client.$transaction(async (transaction) => {
      const block = await transaction.vehicleBlockedPeriod.findFirst({
        where: { id: blockId, vehicleId: id },
      });
      if (!block) return 0;
      if (block.removedAt) return 0;
      if (block.endsAt <= new Date()) {
        throw new ApplicationException(
          VehicleErrorCode.INVALID_BLOCKED_PERIOD,
          'Past unavailable periods are read-only.',
          HttpStatus.CONFLICT,
        );
      }
      await this.occupancy.release(transaction, block.occupancyId, 'OWNER_BLOCK_REMOVED');
      await transaction.vehicleBlockedPeriod.update({
        data: { removedAt: new Date() },
        where: { id: block.id },
      });
      return 1;
    });
    return { removed: result === 1 };
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
    await this.owners.assertDraftCapable(userId);
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
    } else {
      const blockingIssue = await this.database.client.vehicleKnownIssue.findFirst({
        where: {
          classification: {
            in: [
              InspectionConditionClassification.OPERATIONAL,
              InspectionConditionClassification.SAFETY_CRITICAL,
            ],
          },
          status: VehicleKnownIssueStatus.ACTIVE,
          vehicleId: id,
        },
      });
      if (blockingIssue) {
        this.invalidState('Resolve active operational and safety-critical issues first.');
      }
    }
    return this.database.client.vehicle.update({
      data: { operationalStatus: input.status },
      where: { id },
    });
  }

  private withOwnerPhotoGrants<
    T extends {
      location: { latitude: unknown; longitude: unknown } | null;
      photos: Array<{
        fileAsset: { id: string; status: FileAssetStatus };
      }>;
      policyVersions: Array<{
        securityDepositAmountMinor: number | null;
        securityDepositCurrency: string | null;
        securityDepositRequired: boolean;
      }>;
    },
  >(vehicle: T) {
    return {
      ...vehicle,
      ...this.serializedLocation(vehicle),
      policyVersions: vehicle.policyVersions.map((policy) => ({
        ...policy,
        securityDeposit: securityDepositProjection(policy),
      })),
      photos: vehicle.photos.map((photo) => ({
        ...photo,
        fileAsset: {
          ...photo.fileAsset,
          contentGrant:
            photo.fileAsset.status === FileAssetStatus.READY
              ? this.files.trustedAuthorizedGrant(photo.fileAsset.id)
              : null,
        },
      })),
    };
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
    const [vehicle, auditLogs, rating] = await Promise.all([
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
      this.database.client.ratingProjection.findUnique({
        where: { subjectType_subjectId: { subjectId: id, subjectType: ReviewType.VEHICLE } },
      }),
    ]);
    return {
      ...vehicle,
      ...this.serializedLocation(vehicle),
      auditLogs,
      knownIssues: this.withKnownIssueEvidenceGrants(vehicle.knownIssues),
      publishedRating: rating
        ? { averageRating: rating.averageRating.toString(), reviewCount: rating.reviewCount }
        : { averageRating: null, reviewCount: 0 },
    };
  }

  private async assertKnownIssueEvidence(userId: string, fileAssetIds: readonly string[]) {
    const unique = [...new Set(fileAssetIds)];
    if (!unique.length) return;
    const count = await this.database.client.fileAsset.count({
      where: {
        classification: FileClassification.SENSITIVE,
        id: { in: unique },
        mimeType: { startsWith: 'image/' },
        status: FileAssetStatus.READY,
        uploadedById: userId,
      },
    });
    if (count !== unique.length)
      this.invalidFile('Attach only ready private issue evidence uploaded by this owner.');
  }

  private withKnownIssueEvidenceGrants<
    T extends { evidence: Array<{ fileAsset: { id: string; status: FileAssetStatus } }> },
  >(issues: T[]) {
    return issues.map((issue) => ({
      ...issue,
      evidence: issue.evidence.map((item) => ({
        ...item,
        fileAsset: {
          ...item.fileAsset,
          contentGrant:
            item.fileAsset.status === FileAssetStatus.READY
              ? this.files.trustedAuthorizedGrant(item.fileAsset.id)
              : null,
        },
      })),
    }));
  }

  private serializedLocation(vehicle: {
    location?: { latitude: unknown; longitude: unknown } | null;
  }) {
    return vehicle.location
      ? {
          location: {
            ...vehicle.location,
            latitude: String(vehicle.location.latitude),
            longitude: String(vehicle.location.longitude),
          },
        }
      : {};
  }

  async approve(id: string, actorUserId: string, request: RequestMetadata) {
    const vehicle = await this.adminRecord(id);
    this.assertState(
      vehicle.status,
      [VehicleLifecycleStatus.PENDING_APPROVAL],
      'Only pending vehicles can be approved.',
    );
    const detail = await this.database.client.vehicle.findUniqueOrThrow({
      include: ownerVehicleInclude,
      where: { id },
    });
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

  private async readinessFailures(vehicle: OwnerVehicleRecord) {
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
    const discountError = validateDurationDiscounts(input);
    if (discountError)
      throw new ApplicationException(
        VehicleErrorCode.INVALID_PRICING,
        discountError,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const fulfillmentError = validateFulfillmentPolicy(input);
    if (fulfillmentError) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_FULFILLMENT_POLICY,
        fulfillmentError,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
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

  private validateSecurityDeposit(input: CreateVehiclePolicyVersionDto) {
    const deposit = securityDepositConfiguration({
      ...(input.securityDepositAmountMinor === undefined
        ? {}
        : { amountMinor: input.securityDepositAmountMinor }),
      ...(input.securityDepositCurrency === undefined
        ? {}
        : { currency: input.securityDepositCurrency }),
      ...(input.securityDepositRequired === undefined
        ? {}
        : { required: input.securityDepositRequired }),
    });
    if (!deposit.required) {
      if (input.securityDepositAmountMinor !== undefined || input.securityDepositCurrency) {
        throw new ApplicationException(
          VehicleErrorCode.SECURITY_DEPOSIT_INVALID_CONFIGURATION,
          'A no-deposit policy cannot include a deposit amount or currency.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return deposit;
    }
    if (deposit.amountMinor === null || deposit.currency === null || deposit.amountMinor <= 0) {
      throw new ApplicationException(
        VehicleErrorCode.SECURITY_DEPOSIT_INVALID_CONFIGURATION,
        'A required security deposit needs a positive amount and currency.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!isSecurityDepositCurrency(deposit.currency)) {
      throw new ApplicationException(
        VehicleErrorCode.SECURITY_DEPOSIT_CURRENCY_UNSUPPORTED,
        'Select a supported security deposit currency.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (!isAllowedSecurityDepositTier(deposit.currency, deposit.amountMinor)) {
      throw new ApplicationException(
        VehicleErrorCode.SECURITY_DEPOSIT_AMOUNT_NOT_ALLOWED,
        'Select an approved security deposit amount.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return deposit;
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

  private async canonicalMake(value: string): Promise<string | null> {
    const normalized = value.trim();
    if (!normalized) return null;
    const make = await this.database.client.vehicleMake.findFirst({
      where: { active: true, name: { equals: normalized, mode: 'insensitive' } },
      select: { name: true },
    });
    if (!make) {
      throw new ApplicationException(
        VehicleErrorCode.INVALID_VEHICLE_SPECIFICATION,
        'Select a supported vehicle make.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return make.name;
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
