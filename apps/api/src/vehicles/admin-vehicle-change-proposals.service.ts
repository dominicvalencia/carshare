import { HttpStatus, Injectable } from '@nestjs/common';
import {
  classifyVehicleChangedFields,
  diffVehicleChangeProposalSnapshots,
  validateVehicleChangeProposalSnapshotV1,
  type AdminVehicleChangeProposalDetail,
  type AdminVehicleChangeProposalListResponse,
  type VehicleChangeProposalSnapshotV1,
} from '@carrental/api-contracts';
import {
  FileAssetStatus,
  FileClassification,
  Prisma,
  VehicleChangeProposalAssetKind,
  VehicleChangeProposalStatus,
  VehicleLifecycleStatus,
  VerificationStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { FilesService } from '../files/files.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata } from '../security/security-context';
import { VehicleChangeProposalSnapshotService } from './vehicle-change-proposal-snapshot.service';

const ADMIN_STATUSES = [
  VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
  VehicleChangeProposalStatus.PLATFORM_CHANGES_REQUIRED,
  VehicleChangeProposalStatus.REJECTED,
  VehicleChangeProposalStatus.APPLIED,
] as const;
const REQUIRED_PHOTO_PERSPECTIVES = [
  'FRONT',
  'REAR',
  'DRIVER_SIDE',
  'PASSENGER_SIDE',
  'INTERIOR_DASHBOARD',
] as const;

@Injectable()
export class AdminVehicleChangeProposalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly snapshots: VehicleChangeProposalSnapshotService,
    private readonly files: FilesService,
    private readonly crypto: CryptoService,
  ) {}

  async list(
    status: VehicleChangeProposalStatus = VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
  ): Promise<AdminVehicleChangeProposalListResponse> {
    if (!ADMIN_STATUSES.includes(status as (typeof ADMIN_STATUSES)[number])) this.invalidStatus();
    const proposals = await this.database.client.vehicleChangeProposal.findMany({
      include: {
        ownerProfile: { select: { id: true, legalName: true, publicReference: true } },
        submittedMembership: { select: { displayName: true } },
        vehicle: { select: { make: true, model: true, modelYear: true, revision: true } },
      },
      orderBy: { submittedAt: 'asc' },
      take: 100,
      where: { platformReviewRequired: true, status },
    });
    return { proposals: proposals.map((proposal) => this.listItem(proposal)) };
  }

  async detail(id: string): Promise<AdminVehicleChangeProposalDetail> {
    const proposal = await this.database.client.vehicleChangeProposal.findFirst({
      include: {
        assets: { include: { fileAsset: true }, orderBy: { displayOrder: 'asc' } },
        ownerProfile: { select: { id: true, legalName: true, publicReference: true } },
        submittedMembership: { select: { displayName: true } },
        vehicle: { select: { make: true, model: true, modelYear: true, revision: true } },
      },
      where: { id, platformReviewRequired: true },
    });
    if (!proposal) throw this.notFound();
    const [live, reviewHistory] = await Promise.all([
      this.snapshots.buildFromLiveVehicle(proposal.vehicleId, proposal.ownerProfileId),
      this.database.client.auditLog.findMany({
        orderBy: { occurredAt: 'asc' },
        select: { action: true, occurredAt: true, reason: true },
        where: { targetId: proposal.id, targetType: 'VEHICLE_CHANGE_PROPOSAL' },
      }),
    ]);
    if (!live) throw this.notFound();
    const proposed = this.validateSnapshot(proposal.proposedSnapshot);
    return {
      ...this.listItem(proposal),
      appliedAt: proposal.appliedAt?.toISOString() ?? null,
      assets: proposal.assets.map((asset) => ({
        contentGrant:
          asset.fileAsset.status === FileAssetStatus.READY
            ? this.files.trustedAuthorizedGrant(asset.fileAssetId)
            : null,
        fileAssetId: asset.fileAssetId,
        kind: asset.kind,
        mimeType: asset.fileAsset.mimeType,
        originalName: asset.fileAsset.originalName,
      })),
      baseVehicleRevision: proposal.baseVehicleRevision,
      currentSnapshot: live.snapshot,
      currentVehicleRevision: live.baseVehicleRevision,
      ownerApprovalBypassed: proposal.ownerApprovalBypassed,
      ownerApprovalRequired: proposal.ownerApprovalRequired,
      ownerReviewedAt: proposal.ownerReviewedAt?.toISOString() ?? null,
      platformReviewReason: proposal.platformReviewReason,
      platformReviewRequired: proposal.platformReviewRequired,
      platformReviewedAt: proposal.platformReviewedAt?.toISOString() ?? null,
      proposedSnapshot: proposed,
      reviewHistory: reviewHistory.map((entry) => ({
        action: entry.action,
        occurredAt: entry.occurredAt.toISOString(),
        reason: entry.reason,
      })),
      trustEnabledAtSubmission: proposal.trustEnabledAtSubmission,
    };
  }

  approve(proposalId: string, adminUserId: string, actorUserId: string, request?: RequestMetadata) {
    return this.database.client.$transaction(
      async (transaction) => {
        const { live, proposal, proposed, vehicle } = await this.lockForDecision(
          transaction,
          proposalId,
          adminUserId,
          actorUserId,
        );
        const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, proposed);
        if (!changedFields.length)
          this.conflict(
            'VEHICLE_CHANGE_PROPOSAL_EMPTY',
            'This proposal no longer contains a change.',
          );
        if (classifyVehicleChangedFields(changedFields) !== 'PLATFORM_REVIEW_REQUIRED')
          this.conflict(
            'VEHICLE_CHANGE_PROPOSAL_CLASSIFICATION_CHANGED',
            'The proposal must be submitted again before review.',
          );
        await this.validateReferences(transaction, proposal, proposed, live.snapshot);
        const latestPolicy = await transaction.vehiclePolicyVersion.findFirst({
          orderBy: { version: 'desc' },
          select: { version: true },
          where: { vehicleId: vehicle.id },
        });
        const policyVersion = (latestPolicy?.version ?? 0) + 1;
        await transaction.vehicle.update({
          data: {
            categoryId: proposed.vehicle.categoryId,
            color: proposed.vehicle.color,
            description: proposed.vehicle.description,
            doorCount: proposed.vehicle.doorCount,
            fuelType: proposed.vehicle.fuelType as never,
            make: proposed.vehicle.make,
            model: proposed.vehicle.model,
            modelYear: proposed.vehicle.modelYear,
            plateHash: this.identifierHash('vehicle-plate', proposed.vehicle.plateNumber),
            plateNumber: proposed.vehicle.plateNumber,
            powertrain: proposed.vehicle.powertrain as never,
            rentalRequirements: proposed.vehicle.rentalRequirements,
            revision: { increment: 1 },
            seatCount: proposed.vehicle.seatCount,
            transmission: proposed.vehicle.transmission as never,
            variant: proposed.vehicle.variant,
            vin: proposed.vehicle.vin,
            vinHash: this.identifierHash('vehicle-vin', proposed.vehicle.vin),
          },
          where: { id: vehicle.id },
        });
        await this.promoteFeatures(transaction, vehicle.id, proposed);
        await transaction.vehiclePolicyVersion.create({
          data: {
            ...proposed.policy,
            createdByUserId: actorUserId,
            vehicleId: vehicle.id,
            version: policyVersion,
          } as Prisma.VehiclePolicyVersionUncheckedCreateInput,
        });
        await this.promotePhotos(transaction, vehicle.id, proposed);
        await this.promoteDocuments(transaction, vehicle.id, proposed);
        await this.promoteLocation(transaction, vehicle.id, proposed);
        await this.promoteKnownIssues(
          transaction,
          vehicle.id,
          proposal.submittedByUserId,
          proposed,
        );
        const reviewedAt = new Date();
        await transaction.vehicleChangeProposal.update({
          data: {
            appliedAt: reviewedAt,
            changedFields,
            platformReviewReason: null,
            platformReviewedAt: reviewedAt,
            platformReviewedByAdminId: adminUserId,
            status: VehicleChangeProposalStatus.APPLIED,
          },
          where: { id: proposal.id },
        });
        await this.recordDecision(transaction, {
          action: 'VEHICLE_CHANGE_PROPOSAL_PLATFORM_APPROVED_AND_APPLIED',
          actorUserId,
          adminUserId,
          changedFields,
          newStatus: VehicleChangeProposalStatus.APPLIED,
          policyVersion,
          proposal,
          ...(request ? { request } : {}),
          resultingRevision: vehicle.revision + 1,
        });
        await this.notifyDecision(transaction, proposal, vehicle, 'APPROVED', vehicle.revision + 1);
        return {
          id: proposal.id,
          resultingVehicleRevision: vehicle.revision + 1,
          reviewedAt: reviewedAt.toISOString(),
          status: 'APPLIED' as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  requestChanges(
    id: string,
    reason: string,
    adminUserId: string,
    actorUserId: string,
    request?: RequestMetadata,
  ) {
    return this.decideWithoutPromotion(
      id,
      reason,
      adminUserId,
      actorUserId,
      'CHANGES_REQUIRED',
      request,
    );
  }

  reject(
    id: string,
    reason: string,
    adminUserId: string,
    actorUserId: string,
    request?: RequestMetadata,
  ) {
    return this.decideWithoutPromotion(id, reason, adminUserId, actorUserId, 'REJECTED', request);
  }

  private decideWithoutPromotion(
    proposalId: string,
    reason: string,
    adminUserId: string,
    actorUserId: string,
    decision: 'CHANGES_REQUIRED' | 'REJECTED',
    request?: RequestMetadata,
  ) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 10)
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_REASON_REQUIRED',
        'Provide a meaningful review reason.',
        HttpStatus.BAD_REQUEST,
      );
    return this.database.client.$transaction(
      async (transaction) => {
        const { proposal, vehicle } = await this.lockForDecision(
          transaction,
          proposalId,
          adminUserId,
          actorUserId,
          false,
        );
        const reviewedAt = new Date();
        const status =
          decision === 'CHANGES_REQUIRED'
            ? VehicleChangeProposalStatus.PLATFORM_CHANGES_REQUIRED
            : VehicleChangeProposalStatus.REJECTED;
        await transaction.vehicleChangeProposal.update({
          data: {
            platformReviewReason: cleanReason,
            platformReviewedAt: reviewedAt,
            platformReviewedByAdminId: adminUserId,
            status,
          },
          where: { id: proposal.id },
        });
        await this.recordDecision(transaction, {
          action:
            decision === 'CHANGES_REQUIRED'
              ? 'VEHICLE_CHANGE_PROPOSAL_PLATFORM_CHANGES_REQUESTED'
              : 'VEHICLE_CHANGE_PROPOSAL_PLATFORM_REJECTED',
          actorUserId,
          adminUserId,
          changedFields: proposal.changedFields,
          newStatus: status,
          proposal,
          reason: cleanReason,
          ...(request ? { request } : {}),
          resultingRevision: vehicle.revision,
        });
        await this.notifyDecision(transaction, proposal, vehicle, decision, vehicle.revision);
        return {
          id: proposal.id,
          resultingVehicleRevision: vehicle.revision,
          reviewedAt: reviewedAt.toISOString(),
          status:
            decision === 'CHANGES_REQUIRED'
              ? ('PLATFORM_CHANGES_REQUIRED' as const)
              : ('REJECTED' as const),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async lockForDecision(
    transaction: Prisma.TransactionClient,
    proposalId: string,
    adminUserId: string,
    actorUserId: string,
    enforceFresh = true,
  ) {
    const target = await transaction.vehicleChangeProposal.findUnique({
      select: { vehicleId: true },
      where: { id: proposalId },
    });
    if (!target) throw this.notFound();
    await transaction.$queryRaw`SELECT id FROM vehicles WHERE id = ${target.vehicleId}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT id FROM vehicle_change_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
    const proposal = await transaction.vehicleChangeProposal.findFirst({
      include: {
        assets: true,
        ownerProfile: { select: { userId: true } },
        submittedMembership: { select: { displayName: true } },
      },
      where: {
        id: proposalId,
        platformReviewRequired: true,
        status: VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
      },
    });
    if (!proposal) throw this.notFound();
    const [admin, vehicle] = await Promise.all([
      transaction.adminUser.findFirst({
        select: { id: true },
        where: { credentialUserId: actorUserId, id: adminUserId, status: 'ACTIVE' },
      }),
      transaction.vehicle.findFirst({
        select: {
          id: true,
          make: true,
          model: true,
          ownerProfileId: true,
          ownerUserId: true,
          revision: true,
          status: true,
        },
        where: { id: proposal.vehicleId, ownerProfileId: proposal.ownerProfileId },
      }),
    ]);
    if (!admin)
      throw new ApplicationException(
        'ADMIN_REVIEWER_INVALID',
        'The Admin reviewer is unavailable.',
        HttpStatus.FORBIDDEN,
      );
    if (!vehicle || vehicle.status !== VehicleLifecycleStatus.APPROVED) throw this.notFound();
    if (enforceFresh && vehicle.revision !== proposal.baseVehicleRevision)
      this.conflict(
        'VEHICLE_CHANGE_PROPOSAL_STALE',
        'Live vehicle changed after this proposal was submitted.',
      );
    const proposed = this.validateSnapshot(proposal.proposedSnapshot);
    const live = await this.snapshots.buildFromLiveVehicle(
      vehicle.id,
      vehicle.ownerProfileId,
      transaction,
    );
    if (!live) throw this.notFound();
    return { live, proposal, proposed, vehicle };
  }

  private async validateReferences(
    transaction: Prisma.TransactionClient,
    proposal: { assets: { fileAssetId: string; kind: VehicleChangeProposalAssetKind }[] },
    proposed: VehicleChangeProposalSnapshotV1,
    live: VehicleChangeProposalSnapshotV1,
  ) {
    const liveIds = new Set([...live.photos, ...live.documents].map((item) => item.fileAssetId));
    const proposalAssets = new Map(proposal.assets.map((asset) => [asset.fileAssetId, asset]));
    const photoIds = proposed.photos.map((photo) => photo.fileAssetId);
    const documentIds = proposed.documents.map((document) => document.fileAssetId);
    for (const id of photoIds)
      if (!liveIds.has(id) && proposalAssets.get(id)?.kind !== VehicleChangeProposalAssetKind.PHOTO)
        this.invalidAssets();
    for (const id of documentIds)
      if (
        !liveIds.has(id) &&
        proposalAssets.get(id)?.kind !== VehicleChangeProposalAssetKind.DOCUMENT
      )
        this.invalidAssets();
    const referenced = [...new Set([...photoIds, ...documentIds])];
    const files = await transaction.fileAsset.findMany({
      select: { classification: true, id: true, status: true },
      where: { id: { in: referenced } },
    });
    if (
      files.length !== referenced.length ||
      files.some((file) => file.status !== FileAssetStatus.READY)
    )
      this.invalidAssets();
    const [features, definitions, category] = await Promise.all([
      transaction.vehicleFeature.count({
        where: { active: true, id: { in: [...proposed.featureIds] } },
      }),
      transaction.vehicleDocumentDefinition.count({
        where: { active: true, id: { in: proposed.documents.map((item) => item.definitionId) } },
      }),
      proposed.vehicle.categoryId
        ? transaction.vehicleCategory.count({
            where: { active: true, id: proposed.vehicle.categoryId },
          })
        : Promise.resolve(1),
    ]);
    if (
      features !== proposed.featureIds.length ||
      definitions !== proposed.documents.length ||
      category !== 1
    )
      this.invalidAssets();
    await this.assertReady(transaction, proposed);
  }

  private async assertReady(
    transaction: Prisma.TransactionClient,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    const vehicle = proposed.vehicle;
    const complete =
      vehicle.categoryId &&
      vehicle.make &&
      vehicle.model &&
      vehicle.modelYear &&
      vehicle.transmission &&
      vehicle.powertrain &&
      vehicle.fuelType &&
      vehicle.seatCount &&
      vehicle.doorCount &&
      vehicle.color &&
      vehicle.plateNumber;
    const requiredDocuments = await transaction.vehicleDocumentDefinition.findMany({
      select: { id: true, name: true },
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    const today = new Date().setUTCHours(0, 0, 0, 0);
    const invalid =
      !complete ||
      proposed.photos.length < 5 ||
      proposed.photos.filter((photo) => photo.isCover).length !== 1 ||
      REQUIRED_PHOTO_PERSPECTIVES.some(
        (perspective) => !proposed.photos.some((photo) => photo.perspective === perspective),
      ) ||
      requiredDocuments.some(
        (definition) =>
          !proposed.documents.some((document) => document.definitionId === definition.id),
      ) ||
      proposed.documents.some(
        (document) => document.expiresAt && new Date(document.expiresAt).getTime() < today,
      ) ||
      !proposed.location ||
      (vehicle.powertrain === 'BATTERY_ELECTRIC') !== (vehicle.fuelType === 'ELECTRIC') ||
      (vehicle.powertrain === 'BATTERY_ELECTRIC'
        ? !proposed.policy.evReturnPolicy || Boolean(proposed.policy.fuelReturnPolicy)
        : !proposed.policy.fuelReturnPolicy || Boolean(proposed.policy.evReturnPolicy));
    if (invalid)
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_NOT_READY',
        'The proposed vehicle configuration no longer meets listing requirements.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
  }

  private async promoteFeatures(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    await transaction.vehicleFeatureAssignment.deleteMany({ where: { vehicleId } });
    if (proposed.featureIds.length)
      await transaction.vehicleFeatureAssignment.createMany({
        data: proposed.featureIds.map((featureId) => ({ featureId, vehicleId })),
      });
  }

  private async promotePhotos(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    const current = await transaction.vehiclePhoto.findMany({ where: { vehicleId } });
    const proposedIds = new Set(proposed.photos.map((photo) => photo.fileAssetId));
    await transaction.vehiclePhoto.updateMany({
      data: { removedAt: new Date() },
      where: { fileAssetId: { notIn: [...proposedIds] }, removedAt: null, vehicleId },
    });
    for (const photo of proposed.photos) {
      const existing = current.find((item) => item.fileAssetId === photo.fileAssetId);
      if (existing)
        await transaction.vehiclePhoto.update({
          data: {
            displayOrder: photo.displayOrder,
            isCover: photo.isCover,
            perspective: photo.perspective as never,
            removedAt: null,
          },
          where: { id: existing.id },
        });
      else
        await transaction.vehiclePhoto.create({
          data: {
            displayOrder: photo.displayOrder,
            fileAssetId: photo.fileAssetId,
            isCover: photo.isCover,
            perspective: photo.perspective as never,
            vehicleId,
          },
        });
      await transaction.fileAsset.update({
        data: { classification: FileClassification.PUBLIC },
        where: { id: photo.fileAssetId },
      });
    }
  }

  private async promoteDocuments(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    const current = await transaction.vehicleDocument.findMany({
      orderBy: { version: 'desc' },
      where: { replacedAt: null, vehicleId },
    });
    const proposedFiles = new Set(proposed.documents.map((document) => document.fileAssetId));
    await transaction.vehicleDocument.updateMany({
      data: { replacedAt: new Date() },
      where: { fileAssetId: { notIn: [...proposedFiles] }, replacedAt: null, vehicleId },
    });
    for (const document of proposed.documents) {
      const same = current.find((item) => item.fileAssetId === document.fileAssetId);
      if (same) {
        await transaction.vehicleDocument.update({
          data: {
            expiresAt: document.expiresAt ? new Date(document.expiresAt) : null,
            replacedAt: null,
          },
          where: { id: same.id },
        });
        continue;
      }
      const prior = current.find((item) => item.definitionId === document.definitionId);
      const latest = await transaction.vehicleDocument.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
        where: { definitionId: document.definitionId, vehicleId },
      });
      await transaction.vehicleDocument.create({
        data: {
          definitionId: document.definitionId,
          expiresAt: document.expiresAt ? new Date(document.expiresAt) : null,
          fileAssetId: document.fileAssetId,
          replacesDocumentId: prior?.id ?? null,
          status: VerificationStatus.PENDING,
          vehicleId,
          version: (latest?.version ?? 0) + 1,
        },
      });
      await transaction.fileAsset.update({
        data: { classification: FileClassification.SENSITIVE },
        where: { id: document.fileAssetId },
      });
    }
  }

  private async promoteLocation(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    if (!proposed.location) {
      await transaction.vehicleLocation.deleteMany({ where: { vehicleId } });
      return;
    }
    const data = {
      ...proposed.location,
      latitude: new Prisma.Decimal(proposed.location.latitude),
      longitude: new Prisma.Decimal(proposed.location.longitude),
    };
    await transaction.vehicleLocation.upsert({
      create: { ...data, vehicleId },
      update: data,
      where: { vehicleId },
    });
  }

  private async promoteKnownIssues(
    transaction: Prisma.TransactionClient,
    vehicleId: string,
    actorUserId: string,
    proposed: VehicleChangeProposalSnapshotV1,
  ) {
    if (proposed.knownIssues === undefined) return;
    const current = await transaction.vehicleKnownIssue.findMany({
      select: { id: true },
      where: { vehicleId },
    });
    const currentIds = new Set(current.map(({ id }) => id));
    const proposedIds = new Set(
      proposed.knownIssues.flatMap(({ id }) => (id === null ? [] : [id])),
    );
    if (
      [...proposedIds].some((id) => !currentIds.has(id)) ||
      [...currentIds].some((id) => !proposedIds.has(id))
    )
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_INVALID',
        'Known issue references no longer match the live vehicle.',
        HttpStatus.CONFLICT,
      );
    for (const issue of proposed.knownIssues) {
      if (issue.id)
        await transaction.vehicleKnownIssue.update({
          data: {
            category: issue.category as never,
            classification: issue.classification as never,
            description: issue.description.trim(),
            ...(issue.status === 'RESOLVED'
              ? { resolvedAt: new Date(), resolvedByUserId: actorUserId }
              : { resolvedAt: null, resolvedByUserId: null }),
            status: issue.status,
            vehicleArea: issue.vehicleArea as never,
          },
          where: { id: issue.id },
        });
      else
        await transaction.vehicleKnownIssue.create({
          data: {
            category: issue.category as never,
            classification: issue.classification as never,
            createdByUserId: actorUserId,
            description: issue.description.trim(),
            status: issue.status,
            vehicleArea: issue.vehicleArea as never,
            vehicleId,
          },
        });
    }
  }

  private recordDecision(
    transaction: Prisma.TransactionClient,
    input: {
      action: string;
      actorUserId: string;
      adminUserId: string;
      changedFields: readonly string[];
      newStatus: VehicleChangeProposalStatus;
      policyVersion?: number;
      proposal: {
        baseVehicleRevision: number;
        id: string;
        ownerApprovalBypassed: boolean;
        ownerApprovalRequired: boolean;
        ownerProfileId: string;
        status: VehicleChangeProposalStatus;
        submittedByMembershipId: string;
        submittedByUserId: string;
        vehicleId: string;
      };
      reason?: string;
      request?: RequestMetadata;
      resultingRevision: number;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        ...(input.request?.correlationId ? { correlationId: input.request.correlationId } : {}),
        ...(input.request?.ipAddress ? { ipAddress: input.request.ipAddress } : {}),
        metadata: {
          adminUserId: input.adminUserId,
          baseVehicleRevision: input.proposal.baseVehicleRevision,
          changedFields: input.changedFields,
          managerMembershipId: input.proposal.submittedByMembershipId,
          managerUserId: input.proposal.submittedByUserId,
          newStatus: input.newStatus,
          ownerApprovalBypassed: input.proposal.ownerApprovalBypassed,
          ownerApprovalRequired: input.proposal.ownerApprovalRequired,
          ownerProfileId: input.proposal.ownerProfileId,
          ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
          previousStatus: input.proposal.status,
          resultingVehicleRevision: input.resultingRevision,
          vehicleId: input.proposal.vehicleId,
        },
        ...(input.reason ? { reason: input.reason } : {}),
        targetId: input.proposal.id,
        targetType: 'VEHICLE_CHANGE_PROPOSAL',
      },
    });
  }

  private async notifyDecision(
    transaction: Prisma.TransactionClient,
    proposal: { id: string; ownerProfile: { userId: string }; submittedByUserId: string },
    vehicle: { id: string; make: string | null; model: string | null },
    decision: 'APPROVED' | 'CHANGES_REQUIRED' | 'REJECTED',
    revision: number,
  ) {
    const eventType = `VEHICLE_CHANGE_PROPOSAL_PLATFORM_${decision}`;
    const recipients = [...new Set([proposal.ownerProfile.userId, proposal.submittedByUserId])];
    const vehicleDisplayName = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
    await transaction.outboxEvent.createMany({
      data: recipients.map((recipientUserId) => ({
        aggregateId: proposal.id,
        aggregateType: 'VEHICLE_CHANGE_PROPOSAL',
        eventType,
        payload: {
          decision,
          notificationAudience:
            recipientUserId === proposal.ownerProfile.userId ? 'OWNER' : 'ACCOUNT',
          notificationIdentity: `${proposal.id}:${eventType}:${revision}:${recipientUserId}`,
          proposalId: proposal.id,
          recipientUserId,
          vehicleDisplayName,
          vehicleId: vehicle.id,
        },
      })),
    });
  }

  private listItem(proposal: {
    baseVehicleRevision: number;
    changeClassification: string;
    changedFields: string[];
    id: string;
    ownerProfile: { id: string; legalName: string | null; publicReference: string };
    status: VehicleChangeProposalStatus;
    submittedAt: Date | null;
    submittedMembership: { displayName: string };
    vehicle: {
      make: string | null;
      model: string | null;
      modelYear: number | null;
      revision: number;
    };
    vehicleId: string;
  }) {
    return {
      changedFields: proposal.changedFields as never,
      classification: proposal.changeClassification as never,
      id: proposal.id,
      stale: proposal.baseVehicleRevision !== proposal.vehicle.revision,
      status: proposal.status,
      submittedAt: proposal.submittedAt?.toISOString() ?? null,
      submitter: { displayName: proposal.submittedMembership.displayName },
      vehicle: {
        displayName:
          [proposal.vehicle.modelYear, proposal.vehicle.make, proposal.vehicle.model]
            .filter(Boolean)
            .join(' ') || 'Vehicle',
      },
      vehicleId: proposal.vehicleId,
      workspace: {
        id: proposal.ownerProfile.id,
        name: proposal.ownerProfile.legalName ?? proposal.ownerProfile.publicReference,
      },
    };
  }

  private validateSnapshot(value: unknown) {
    const snapshot = value as VehicleChangeProposalSnapshotV1;
    if (validateVehicleChangeProposalSnapshotV1(snapshot).length)
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_INVALID',
        'The proposed vehicle details are invalid.',
        HttpStatus.CONFLICT,
      );
    return snapshot;
  }

  private identifierHash(scope: string, value: string | null) {
    const normalized = value?.replace(/[^A-Z0-9]/gi, '').toUpperCase() ?? '';
    return normalized ? this.crypto.hashIdentifier(`${scope}:${normalized}`) : null;
  }

  private invalidAssets(): never {
    throw new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_ASSET_INVALID',
      'The proposal assets are unavailable or invalid.',
      HttpStatus.CONFLICT,
    );
  }
  private invalidStatus(): never {
    throw new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_STATUS_INVALID',
      'That proposal status cannot be listed.',
      HttpStatus.BAD_REQUEST,
    );
  }
  private conflict(code: string, message: string): never {
    throw new ApplicationException(code, message, HttpStatus.CONFLICT);
  }
  private notFound() {
    return new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_NOT_FOUND',
      'Vehicle change proposal not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
