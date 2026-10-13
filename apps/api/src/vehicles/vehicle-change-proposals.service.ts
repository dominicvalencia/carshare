import { HttpStatus, Injectable } from '@nestjs/common';
import {
  assertVehicleChangeProposalFresh,
  classifyVehicleChangedFields,
  diffVehicleChangeProposalSnapshots,
  validateVehicleChangeProposalSnapshotV1,
  type VehicleChangeField,
  type VehicleChangeProposalReadModel,
  type VehicleChangeProposalSnapshotV1,
} from '@carrental/api-contracts';
import {
  FileAssetStatus,
  FileClassification,
  OwnerStaffRole,
  OwnerStaffStatus,
  OwnerStaffVehicleScopeMode,
  Prisma,
  VehicleChangeProposalAssetKind,
  VehicleChangeProposalStatus,
  VehicleLifecycleStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { OwnerAccessContext, RequestMetadata } from '../security/security-context';
import { VehicleChangeProposalSnapshotService } from './vehicle-change-proposal-snapshot.service';
import type {
  AddVehicleChangeProposalDocumentDto,
  AddVehicleChangeProposalPhotoDto,
  ReorderVehicleChangeProposalPhotosDto,
} from './vehicles.dto';
import { FilesService } from '../files/files.service';

const EDIT_PERMISSION = 'vehicles.update_operational_fields' as const;
const ELIGIBLE_LIFECYCLES = [VehicleLifecycleStatus.APPROVED] as const;

const proposalReadSelect = {
  assets: {
    select: {
      documentDefinitionId: true,
      documentType: true,
      expiresAt: true,
      fileAsset: { select: { id: true, mimeType: true, originalName: true } },
      fileAssetId: true,
      kind: true,
    },
  },
  baseVehicleRevision: true,
  changeClassification: true,
  changedFields: true,
  createdAt: true,
  id: true,
  ownerApprovalBypassed: true,
  ownerApprovalRequired: true,
  platformReviewReason: true,
  platformReviewRequired: true,
  proposedSnapshot: true,
  snapshotSchemaVersion: true,
  status: true,
  submittedAt: true,
  submittedMembership: { select: { displayName: true } },
  updatedAt: true,
  vehicleId: true,
  withdrawnAt: true,
} satisfies Prisma.VehicleChangeProposalSelect;

type ProposalReadRecord = Prisma.VehicleChangeProposalGetPayload<{
  select: typeof proposalReadSelect;
}>;
type ProposalWithAssets = Prisma.VehicleChangeProposalGetPayload<{
  include: { assets: { select: { fileAssetId: true } } };
}>;

@Injectable()
export class VehicleChangeProposalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ownerAccess: OwnerAccessService,
    private readonly snapshots: VehicleChangeProposalSnapshotService,
    private readonly files: FilesService,
  ) {}

  async addPhoto(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    input: AddVehicleChangeProposalPhotoDto,
    request?: RequestMetadata,
  ) {
    return this.mutateAssets(
      context,
      actorUserId,
      vehicleId,
      proposalId,
      request,
      async (transaction, proposal, proposed) => {
        const file = await transaction.fileAsset.findFirst({
          select: { id: true },
          where: {
            classification: FileClassification.PRIVATE,
            id: input.fileAssetId,
            mimeType: { startsWith: 'image/' },
            status: FileAssetStatus.READY,
            uploadedById: actorUserId,
          },
        });
        if (!file)
          throw this.invalidAsset('Attach a ready private image uploaded by this Manager.');
        if (
          proposed.photos.length >= 30 &&
          !proposed.photos.some(({ fileAssetId }) => fileAssetId === file.id)
        )
          throw this.invalidAsset('A proposal can contain at most 30 photos.');
        const existingAsset = await transaction.vehicleChangeProposalAsset.findUnique({
          select: { proposalId: true },
          where: { fileAssetId: file.id },
        });
        if (existingAsset && existingAsset.proposalId !== proposal.id) throw this.invalidAsset();
        const existing = proposed.photos.find(({ fileAssetId }) => fileAssetId === file.id);
        const makeCover = input.isCover === true || proposed.photos.length === 0;
        const photos = proposed.photos
          .filter(({ fileAssetId }) => fileAssetId !== file.id)
          .map((photo) => (makeCover ? { ...photo, isCover: false } : photo));
        photos.push({
          displayOrder: existing?.displayOrder ?? input.displayOrder,
          fileAssetId: file.id,
          isCover: makeCover || existing?.isCover === true,
          perspective: input.perspective,
        });
        await transaction.vehicleChangeProposalAsset.upsert({
          create: {
            displayOrder: input.displayOrder,
            fileAssetId: file.id,
            isCover: makeCover,
            kind: VehicleChangeProposalAssetKind.PHOTO,
            photoPerspective: input.perspective,
            proposalId: proposal.id,
          },
          update: {
            displayOrder: input.displayOrder,
            isCover: makeCover,
            photoPerspective: input.perspective,
          },
          where: { fileAssetId: file.id },
        });
        return { ...proposed, photos };
      },
    );
  }

  async reorderPhotos(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    input: ReorderVehicleChangeProposalPhotosDto,
    request?: RequestMetadata,
  ) {
    return this.mutateAssets(
      context,
      actorUserId,
      vehicleId,
      proposalId,
      request,
      async (transaction, proposal, proposed) => {
        const ids = input.photos.map(({ fileAssetId }) => fileAssetId);
        const orders = input.photos.map(({ displayOrder }) => displayOrder);
        if (
          input.photos.length !== proposed.photos.length ||
          new Set(ids).size !== proposed.photos.length ||
          !ids.every((fileAssetId) =>
            proposed.photos.some((photo) => photo.fileAssetId === fileAssetId),
          ) ||
          new Set(orders).size !== proposed.photos.length ||
          (input.photos.length > 0 && input.photos.filter(({ isCover }) => isCover).length !== 1)
        )
          throw this.invalidAsset(
            'Provide every proposed photo once, unique display orders, and exactly one cover.',
          );
        const byId = new Map(proposed.photos.map((photo) => [photo.fileAssetId, photo]));
        for (const photo of input.photos) {
          await transaction.vehicleChangeProposalAsset.updateMany({
            data: { displayOrder: photo.displayOrder, isCover: photo.isCover === true },
            where: { fileAssetId: photo.fileAssetId, proposalId: proposal.id },
          });
        }
        return {
          ...proposed,
          photos: input.photos.map((photo) => ({
            ...byId.get(photo.fileAssetId)!,
            displayOrder: photo.displayOrder,
            isCover: photo.isCover === true,
          })),
        };
      },
    );
  }

  async removePhoto(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    fileAssetId: string,
    request?: RequestMetadata,
  ) {
    return this.mutateAssets(
      context,
      actorUserId,
      vehicleId,
      proposalId,
      request,
      async (_transaction, _proposal, proposed) => {
        const removed = proposed.photos.find((photo) => photo.fileAssetId === fileAssetId);
        if (!removed) throw this.invalidAsset('The proposed photo was not found.');
        const photos = proposed.photos.filter((photo) => photo.fileAssetId !== fileAssetId);
        if (removed.isCover && photos.length) photos[0] = { ...photos[0]!, isCover: true };
        return { ...proposed, photos };
      },
    );
  }

  async addDocument(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    input: AddVehicleChangeProposalDocumentDto,
    request?: RequestMetadata,
  ) {
    return this.mutateAssets(
      context,
      actorUserId,
      vehicleId,
      proposalId,
      request,
      async (transaction, proposal, proposed) => {
        const [definition, file] = await Promise.all([
          transaction.vehicleDocumentDefinition.findFirst({
            select: { code: true, id: true },
            where: { active: true, id: input.definitionId, jurisdiction: 'PH' },
          }),
          transaction.fileAsset.findFirst({
            select: { id: true },
            where: {
              classification: FileClassification.SENSITIVE,
              id: input.fileAssetId,
              OR: [{ mimeType: 'application/pdf' }, { mimeType: { startsWith: 'image/' } }],
              status: FileAssetStatus.READY,
              uploadedById: actorUserId,
            },
          }),
        ]);
        if (!definition || !file)
          throw this.invalidAsset(
            'Attach a valid sensitive vehicle document uploaded by this Manager.',
          );
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (expiresAt && expiresAt.getTime() <= Date.now())
          throw this.invalidAsset('Document expiry must be in the future.');
        const existingAsset = await transaction.vehicleChangeProposalAsset.findUnique({
          select: { proposalId: true },
          where: { fileAssetId: file.id },
        });
        if (existingAsset && existingAsset.proposalId !== proposal.id) throw this.invalidAsset();
        await transaction.vehicleChangeProposalAsset.upsert({
          create: {
            documentDefinitionId: definition.id,
            documentType: definition.code,
            expiresAt,
            fileAssetId: file.id,
            kind: VehicleChangeProposalAssetKind.DOCUMENT,
            proposalId: proposal.id,
          },
          update: { documentDefinitionId: definition.id, documentType: definition.code, expiresAt },
          where: { fileAssetId: file.id },
        });
        return {
          ...proposed,
          documents: [
            ...proposed.documents.filter(({ definitionId }) => definitionId !== definition.id),
            {
              definitionId: definition.id,
              documentType: definition.code,
              expiresAt: expiresAt?.toISOString() ?? null,
              fileAssetId: file.id,
            },
          ],
        };
      },
    );
  }

  async removeDocument(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    definitionId: string,
    request?: RequestMetadata,
  ) {
    return this.mutateAssets(
      context,
      actorUserId,
      vehicleId,
      proposalId,
      request,
      async (_transaction, _proposal, proposed) => {
        if (!proposed.documents.some((document) => document.definitionId === definitionId))
          throw this.invalidAsset('The proposed document was not found.');
        return {
          ...proposed,
          documents: proposed.documents.filter(
            (document) => document.definitionId !== definitionId,
          ),
        };
      },
    );
  }

  async create(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    request?: RequestMetadata,
  ): Promise<VehicleChangeProposalReadModel> {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    try {
      return await this.database.client.$transaction(
        async (transaction) => {
          await this.assertActor(transaction, context, actorUserId);
          await this.assertScopedEligibleVehicle(transaction, context, vehicleId);
          const live = await this.snapshots.buildFromLiveVehicle(
            vehicleId,
            context.ownerProfileId,
            transaction,
          );
          if (!live) throw this.notFound();
          const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, live.snapshot);
          const classification = classifyVehicleChangedFields(changedFields);
          const proposal = await transaction.vehicleChangeProposal.create({
            data: {
              baseVehicleRevision: live.baseVehicleRevision,
              changeClassification: classification,
              changedFields,
              ownerProfileId: context.ownerProfileId,
              platformReviewRequired: classification === 'PLATFORM_REVIEW_REQUIRED',
              proposedSnapshot: this.toJson(live.snapshot),
              snapshotSchemaVersion: live.snapshot.schemaVersion,
              status: VehicleChangeProposalStatus.DRAFT,
              submittedByMembershipId: membershipId,
              submittedByUserId: actorUserId,
              vehicleId,
            },
            select: proposalReadSelect,
          });
          await this.audit(
            transaction,
            'VEHICLE_CHANGE_PROPOSAL_CREATED',
            proposal,
            context,
            actorUserId,
            request,
          );
          return this.toReadModel(proposal);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationException(
          'VEHICLE_CHANGE_PROPOSAL_ALREADY_ACTIVE',
          'This vehicle already has an active change proposal.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async get(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
  ): Promise<VehicleChangeProposalReadModel> {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    const proposal = await this.database.client.vehicleChangeProposal.findFirst({
      select: proposalReadSelect,
      where: {
        id: proposalId,
        ownerProfileId: context.ownerProfileId,
        submittedByMembershipId: membershipId,
        submittedByUserId: actorUserId,
        vehicleId,
      },
    });
    if (!proposal) throw this.notFound();
    return this.toReadModel(proposal as ProposalReadRecord);
  }

  async update(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    proposedSnapshot: unknown,
    request?: RequestMetadata,
  ): Promise<VehicleChangeProposalReadModel> {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    const validated = this.validateSnapshot(proposedSnapshot);
    return this.database.client.$transaction(
      async (transaction) => {
        await this.assertActor(transaction, context, actorUserId);
        await this.assertScopedEligibleVehicle(transaction, context, vehicleId);
        const proposal = await transaction.vehicleChangeProposal.findFirst({
          include: { assets: { select: { fileAssetId: true } } },
          where: {
            id: proposalId,
            ownerProfileId: context.ownerProfileId,
            status: {
              in: [
                VehicleChangeProposalStatus.DRAFT,
                VehicleChangeProposalStatus.OWNER_CHANGES_REQUIRED,
                VehicleChangeProposalStatus.PLATFORM_CHANGES_REQUIRED,
              ],
            },
            submittedByMembershipId: membershipId,
            submittedByUserId: actorUserId,
            vehicleId,
          },
        });
        if (!proposal) throw this.notEditable();
        const live = await this.snapshots.buildFromLiveVehicle(
          vehicleId,
          context.ownerProfileId,
          transaction,
        );
        if (!live) throw this.notFound();
        this.assertFresh(proposal.baseVehicleRevision, live.baseVehicleRevision);
        this.assertAssetReferences(
          validated,
          live.snapshot,
          (proposal as typeof proposal & { assets: { fileAssetId: string }[] }).assets,
        );
        const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, validated);
        const classification = classifyVehicleChangedFields(changedFields);
        const updated = await transaction.vehicleChangeProposal.update({
          data: {
            changeClassification: classification,
            changedFields,
            platformReviewRequired: classification === 'PLATFORM_REVIEW_REQUIRED',
            ownerApprovalBypassed: false,
            ownerApprovalRequired: true,
            ownerReviewReason: null,
            ownerReviewedAt: null,
            ownerReviewedByUserId: null,
            proposedSnapshot: this.toJson(validated),
            snapshotSchemaVersion: validated.schemaVersion,
            status: VehicleChangeProposalStatus.DRAFT,
          },
          select: proposalReadSelect,
          where: { id: proposal.id },
        });
        await this.audit(
          transaction,
          'VEHICLE_CHANGE_PROPOSAL_UPDATED',
          updated,
          context,
          actorUserId,
          request,
        );
        return this.toReadModel(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async withdraw(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    request?: RequestMetadata,
  ) {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    return this.database.client.$transaction(
      async (transaction) => {
        await this.assertActor(transaction, context, actorUserId);
        await this.assertScopedEligibleVehicle(transaction, context, vehicleId);
        const proposal = await transaction.vehicleChangeProposal.findFirst({
          where: {
            id: proposalId,
            ownerProfileId: context.ownerProfileId,
            status: {
              in: [
                VehicleChangeProposalStatus.DRAFT,
                VehicleChangeProposalStatus.PENDING_OWNER_APPROVAL,
              ],
            },
            submittedByMembershipId: membershipId,
            submittedByUserId: actorUserId,
            vehicleId,
          },
        });
        if (!proposal) throw this.notEditable();
        const vehicle = await transaction.vehicle.findFirst({
          select: { revision: true },
          where: { id: vehicleId, ownerProfileId: context.ownerProfileId },
        });
        if (!vehicle) throw this.notFound();
        this.assertFresh(proposal.baseVehicleRevision, vehicle.revision);
        const withdrawnAt = new Date();
        const updated = await transaction.vehicleChangeProposal.update({
          data: { status: VehicleChangeProposalStatus.WITHDRAWN, withdrawnAt },
          select: proposalReadSelect,
          where: { id: proposal.id },
        });
        await this.audit(
          transaction,
          'VEHICLE_CHANGE_PROPOSAL_WITHDRAWN',
          updated,
          context,
          actorUserId,
          request,
        );
        return {
          id: updated.id,
          status: 'WITHDRAWN' as const,
          withdrawnAt: withdrawnAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async submit(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    request?: RequestMetadata,
  ) {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    return this.database.client.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
        await transaction.$queryRaw`SELECT id FROM vehicle_change_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
        const actor = await this.assertActor(transaction, context, actorUserId);
        const vehicle = await this.assertScopedEligibleVehicle(transaction, context, vehicleId);
        const proposal = await transaction.vehicleChangeProposal.findFirst({
          include: { assets: { select: { fileAssetId: true } } },
          where: {
            id: proposalId,
            ownerProfileId: context.ownerProfileId,
            status: VehicleChangeProposalStatus.DRAFT,
            submittedByMembershipId: membershipId,
            submittedByUserId: actorUserId,
            vehicleId,
          },
        });
        if (!proposal) throw this.notEditable();
        const proposed = this.validateSnapshot(proposal.proposedSnapshot);
        const live = await this.snapshots.buildFromLiveVehicle(
          vehicleId,
          context.ownerProfileId,
          transaction,
        );
        if (!live) throw this.notFound();
        this.assertFresh(proposal.baseVehicleRevision, live.baseVehicleRevision);
        this.assertAssetReferences(proposed, live.snapshot, proposal.assets);
        const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, proposed);
        if (!changedFields.length)
          throw new ApplicationException(
            'VEHICLE_CHANGE_PROPOSAL_EMPTY',
            'Change at least one vehicle detail before submitting.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        const classification = classifyVehicleChangedFields(changedFields);
        const platformReviewRequired = classification === 'PLATFORM_REVIEW_REQUIRED';
        const submittedAt = new Date();
        if (actor.ownerApprovalBypassEnabled) {
          return this.submitTrustedProposal(transaction, {
            actorDisplayName: actor.displayName,
            actorUserId,
            changedFields,
            classification,
            context,
            liveRevision: live.baseVehicleRevision,
            platformReviewRequired,
            proposal,
            proposed,
            ...(request ? { request } : {}),
            submittedAt,
            vehicle,
          });
        }
        const updated = await transaction.vehicleChangeProposal.update({
          data: {
            changeClassification: classification,
            changedFields,
            ownerApprovalBypassed: false,
            ownerApprovalRequired: true,
            ownerReviewReason: null,
            ownerReviewedAt: null,
            ownerReviewedByUserId: null,
            platformReviewReason: null,
            platformReviewedAt: null,
            platformReviewedByAdminId: null,
            platformReviewRequired,
            status: VehicleChangeProposalStatus.PENDING_OWNER_APPROVAL,
            submittedAt,
            trustEnabledAtSubmission: false,
          },
          select: proposalReadSelect,
          where: { id: proposal.id },
        });
        await this.audit(
          transaction,
          'VEHICLE_CHANGE_PROPOSAL_SUBMITTED',
          updated,
          context,
          actorUserId,
          request,
          {
            ownerApprovalBypassed: false,
            ownerApprovalRequired: true,
            platformReviewRequired,
            trustEnabledAtSubmission: false,
          },
        );
        await this.writeProposalNotification(transaction, {
          eventType: 'VEHICLE_CHANGE_PROPOSAL_SUBMITTED',
          managerDisplayName: actor.displayName,
          notificationAudience: 'OWNER',
          proposalId: updated.id,
          recipientUserId: vehicle.ownerUserId,
          revision: live.baseVehicleRevision,
          vehicle,
        });
        return {
          ...this.toReadModel(updated),
          status: 'PENDING_OWNER_APPROVAL' as const,
          submittedAt: submittedAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listForOwner(ownerUserId: string) {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: { id: true },
      where: { userId: ownerUserId },
    });
    if (!owner) throw this.denied();
    const proposals = await this.database.client.vehicleChangeProposal.findMany({
      select: { id: true, vehicleId: true },
      where: {
        ownerProfileId: owner.id,
        status: {
          in: [
            VehicleChangeProposalStatus.PENDING_OWNER_APPROVAL,
            VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
          ],
        },
      },
      orderBy: { submittedAt: 'asc' },
    });
    return {
      proposals: await Promise.all(
        proposals.map(({ id: proposalId, vehicleId }) =>
          this.ownerDetail(ownerUserId, vehicleId, proposalId),
        ),
      ),
    };
  }

  async ownerDetail(ownerUserId: string, vehicleId: string, proposalId: string) {
    const proposal = await this.database.client.vehicleChangeProposal.findFirst({
      select: proposalReadSelect,
      where: { id: proposalId, vehicle: { id: vehicleId, ownerUserId }, vehicleId },
    });
    if (!proposal) throw this.notFound();
    const vehicle = await this.database.client.vehicle.findFirst({
      select: { make: true, model: true, modelYear: true, ownerProfileId: true, revision: true },
      where: { id: vehicleId, ownerUserId },
    });
    if (!vehicle) throw this.notFound();
    const live = await this.snapshots.buildFromLiveVehicle(vehicleId, vehicle.ownerProfileId);
    if (!live) throw this.notFound();
    const proposed = this.validateSnapshot(proposal.proposedSnapshot);
    return {
      assets: proposal.assets.map((asset) => ({
        contentGrant: this.files.trustedAuthorizedGrant(asset.fileAssetId),
        documentDefinitionId: asset.documentDefinitionId,
        documentType: asset.documentType,
        expiresAt: asset.expiresAt?.toISOString() ?? null,
        fileAssetId: asset.fileAssetId,
        kind: asset.kind,
        mimeType: asset.fileAsset.mimeType,
        originalName: asset.fileAsset.originalName,
      })),
      baseVehicleRevision: proposal.baseVehicleRevision,
      classification: proposal.changeClassification,
      comparison: {
        changedFields: diffVehicleChangeProposalSnapshots(live.snapshot, proposed),
        currentSnapshot: live.snapshot,
        proposedSnapshot: proposed,
      },
      createdAt: proposal.createdAt.toISOString(),
      currentVehicleRevision: vehicle.revision,
      id: proposal.id,
      platformReviewRequired: proposal.platformReviewRequired,
      status: proposal.status,
      submittedAt: proposal.submittedAt?.toISOString() ?? null,
      submitter: { displayName: proposal.submittedMembership.displayName },
      updatedAt: proposal.updatedAt.toISOString(),
      vehicle: { make: vehicle.make, model: vehicle.model, modelYear: vehicle.modelYear },
      vehicleId,
    };
  }

  async returnForChanges(
    ownerUserId: string,
    vehicleId: string,
    proposalId: string,
    reason: string,
    request?: RequestMetadata,
  ) {
    const cleanReason = reason.trim();
    if (cleanReason.length < 10)
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_REASON_REQUIRED',
        'Explain what the Manager needs to change.',
        HttpStatus.BAD_REQUEST,
      );
    return this.database.client.$transaction(
      async (transaction) => {
        const { proposal, vehicle } = await this.lockOwnerReview(
          transaction,
          ownerUserId,
          vehicleId,
          proposalId,
        );
        this.assertFresh(proposal.baseVehicleRevision, vehicle.revision);
        this.validateSnapshot(proposal.proposedSnapshot);
        const reviewedAt = new Date();
        await transaction.vehicleChangeProposal.update({
          data: {
            ownerReviewReason: cleanReason,
            ownerReviewedAt: reviewedAt,
            ownerReviewedByUserId: ownerUserId,
            status: VehicleChangeProposalStatus.OWNER_CHANGES_REQUIRED,
          },
          where: { id: proposal.id },
        });
        await this.auditOwnerDecision(transaction, {
          action: 'VEHICLE_CHANGE_PROPOSAL_CHANGES_REQUESTED',
          actorUserId: ownerUserId,
          newStatus: VehicleChangeProposalStatus.OWNER_CHANGES_REQUIRED,
          proposal,
          ...(request ? { request } : {}),
          reason: cleanReason,
          vehicleRevision: vehicle.revision,
        });
        await this.writeProposalNotification(transaction, {
          eventType: 'VEHICLE_CHANGE_PROPOSAL_OWNER_CHANGES_REQUIRED',
          notificationAudience: 'ACCOUNT',
          proposalId: proposal.id,
          recipientUserId: proposal.submittedByUserId,
          revision: vehicle.revision,
          vehicle,
        });
        return {
          id: proposal.id,
          reviewedAt: reviewedAt.toISOString(),
          status: 'OWNER_CHANGES_REQUIRED' as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async approve(
    ownerUserId: string,
    vehicleId: string,
    proposalId: string,
    request?: RequestMetadata,
  ) {
    return this.database.client.$transaction(
      async (transaction) => {
        const { proposal, vehicle } = await this.lockOwnerReview(
          transaction,
          ownerUserId,
          vehicleId,
          proposalId,
        );
        this.assertFresh(proposal.baseVehicleRevision, vehicle.revision);
        const proposed = this.validateSnapshot(proposal.proposedSnapshot);
        const live = await this.snapshots.buildFromLiveVehicle(
          vehicleId,
          proposal.ownerProfileId,
          transaction,
        );
        if (!live) throw this.notFound();
        const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, proposed);
        if (!changedFields.length)
          throw new ApplicationException(
            'VEHICLE_CHANGE_PROPOSAL_EMPTY',
            'This proposal no longer contains a change.',
            HttpStatus.CONFLICT,
          );
        const classification = classifyVehicleChangedFields(changedFields);
        const platformReviewRequired = classification === 'PLATFORM_REVIEW_REQUIRED';
        const reviewedAt = new Date();
        if (platformReviewRequired) {
          await transaction.vehicleChangeProposal.update({
            data: {
              changeClassification: classification,
              changedFields,
              ownerReviewReason: null,
              ownerReviewedAt: reviewedAt,
              ownerReviewedByUserId: ownerUserId,
              platformReviewRequired: true,
              status: VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
            },
            where: { id: proposal.id },
          });
          await this.auditOwnerDecision(transaction, {
            action: 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_FOR_PLATFORM_REVIEW',
            actorUserId: ownerUserId,
            newStatus: VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
            proposal: { ...proposal, changeClassification: classification, changedFields },
            ...(request ? { request } : {}),
            vehicleRevision: vehicle.revision,
          });
          await this.writeProposalNotification(transaction, {
            eventType: 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_PLATFORM_REVIEW',
            notificationAudience: 'ACCOUNT',
            proposalId: proposal.id,
            recipientUserId: proposal.submittedByUserId,
            revision: vehicle.revision,
            vehicle,
          });
          return {
            id: proposal.id,
            reviewedAt: reviewedAt.toISOString(),
            status: 'PENDING_PLATFORM_REVIEW' as const,
          };
        }
        const latestPolicy = await transaction.vehiclePolicyVersion.findFirst({
          orderBy: { version: 'desc' },
          select: { version: true },
          where: { vehicleId },
        });
        const policyVersion = (latestPolicy?.version ?? 0) + 1;
        await transaction.vehicle.update({
          data: {
            description: proposed.vehicle.description,
            rentalRequirements: proposed.vehicle.rentalRequirements,
            revision: { increment: 1 },
          },
          where: { id: vehicleId },
        });
        await transaction.vehicleFeatureAssignment.deleteMany({ where: { vehicleId } });
        if (proposed.featureIds.length)
          await transaction.vehicleFeatureAssignment.createMany({
            data: proposed.featureIds.map((featureId) => ({ featureId, vehicleId })),
          });
        await transaction.vehiclePolicyVersion.create({
          data: this.policyData(proposed, vehicleId, ownerUserId, policyVersion),
        });
        const appliedAt = new Date();
        await transaction.vehicleChangeProposal.update({
          data: {
            appliedAt,
            changeClassification: classification,
            changedFields,
            ownerReviewReason: null,
            ownerReviewedAt: reviewedAt,
            ownerReviewedByUserId: ownerUserId,
            platformReviewRequired: false,
            status: VehicleChangeProposalStatus.APPLIED,
          },
          where: { id: proposal.id },
        });
        await this.auditOwnerDecision(transaction, {
          action: 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_AND_APPLIED',
          actorUserId: ownerUserId,
          newStatus: VehicleChangeProposalStatus.APPLIED,
          policyVersion,
          proposal: { ...proposal, changeClassification: classification, changedFields },
          ...(request ? { request } : {}),
          vehicleRevision: vehicle.revision + 1,
        });
        await this.writeProposalNotification(transaction, {
          eventType: 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_APPLIED',
          notificationAudience: 'ACCOUNT',
          proposalId: proposal.id,
          recipientUserId: proposal.submittedByUserId,
          revision: vehicle.revision + 1,
          vehicle,
        });
        return {
          id: proposal.id,
          reviewedAt: reviewedAt.toISOString(),
          status: 'APPLIED' as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async submitTrustedProposal(
    transaction: Prisma.TransactionClient,
    input: {
      actorDisplayName: string;
      actorUserId: string;
      changedFields: VehicleChangeField[];
      classification: 'OWNER_APPROVAL_ONLY' | 'PLATFORM_REVIEW_REQUIRED';
      context: OwnerAccessContext;
      liveRevision: number;
      platformReviewRequired: boolean;
      proposal: ProposalWithAssets;
      proposed: VehicleChangeProposalSnapshotV1;
      request?: RequestMetadata;
      submittedAt: Date;
      vehicle: { id: string; make: string | null; model: string | null; ownerUserId: string };
    },
  ) {
    if (input.platformReviewRequired) {
      const updated = await transaction.vehicleChangeProposal.update({
        data: {
          changeClassification: input.classification,
          changedFields: input.changedFields,
          ownerApprovalBypassed: true,
          ownerApprovalRequired: false,
          ownerReviewReason: null,
          ownerReviewedAt: null,
          ownerReviewedByUserId: null,
          platformReviewRequired: true,
          platformReviewReason: null,
          platformReviewedAt: null,
          platformReviewedByAdminId: null,
          status: VehicleChangeProposalStatus.PENDING_PLATFORM_REVIEW,
          submittedAt: input.submittedAt,
          trustEnabledAtSubmission: true,
        },
        select: proposalReadSelect,
        where: { id: input.proposal.id },
      });
      await this.auditTrustedSubmission(transaction, input, updated, input.liveRevision);
      await this.writeTrustedProposalOutbox(transaction, {
        ...input,
        eventType: 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_PLATFORM_REVIEW_SUBMITTED',
        resultingRevision: input.liveRevision,
      });
      return {
        ...this.toReadModel(updated),
        status: 'PENDING_PLATFORM_REVIEW' as const,
        submittedAt: input.submittedAt.toISOString(),
      };
    }

    const latestPolicy = await transaction.vehiclePolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
      where: { vehicleId: input.vehicle.id },
    });
    const policyVersion = (latestPolicy?.version ?? 0) + 1;
    await transaction.vehicle.update({
      data: {
        description: input.proposed.vehicle.description,
        rentalRequirements: input.proposed.vehicle.rentalRequirements,
        revision: { increment: 1 },
      },
      where: { id: input.vehicle.id },
    });
    await transaction.vehicleFeatureAssignment.deleteMany({
      where: { vehicleId: input.vehicle.id },
    });
    if (input.proposed.featureIds.length)
      await transaction.vehicleFeatureAssignment.createMany({
        data: input.proposed.featureIds.map((featureId) => ({
          featureId,
          vehicleId: input.vehicle.id,
        })),
      });
    await transaction.vehiclePolicyVersion.create({
      data: this.policyData(input.proposed, input.vehicle.id, input.actorUserId, policyVersion),
    });
    const appliedAt = new Date();
    const updated = await transaction.vehicleChangeProposal.update({
      data: {
        appliedAt,
        changeClassification: input.classification,
        changedFields: input.changedFields,
        ownerApprovalBypassed: true,
        ownerApprovalRequired: false,
        ownerReviewReason: null,
        ownerReviewedAt: null,
        ownerReviewedByUserId: null,
        platformReviewRequired: false,
        platformReviewReason: null,
        platformReviewedAt: null,
        platformReviewedByAdminId: null,
        status: VehicleChangeProposalStatus.APPLIED,
        submittedAt: input.submittedAt,
        trustEnabledAtSubmission: true,
      },
      select: proposalReadSelect,
      where: { id: input.proposal.id },
    });
    await this.auditTrustedSubmission(
      transaction,
      input,
      updated,
      input.liveRevision + 1,
      policyVersion,
    );
    await this.writeTrustedProposalOutbox(transaction, {
      ...input,
      eventType: 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_APPLIED',
      resultingRevision: input.liveRevision + 1,
    });
    return {
      ...this.toReadModel(updated),
      status: 'APPLIED' as const,
      submittedAt: input.submittedAt.toISOString(),
    };
  }

  private auditTrustedSubmission(
    transaction: Prisma.TransactionClient,
    input: {
      actorUserId: string;
      changedFields: VehicleChangeField[];
      classification: string;
      context: OwnerAccessContext;
      platformReviewRequired: boolean;
      proposal: { baseVehicleRevision: number; id: string };
      request?: RequestMetadata;
    },
    proposal: ProposalReadRecord,
    resultingRevision: number,
    policyVersion?: number,
  ) {
    return this.audit(
      transaction,
      input.platformReviewRequired
        ? 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_SUBMITTED_FOR_PLATFORM_REVIEW'
        : 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_APPLIED',
      proposal,
      input.context,
      input.actorUserId,
      input.request,
      {
        ownerApprovalBypassed: true,
        ownerApprovalRequired: false,
        permission: EDIT_PERMISSION,
        platformReviewRequired: input.platformReviewRequired,
        ...(policyVersion ? { policyVersion } : {}),
        resultingStatus: proposal.status,
        trustEnabledAtSubmission: true,
        vehicleRevision: resultingRevision,
      },
    );
  }

  private writeTrustedProposalOutbox(
    transaction: Prisma.TransactionClient,
    input: {
      actorDisplayName: string;
      eventType:
        | 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_APPLIED'
        | 'VEHICLE_CHANGE_PROPOSAL_TRUSTED_PLATFORM_REVIEW_SUBMITTED';
      proposal: { id: string };
      resultingRevision: number;
      vehicle: { id: string; make: string | null; model: string | null; ownerUserId: string };
    },
  ) {
    const vehicleDisplayName =
      [input.vehicle.make, input.vehicle.model].filter(Boolean).join(' ').trim() || 'Vehicle';
    return transaction.outboxEvent.create({
      data: {
        aggregateId: input.proposal.id,
        aggregateType: 'VEHICLE_CHANGE_PROPOSAL',
        eventType: input.eventType,
        payload: {
          managerDisplayName: input.actorDisplayName,
          notificationAudience: 'OWNER',
          notificationIdentity: `${input.proposal.id}:${input.eventType}:${input.resultingRevision}`,
          proposalId: input.proposal.id,
          recipientUserId: input.vehicle.ownerUserId,
          vehicleDisplayName,
          vehicleId: input.vehicle.id,
        },
      },
    });
  }

  private writeProposalNotification(
    transaction: Prisma.TransactionClient,
    input: {
      eventType:
        | 'VEHICLE_CHANGE_PROPOSAL_SUBMITTED'
        | 'VEHICLE_CHANGE_PROPOSAL_OWNER_CHANGES_REQUIRED'
        | 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_APPLIED'
        | 'VEHICLE_CHANGE_PROPOSAL_OWNER_APPROVED_PLATFORM_REVIEW';
      managerDisplayName?: string;
      notificationAudience: 'OWNER' | 'ACCOUNT';
      proposalId: string;
      recipientUserId: string;
      revision: number;
      vehicle: { id: string; make: string | null; model: string | null };
    },
  ) {
    const vehicleDisplayName =
      [input.vehicle.make, input.vehicle.model].filter(Boolean).join(' ').trim() || 'Vehicle';
    return transaction.outboxEvent.create({
      data: {
        aggregateId: input.proposalId,
        aggregateType: 'VEHICLE_CHANGE_PROPOSAL',
        eventType: input.eventType,
        payload: {
          ...(input.managerDisplayName ? { managerDisplayName: input.managerDisplayName } : {}),
          notificationAudience: input.notificationAudience,
          notificationIdentity: `${input.proposalId}:${input.eventType}:${input.revision}:${input.recipientUserId}`,
          proposalId: input.proposalId,
          recipientUserId: input.recipientUserId,
          vehicleDisplayName,
          vehicleId: input.vehicle.id,
        },
      },
    });
  }

  private async mutateAssets(
    context: OwnerAccessContext,
    actorUserId: string,
    vehicleId: string,
    proposalId: string,
    request: RequestMetadata | undefined,
    mutation: (
      transaction: Prisma.TransactionClient,
      proposal: ProposalWithAssets,
      proposed: VehicleChangeProposalSnapshotV1,
    ) => Promise<VehicleChangeProposalSnapshotV1>,
  ): Promise<VehicleChangeProposalReadModel> {
    this.assertManager(context);
    const membershipId = context.membershipId!;
    await this.ownerAccess.assertVehicleAccess(context, vehicleId, EDIT_PERMISSION);
    return this.database.client.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
        await transaction.$queryRaw`SELECT id FROM vehicle_change_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
        await this.assertActor(transaction, context, actorUserId);
        await this.assertScopedEligibleVehicle(transaction, context, vehicleId);
        const proposal = await transaction.vehicleChangeProposal.findFirst({
          include: { assets: { select: { fileAssetId: true } } },
          where: {
            id: proposalId,
            ownerProfileId: context.ownerProfileId,
            status: {
              in: [
                VehicleChangeProposalStatus.DRAFT,
                VehicleChangeProposalStatus.OWNER_CHANGES_REQUIRED,
                VehicleChangeProposalStatus.PLATFORM_CHANGES_REQUIRED,
              ],
            },
            submittedByMembershipId: membershipId,
            submittedByUserId: actorUserId,
            vehicleId,
          },
        });
        if (!proposal) throw this.notEditable();
        const live = await this.snapshots.buildFromLiveVehicle(
          vehicleId,
          context.ownerProfileId,
          transaction,
        );
        if (!live) throw this.notFound();
        this.assertFresh(proposal.baseVehicleRevision, live.baseVehicleRevision);
        const current = this.validateSnapshot(proposal.proposedSnapshot);
        this.assertAssetReferences(current, live.snapshot, proposal.assets);
        const proposed = this.validateSnapshot(await mutation(transaction, proposal, current));
        const proposalAssets = await transaction.vehicleChangeProposalAsset.findMany({
          select: { fileAssetId: true },
          where: { proposalId },
        });
        this.assertAssetReferences(proposed, live.snapshot, proposalAssets);
        const changedFields = diffVehicleChangeProposalSnapshots(live.snapshot, proposed);
        const classification = classifyVehicleChangedFields(changedFields);
        const updated = await transaction.vehicleChangeProposal.update({
          data: {
            changeClassification: classification,
            changedFields,
            ownerApprovalBypassed: false,
            ownerApprovalRequired: true,
            ownerReviewReason: null,
            ownerReviewedAt: null,
            ownerReviewedByUserId: null,
            platformReviewReason: null,
            platformReviewedAt: null,
            platformReviewedByAdminId: null,
            platformReviewRequired: classification === 'PLATFORM_REVIEW_REQUIRED',
            proposedSnapshot: this.toJson(proposed),
            snapshotSchemaVersion: proposed.schemaVersion,
            status: VehicleChangeProposalStatus.DRAFT,
          },
          select: proposalReadSelect,
          where: { id: proposal.id },
        });
        await this.audit(
          transaction,
          'VEHICLE_CHANGE_PROPOSAL_ASSETS_UPDATED',
          updated,
          context,
          actorUserId,
          request,
        );
        return this.toReadModel(updated);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private assertManager(context: OwnerAccessContext): void {
    if (context.capacity !== 'MANAGER' || !context.membershipId) throw this.denied();
    this.ownerAccess.requirePermission(context, EDIT_PERMISSION);
  }

  private async assertActor(
    transaction: Prisma.TransactionClient,
    context: OwnerAccessContext,
    actorUserId: string,
  ): Promise<{ displayName: string; ownerApprovalBypassEnabled: boolean }> {
    const membershipId = context.membershipId!;
    const actor = await transaction.ownerStaffMembership.findFirst({
      select: {
        displayName: true,
        id: true,
        ownerApprovalBypassEnabled: true,
        permissions: {
          select: { permissionId: true },
          where: { permission: { code: EDIT_PERMISSION } },
        },
      },
      where: {
        id: membershipId,
        ownerProfileId: context.ownerProfileId,
        role: OwnerStaffRole.MANAGER,
        status: OwnerStaffStatus.ACTIVE,
        userId: actorUserId,
      },
    });
    if (!actor || actor.permissions.length !== 1) throw this.denied();
    return {
      displayName: actor.displayName,
      ownerApprovalBypassEnabled: actor.ownerApprovalBypassEnabled,
    };
  }

  private async lockOwnerReview(
    transaction: Prisma.TransactionClient,
    ownerUserId: string,
    vehicleId: string,
    proposalId: string,
  ) {
    await transaction.$queryRaw`SELECT id FROM vehicles WHERE id = ${vehicleId}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT id FROM vehicle_change_proposals WHERE id = ${proposalId}::uuid FOR UPDATE`;
    const vehicle = await transaction.vehicle.findFirst({
      select: {
        id: true,
        make: true,
        model: true,
        ownerProfileId: true,
        revision: true,
        status: true,
      },
      where: {
        id: vehicleId,
        ownerUserId,
        status: VehicleLifecycleStatus.APPROVED,
      },
    });
    if (!vehicle) throw this.notFound();
    const proposal = await transaction.vehicleChangeProposal.findFirst({
      where: {
        id: proposalId,
        ownerProfileId: vehicle.ownerProfileId,
        status: VehicleChangeProposalStatus.PENDING_OWNER_APPROVAL,
        vehicleId,
      },
    });
    if (!proposal) throw this.notFound();
    return { proposal, vehicle };
  }

  private policyData(
    snapshot: VehicleChangeProposalSnapshotV1,
    vehicleId: string,
    createdByUserId: string,
    version: number,
  ): Prisma.VehiclePolicyVersionUncheckedCreateInput {
    return {
      ...snapshot.policy,
      createdByUserId,
      vehicleId,
      version,
    } as Prisma.VehiclePolicyVersionUncheckedCreateInput;
  }

  private auditOwnerDecision(
    transaction: Prisma.TransactionClient,
    input: {
      action: string;
      actorUserId: string;
      newStatus: VehicleChangeProposalStatus;
      policyVersion?: number;
      proposal: {
        id: string;
        baseVehicleRevision: number;
        changeClassification: string;
        changedFields: string[];
        status: VehicleChangeProposalStatus;
        submittedByUserId: string;
        submittedByMembershipId: string;
        vehicleId: string;
        ownerProfileId: string;
      };
      reason?: string;
      request?: RequestMetadata;
      vehicleRevision: number;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actorUserId,
        ...(input.request?.correlationId ? { correlationId: input.request.correlationId } : {}),
        ...(input.request?.ipAddress ? { ipAddress: input.request.ipAddress } : {}),
        metadata: {
          baseVehicleRevision: input.proposal.baseVehicleRevision,
          changedFields: input.proposal.changedFields,
          classification: input.proposal.changeClassification,
          managerMembershipId: input.proposal.submittedByMembershipId,
          managerUserId: input.proposal.submittedByUserId,
          newStatus: input.newStatus,
          ownerProfileId: input.proposal.ownerProfileId,
          ...(input.policyVersion ? { policyVersion: input.policyVersion } : {}),
          previousStatus: input.proposal.status,
          vehicleId: input.proposal.vehicleId,
          vehicleRevision: input.vehicleRevision,
        },
        ...(input.reason ? { reason: input.reason } : {}),
        targetId: input.proposal.id,
        targetType: 'VEHICLE_CHANGE_PROPOSAL',
      },
    });
  }

  private async assertScopedEligibleVehicle(
    transaction: Prisma.TransactionClient,
    context: OwnerAccessContext,
    vehicleId: string,
  ) {
    const vehicle = await transaction.vehicle.findFirst({
      select: { id: true, make: true, model: true, ownerUserId: true },
      where: {
        id: vehicleId,
        ownerProfileId: context.ownerProfileId,
        status: { in: [...ELIGIBLE_LIFECYCLES] },
        ...(context.vehicleScopeMode === OwnerStaffVehicleScopeMode.SELECTED_VEHICLES
          ? { staffAssignments: { some: { membershipId: context.membershipId! } } }
          : {}),
      },
    });
    if (!vehicle)
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_VEHICLE_INELIGIBLE',
        'The vehicle is unavailable for a change proposal.',
        HttpStatus.CONFLICT,
      );
    return vehicle;
  }

  private validateSnapshot(snapshot: unknown): VehicleChangeProposalSnapshotV1 {
    try {
      const candidate = snapshot as VehicleChangeProposalSnapshotV1;
      const errors = validateVehicleChangeProposalSnapshotV1(candidate);
      if (errors.length)
        throw new ApplicationException(
          'VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_INVALID',
          'The proposed vehicle details are invalid.',
          HttpStatus.BAD_REQUEST,
          errors.map((issue) => ({ issue })),
        );
      return candidate;
    } catch (error) {
      if (error instanceof ApplicationException) throw error;
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_SNAPSHOT_INVALID',
        'The proposed vehicle details are invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertAssetReferences(
    proposed: VehicleChangeProposalSnapshotV1,
    live: VehicleChangeProposalSnapshotV1,
    proposalAssets: readonly { fileAssetId: string }[],
  ): void {
    const allowed = new Set([
      ...live.photos.map(({ fileAssetId }) => fileAssetId),
      ...live.documents.map(({ fileAssetId }) => fileAssetId),
      ...proposalAssets.map(({ fileAssetId }) => fileAssetId),
    ]);
    const references = [
      ...proposed.photos.map(({ fileAssetId }) => fileAssetId),
      ...proposed.documents.map(({ fileAssetId }) => fileAssetId),
    ];
    if (references.some((fileAssetId) => !allowed.has(fileAssetId)))
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_ASSET_INVALID',
        'A proposed asset does not belong to this vehicle or proposal.',
        HttpStatus.BAD_REQUEST,
      );
  }

  private assertFresh(baseRevision: number, currentRevision: number): void {
    try {
      assertVehicleChangeProposalFresh(baseRevision, currentRevision);
    } catch {
      throw new ApplicationException(
        'VEHICLE_CHANGE_PROPOSAL_STALE',
        'This vehicle changed since the proposal was created. Start a new proposal from the latest vehicle details.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private audit(
    transaction: Prisma.TransactionClient,
    action: string,
    proposal: ProposalReadRecord,
    context: OwnerAccessContext,
    actorUserId: string,
    request?: RequestMetadata,
    extraMetadata: Record<string, unknown> = {},
  ) {
    return transaction.auditLog.create({
      data: {
        action,
        actorUserId,
        ...(request?.correlationId ? { correlationId: request.correlationId } : {}),
        ...(request?.ipAddress ? { ipAddress: request.ipAddress } : {}),
        metadata: {
          baseVehicleRevision: proposal.baseVehicleRevision,
          capacity: context.capacity,
          changeClassification: proposal.changeClassification,
          changedFields: proposal.changedFields,
          membershipId: context.membershipId,
          ownerProfileId: context.ownerProfileId,
          vehicleId: proposal.vehicleId,
          ...extraMetadata,
        },
        targetId: proposal.id,
        targetType: 'VEHICLE_CHANGE_PROPOSAL',
      },
    });
  }

  private toReadModel(proposal: ProposalReadRecord): VehicleChangeProposalReadModel {
    return {
      assets: proposal.assets.map((asset) => ({
        contentGrant: this.files.trustedAuthorizedGrant(asset.fileAssetId),
        documentDefinitionId: asset.documentDefinitionId,
        documentType: asset.documentType,
        expiresAt: asset.expiresAt?.toISOString() ?? null,
        fileAssetId: asset.fileAssetId,
        kind: asset.kind,
        mimeType: asset.fileAsset.mimeType,
        originalName: asset.fileAsset.originalName,
      })),
      baseVehicleRevision: proposal.baseVehicleRevision,
      changedFields: proposal.changedFields as VehicleChangeField[],
      classification: proposal.changeClassification,
      createdAt: proposal.createdAt.toISOString(),
      id: proposal.id,
      platformReviewRequired: proposal.platformReviewRequired,
      ownerApprovalBypassed: proposal.ownerApprovalBypassed,
      ownerApprovalRequired: proposal.ownerApprovalRequired,
      platformReviewReason: proposal.platformReviewReason,
      proposedSnapshot: proposal.proposedSnapshot as unknown as VehicleChangeProposalSnapshotV1,
      snapshotSchemaVersion: proposal.snapshotSchemaVersion,
      status: proposal.status,
      submittedAt: proposal.submittedAt?.toISOString() ?? null,
      submitter: { displayName: proposal.submittedMembership.displayName },
      updatedAt: proposal.updatedAt.toISOString(),
      vehicleId: proposal.vehicleId,
      withdrawnAt: proposal.withdrawnAt?.toISOString() ?? null,
    };
  }

  private toJson(snapshot: VehicleChangeProposalSnapshotV1): Prisma.InputJsonValue {
    return structuredClone(snapshot) as unknown as Prisma.InputJsonValue;
  }

  private denied() {
    return new ApplicationException(
      'OWNER_ACCESS_DENIED',
      'This action is not permitted.',
      HttpStatus.FORBIDDEN,
    );
  }

  private notFound() {
    return new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_NOT_FOUND',
      'Vehicle change proposal not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private notEditable() {
    return new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_NOT_EDITABLE',
      'Only the creating Manager can change their draft proposal.',
      HttpStatus.CONFLICT,
    );
  }

  private invalidAsset(message = 'This asset does not belong to the editable proposal.') {
    return new ApplicationException(
      'VEHICLE_CHANGE_PROPOSAL_ASSET_INVALID',
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
