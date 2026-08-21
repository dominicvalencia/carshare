import { Injectable } from '@nestjs/common';
import {
  FileAssetStatus,
  FileClassification,
  OwnerProfileStatus,
  Prisma,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VerificationStatus,
} from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';

export const publicVehicleSelect = {
  approvedAt: true,
  category: { select: { code: true, id: true, name: true } },
  createdAt: true,
  description: true,
  doorCount: true,
  features: { select: { feature: { select: { code: true, id: true, name: true } } } },
  fuelType: true,
  id: true,
  location: {
    select: { city: true, country: true, province: true, timezone: true },
  },
  make: true,
  model: true,
  modelYear: true,
  operationalStatus: true,
  ownerProfile: {
    select: {
      id: true,
      status: true,
      userId: true,
      user: {
        select: {
          createdAt: true,
          profile: {
            select: {
              avatarFile: {
                select: { classification: true, id: true, status: true },
              },
              displayName: true,
              firstName: true,
            },
          },
        },
      },
    },
  },
  photos: {
    orderBy: { displayOrder: 'asc' as const },
    select: {
      displayOrder: true,
      fileAsset: { select: { classification: true, id: true, status: true } },
      id: true,
      isCover: true,
      perspective: true,
    },
    where: {
      fileAsset: { classification: FileClassification.PUBLIC, status: FileAssetStatus.READY },
      removedAt: null,
    },
  },
  policyVersions: { orderBy: { version: 'desc' as const }, take: 1 },
  powertrain: true,
  rentalRequirements: true,
  seatCount: true,
  status: true,
  transmission: true,
  variant: true,
} satisfies Prisma.VehicleSelect;

export type PublicVehicleRecord = Prisma.VehicleGetPayload<{ select: typeof publicVehicleSelect }>;

@Injectable()
export class PublicVehicleEligibilityService {
  constructor(private readonly database: DatabaseService) {}

  async findEligible(
    ids?: readonly string[],
    transaction?: Prisma.TransactionClient,
  ): Promise<PublicVehicleRecord[]> {
    const client = transaction ?? this.database.client;
    const required = await this.requiredDocumentIds(client);
    return client.vehicle.findMany({
      orderBy: { id: 'asc' },
      select: publicVehicleSelect,
      where: this.where(required, ids),
    });
  }

  async findOne(
    id: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<PublicVehicleRecord | null> {
    const vehicles = await this.findEligible([id], transaction);
    return vehicles[0] ?? null;
  }

  async diagnostic(id: string) {
    const eligible = await this.findOne(id);
    if (eligible) return { discoverable: true, reasons: [], previewVehicleId: id };
    const vehicle = await this.database.client.vehicle.findUnique({
      include: {
        documents: { include: { definition: true } },
        location: true,
        ownerProfile: true,
        photos: { include: { fileAsset: true }, where: { isCover: true, removedAt: null } },
        policyVersions: { orderBy: { version: 'desc' }, take: 1 },
      },
      where: { id },
    });
    if (!vehicle) return { discoverable: false, reasons: ['VEHICLE_NOT_FOUND'] };
    const reasons: string[] = [];
    if (vehicle.status !== VehicleLifecycleStatus.APPROVED) reasons.push('LISTING_NOT_APPROVED');
    if (vehicle.operationalStatus !== VehicleOperationalStatus.AVAILABLE)
      reasons.push('VEHICLE_UNAVAILABLE');
    if (vehicle.ownerProfile.status !== OwnerProfileStatus.VERIFIED)
      reasons.push('OWNER_NOT_VERIFIED');
    if (!vehicle.location) reasons.push('LOCATION_MISSING');
    if (!vehicle.policyVersions.length) reasons.push('POLICY_MISSING');
    if (
      !vehicle.photos.some(
        ({ fileAsset }) =>
          fileAsset.classification === FileClassification.PUBLIC &&
          fileAsset.status === FileAssetStatus.READY,
      )
    )
      reasons.push('PUBLIC_COVER_PHOTO_MISSING');
    const required = await this.requiredDocumentIds();
    for (const definitionId of required) {
      if (
        !vehicle.documents.some(
          (document) =>
            document.definitionId === definitionId &&
            document.status === VerificationStatus.VERIFIED &&
            document.replacedAt === null &&
            (!document.expiresAt || document.expiresAt >= new Date()),
        )
      )
        reasons.push('REQUIRED_DOCUMENT_INVALID');
    }
    return { discoverable: false, reasons: [...new Set(reasons)] };
  }

  private async requiredDocumentIds(
    client: Prisma.TransactionClient | DatabaseService['client'] = this.database.client,
  ): Promise<string[]> {
    const definitions = await client.vehicleDocumentDefinition.findMany({
      select: { id: true },
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    return definitions.map(({ id }) => id);
  }

  private where(required: readonly string[], ids?: readonly string[]): Prisma.VehicleWhereInput {
    return {
      AND: required.map((definitionId) => ({
        documents: {
          some: {
            definitionId,
            replacedAt: null,
            status: VerificationStatus.VERIFIED,
            OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
          },
        },
      })),
      ...(ids ? { id: { in: [...ids] } } : {}),
      location: { isNot: null },
      operationalStatus: VehicleOperationalStatus.AVAILABLE,
      ownerProfile: { status: OwnerProfileStatus.VERIFIED },
      photos: {
        some: {
          fileAsset: { classification: FileClassification.PUBLIC, status: FileAssetStatus.READY },
          isCover: true,
          removedAt: null,
        },
      },
      policyVersions: { some: {} },
      status: VehicleLifecycleStatus.APPROVED,
    };
  }
}
