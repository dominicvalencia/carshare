import { randomUUID } from 'node:crypto';
import { Inject, Injectable, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingStatus,
  DisputeOriginType,
  DisputeStatus,
  EarningHoldMode,
  EarningHoldReason,
  FileAssetStatus,
  FileClassification,
  HandoverPhase,
  HandoverTravelStatus,
  InspectionConfirmationDecision,
  InspectionAmendmentStatus,
  InspectionConditionClassification,
  InspectionConditionDisclosureState,
  InspectionParticipantRole,
  InspectionPerspective,
  InspectionStatus,
  InspectionType,
  OwnerProfileStatus,
  EndFulfillmentMethod,
  StartFulfillmentMethod,
  Prisma,
  RentalIncidentCategory,
  RentalIncidentSeverity,
  RentalIncidentStatus,
  SecurityDepositStatus,
  VehicleOperationalStatus,
  PickupDiscrepancyResponseType,
  PickupDiscrepancyResolutionDecision,
  PickupHandoverOperationsOutcome,
  VehicleKnownIssueStatus,
  terminateActiveExtensionForReturn,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { AuditService } from '../audit/audit.service';
import { workflowCompliance } from './workflow-compliance';
import {
  HANDOVER_WORKFLOW_VERSION_B4,
  HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION,
} from '@carrental/api-contracts';

const inspectionCorrectionAdminInclude = {
  createdBy: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
  reviewedBy: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
  inspection: {
    include: {
      amendments: {
        include: {
          createdBy: { select: { id: true, profile: { select: { displayName: true } } } },
          reviewedBy: { select: { id: true, profile: { select: { displayName: true } } } },
        },
        orderBy: { createdAt: 'desc' as const },
      },
      booking: {
        select: {
          id: true,
          publicReference: true,
          status: true,
          owner: { select: { id: true, profile: { select: { displayName: true } } } },
          renter: { select: { id: true, profile: { select: { displayName: true } } } },
          statusHistory: { orderBy: { occurredAt: 'asc' as const } },
          vehicle: { select: { id: true, make: true, model: true, modelYear: true } },
          inspections: {
            orderBy: [{ type: 'asc' as const }, { version: 'asc' as const }],
            select: {
              id: true,
              type: true,
              version: true,
              odometerMeters: true,
              fuelBasisPoints: true,
              batterySocBasisPoints: true,
              finalizedAt: true,
            },
          },
        },
      },
      media: {
        include: { fileAsset: { select: { id: true, originalName: true } } },
        orderBy: [{ perspective: 'asc' as const }, { evidenceSequence: 'asc' as const }],
      },
    },
  },
} satisfies Prisma.InspectionAmendmentInclude;
import { CryptoService } from '../security/crypto.service';
import type {
  OwnerAccessContext,
  RequestMetadata,
  RequestPrincipal,
} from '../security/security-context';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import { hasBlockingAcceptedBookingAmendment } from '../bookings/booking-amendment-lifecycle-guard';
import type {
  CreateClaimDto,
  HandoverEvidenceWaiverDto,
  ConfirmVehicleReceiptDto,
  AdminHandoverResolutionDto,
  CreateIncidentDto,
  IncidentStatusDto,
  OperationalHoldDto,
  ReturnConfirmationDto,
  HandoverTravelTransitionDto,
  PickupInspectionReviewDto,
  PickupDiscrepancyResponseDto,
  PickupDiscrepancyResolutionReviewDto,
  PickupHandoverOperationsResolutionDto,
  PickupHandoverResponseDto,
  SubmitInspectionDto,
  UpsertInspectionDraftMediaDto,
  RequestInspectionCorrectionDto,
  ReviewInspectionCorrectionDto,
  OverdueHandoverRecoveryDto,
  OverdueHandoverRecoveryResponseDto,
} from './rentals.dto';
import { calculateBookingUsage } from './usage-calculation';

const requiredPerspectives = [
  InspectionPerspective.FRONT,
  InspectionPerspective.REAR,
  InspectionPerspective.DRIVER_SIDE,
  InspectionPerspective.PASSENGER_SIDE,
  InspectionPerspective.ODOMETER,
  InspectionPerspective.FUEL_OR_BATTERY_DISPLAY,
] as const;

export function currentOverdueHandoverRecovery<T extends { readonly acceptance: unknown | null }>(
  recoveries: readonly T[],
): T | null {
  return recoveries.find((recovery) => !recovery.acceptance) ?? recoveries[0] ?? null;
}

const rentalInclude = {
  handoverEvidenceWaivers: true,
  handoverReturnReceipt: true,
  pickupHandoverReport: { include: { response: true } },
  pickupHandoverResponse: true,
  overdueHandoverRecoveries: {
    include: { response: true, acceptance: true },
    orderBy: { reportedAt: 'desc' as const },
  },
  cancellation: true,
  cancellationSettlement: { include: { refund: true } },
  fulfillmentSnapshot: true,
  handoverTravelEvents: { orderBy: { occurredAt: 'asc' as const } },
  pickupOperationsResolutions: {
    include: { dispute: true, incident: true },
    orderBy: { resolvedAt: 'asc' as const },
  },
  inspections: {
    where: { status: InspectionStatus.FINALIZED },
    include: {
      amendments: {
        include: {
          createdBy: { select: { profile: { select: { displayName: true } } } },
          reviewedBy: { select: { profile: { select: { displayName: true } } } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      confirmations: {
        include: {
          discrepancyResponses: {
            include: {
              acknowledgedConditionIssue: true,
              referencedInspectionMedia: true,
              resolutionReview: { include: { operationsResolution: true } },
            },
            orderBy: { roundNumber: 'asc' as const },
          },
        },
        orderBy: { confirmedAt: 'asc' as const },
      },
      conditionIssues: {
        include: {
          evidence: {
            include: { inspectionMedia: { include: { fileAsset: { select: { id: true } } } } },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      media: {
        include: {
          fileAsset: {
            select: {
              checksum: true,
              classification: true,
              createdAt: true,
              id: true,
              mimeType: true,
              originalName: true,
              size: true,
              status: true,
            },
          },
        },
        orderBy: [{ perspective: 'asc' as const }, { evidenceSequence: 'asc' as const }],
      },
    },
    orderBy: [{ type: 'asc' as const }, { version: 'asc' as const }],
  },
  ownerEarning: { select: { currency: true, netEarningAmountMinor: true, status: true } },
  policySnapshot: true,
  postReturnClaims: {
    include: { evidence: { include: { fileAsset: { select: { id: true } } } } },
    orderBy: { submittedAt: 'asc' as const },
  },
  pricingSnapshot: true,
  rentalIncidents: {
    include: {
      disputes: true,
      evidence: { include: { fileAsset: { select: { id: true } } } },
      pickupDiscrepancyResponses: {
        include: {
          resolutionReview: { include: { operationsResolution: true } },
        },
        orderBy: { roundNumber: 'asc' as const },
      },
      pickupHandoverOperationsResolution: true,
    },
    orderBy: { reportedAt: 'asc' as const },
  },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
  usageSummary: true,
  vehicle: {
    select: {
      operationalStatus: true,
      fuelType: true,
      id: true,
      make: true,
      model: true,
      modelYear: true,
      powertrain: true,
      variant: true,
    },
  },
} satisfies Prisma.BookingInclude;

type RentalRecord = Prisma.BookingGetPayload<{ include: typeof rentalInclude }>;

type OwnerOperationAuthority = {
  readonly actorUserId: string;
  readonly ownerUserId: string;
};

export function securityDepositBlocksHandover(input: {
  readonly authorizedAmountMinor: bigint;
  readonly executionEnabled: boolean;
  readonly required: boolean;
  readonly requiredAmountMinor: number | null;
  readonly status: SecurityDepositStatus | null;
}) {
  if (!input.executionEnabled || !input.required) return false;
  return (
    input.status !== SecurityDepositStatus.AUTHORIZED ||
    input.authorizedAmountMinor < BigInt(input.requiredAmountMinor ?? 0)
  );
}

@Injectable()
export class RentalsService {
  private readonly pickupEarlyMinutes: number;
  private readonly pickupGraceMinutes: number;
  private readonly challengeTtlMinutes: number;
  private readonly challengeMaxAttempts: number;
  private readonly returnConfirmationGraceMinutes: number;
  private readonly securityDepositExecutionEnabled: boolean;

  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly ownerAccess: OwnerAccessService,
    @Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>,
  ) {
    this.pickupEarlyMinutes = configuration.getOrThrow('PICKUP_WINDOW_EARLY_MINUTES', {
      infer: true,
    });
    this.pickupGraceMinutes = configuration.getOrThrow('PICKUP_WINDOW_GRACE_MINUTES', {
      infer: true,
    });
    this.challengeTtlMinutes = configuration.getOrThrow('PICKUP_VERIFICATION_TTL_MINUTES', {
      infer: true,
    });
    this.challengeMaxAttempts = configuration.getOrThrow('PICKUP_VERIFICATION_MAX_ATTEMPTS', {
      infer: true,
    });
    this.securityDepositExecutionEnabled = configuration.getOrThrow(
      'SECURITY_DEPOSIT_EXECUTION_ENABLED',
      { infer: true },
    );
    this.returnConfirmationGraceMinutes = configuration.getOrThrow(
      'RETURN_CONFIRMATION_GRACE_MINUTES',
      { infer: true },
    );
  }

  async participantDetail(principal: RequestPrincipal, reference: string) {
    await this.evaluateReadiness(reference);
    const booking = await this.load(reference);
    this.assertParticipant(booking, principal.userId);
    return this.serialize(booking);
  }

  async ownerDetail(principal: RequestPrincipal, reference: string) {
    await this.evaluateReadiness(reference);
    const booking = await this.load(reference);
    if (booking.ownerUserId !== principal.userId) this.denied();
    return this.serialize(booking);
  }

  async ownerDetailForAccess(context: OwnerAccessContext, reference: string) {
    await this.ownerAccess.assertBookingAccess(context, reference, 'rentals.view');
    await this.evaluateReadiness(reference);
    return this.ownerAccessProjection(context, this.serialize(await this.load(reference)));
  }

  async listForOwnerAccess(context: OwnerAccessContext) {
    const vehicle = this.ownerAccess.vehicleWhere(context, 'rentals.view');
    const bookings = await this.database.client.booking.findMany({
      include: rentalInclude,
      orderBy: { rentalStart: 'desc' },
      where: { vehicle },
    });
    return bookings.map((booking) => this.ownerAccessProjection(context, this.serialize(booking)));
  }

  private ownerAccessProjection<T>(context: OwnerAccessContext, value: T): T {
    if (context.capacity === 'OWNER') return value;
    const projected = structuredClone(value) as Record<string, unknown>;
    if (!context.permissions.includes('claims.view')) delete projected.postReturnClaims;
    if (!context.permissions.includes('disputes.view')) {
      delete projected.disputes;
      if (Array.isArray(projected.rentalIncidents))
        for (const incident of projected.rentalIncidents)
          if (incident && typeof incident === 'object')
            delete (incident as Record<string, unknown>).disputes;
    }
    return projected as T;
  }

  async ownerPickupInspectionDraft(
    ownerUserId: string,
    reference: string,
    actorUserId = ownerUserId,
  ) {
    const booking = await this.database.client.booking.findUniqueOrThrow({
      select: { id: true, ownerUserId: true, vehicleId: true },
      where: { publicReference: reference },
    });
    if (booking.ownerUserId !== ownerUserId) this.denied();
    const draft = await this.database.client.inspection.findFirst({
      include: {
        media: {
          orderBy: [{ perspective: 'asc' }, { evidenceSequence: 'asc' }],
          select: { evidenceSequence: true, fileAssetId: true, perspective: true },
        },
      },
      where: {
        bookingId: booking.id,
        status: InspectionStatus.DRAFT,
        submittedByUserId: actorUserId,
        type: InspectionType.PICKUP,
      },
    });
    const knownIssues = await this.database.client.vehicleKnownIssue.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        category: true,
        classification: true,
        description: true,
        evidence: {
          orderBy: { createdAt: 'asc' },
          select: { fileAssetId: true },
        },
        id: true,
        vehicleArea: true,
      },
      where: { status: VehicleKnownIssueStatus.ACTIVE, vehicleId: booking.vehicleId },
    });
    return { inspectionId: draft?.id ?? null, knownIssues, media: draft?.media ?? [] };
  }

  async upsertOwnerPickupInspectionDraftMedia(
    ownerUserId: string,
    reference: string,
    input: UpsertInspectionDraftMediaDto,
    actorUserId = ownerUserId,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      let booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true },
        where: { publicReference: reference },
      });
      if (booking.ownerUserId !== ownerUserId) this.denied();
      if (booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED) {
        throw new ApplicationException(
          'OWNER_NOT_VERIFIED',
          'Owner verification is required for rental handover.',
          HttpStatus.FORBIDDEN,
        );
      }
      booking = await this.ensureReady(transaction, booking);
      this.assertPickupWindow(booking);
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Pickup evidence requires a booking ready for pickup.');
      }
      await this.validateEvidenceFiles(transaction, actorUserId, [input.fileAssetId]);
      await this.assertEvidenceNotWaived(transaction, booking.id, HandoverPhase.START);
      let draft = await transaction.inspection.findFirst({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.DRAFT,
          submittedByUserId: actorUserId,
          type: InspectionType.PICKUP,
        },
      });
      if (!draft) {
        const latest = await transaction.inspection.findFirst({
          orderBy: { version: 'desc' },
          where: { bookingId: booking.id, type: InspectionType.PICKUP },
        });
        draft = await transaction.inspection.create({
          data: {
            bookingId: booking.id,
            id: randomUUID(),
            submittedByUserId: actorUserId,
            type: InspectionType.PICKUP,
            version: (latest?.version ?? 0) + 1,
          },
        });
      }
      if (input.replace) {
        await transaction.inspectionMedia.deleteMany({
          where: { inspectionId: draft.id, perspective: input.perspective },
        });
      }
      const latestSequence = await transaction.inspectionMedia.aggregate({
        _max: { evidenceSequence: true },
        where: { inspectionId: draft.id, perspective: input.perspective },
      });
      await transaction.inspectionMedia.create({
        data: {
          clientCapturedAt: input.clientCapturedAt ? new Date(input.clientCapturedAt) : null,
          evidenceSequence: input.replace ? 1 : (latestSequence._max.evidenceSequence ?? 0) + 1,
          fileAssetId: input.fileAssetId,
          id: randomUUID(),
          inspectionId: draft.id,
          perspective: input.perspective,
          submittedById: actorUserId,
        },
      });
    });
    return this.ownerPickupInspectionDraft(ownerUserId, reference, actorUserId);
  }

  async submitInspection(
    userId: string,
    reference: string,
    type: InspectionType,
    input: SubmitInspectionDto,
    metadata: RequestMetadata,
    ownerAuthority?: OwnerOperationAuthority,
  ) {
    const authorizationUserId = ownerAuthority?.ownerUserId ?? userId;
    const actorUserId = ownerAuthority?.actorUserId ?? userId;
    const inspectionId = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      let booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true, vehicle: true },
        where: { publicReference: reference },
      });
      const participantRole =
        booking.ownerUserId === authorizationUserId
          ? InspectionParticipantRole.OWNER
          : booking.renterUserId === authorizationUserId
            ? InspectionParticipantRole.RENTER
            : null;
      if (!participantRole) this.denied();
      if (type === InspectionType.PICKUP && participantRole !== InspectionParticipantRole.OWNER) {
        this.denied();
      }
      if (type === InspectionType.RETURN && participantRole !== InspectionParticipantRole.RENTER) {
        throw new ApplicationException(
          'RETURN_INSPECTION_RENTER_ONLY',
          'The renter must submit the authoritative return inspection.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (
        participantRole === InspectionParticipantRole.OWNER &&
        booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED
      ) {
        throw new ApplicationException(
          'OWNER_NOT_VERIFIED',
          'Owner verification is required for rental handover.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (type === InspectionType.PICKUP) {
        booking = await this.ensureReady(transaction, booking);
        this.assertPickupWindow(booking);
        if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
          this.invalidState('Pickup inspection requires a booking ready for pickup.');
        }
      } else if (booking.status !== BookingStatus.RETURN_PENDING) {
        this.invalidState('Return inspection requires a return-pending booking.');
      }
      this.validatePowertrainMeasurements(booking.vehicle.powertrain, input);
      if (type === InspectionType.RETURN) {
        const pickup = await transaction.inspection.findFirst({
          include: {
            amendments: {
              orderBy: { reviewedAt: 'desc' },
              where: { status: InspectionAmendmentStatus.APPROVED },
            },
          },
          where: {
            bookingId: booking.id,
            status: InspectionStatus.FINALIZED,
            type: InspectionType.PICKUP,
          },
        });
        const effectivePickup = pickup ? this.effectiveInspection(pickup) : null;
        const returnOdometerMeters = BigInt(input.odometerMeters);
        if (
          effectivePickup?.odometerMeters != null &&
          returnOdometerMeters < effectivePickup.odometerMeters
        ) {
          throw new ApplicationException(
            'RETURN_ODOMETER_INVALID',
            `Enter a return odometer of at least ${Number(effectivePickup.odometerMeters) / 1000} km. It cannot be lower than the pickup reading.`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      await this.assertEvidenceNotWaived(
        transaction,
        booking.id,
        type === InspectionType.PICKUP ? HandoverPhase.START : HandoverPhase.RETURN,
      );
      await this.validateInspectionFiles(transaction, actorUserId, input);
      this.validatePerspectives(input);
      if (type === InspectionType.PICKUP) this.validateConditionDisclosure(input);
      const activeKnownIssues =
        type === InspectionType.PICKUP
          ? await transaction.vehicleKnownIssue.findMany({
              include: {
                evidence: {
                  orderBy: { createdAt: 'asc' },
                  select: { fileAssetId: true },
                },
              },
              where: {
                status: VehicleKnownIssueStatus.ACTIVE,
                vehicleId: booking.vehicleId,
              },
            })
          : [];
      const selectedKnownIssueIds = new Set(
        (input.conditionIssues ?? []).flatMap(({ knownIssueId }) =>
          knownIssueId ? [knownIssueId] : [],
        ),
      );
      const selectedKnownIssueCount = (input.conditionIssues ?? []).filter(
        ({ knownIssueId }) => knownIssueId,
      ).length;
      if (selectedKnownIssueIds.size !== selectedKnownIssueCount) {
        throw new ApplicationException(
          'VEHICLE_KNOWN_ISSUE_DUPLICATE',
          'Include each active known vehicle issue only once.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (
        type === InspectionType.PICKUP &&
        activeKnownIssues.some(({ id }) => !selectedKnownIssueIds.has(id))
      ) {
        throw new ApplicationException(
          'ACTIVE_VEHICLE_KNOWN_ISSUES_REQUIRED',
          'Include every active known vehicle issue or mark it resolved before finalizing.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const activeKnownIssuesById = new Map(activeKnownIssues.map((issue) => [issue.id, issue]));
      const existing = await transaction.inspection.findFirst({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          ...(ownerAuthority ? {} : { submittedByUserId: actorUserId }),
          type,
        },
      });
      if (existing) return existing.id;
      const draft = await transaction.inspection.findFirst({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.DRAFT,
          submittedByUserId: actorUserId,
          type,
        },
      });
      const latest = await transaction.inspection.findFirst({
        orderBy: { version: 'desc' },
        where: { bookingId: booking.id, type },
      });
      const inspection = draft
        ? await transaction.inspection.update({
            data: {
              batterySocBasisPoints: input.batterySocBasisPoints ?? null,
              fuelBasisPoints: input.fuelBasisPoints ?? null,
              notes: input.notes ?? null,
              odometerMeters: BigInt(input.odometerMeters),
              conditionDisclosureState:
                type === InspectionType.PICKUP ? (input.conditionDisclosureState ?? null) : null,
            },
            where: { id: draft.id },
          })
        : await transaction.inspection.create({
            data: {
              batterySocBasisPoints: input.batterySocBasisPoints ?? null,
              bookingId: booking.id,
              fuelBasisPoints: input.fuelBasisPoints ?? null,
              id: randomUUID(),
              notes: input.notes ?? null,
              odometerMeters: BigInt(input.odometerMeters),
              conditionDisclosureState:
                type === InspectionType.PICKUP ? (input.conditionDisclosureState ?? null) : null,
              submittedByUserId: actorUserId,
              type,
              version: (latest?.version ?? 0) + 1,
            },
          });
      if (draft) {
        await transaction.inspectionConditionIssueEvidence.deleteMany({
          where: { issue: { inspectionId: draft.id } },
        });
        await transaction.inspectionConditionIssue.deleteMany({
          where: { inspectionId: draft.id },
        });
        await transaction.inspectionMedia.deleteMany({ where: { inspectionId: draft.id } });
      }
      await transaction.inspectionMedia.createMany({
        data: input.media.map((media) => ({
          clientCapturedAt: media.clientCapturedAt ? new Date(media.clientCapturedAt) : null,
          evidenceSequence: media.evidenceSequence ?? 1,
          fileAssetId: media.fileAssetId,
          id: randomUUID(),
          inspectionId: inspection.id,
          perspective: media.perspective,
          submittedById: actorUserId,
        })),
      });
      if (type === InspectionType.PICKUP && input.conditionIssues?.length) {
        const inputMediaAssetIds = new Set(input.media.map(({ fileAssetId }) => fileAssetId));
        const knownIssueEvidenceAssetIds = [
          ...new Set(
            input.conditionIssues.flatMap((issue) =>
              issue.knownIssueId
                ? (activeKnownIssuesById
                    .get(issue.knownIssueId)
                    ?.evidence.map(({ fileAssetId }) => fileAssetId) ?? [])
                : [],
            ),
          ),
        ].filter((fileAssetId) => !inputMediaAssetIds.has(fileAssetId));
        if (knownIssueEvidenceAssetIds.length) {
          const maximumAdditionalSequence = await transaction.inspectionMedia.aggregate({
            _max: { evidenceSequence: true },
            where: {
              inspectionId: inspection.id,
              perspective: InspectionPerspective.ADDITIONAL,
            },
          });
          const startingSequence = maximumAdditionalSequence._max.evidenceSequence ?? 0;
          await transaction.inspectionMedia.createMany({
            data: knownIssueEvidenceAssetIds.map((fileAssetId, index) => ({
              evidenceSequence: startingSequence + index + 1,
              fileAssetId,
              id: randomUUID(),
              inspectionId: inspection.id,
              perspective: InspectionPerspective.ADDITIONAL,
              submittedById: actorUserId,
            })),
          });
        }
        const media = await transaction.inspectionMedia.findMany({
          select: { id: true, fileAssetId: true },
          where: { inspectionId: inspection.id },
        });
        const mediaByAsset = new Map(media.map((item) => [item.fileAssetId, item.id]));
        const effectiveIssues = [];
        for (const issue of input.conditionIssues) {
          const knownIssue = issue.knownIssueId
            ? activeKnownIssuesById.get(issue.knownIssueId)
            : undefined;
          if (issue.knownIssueId && !knownIssue) {
            throw new ApplicationException(
              'VEHICLE_KNOWN_ISSUE_INVALID',
              'The selected known issue is no longer active for this vehicle.',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          const snapshot = knownIssue
            ? {
                category: knownIssue.category,
                classification: knownIssue.classification,
                description: knownIssue.description,
                vehicleArea: knownIssue.vehicleArea,
              }
            : issue;
          const created = await transaction.inspectionConditionIssue.create({
            data: {
              category: snapshot.category,
              classification: snapshot.classification,
              createdByUserId: actorUserId,
              description: snapshot.description.trim(),
              id: randomUUID(),
              inspectionId: inspection.id,
              vehicleArea: snapshot.vehicleArea,
            },
          });
          const evidenceAssetIds = knownIssue
            ? knownIssue.evidence.map(({ fileAssetId }) => fileAssetId)
            : (issue.evidenceFileAssetIds ?? []);
          const evidence = evidenceAssetIds.map((assetId) => {
            const inspectionMediaId = mediaByAsset.get(assetId);
            if (!inspectionMediaId)
              throw new ApplicationException(
                'INSPECTION_CONDITION_EVIDENCE_INVALID',
                'Condition evidence must belong to this inspection.',
                HttpStatus.UNPROCESSABLE_ENTITY,
              );
            return { inspectionMediaId, issueId: created.id };
          });
          if (evidence.length)
            await transaction.inspectionConditionIssueEvidence.createMany({ data: evidence });
          if (!knownIssue && issue.persistAsKnownIssue) {
            const persistent = await transaction.vehicleKnownIssue.create({
              data: {
                category: snapshot.category,
                classification: snapshot.classification,
                createdByUserId: actorUserId,
                description: snapshot.description.trim(),
                status: VehicleKnownIssueStatus.ACTIVE,
                vehicleArea: snapshot.vehicleArea,
                vehicleId: booking.vehicleId,
              },
            });
            if (issue.evidenceFileAssetIds?.length) {
              await transaction.vehicleKnownIssueEvidence.createMany({
                data: [...new Set(issue.evidenceFileAssetIds)].map((fileAssetId) => ({
                  fileAssetId,
                  issueId: persistent.id,
                  uploadedByUserId: actorUserId,
                })),
              });
            }
          }
          effectiveIssues.push(snapshot);
        }
        if (
          effectiveIssues.some(
            ({ classification }) =>
              classification === InspectionConditionClassification.SAFETY_CRITICAL,
          )
        ) {
          await transaction.vehicle.update({
            data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
            where: { id: booking.vehicleId },
          });
          await transaction.rentalIncident.create({
            data: {
              blocksCompletion: true,
              bookingId: booking.id,
              category: RentalIncidentCategory.VEHICLE_ISSUE,
              description: 'Safety-critical condition disclosed during the Start inspection.',
              id: randomUUID(),
              reportedByUserId: actorUserId,
              severity: RentalIncidentSeverity.CRITICAL,
            },
          });
          await this.outbox(transaction, booking.id, 'PICKUP_SAFETY_CRITICAL_CONDITION_REPORTED', {
            bookingId: booking.id,
            vehicleId: booking.vehicleId,
          });
        } else if (
          effectiveIssues.some(
            ({ classification }) =>
              classification === InspectionConditionClassification.OPERATIONAL,
          )
        ) {
          await transaction.rentalIncident.create({
            data: {
              blocksCompletion: true,
              bookingId: booking.id,
              category: RentalIncidentCategory.VEHICLE_ISSUE,
              description: 'Operational condition requires Operations review before handover.',
              id: randomUUID(),
              reportedByUserId: actorUserId,
              severity: RentalIncidentSeverity.MEDIUM,
            },
          });
          await this.outbox(transaction, booking.id, 'PICKUP_OPERATIONAL_CONDITION_REPORTED', {
            bookingId: booking.id,
            vehicleId: booking.vehicleId,
          });
        }
      }
      await transaction.inspection.update({
        data: { finalizedAt: new Date(), status: InspectionStatus.FINALIZED },
        where: { id: inspection.id },
      });
      await transaction.inspectionConfirmation.create({
        data: {
          decision: InspectionConfirmationDecision.AGREED,
          id: randomUUID(),
          inspectionId: inspection.id,
          role: participantRole,
          userId: actorUserId,
        },
      });
      await this.outbox(transaction, booking.id, `${type}_INSPECTION_SUBMITTED`, {
        bookingId: booking.id,
        inspectionId: inspection.id,
      });
      await this.analytics(transaction, booking, `${type}_INSPECTION_SUBMITTED`, metadata);
      return inspection.id;
    });
    return {
      inspectionId,
      rental: ownerAuthority
        ? await this.ownerDetailById(ownerAuthority.ownerUserId, reference)
        : await this.participantDetailById(userId, reference),
    };
  }

  async reviewPickupInspection(
    renterUserId: string,
    reference: string,
    input: PickupInspectionReviewDto,
    metadata: RequestMetadata,
  ) {
    if (input.decision === InspectionConfirmationDecision.DISAGREED && !input.reason?.trim()) {
      throw new ApplicationException(
        'PICKUP_INSPECTION_REVIEW_REASON_REQUIRED',
        'Describe the condition issue before reporting a discrepancy.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.renterUserId !== renterUserId) this.denied();
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Pickup review requires a booking ready for pickup.');
      }
      const inspection = await transaction.inspection.findFirst({
        include: {
          conditionIssues: { select: { classification: true } },
          confirmations: {
            include: {
              discrepancyResponses: {
                include: {
                  resolutionReview: { include: { operationsResolution: true } },
                },
                orderBy: { roundNumber: 'asc' },
              },
            },
          },
        },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          submittedByUserId: booking.ownerUserId,
          type: InspectionType.PICKUP,
        },
      });
      if (!inspection) {
        throw new ApplicationException(
          'PICKUP_INSPECTION_REQUIRED',
          'The owner must finalize pickup evidence before renter review.',
          HttpStatus.CONFLICT,
        );
      }
      const existing = await transaction.inspectionConfirmation.findUnique({
        where: {
          inspectionId_role: {
            inspectionId: inspection.id,
            role: InspectionParticipantRole.RENTER,
          },
        },
      });
      if (existing) {
        if (existing.decision === input.decision) return;
        throw new ApplicationException(
          'PICKUP_INSPECTION_REVIEW_IMMUTABLE',
          'The submitted pickup review cannot be changed.',
          HttpStatus.CONFLICT,
        );
      }
      await transaction.inspectionConfirmation.create({
        data: {
          decision: input.decision,
          id: randomUUID(),
          inspectionId: inspection.id,
          reason: input.reason?.trim() ?? null,
          role: InspectionParticipantRole.RENTER,
          userId: renterUserId,
        },
      });
      if (input.decision === InspectionConfirmationDecision.DISAGREED) {
        const description = 'Pickup condition discrepancy reported from the finalized inspection.';
        const existingIncident = await transaction.rentalIncident.findFirst({
          where: {
            bookingId: booking.id,
            category: RentalIncidentCategory.VEHICLE_ISSUE,
            description,
            reportedByUserId: renterUserId,
          },
        });
        if (!existingIncident) {
          await transaction.rentalIncident.create({
            data: {
              blocksCompletion: true,
              bookingId: booking.id,
              category: RentalIncidentCategory.VEHICLE_ISSUE,
              description,
              id: randomUUID(),
              reportedByUserId: renterUserId,
              severity: RentalIncidentSeverity.HIGH,
            },
          });
        }
      }
      await this.outbox(transaction, booking.id, `PICKUP_INSPECTION_${input.decision}`, {
        bookingId: booking.id,
        inspectionId: inspection.id,
      });
      await this.analytics(transaction, booking, `PICKUP_INSPECTION_${input.decision}`, metadata);
    });
    return this.participantDetailById(renterUserId, reference);
  }

  async respondToPickupDiscrepancy(
    ownerUserId: string,
    reference: string,
    input: PickupDiscrepancyResponseDto,
    metadata: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.ownerUserId !== ownerUserId) this.denied();
      const inspection = await transaction.inspection.findFirstOrThrow({
        include: { media: true },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      const confirmation = await transaction.inspectionConfirmation.findUniqueOrThrow({
        include: {
          discrepancyResponses: {
            include: { acknowledgedConditionIssue: true, resolutionReview: true },
            orderBy: { roundNumber: 'asc' },
          },
        },
        where: {
          inspectionId_role: {
            inspectionId: inspection.id,
            role: InspectionParticipantRole.RENTER,
          },
        },
      });
      if (confirmation.decision !== InspectionConfirmationDecision.DISAGREED)
        this.invalidState(
          'A discrepancy response requires the renter to have reported a difference.',
        );
      const previousResponse = confirmation.discrepancyResponses.at(-1);
      if (previousResponse && !previousResponse.resolutionReview) return;
      if (
        previousResponse?.resolutionReview?.decision ===
        PickupDiscrepancyResolutionDecision.ACCEPTED
      )
        this.invalidState('The renter already accepted the latest resolution.');
      const incident = await transaction.rentalIncident.findFirstOrThrow({
        where: {
          bookingId: booking.id,
          category: RentalIncidentCategory.VEHICLE_ISSUE,
          reportedByUserId: booking.renterUserId,
        },
      });
      let acknowledgedConditionIssueId = input.acknowledgedConditionIssueId ?? null;
      const sameInlineCondition =
        previousResponse?.acknowledgedConditionIssue &&
        input.acknowledgedCondition &&
        previousResponse.acknowledgedConditionIssue.category ===
          input.acknowledgedCondition.category &&
        previousResponse.acknowledgedConditionIssue.classification ===
          input.acknowledgedCondition.classification &&
        previousResponse.acknowledgedConditionIssue.vehicleArea ===
          input.acknowledgedCondition.vehicleArea &&
        previousResponse.acknowledgedConditionIssue.description ===
          input.acknowledgedCondition.description.trim();
      if (
        previousResponse &&
        previousResponse.responseType === input.responseType &&
        previousResponse.responseText === input.responseText.trim() &&
        (previousResponse.acknowledgedConditionIssueId === acknowledgedConditionIssueId ||
          Boolean(sameInlineCondition)) &&
        previousResponse.referencedInspectionMediaId === (input.referencedInspectionMediaId ?? null)
      )
        throw new ApplicationException(
          'PICKUP_DISCREPANCY_RESPONSE_UNCHANGED',
          'Update the resolution with a material change before sending it again.',
          HttpStatus.CONFLICT,
        );
      if (
        input.responseType === PickupDiscrepancyResponseType.ACKNOWLEDGE_CONDITION &&
        !acknowledgedConditionIssueId
      ) {
        if (!input.acknowledgedCondition)
          throw new ApplicationException(
            'PICKUP_DISCREPANCY_CONDITION_REQUIRED',
            'Describe the acknowledged condition.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        const issue = await transaction.inspectionConditionIssue.create({
          data: {
            category: input.acknowledgedCondition.category,
            classification: input.acknowledgedCondition.classification,
            createdByUserId: ownerUserId,
            description: input.acknowledgedCondition.description.trim(),
            id: randomUUID(),
            inspectionId: inspection.id,
            vehicleArea: input.acknowledgedCondition.vehicleArea,
          },
        });
        acknowledgedConditionIssueId = issue.id;
      }
      if (acknowledgedConditionIssueId) {
        const issue = await transaction.inspectionConditionIssue.findFirst({
          where: { id: acknowledgedConditionIssueId, inspectionId: inspection.id },
        });
        if (!issue)
          throw new ApplicationException(
            'PICKUP_DISCREPANCY_CONDITION_INVALID',
            'Acknowledged condition must belong to the Start inspection.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        if (issue.classification === InspectionConditionClassification.SAFETY_CRITICAL) {
          await transaction.vehicle.update({
            data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
            where: { id: booking.vehicleId },
          });
          await transaction.rentalIncident.update({
            data: {
              blocksCompletion: true,
              severity: RentalIncidentSeverity.CRITICAL,
            },
            where: { id: incident.id },
          });
          await this.outbox(transaction, booking.id, 'PICKUP_SAFETY_CRITICAL_CONDITION_REPORTED', {
            bookingId: booking.id,
            vehicleId: booking.vehicleId,
          });
        }
      }
      if (
        input.referencedInspectionMediaId &&
        !inspection.media.some(({ id }) => id === input.referencedInspectionMediaId)
      )
        throw new ApplicationException(
          'PICKUP_DISCREPANCY_EVIDENCE_INVALID',
          'Referenced evidence must belong to the Start inspection.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      const response = await transaction.pickupDiscrepancyResponse.create({
        data: {
          acknowledgedConditionIssueId,
          id: randomUUID(),
          incidentId: incident.id,
          originalConfirmationId: confirmation.id,
          previousResponseId: previousResponse?.id ?? null,
          roundNumber: (previousResponse?.roundNumber ?? 0) + 1,
          referencedInspectionMediaId: input.referencedInspectionMediaId ?? null,
          respondedByUserId: ownerUserId,
          responseText: input.responseText.trim(),
          responseType: input.responseType,
        },
      });
      if (input.responseType === PickupDiscrepancyResponseType.REQUEST_SUPPORT) {
        const existing = await transaction.dispute.findFirst({
          where: {
            incidentId: incident.id,
            status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
          },
        });
        if (!existing)
          await transaction.dispute.create({
            data: {
              bookingId: booking.id,
              blocksCompletion: true,
              id: randomUUID(),
              incidentId: incident.id,
              openedByUserId: ownerUserId,
              originType: DisputeOriginType.INCIDENT,
              reason: input.responseText.trim(),
            },
          });
      }
      await this.outbox(transaction, booking.id, 'PICKUP_DISCREPANCY_OWNER_RESPONDED', {
        bookingId: booking.id,
        responseId: response.id,
        recipientUserId: booking.renterUserId,
      });
      await this.analytics(transaction, booking, 'PICKUP_DISCREPANCY_OWNER_RESPONDED', metadata);
    });
    return this.ownerDetailById(ownerUserId, reference);
  }

  async reviewPickupDiscrepancyResolution(
    renterUserId: string,
    reference: string,
    input: PickupDiscrepancyResolutionReviewDto,
    metadata: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.renterUserId !== renterUserId) this.denied();
      const confirmation = await transaction.inspectionConfirmation.findFirstOrThrow({
        include: {
          discrepancyResponses: {
            include: { resolutionReview: { include: { operationsResolution: true } } },
            orderBy: { roundNumber: 'asc' },
          },
        },
        where: {
          inspection: {
            bookingId: booking.id,
            status: InspectionStatus.FINALIZED,
            type: InspectionType.PICKUP,
          },
          role: InspectionParticipantRole.RENTER,
        },
      });
      const response = confirmation.discrepancyResponses.at(-1);
      if (!response)
        this.invalidState('The owner must respond before the resolution can be reviewed.');
      if (response.resolutionReview) return;
      if (
        input.decision === PickupDiscrepancyResolutionDecision.STILL_DISAGREES &&
        !input.reason?.trim()
      )
        throw new ApplicationException(
          'PICKUP_DISCREPANCY_REASON_REQUIRED',
          'Explain why the issue still needs resolution.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      const review = await transaction.pickupDiscrepancyResolutionReview.create({
        data: {
          decision: input.decision,
          id: randomUUID(),
          reason: input.reason?.trim() ?? null,
          responseId: response.id,
          reviewedByUserId: renterUserId,
        },
      });
      if (input.decision === PickupDiscrepancyResolutionDecision.ACCEPTED) {
        await transaction.rentalIncident.update({
          data: { resolvedAt: new Date(), status: RentalIncidentStatus.RESOLVED },
          where: { id: response.incidentId },
        });
      }
      await this.outbox(
        transaction,
        booking.id,
        `PICKUP_DISCREPANCY_RESOLUTION_${input.decision}`,
        { bookingId: booking.id, recipientUserId: booking.ownerUserId, reviewId: review.id },
      );
      await this.analytics(
        transaction,
        booking,
        `PICKUP_DISCREPANCY_RESOLUTION_${input.decision}`,
        metadata,
      );
    });
    return this.participantDetailById(renterUserId, reference);
  }

  async escalatePickupDiscrepancy(userId: string, reference: string, metadata: RequestMetadata) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      this.assertParticipant(booking, userId);
      if (booking.status !== BookingStatus.READY_FOR_PICKUP)
        this.invalidState('Only an unresolved pre-custody handover may be escalated.');
      const incident = await transaction.rentalIncident.findFirstOrThrow({
        include: {
          disputes: true,
          pickupDiscrepancyResponses: {
            include: { resolutionReview: true },
            orderBy: { roundNumber: 'asc' },
          },
        },
        where: {
          bookingId: booking.id,
          category: RentalIncidentCategory.VEHICLE_ISSUE,
          reportedByUserId: booking.renterUserId,
        },
      });
      const latest = incident.pickupDiscrepancyResponses.at(-1);
      if (latest?.resolutionReview?.decision === PickupDiscrepancyResolutionDecision.ACCEPTED)
        this.invalidState('The participant resolution is already accepted.');
      const activeDisputeStatuses = new Set<DisputeStatus>([
        DisputeStatus.OPEN,
        DisputeStatus.EVIDENCE_COLLECTION,
        DisputeStatus.UNDER_REVIEW,
      ]);
      if (!incident.disputes.some(({ status }) => activeDisputeStatuses.has(status)))
        await transaction.dispute.create({
          data: {
            bookingId: booking.id,
            blocksCompletion: true,
            id: randomUUID(),
            incidentId: incident.id,
            openedByUserId: userId,
            originType: DisputeOriginType.INCIDENT,
            reason:
              'Participant explicitly requested CarShare support for the pickup-condition disagreement.',
          },
        });
      await this.outbox(transaction, booking.id, 'PICKUP_DISCREPANCY_SUPPORT_REQUESTED', {
        bookingId: booking.id,
        recipientUserId:
          booking.ownerUserId === userId ? booking.renterUserId : booking.ownerUserId,
      });
      await this.analytics(transaction, booking, 'PICKUP_DISCREPANCY_SUPPORT_REQUESTED', metadata);
    });
    return this.participantDetailById(userId, reference);
  }

  async transitionHandoverTravel(
    ownerUserId: string,
    reference: string,
    input: HandoverTravelTransitionDto,
    metadata: RequestMetadata,
    actorUserId = ownerUserId,
  ) {
    try {
      await this.database.client.$transaction(async (transaction) => {
        await this.lockBooking(transaction, reference);
        const booking = await transaction.booking.findUniqueOrThrow({
          include: { fulfillmentSnapshot: true, handoverTravelEvents: true, ownerProfile: true },
          where: { publicReference: reference },
        });
        if (booking.ownerUserId !== ownerUserId) this.denied();
        if (booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED) this.denied();
        const snapshot = booking.fulfillmentSnapshot;
        if (!snapshot) {
          throw new ApplicationException(
            'HANDOVER_TRAVEL_NOT_APPLICABLE',
            'Travel progress is unavailable for a legacy pickup-and-return booking.',
            HttpStatus.CONFLICT,
          );
        }
        const isStart = input.phase === HandoverPhase.START;
        if (!isStart && booking.status !== BookingStatus.RETURN_PENDING) {
          this.invalidState('The renter must start Return before collection travel can begin.');
        }
        if (
          (isStart && snapshot.startMethod !== StartFulfillmentMethod.OWNER_DELIVERY) ||
          (!isStart && snapshot.endMethod !== EndFulfillmentMethod.OWNER_COLLECTION)
        ) {
          throw new ApplicationException(
            'HANDOVER_TRAVEL_NOT_APPLICABLE',
            'Owner travel is not part of this booking fulfillment method.',
            HttpStatus.CONFLICT,
          );
        }
        if (
          (isStart &&
            !new Set<BookingStatus>([BookingStatus.CONFIRMED, BookingStatus.READY_FOR_PICKUP]).has(
              booking.status,
            )) ||
          (!isStart &&
            !new Set<BookingStatus>([BookingStatus.ACTIVE, BookingStatus.RETURN_PENDING]).has(
              booking.status,
            ))
        ) {
          throw new ApplicationException(
            'INVALID_HANDOVER_TRAVEL_TRANSITION',
            'Travel progress is unavailable in the current rental state.',
            HttpStatus.CONFLICT,
          );
        }
        const opensAt = isStart
          ? new Date(booking.rentalStart.getTime() - this.pickupEarlyMinutes * 60_000)
          : new Date(booking.rentalEnd.getTime() - this.returnConfirmationGraceMinutes * 60_000);
        if (Date.now() < opensAt.getTime()) {
          throw new ApplicationException(
            'HANDOVER_TRAVEL_TOO_EARLY',
            'Travel progress is not available before the handover window.',
            HttpStatus.CONFLICT,
          );
        }
        const phaseEvents = booking.handoverTravelEvents
          .filter(({ phase }) => phase === input.phase)
          .map(({ status }) => status);
        if (phaseEvents.includes(input.status)) return;
        const allowed = isStart
          ? [
              HandoverTravelStatus.PREPARING,
              HandoverTravelStatus.ON_THE_WAY,
              HandoverTravelStatus.ARRIVED,
            ]
          : [HandoverTravelStatus.ON_THE_WAY, HandoverTravelStatus.ARRIVED];
        const expected = allowed[phaseEvents.length];
        if (input.status !== expected) {
          throw new ApplicationException(
            'INVALID_HANDOVER_TRAVEL_TRANSITION',
            'Complete the preceding travel step before advancing.',
            HttpStatus.CONFLICT,
          );
        }
        await transaction.bookingHandoverTravelEvent.create({
          data: {
            actorUserId,
            bookingId: booking.id,
            id: randomUUID(),
            phase: input.phase,
            status: input.status,
          },
        });
        await this.outbox(transaction, booking.id, `HANDOVER_${input.phase}_${input.status}`, {
          bookingId: booking.id,
          phase: input.phase,
          status: input.status,
        });
        await this.analytics(
          transaction,
          booking,
          `HANDOVER_${input.phase}_${input.status}`,
          metadata,
        );
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
    }
    return this.ownerDetailById(ownerUserId, reference);
  }

  async reportOverdueHandoverRecovery(
    ownerUserId: string,
    reference: string,
    input: OverdueHandoverRecoveryDto,
    metadata: RequestMetadata,
    actorUserId = ownerUserId,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
        include: {
          ownerProfile: true,
          fulfillmentSnapshot: true,
          overdueHandoverRecoveries: { include: { response: true, acceptance: true } },
          inspections: { where: { status: InspectionStatus.FINALIZED } },
        },
      });
      if (
        booking.ownerUserId !== ownerUserId ||
        booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED
      )
        this.denied();
      if (booking.handoverWorkflowVersion !== HANDOVER_WORKFLOW_VERSION_B4)
        this.invalidState('Overdue recovery is available only for supported B4 bookings.');
      if (booking.operationalHold)
        this.invalidState('Operations review is required before overdue recovery.');
      if (!input.acknowledged || input.acknowledgementVersion !== 'OVERDUE_HANDOVER_RECOVERY_V1')
        this.invalidState('Acknowledge the reduced-evidence warning before continuing.');
      const now = new Date();
      const startOverdue =
        ['CONFIRMED', 'READY_FOR_PICKUP'].includes(booking.status) &&
        !booking.actualPickupAt &&
        Boolean(booking.pickupWindowEnd && now > booking.pickupWindowEnd);
      const returnOverdue =
        ['READY_FOR_PICKUP', 'ACTIVE', 'RETURN_PENDING'].includes(booking.status) &&
        !booking.actualReturnAt &&
        now.getTime() > booking.rentalEnd.getTime() + this.returnConfirmationGraceMinutes * 60_000;
      const requiredScope =
        startOverdue && returnOverdue
          ? 'BOTH'
          : startOverdue
            ? 'START'
            : returnOverdue
              ? 'RETURN'
              : null;
      if (!requiredScope || input.scope !== requiredScope)
        this.invalidState(
          requiredScope === 'BOTH'
            ? 'Pickup and Return are both overdue and must be reported together.'
            : requiredScope
              ? `Only the overdue ${requiredScope === 'START' ? 'Pickup' : 'Return'} may be reported.`
              : 'The regular handover process is still required because no handover is overdue.',
        );
      const overlappingRecovery = booking.overdueHandoverRecoveries.find(
        (recovery) =>
          !recovery.response &&
          !recovery.acceptance &&
          (recovery.scope === 'BOTH' || input.scope === 'BOTH' || recovery.scope === input.scope),
      );
      if (overlappingRecovery) return;
      const needsStart = input.scope === 'START' || input.scope === 'BOTH';
      const needsReturn = input.scope === 'RETURN' || input.scope === 'BOTH';
      if ((needsStart && !input.reportedPickupAt) || (needsReturn && !input.reportedReturnAt))
        this.invalidState('Enter every physical handover date and time included in this report.');
      if ((!needsStart && input.reportedPickupAt) || (!needsReturn && input.reportedReturnAt))
        this.invalidState('Do not submit a handover time for a phase that is not being recovered.');
      const pickupAt = input.reportedPickupAt ? new Date(input.reportedPickupAt) : null;
      const returnAt = input.reportedReturnAt ? new Date(input.reportedReturnAt) : null;
      const effectivePickupAt = pickupAt ?? booking.actualPickupAt;
      if (
        (pickupAt && (pickupAt < booking.rentalStart || pickupAt > now)) ||
        (returnAt && (!effectivePickupAt || returnAt < effectivePickupAt || returnAt > now))
      )
        this.invalidState('Reported handover times are outside the allowed chronological window.');
      if (
        booking.inspections.some(
          ({ type }) =>
            (needsStart && type === InspectionType.PICKUP) ||
            (needsReturn && type === InspectionType.RETURN),
        )
      )
        this.invalidState('Finalized inspection evidence cannot be replaced by overdue recovery.');
      const recovery = await transaction.bookingOverdueHandoverRecovery.create({
        data: {
          acknowledgementVersion: input.acknowledgementVersion,
          bookingId: booking.id,
          correlationId: metadata.correlationId ?? null,
          reportedByUserId: actorUserId,
          reportedPickupAt: pickupAt,
          reportedReturnAt: returnAt,
          responseDeadlineAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          scope: input.scope,
        },
      });
      await this.history(
        transaction,
        booking.id,
        booking.status,
        booking.status,
        BookingActorType.USER,
        actorUserId,
        `OVERDUE_HANDOVER_RECOVERY_${input.scope}_REPORTED`,
        metadata,
      );
      await this.outbox(transaction, booking.id, 'OVERDUE_HANDOVER_RECOVERY_REPORTED', {
        bookingId: booking.id,
        recoveryId: recovery.id,
        responseDeadlineAt: recovery.responseDeadlineAt.toISOString(),
        scope: input.scope,
      });
    });
    return this.ownerDetailById(ownerUserId, reference);
  }

  async respondToOverdueHandoverRecovery(
    renterUserId: string,
    reference: string,
    input: OverdueHandoverRecoveryResponseDto,
    metadata: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
        include: {
          overdueHandoverRecoveries: {
            include: { response: true, acceptance: true },
            orderBy: { reportedAt: 'desc' },
          },
        },
      });
      if (booking.renterUserId !== renterUserId) this.denied();
      const recovery = booking.overdueHandoverRecoveries.find(
        (candidate) => !candidate.response && !candidate.acceptance,
      );
      if (!recovery) this.invalidState('There is no owner-reported overdue handover to review.');
      if (recovery.acceptance)
        this.invalidState('The 24-hour response window has closed and the report is accepted.');
      if (new Date() >= recovery.responseDeadlineAt)
        this.invalidState('The 24-hour response window has closed.');
      if (input.decision === 'DISPUTED' && !input.reason?.trim())
        this.invalidState('Explain why you disagree with the owner-reported handover.');
      if (recovery.response) {
        if (
          recovery.response.decision !== input.decision ||
          (recovery.response.reason ?? null) !== (input.reason?.trim() ?? null)
        )
          this.invalidState('Your overdue handover response cannot be changed.');
        return;
      }
      await transaction.bookingOverdueHandoverRecoveryResponse.create({
        data: {
          bookingId: booking.id,
          correlationId: metadata.correlationId ?? null,
          decision: input.decision,
          reason: input.reason?.trim() ?? null,
          recoveryId: recovery.id,
          respondedByUserId: renterUserId,
        },
      });
      if (input.decision === 'DISPUTED') {
        const incident = await transaction.rentalIncident.create({
          data: {
            blocksCompletion: true,
            bookingId: booking.id,
            category: RentalIncidentCategory.VEHICLE_ISSUE,
            description: input.reason!.trim(),
            id: randomUUID(),
            reportedByUserId: renterUserId,
            severity: RentalIncidentSeverity.CRITICAL,
          },
        });
        const dispute = await transaction.dispute.create({
          data: {
            blocksCompletion: true,
            bookingId: booking.id,
            incidentId: incident.id,
            openedByUserId: renterUserId,
            originType: DisputeOriginType.INCIDENT,
            reason: input.reason!.trim(),
            status: DisputeStatus.EVIDENCE_COLLECTION,
          },
        });
        await this.outbox(transaction, booking.id, 'DISPUTE_OPENED', {
          bookingId: booking.id,
          disputeId: dispute.id,
          recoveryId: recovery.id,
        });
      } else {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "accept_overdue_handover_recovery"(${recovery.id}::uuid, 'RENTER_CONFIRMED')`,
        );
      }
      await this.history(
        transaction,
        booking.id,
        booking.status,
        booking.status,
        BookingActorType.USER,
        renterUserId,
        `OVERDUE_HANDOVER_RECOVERY_${input.decision}`,
        metadata,
      );
    });
    return this.participantDetailById(renterUserId, reference);
  }

  async waiveEvidence(
    userId: string,
    reference: string,
    phase: HandoverPhase,
    input: HandoverEvidenceWaiverDto,
    metadata: RequestMetadata,
    ownerAuthority?: OwnerOperationAuthority,
  ) {
    const authorizationUserId = ownerAuthority?.ownerUserId ?? userId;
    const actorUserId = ownerAuthority?.actorUserId ?? userId;
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      let booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true },
        where: { publicReference: reference },
      });
      const fulfillment = await transaction.bookingFulfillmentSnapshot.findUnique({
        where: { bookingId: booking.id },
      });
      const overdueReturnRecovery =
        phase === HandoverPhase.RETURN &&
        Date.now() > booking.rentalEnd.getTime() + this.returnConfirmationGraceMinutes * 60_000;
      const ownerOverdueCollectionRecovery =
        overdueReturnRecovery &&
        fulfillment?.endMethod === EndFulfillmentMethod.OWNER_COLLECTION &&
        authorizationUserId === booking.ownerUserId;
      const authorizedUserId =
        phase === HandoverPhase.START
          ? booking.ownerUserId
          : overdueReturnRecovery &&
              fulfillment?.endMethod === EndFulfillmentMethod.OWNER_COLLECTION
            ? booking.ownerUserId
            : booking.renterUserId;
      if (authorizationUserId !== authorizedUserId) this.denied();
      if (booking.handoverWorkflowVersion !== HANDOVER_WORKFLOW_VERSION_B4)
        this.invalidState('Evidence waiver is available only for supported B4 bookings.');
      if (
        !input.acknowledged ||
        input.acknowledgementVersion !== HANDOVER_EVIDENCE_WAIVER_ACKNOWLEDGEMENT_VERSION
      )
        this.invalidState('Acknowledge the inspection evidence warning before continuing.');
      const existing = await transaction.bookingHandoverEvidenceWaiver.findUnique({
        where: { bookingId_phase: { bookingId: booking.id, phase } },
      });
      if (existing) {
        if (
          existing.waivedByUserId !== actorUserId ||
          existing.acknowledgementVersion !== input.acknowledgementVersion
        )
          this.invalidState('The evidence decision cannot be changed.');
      }
      if (!input.reportedPhysicalHandoverAt)
        this.invalidState(
          phase === HandoverPhase.START
            ? 'Enter when the vehicle was physically handed to the renter.'
            : 'Enter when the vehicle was physically returned to the owner.',
        );
      const reportedPhysicalHandoverAt = new Date(input.reportedPhysicalHandoverAt);
      if (
        existing &&
        phase === HandoverPhase.RETURN &&
        existing.reportedPhysicalHandoverAt?.getTime() !== reportedPhysicalHandoverAt.getTime()
      )
        this.invalidState('The reported physical Return time cannot be changed.');
      if (phase === HandoverPhase.START) {
        if (booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED) this.denied();
        booking = await this.ensureReady(transaction, booking);
        this.assertPickupWindow(booking);
        if (booking.status !== BookingStatus.READY_FOR_PICKUP || booking.actualPickupAt)
          this.invalidState('Start evidence can only be waived before pickup custody transfer.');
        await this.assertHandoverAvailable(transaction, booking.id);
        await this.assertStartSafety(transaction, booking.vehicleId);
        let earliestAllowed = booking.pickupWindowStart ?? booking.rentalStart;
        if (fulfillment?.startMethod === StartFulfillmentMethod.OWNER_DELIVERY) {
          const arrived = await transaction.bookingHandoverTravelEvent.findUnique({
            where: {
              bookingId_phase_status: {
                bookingId: booking.id,
                phase: HandoverPhase.START,
                status: HandoverTravelStatus.ARRIVED,
              },
            },
          });
          if (!arrived) this.invalidState('Mark Delivery arrival before reporting handover.');
          if (arrived.occurredAt > earliestAllowed) earliestAllowed = arrived.occurredAt;
        }
        const now = new Date();
        if (
          reportedPhysicalHandoverAt < earliestAllowed ||
          reportedPhysicalHandoverAt > now ||
          reportedPhysicalHandoverAt >= booking.rentalEnd
        )
          this.invalidState(
            `Reported handover must be between ${earliestAllowed.toISOString()} and the current time.`,
          );
      } else {
        if (
          booking.status !== BookingStatus.RETURN_PENDING ||
          !booking.actualPickupAt ||
          booking.actualReturnAt
        )
          this.invalidState('Start return before choosing a Return evidence waiver.');
        if (booking.operationalHold)
          this.invalidState('Operations review is required before continuing.');
        if (
          reportedPhysicalHandoverAt < booking.actualPickupAt ||
          reportedPhysicalHandoverAt > new Date()
        )
          this.invalidState(
            `Reported Return must be between ${booking.actualPickupAt.toISOString()} and the current time.`,
          );
      }
      if (!overdueReturnRecovery) await this.assertTravelArrived(transaction, booking.id, phase);
      if (
        await transaction.inspection.count({
          where: {
            bookingId: booking.id,
            status: InspectionStatus.FINALIZED,
            type: phase === HandoverPhase.START ? InspectionType.PICKUP : InspectionType.RETURN,
          },
        })
      )
        this.invalidState('Finalized inspection evidence cannot be replaced by a waiver.');
      if (!existing)
        await transaction.bookingHandoverEvidenceWaiver.create({
          data: {
            bookingId: booking.id,
            phase,
            waivedByUserId: actorUserId,
            acknowledgementVersion: input.acknowledgementVersion,
            correlationId: metadata.correlationId ?? null,
            ...(phase === HandoverPhase.RETURN ? { reportedPhysicalHandoverAt } : {}),
          },
        });
      if (phase === HandoverPhase.START && reportedPhysicalHandoverAt) {
        const existingReport = await transaction.bookingPickupHandoverReport.findUnique({
          where: { bookingId: booking.id },
        });
        if (
          existingReport &&
          existingReport.reportedPhysicalHandoverAt.getTime() !==
            reportedPhysicalHandoverAt.getTime()
        )
          this.invalidState('The reported physical handover time cannot be changed.');
        if (!existingReport)
          await transaction.bookingPickupHandoverReport.create({
            data: {
              bookingId: booking.id,
              correlationId: metadata.correlationId ?? null,
              reportedByUserId: actorUserId,
              reportedPhysicalHandoverAt,
            },
          });
      }
      if (existing) return;
      const eventType =
        phase === HandoverPhase.START
          ? 'START_INSPECTION_EVIDENCE_WAIVED'
          : ownerOverdueCollectionRecovery
            ? 'OWNER_RETURN_INSPECTION_EVIDENCE_WAIVED'
            : 'RETURN_INSPECTION_EVIDENCE_WAIVED';
      await this.history(
        transaction,
        booking.id,
        booking.status,
        booking.status,
        BookingActorType.USER,
        actorUserId,
        eventType,
        metadata,
      );
      await this.outbox(transaction, booking.id, eventType, { bookingId: booking.id });
    });
    return ownerAuthority
      ? this.ownerDetailById(ownerAuthority.ownerUserId, reference)
      : this.participantDetailById(userId, reference);
  }

  async respondToPickupHandoverReport(
    renterUserId: string,
    reference: string,
    input: PickupHandoverResponseDto,
    metadata: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.renterUserId !== renterUserId) this.denied();
      if (
        booking.handoverWorkflowVersion !== HANDOVER_WORKFLOW_VERSION_B4 ||
        booking.status !== BookingStatus.READY_FOR_PICKUP ||
        booking.actualPickupAt
      )
        this.invalidState('This handover report can no longer be reviewed.');
      const report = await transaction.bookingPickupHandoverReport.findUnique({
        where: { bookingId: booking.id },
      });
      if (!report) this.invalidState('The owner has not submitted a handover time.');
      const existing = await transaction.bookingPickupHandoverResponse.findUnique({
        where: { bookingId: booking.id },
      });
      const proposedPhysicalHandoverAt = input.proposedPhysicalHandoverAt
        ? new Date(input.proposedPhysicalHandoverAt)
        : null;
      if (
        (input.decision === 'DISPUTED') !== Boolean(proposedPhysicalHandoverAt) ||
        (input.decision !== 'DISPUTED' && input.proposedPhysicalHandoverAt)
      )
        this.invalidState('A different handover time is required only when disputing the report.');
      if (proposedPhysicalHandoverAt) {
        let earliestAllowed = booking.pickupWindowStart ?? booking.rentalStart;
        const fulfillment = await transaction.bookingFulfillmentSnapshot.findUnique({
          where: { bookingId: booking.id },
        });
        if (fulfillment?.startMethod === StartFulfillmentMethod.OWNER_DELIVERY) {
          const arrived = await transaction.bookingHandoverTravelEvent.findUnique({
            where: {
              bookingId_phase_status: {
                bookingId: booking.id,
                phase: HandoverPhase.START,
                status: HandoverTravelStatus.ARRIVED,
              },
            },
          });
          if (!arrived) this.invalidState('Delivery arrival has not been recorded.');
          if (arrived.occurredAt > earliestAllowed) earliestAllowed = arrived.occurredAt;
        }
        if (
          proposedPhysicalHandoverAt < earliestAllowed ||
          proposedPhysicalHandoverAt > new Date() ||
          proposedPhysicalHandoverAt >= booking.rentalEnd
        )
          this.invalidState(
            `Proposed handover must be between ${earliestAllowed.toISOString()} and the current time.`,
          );
      }
      if (existing) {
        if (
          existing.decision !== input.decision ||
          existing.proposedPhysicalHandoverAt?.getTime() !== proposedPhysicalHandoverAt?.getTime()
        )
          this.invalidState('Your handover response cannot be changed.');
        return;
      }
      await transaction.bookingPickupHandoverResponse.create({
        data: {
          bookingId: booking.id,
          correlationId: metadata.correlationId ?? null,
          decision: input.decision,
          proposedPhysicalHandoverAt,
          reportId: report.id,
          respondedByUserId: renterUserId,
        },
      });
      const eventType = `PICKUP_HANDOVER_TIME_${input.decision}`;
      await this.history(
        transaction,
        booking.id,
        booking.status,
        booking.status,
        BookingActorType.USER,
        renterUserId,
        eventType,
        metadata,
      );
      await this.outbox(transaction, booking.id, eventType, { bookingId: booking.id });
    });
    return this.participantDetailById(renterUserId, reference);
  }

  private async assertEvidenceNotWaived(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    phase: HandoverPhase,
  ) {
    if (
      await transaction.bookingHandoverEvidenceWaiver.findUnique({
        where: { bookingId_phase: { bookingId, phase } },
      })
    )
      this.invalidState('Inspection evidence was waived. The evidence outcome cannot be changed.');
  }

  private async assertStartSafety(transaction: Prisma.TransactionClient, vehicleId: string) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "vehicles" WHERE "id" = ${vehicleId}::uuid FOR UPDATE`,
    );
    const vehicle = await transaction.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    if (
      vehicle.operationalStatus !== VehicleOperationalStatus.AVAILABLE ||
      (await transaction.vehicleKnownIssue.count({
        where: {
          vehicleId,
          status: VehicleKnownIssueStatus.ACTIVE,
          classification: InspectionConditionClassification.SAFETY_CRITICAL,
        },
      }))
    )
      this.invalidState('A safety or vehicle availability blocker prevents handover.');
  }

  private async assertTravelArrived(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    phase: HandoverPhase,
  ) {
    const fulfillment = await transaction.bookingFulfillmentSnapshot.findUnique({
      where: { bookingId },
    });
    if (
      ((phase === HandoverPhase.START &&
        fulfillment?.startMethod === StartFulfillmentMethod.OWNER_DELIVERY) ||
        (phase === HandoverPhase.RETURN &&
          fulfillment?.endMethod === EndFulfillmentMethod.OWNER_COLLECTION)) &&
      !(await transaction.bookingHandoverTravelEvent.count({
        where: { bookingId, phase, status: HandoverTravelStatus.ARRIVED },
      }))
    )
      this.invalidState('Mark arrival at the contractual location before continuing handover.');
  }

  async confirmVehicleReceipt(
    ownerUserId: string,
    reference: string,
    input: ConfirmVehicleReceiptDto,
    metadata: RequestMetadata,
    actorUserId = ownerUserId,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
        include: {
          ownerProfile: true,
          occupancy: true,
          policySnapshot: true,
          pricingSnapshot: true,
          vehicle: true,
        },
      });
      if (
        booking.ownerUserId !== ownerUserId ||
        booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED
      )
        this.denied();
      if (!input.vehicleReceived)
        this.invalidState('Confirm that you physically received the vehicle.');
      const receipt = await transaction.bookingHandoverReturnReceipt.findUnique({
        where: { bookingId: booking.id },
      });
      if (
        receipt &&
        [BookingStatus.RETURNED, BookingStatus.COMPLETED].includes(
          booking.status as 'RETURNED' | 'COMPLETED',
        )
      )
        return;
      if (
        booking.handoverWorkflowVersion !== HANDOVER_WORKFLOW_VERSION_B4 ||
        booking.status !== BookingStatus.RETURN_PENDING ||
        !booking.actualPickupAt ||
        booking.actualReturnAt ||
        booking.operationalHold
      )
        this.invalidState('The booking is not available for waived Return receipt confirmation.');
      if (
        !(await transaction.bookingHandoverEvidenceWaiver.findUnique({
          where: { bookingId_phase: { bookingId: booking.id, phase: HandoverPhase.RETURN } },
        }))
      )
        this.invalidState('Complete the existing inspection review for a verified Return.');
      const overdueReturnRecovery =
        Date.now() > booking.rentalEnd.getTime() + this.returnConfirmationGraceMinutes * 60_000;
      if (!overdueReturnRecovery)
        await this.assertTravelArrived(transaction, booking.id, HandoverPhase.RETURN);
      const recorded = await transaction.bookingHandoverReturnReceipt.create({
        data: { bookingId: booking.id, confirmedByUserId: actorUserId },
      });
      const now = recorded.confirmedAt;
      if (!booking.policySnapshot) this.invalidState('The booking policy is unavailable.');
      const claimDeadlineAt = new Date(
        now.getTime() + booking.policySnapshot.claimWindowHours * 3600000,
      );
      await transaction.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.RETURNED, actualReturnAt: now, claimDeadlineAt },
      });
      await this.extendOccupancyOrEscalate(transaction, booking, now);
      await this.history(
        transaction,
        booking.id,
        BookingStatus.RETURN_PENDING,
        BookingStatus.RETURNED,
        BookingActorType.USER,
        actorUserId,
        'RETURN_CONFIRMED_WITHOUT_INSPECTION_EVIDENCE',
        metadata,
      );
      await this.outbox(transaction, booking.id, 'RETURN_CONFIRMED', {
        bookingId: booking.id,
        actualReturnAt: now.toISOString(),
      });
      await this.outbox(transaction, booking.id, 'CLAIM_WINDOW_OPENED', {
        bookingId: booking.id,
        claimDeadlineAt: claimDeadlineAt.toISOString(),
      });
      await this.analytics(transaction, booking, 'RETURN_COMPLETED', metadata);
    });
    return this.ownerDetailById(ownerUserId, reference);
  }

  async issuePickupCode(renterUserId: string, reference: string, metadata: RequestMetadata) {
    const code = this.crypto.randomOtp();
    const expiresAt = new Date(Date.now() + this.challengeTtlMinutes * 60_000);
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      let booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.renterUserId !== renterUserId) this.denied();
      booking = await this.ensureReady(transaction, booking);
      await this.assertNoBlockingAcceptedAmendment(transaction, booking.id);
      this.assertPickupWindow(booking);
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Pickup confirmation requires a booking ready for pickup.');
      }
      const inspection = await transaction.inspection.findFirst({
        include: {
          conditionIssues: { select: { classification: true } },
          confirmations: {
            include: {
              discrepancyResponses: {
                include: {
                  resolutionReview: { include: { operationsResolution: true } },
                },
                orderBy: { roundNumber: 'asc' },
              },
            },
          },
        },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      const waiver = await transaction.bookingHandoverEvidenceWaiver.findUnique({
        where: { bookingId_phase: { bookingId: booking.id, phase: HandoverPhase.START } },
      });
      if (waiver) {
        const response = await transaction.bookingPickupHandoverResponse.findUnique({
          where: { bookingId: booking.id },
        });
        if (response?.decision !== 'CONFIRMED')
          throw new ApplicationException(
            'PICKUP_HANDOVER_TIME_CONFIRMATION_REQUIRED',
            response
              ? 'The reported handover time is disputed and requires Operations review.'
              : 'Confirm the owner-reported handover time before requesting a pickup code.',
            HttpStatus.CONFLICT,
          );
      }
      if (!waiver) {
        if (!inspection) {
          throw new ApplicationException(
            'PICKUP_INSPECTION_REQUIRED',
            'Review the finalized pickup inspection before confirming handover.',
            HttpStatus.CONFLICT,
          );
        }
        this.assertNoSafetyCriticalCondition(inspection.conditionIssues);
        const confirmation = inspection.confirmations.find(
          ({ role }) => role === InspectionParticipantRole.RENTER,
        );
        if (!confirmation) {
          throw new ApplicationException(
            'PICKUP_INSPECTION_REVIEW_REQUIRED',
            'Confirm the pickup inspection condition before requesting a pickup code.',
            HttpStatus.CONFLICT,
          );
        }
        if (
          confirmation.decision === InspectionConfirmationDecision.DISAGREED &&
          !this.discrepancyAllowsHandover(
            confirmation.discrepancyResponses.at(-1)?.resolutionReview,
          )
        ) {
          throw new ApplicationException(
            'PICKUP_INSPECTION_DISAGREED',
            'Handover is paused while the reported condition issue is reviewed.',
            HttpStatus.CONFLICT,
          );
        }
      }
      await this.assertStartSafety(transaction, booking.vehicleId);
      await this.assertTravelArrived(transaction, booking.id, HandoverPhase.START);
      await this.assertHandoverAvailable(transaction, booking.id);
      await transaction.inspectionVerificationChallenge.updateMany({
        data: { supersededAt: new Date() },
        where: { bookingId: booking.id, consumedAt: null, supersededAt: null },
      });
      await transaction.inspectionVerificationChallenge.create({
        data: {
          bookingId: booking.id,
          expiresAt,
          id: randomUUID(),
          issuedToUserId: renterUserId,
          maxAttempts: this.challengeMaxAttempts,
          secretHash: this.crypto.hashToken(`pickup:${booking.id}:${code}`),
        },
      });
      await this.outbox(transaction, booking.id, 'PICKUP_VERIFICATION_ISSUED', {
        bookingId: booking.id,
        expiresAt: expiresAt.toISOString(),
      });
      await this.analytics(transaction, booking, 'PICKUP_STARTED', metadata);
    });
    return { code, expiresAt };
  }

  async verifyPickup(
    ownerUserId: string,
    reference: string,
    code: string,
    metadata: RequestMetadata,
    actorUserId = ownerUserId,
  ) {
    const result = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true, policySnapshot: true, securityDeposit: true },
        where: { publicReference: reference },
      });
      if (booking.ownerUserId !== ownerUserId) this.denied();
      if (booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED) this.denied();
      await this.assertNoBlockingAcceptedAmendment(transaction, booking.id);
      if (booking.status === BookingStatus.ACTIVE) {
        return { error: 'PICKUP_CODE_REUSED' as const };
      }
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Booking is not ready for pickup verification.');
      }
      if (
        securityDepositBlocksHandover({
          authorizedAmountMinor: booking.securityDeposit?.authorizedAmountMinor ?? 0n,
          executionEnabled: this.securityDepositExecutionEnabled,
          required: booking.policySnapshot?.securityDepositRequired ?? false,
          requiredAmountMinor: booking.policySnapshot?.securityDepositAmountMinor ?? null,
          status: booking.securityDeposit?.status ?? null,
        })
      )
        throw new ApplicationException(
          'SECURITY_DEPOSIT_REQUIRED_BEFORE_HANDOVER',
          'Place the required security deposit before pickup can be completed.',
          HttpStatus.CONFLICT,
        );
      this.assertPickupWindow(booking);
      const challenge = await transaction.inspectionVerificationChallenge.findFirst({
        orderBy: { createdAt: 'desc' },
        where: { bookingId: booking.id, consumedAt: null, supersededAt: null },
      });
      if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
        return { error: 'PICKUP_CODE_EXPIRED' as const };
      }
      if (challenge.attemptCount >= challenge.maxAttempts) {
        return { error: 'PICKUP_CODE_ATTEMPTS_EXCEEDED' as const };
      }
      const expected = this.crypto.hashToken(`pickup:${booking.id}:${code}`);
      if (!this.crypto.secureEqual(expected, challenge.secretHash)) {
        await transaction.inspectionVerificationChallenge.update({
          data: { attemptCount: { increment: 1 } },
          where: { id: challenge.id },
        });
        return {
          error:
            challenge.attemptCount + 1 >= challenge.maxAttempts
              ? ('PICKUP_CODE_ATTEMPTS_EXCEEDED' as const)
              : ('PICKUP_CODE_INVALID' as const),
        };
      }
      const inspection = await transaction.inspection.findFirst({
        include: {
          conditionIssues: { select: { classification: true } },
          confirmations: {
            include: {
              discrepancyResponses: {
                include: {
                  resolutionReview: { include: { operationsResolution: true } },
                },
                orderBy: { roundNumber: 'asc' },
              },
            },
          },
        },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      const waiver = await transaction.bookingHandoverEvidenceWaiver.findUnique({
        where: { bookingId_phase: { bookingId: booking.id, phase: HandoverPhase.START } },
      });
      if (
        waiver &&
        (
          await transaction.bookingPickupHandoverResponse.findUnique({
            where: { bookingId: booking.id },
          })
        )?.decision !== 'CONFIRMED'
      )
        this.invalidState('The renter must confirm the reported handover time first.');
      await this.assertStartSafety(transaction, booking.vehicleId);
      await this.assertTravelArrived(transaction, booking.id, HandoverPhase.START);
      await this.assertHandoverAvailable(transaction, booking.id);
      if (!waiver) {
        if (!inspection) this.invalidState('Pickup inspection is required.');
        this.assertNoSafetyCriticalCondition(inspection.conditionIssues);
        const roles = new Set(inspection.confirmations.map(({ role }) => role));
        if (
          !roles.has(InspectionParticipantRole.OWNER) ||
          !roles.has(InspectionParticipantRole.RENTER)
        ) {
          throw new ApplicationException(
            'PICKUP_CONFIRMATIONS_REQUIRED',
            'Both participants must confirm the pickup inspection.',
            HttpStatus.CONFLICT,
          );
        }
        const renterConfirmation = inspection.confirmations.find(
          ({ role }) => role === InspectionParticipantRole.RENTER,
        )!;
        if (
          renterConfirmation.decision === InspectionConfirmationDecision.DISAGREED &&
          !this.discrepancyAllowsHandover(
            renterConfirmation.discrepancyResponses.at(-1)?.resolutionReview,
          )
        ) {
          throw new ApplicationException(
            'PICKUP_INSPECTION_DISAGREED',
            'Handover remains paused while the condition issue is unresolved.',
            HttpStatus.CONFLICT,
          );
        }
      }
      const now = new Date();
      await transaction.inspectionVerificationChallenge.update({
        data: { consumedAt: now, consumedByUserId: actorUserId },
        where: { id: challenge.id },
      });
      await transaction.booking.update({
        data: { actualPickupAt: now, status: BookingStatus.ACTIVE },
        where: { id: booking.id },
      });
      await this.history(
        transaction,
        booking.id,
        BookingStatus.READY_FOR_PICKUP,
        BookingStatus.ACTIVE,
        BookingActorType.USER,
        actorUserId,
        waiver ? 'PICKUP_CONFIRMED_WITHOUT_INSPECTION_EVIDENCE' : 'PICKUP_CONFIRMED',
        metadata,
      );
      await this.outbox(transaction, booking.id, 'RENTAL_STARTED', {
        actualPickupAt: now.toISOString(),
        bookingId: booking.id,
      });
      await this.outbox(transaction, booking.id, 'PICKUP_CONFIRMED', {
        actualPickupAt: now.toISOString(),
        bookingId: booking.id,
      });
      await this.analytics(transaction, booking, 'PICKUP_COMPLETED', metadata);
      await this.analytics(transaction, booking, 'RENTAL_ACTIVATED', metadata);
      return { error: null };
    });
    if (result.error) {
      const attempts = result.error === 'PICKUP_CODE_ATTEMPTS_EXCEEDED';
      throw new ApplicationException(
        result.error,
        attempts
          ? 'Pickup verification attempts have been exhausted.'
          : 'Pickup code is invalid or expired.',
        attempts ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_REQUEST,
      );
    }
    return this.ownerDetailById(ownerUserId, reference);
  }

  async initiateReturn(
    userId: string,
    reference: string,
    metadata: RequestMetadata,
    ownerAuthority?: OwnerOperationAuthority,
  ) {
    const authorizationUserId = ownerAuthority?.ownerUserId ?? userId;
    const actorUserId = ownerAuthority?.actorUserId ?? userId;
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      this.assertParticipant(booking, authorizationUserId);
      if (booking.status === BookingStatus.RETURN_PENDING) return;
      if (booking.status !== BookingStatus.ACTIVE) {
        this.invalidState('Only an active rental can begin return.');
      }
      await terminateActiveExtensionForReturn(transaction, booking.id);
      await transaction.booking.update({
        data: { status: BookingStatus.RETURN_PENDING },
        where: { id: booking.id },
      });
      await this.history(
        transaction,
        booking.id,
        BookingStatus.ACTIVE,
        BookingStatus.RETURN_PENDING,
        BookingActorType.USER,
        actorUserId,
        'RETURN_STARTED',
        metadata,
      );
      await this.outbox(transaction, booking.id, 'RETURN_STARTED', { bookingId: booking.id });
      await this.analytics(transaction, booking, 'RETURN_STARTED', metadata);
    });
    return ownerAuthority
      ? this.ownerDetailById(ownerAuthority.ownerUserId, reference)
      : this.participantDetailById(userId, reference);
  }

  async confirmReturn(
    userId: string,
    reference: string,
    input: ReturnConfirmationDto,
    metadata: RequestMetadata,
    ownerAuthority?: OwnerOperationAuthority,
  ) {
    const authorizationUserId = ownerAuthority?.ownerUserId ?? userId;
    const actorUserId = ownerAuthority?.actorUserId ?? userId;
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: {
          occupancy: true,
          ownerProfile: true,
          policySnapshot: true,
          pricingSnapshot: true,
          vehicle: true,
        },
        where: { publicReference: reference },
      });
      const participantRole =
        booking.ownerUserId === authorizationUserId
          ? InspectionParticipantRole.OWNER
          : booking.renterUserId === authorizationUserId
            ? InspectionParticipantRole.RENTER
            : null;
      if (!participantRole) this.denied();
      if (
        participantRole === InspectionParticipantRole.OWNER &&
        booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED
      ) {
        this.denied();
      }
      if (booking.status === BookingStatus.RETURNED) {
        const finalizedReturn = await transaction.inspection.findFirst({
          include: { confirmations: true },
          orderBy: { version: 'asc' },
          where: {
            bookingId: booking.id,
            status: InspectionStatus.FINALIZED,
            type: InspectionType.RETURN,
          },
        });
        const confirmation = finalizedReturn?.confirmations.find(
          ({ role }) => role === participantRole,
        );
        if (confirmation?.decision === input.decision) return;
        throw new ApplicationException(
          'RETURN_CONFIRMATION_IMMUTABLE',
          'The submitted return acknowledgement cannot be changed.',
          HttpStatus.CONFLICT,
        );
      }
      if (booking.status !== BookingStatus.RETURN_PENDING) {
        this.invalidState('Booking is not waiting for return confirmation.');
      }
      const pickup = await transaction.inspection.findFirst({
        include: {
          amendments: {
            orderBy: { reviewedAt: 'desc' },
            where: { status: InspectionAmendmentStatus.APPROVED },
          },
        },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      const returned = await transaction.inspection.findFirstOrThrow({
        orderBy: { version: 'asc' },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.RETURN,
        },
      });
      const startWaiver = await transaction.bookingHandoverEvidenceWaiver.findUnique({
        where: { bookingId_phase: { bookingId: booking.id, phase: HandoverPhase.START } },
      });
      if (!pickup && !startWaiver) this.invalidState('Pickup evidence is unavailable.');
      const effectivePickup = pickup ? this.effectiveInspection(pickup) : null;
      const existing = await transaction.inspectionConfirmation.findUnique({
        where: {
          inspectionId_role: { inspectionId: returned.id, role: participantRole },
        },
      });
      if (existing && existing.decision !== input.decision) {
        throw new ApplicationException(
          'RETURN_CONFIRMATION_IMMUTABLE',
          'The submitted return acknowledgement cannot be changed.',
          HttpStatus.CONFLICT,
        );
      }
      if (!existing) {
        await transaction.inspectionConfirmation.create({
          data: {
            decision: input.decision,
            id: randomUUID(),
            inspectionId: returned.id,
            reason: input.reason ?? null,
            role: participantRole,
            userId: actorUserId,
          },
        });
      }
      const confirmations = await transaction.inspectionConfirmation.findMany({
        where: { inspectionId: returned.id },
      });
      const confirmedRoles = new Set(confirmations.map(({ role }) => role));
      if (
        !confirmedRoles.has(InspectionParticipantRole.OWNER) ||
        !confirmedRoles.has(InspectionParticipantRole.RENTER)
      ) {
        return;
      }
      if (
        effectivePickup &&
        (effectivePickup.odometerMeters === null || returned.odometerMeters === null)
      ) {
        throw new ApplicationException(
          'INSPECTION_MEASUREMENT_REQUIRED',
          'Both inspections require odometer measurements.',
          HttpStatus.CONFLICT,
        );
      }
      if (
        effectivePickup?.odometerMeters != null &&
        returned.odometerMeters != null &&
        returned.odometerMeters < effectivePickup.odometerMeters
      ) {
        throw new ApplicationException(
          'RETURN_ODOMETER_INVALID',
          'Return odometer cannot be lower than pickup odometer.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (!booking.policySnapshot || !booking.pricingSnapshot) {
        throw new ApplicationException(
          'BOOKING_SNAPSHOT_MISSING',
          'The immutable booking policy snapshot is unavailable.',
          HttpStatus.CONFLICT,
        );
      }
      const now = new Date();
      // No invented baseline measurements or deficiency amounts when Start was waived.
      if (
        effectivePickup &&
        effectivePickup.odometerMeters !== null &&
        returned.odometerMeters !== null
      ) {
        const usage = calculateBookingUsage({
          actualReturnAt: now,
          decision: input.decision,
          pickup: {
            batterySocBasisPoints: effectivePickup.batterySocBasisPoints,
            fuelBasisPoints: effectivePickup.fuelBasisPoints,
            odometerMeters: effectivePickup.odometerMeters,
          },
          policy: booking.policySnapshot,
          pricing: booking.pricingSnapshot,
          returned: {
            batterySocBasisPoints: returned.batterySocBasisPoints,
            fuelBasisPoints: returned.fuelBasisPoints,
            odometerMeters: returned.odometerMeters,
          },
          scheduledReturnAt: booking.rentalEnd,
        });
        await transaction.bookingUsageSummary.create({
          data: { bookingId: booking.id, id: randomUUID(), ...usage },
        });
      }
      if (input.decision === InspectionConfirmationDecision.DISAGREED) {
        const dispute = await transaction.dispute.create({
          data: {
            blocksCompletion: true,
            bookingId: booking.id,
            openedByUserId: actorUserId,
            originType: DisputeOriginType.OTHER,
            reason: input.reason ?? 'A participant disputed the recorded return measurements.',
            status: DisputeStatus.EVIDENCE_COLLECTION,
          },
        });
        const earning = await transaction.ownerEarning.findUnique({
          where: { bookingId: booking.id },
        });
        if (earning) {
          const exposure =
            earning.netEarningAmountMinor +
            earning.deliveryEarningMinor +
            earning.collectionEarningMinor +
            earning.additionalCompensationMinor +
            earning.adjustmentAmountMinor;
          if (exposure > 0n) {
            await transaction.earningHold.create({
              data: {
                amountMinor: exposure,
                currency: earning.currency,
                disputeId: dispute.id,
                mode: EarningHoldMode.FULL,
                ownerEarningId: earning.id,
                rationale: 'Disputed return measurements require administrative resolution.',
                reason: EarningHoldReason.DISPUTE,
              },
            });
          }
        }
        await this.outbox(transaction, booking.id, 'DISPUTE_OPENED', {
          bookingId: booking.id,
          disputeId: dispute.id,
        });
      }
      const claimDeadlineAt = new Date(
        now.getTime() + booking.policySnapshot.claimWindowHours * 60 * 60 * 1000,
      );
      await transaction.booking.update({
        data: { actualReturnAt: now, claimDeadlineAt, status: BookingStatus.RETURNED },
        where: { id: booking.id },
      });
      await this.extendOccupancyOrEscalate(transaction, booking, now);
      await this.history(
        transaction,
        booking.id,
        BookingStatus.RETURN_PENDING,
        BookingStatus.RETURNED,
        BookingActorType.USER,
        actorUserId,
        'RETURN_CONFIRMED',
        metadata,
      );
      await this.outbox(transaction, booking.id, 'RETURN_CONFIRMED', {
        actualReturnAt: now.toISOString(),
        bookingId: booking.id,
      });
      await this.outbox(transaction, booking.id, 'CLAIM_WINDOW_OPENED', {
        bookingId: booking.id,
        claimDeadlineAt: claimDeadlineAt.toISOString(),
      });
      await this.analytics(transaction, booking, 'RETURN_COMPLETED', metadata);
    });
    return ownerAuthority
      ? this.ownerDetailById(ownerAuthority.ownerUserId, reference)
      : this.participantDetailById(userId, reference);
  }

  async requestInspectionCorrection(
    ownerUserId: string,
    reference: string,
    inspectionId: string,
    input: RequestInspectionCorrectionDto,
    metadata: RequestMetadata,
  ) {
    if (
      input.proposedOdometerMeters === undefined &&
      input.proposedFuelBasisPoints === undefined &&
      input.proposedBatterySocBasisPoints === undefined
    ) {
      throw new ApplicationException(
        'INSPECTION_CORRECTION_EMPTY',
        'Provide at least one corrected measurement.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const correction = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const inspection = await transaction.inspection.findFirstOrThrow({
        include: { booking: true },
        where: { id: inspectionId, booking: { publicReference: reference } },
      });
      if (
        inspection.booking.ownerUserId !== ownerUserId ||
        inspection.submittedByUserId !== ownerUserId ||
        inspection.type !== InspectionType.PICKUP ||
        inspection.status !== InspectionStatus.FINALIZED
      )
        this.denied();
      if (
        inspection.booking.status !== BookingStatus.ACTIVE &&
        inspection.booking.status !== BookingStatus.RETURN_PENDING
      )
        this.invalidState(
          'Pickup measurement corrections are available only during an active or returning rental.',
        );
      const pending = await transaction.inspectionAmendment.findFirst({
        select: { id: true },
        where: { inspectionId, status: InspectionAmendmentStatus.PENDING_REVIEW },
      });
      if (pending) {
        throw new ApplicationException(
          'INSPECTION_CORRECTION_PENDING',
          'A correction request for this inspection is already pending administrator review.',
          HttpStatus.CONFLICT,
        );
      }
      const created = await transaction.inspectionAmendment.create({
        data: {
          createdByUserId: ownerUserId,
          evidence: {
            originalBatterySocBasisPoints: inspection.batterySocBasisPoints,
            originalFuelBasisPoints: inspection.fuelBasisPoints,
            originalOdometerMeters: inspection.odometerMeters?.toString() ?? null,
          },
          id: randomUUID(),
          inspectionId,
          proposedBatterySocBasisPoints: input.proposedBatterySocBasisPoints ?? null,
          proposedFuelBasisPoints: input.proposedFuelBasisPoints ?? null,
          proposedOdometerMeters:
            input.proposedOdometerMeters === undefined
              ? null
              : BigInt(input.proposedOdometerMeters),
          reason: input.reason,
        },
      });
      await this.outbox(transaction, inspection.booking.id, 'INSPECTION_CORRECTION_REQUESTED', {
        bookingId: inspection.booking.id,
        correctionId: created.id,
        inspectionId,
      });
      return { bookingId: inspection.booking.id, correction: created };
    });
    await this.audit.record({
      action: 'INSPECTION_CORRECTION_REQUESTED',
      actorUserId: ownerUserId,
      metadata: { bookingId: correction.bookingId, inspectionId },
      reason: input.reason,
      request: metadata,
      targetId: correction.correction.id,
      targetType: 'INSPECTION_AMENDMENT',
    });
    return this.toSerializable(correction.correction);
  }

  async adminInspectionCorrections(
    status: InspectionAmendmentStatus = InspectionAmendmentStatus.PENDING_REVIEW,
  ) {
    const corrections = await this.database.client.inspectionAmendment.findMany({
      include: inspectionCorrectionAdminInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      where: { status },
    });
    return this.toSerializable(corrections);
  }

  async adminInspectionCorrection(correctionId: string) {
    const correction = await this.database.client.inspectionAmendment.findUniqueOrThrow({
      include: inspectionCorrectionAdminInclude,
      where: { id: correctionId },
    });
    return this.toSerializable(correction);
  }

  async reviewInspectionCorrection(
    principal: RequestPrincipal,
    correctionId: string,
    input: ReviewInspectionCorrectionDto,
    metadata: RequestMetadata,
  ) {
    const review = await this.database.client.$transaction(async (transaction) => {
      const correction = await transaction.inspectionAmendment.findUniqueOrThrow({
        include: { inspection: { include: { booking: true } } },
        where: { id: correctionId },
      });
      if (correction.createdByUserId === principal.userId) {
        throw new ApplicationException(
          'INSPECTION_CORRECTION_SELF_REVIEW',
          'Correction requesters cannot review their own request.',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.lockBooking(transaction, correction.inspection.booking.publicReference);
      if (correction.status !== InspectionAmendmentStatus.PENDING_REVIEW) {
        if ((correction.status === InspectionAmendmentStatus.APPROVED) === input.approved)
          return { changed: false, correction };
        throw new ApplicationException(
          'INSPECTION_CORRECTION_REVIEWED',
          'This correction request has already been reviewed.',
          HttpStatus.CONFLICT,
        );
      }
      const status = input.approved
        ? InspectionAmendmentStatus.APPROVED
        : InspectionAmendmentStatus.REJECTED;
      const result = await transaction.inspectionAmendment.update({
        data: {
          reviewReason: input.reason,
          reviewedAt: new Date(),
          reviewedByUserId: principal.userId,
          status,
        },
        where: { id: correctionId },
      });
      await this.outbox(
        transaction,
        correction.inspection.booking.id,
        `INSPECTION_CORRECTION_${status}`,
        {
          bookingId: correction.inspection.booking.id,
          correctionId,
          inspectionId: correction.inspectionId,
        },
      );
      return { changed: true, correction: result };
    });
    if (review.changed) {
      await this.audit.record({
        action: `INSPECTION_CORRECTION_${review.correction.status}`,
        actorUserId: principal.userId,
        reason: input.reason,
        request: metadata,
        targetId: correctionId,
        targetType: 'INSPECTION_AMENDMENT',
      });
    }
    return this.toSerializable(review.correction);
  }

  async submitClaim(
    ownerUserId: string,
    reference: string,
    input: CreateClaimDto,
    metadata: RequestMetadata,
  ) {
    const claim = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      if (booking.ownerUserId !== ownerUserId) this.denied();
      if (
        booking.status !== BookingStatus.RETURNED ||
        !booking.claimDeadlineAt ||
        Date.now() > booking.claimDeadlineAt.getTime()
      ) {
        throw new ApplicationException(
          'CLAIM_DEADLINE_PASSED',
          'The booking is not within its post-return claim window.',
          HttpStatus.CONFLICT,
        );
      }
      await this.validateEvidenceFiles(transaction, ownerUserId, input.evidenceFileIds ?? []);
      const created = await transaction.postReturnClaim.create({
        data: {
          bookingId: booking.id,
          category: input.category,
          description: input.description,
          evidence: {
            create: (input.evidenceFileIds ?? []).map((fileAssetId) => ({
              evidenceType: 'PHOTO',
              fileAsset: { connect: { id: fileAssetId } },
              participantRole: 'OWNER',
              submittedBy: { connect: { id: ownerUserId } },
            })),
          },
          id: randomUUID(),
          submittedByUserId: ownerUserId,
        },
      });
      await this.outbox(transaction, booking.id, 'POST_RETURN_CLAIM_SUBMITTED', {
        bookingId: booking.id,
        category: input.category,
        claimId: created.id,
      });
      await this.analytics(transaction, booking, 'CLAIM_SUBMITTED', metadata);
      return created;
    });
    return {
      claim: this.toSerializable(claim),
      rental: await this.ownerDetailById(ownerUserId, reference),
    };
  }

  async reportIncident(
    userId: string,
    reference: string,
    input: CreateIncidentDto,
    metadata: RequestMetadata,
    authority?: OwnerOperationAuthority,
  ) {
    const actorUserId = authority?.actorUserId ?? userId;
    const participantUserId = authority?.ownerUserId ?? userId;
    const incident = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      this.assertParticipant(booking, participantUserId);
      if (
        !new Set<BookingStatus>([
          BookingStatus.READY_FOR_PICKUP,
          BookingStatus.ACTIVE,
          BookingStatus.RETURN_PENDING,
        ]).has(booking.status)
      ) {
        this.invalidState('Incidents can be reported during pickup, active rental, or return.');
      }
      await this.validateEvidenceFiles(transaction, actorUserId, input.evidenceFileIds ?? []);
      const created = await transaction.rentalIncident.create({
        data: {
          blocksCompletion: input.severity === RentalIncidentSeverity.CRITICAL,
          bookingId: booking.id,
          category: input.category,
          description: input.description,
          evidence: {
            create: (input.evidenceFileIds ?? []).map((fileAssetId) => ({
              id: randomUUID(),
              fileAssetId,
            })),
          },
          id: randomUUID(),
          reportedByUserId: actorUserId,
          severity: input.severity,
        },
      });
      await this.outbox(transaction, booking.id, 'INCIDENT_REPORTED', {
        bookingId: booking.id,
        category: input.category,
        incidentId: created.id,
        severity: input.severity,
      });
      await this.analytics(transaction, booking, 'INCIDENT_REPORTED', metadata);
      return created;
    });
    return { incident: this.toSerializable(incident) };
  }

  async adminQueue() {
    const bookings = await this.database.client.booking.findMany({
      include: rentalInclude,
      orderBy: { rentalStart: 'asc' },
      take: 200,
      where: {
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.READY_FOR_PICKUP,
            BookingStatus.ACTIVE,
            BookingStatus.RETURN_PENDING,
            BookingStatus.RETURNED,
          ],
        },
      },
    });
    return Promise.all(bookings.map((booking) => this.serialize(booking)));
  }

  async adminDetail(reference: string) {
    const booking = await this.load(reference);
    const currentVehicleKnownIssues = await this.database.client.vehicleKnownIssue.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        category: true,
        classification: true,
        createdAt: true,
        description: true,
        id: true,
        resolvedAt: true,
        status: true,
        vehicleArea: true,
      },
      where: { vehicleId: booking.vehicleId },
    });
    return { ...(await this.serialize(booking)), currentVehicleKnownIssues };
  }

  async resolvePickupHandover(
    principal: RequestPrincipal,
    reference: string,
    input: PickupHandoverOperationsResolutionDto,
    metadata: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: { vehicle: true },
        where: { publicReference: reference },
      });
      if (booking.status !== BookingStatus.READY_FOR_PICKUP)
        this.invalidState('Operations handover review requires a pickup-ready booking.');
      const incident = await transaction.rentalIncident.findUniqueOrThrow({
        include: {
          disputes: true,
          pickupDiscrepancyResponses: {
            include: { resolutionReview: true },
            orderBy: { roundNumber: 'asc' },
          },
          pickupHandoverOperationsResolution: true,
        },
        where: { id: input.incidentId },
      });
      if (incident.bookingId !== booking.id) this.denied();
      const review = incident.pickupDiscrepancyResponses.at(-1)?.resolutionReview ?? null;
      if (review && review.decision !== PickupDiscrepancyResolutionDecision.STILL_DISAGREES)
        this.invalidState('Only a continued disagreement requires an Operations decision.');
      const dispute = input.disputeId
        ? incident.disputes.find(({ id }) => id === input.disputeId)
        : incident.disputes.find(
            ({ status }) =>
              status === DisputeStatus.OPEN ||
              status === DisputeStatus.EVIDENCE_COLLECTION ||
              status === DisputeStatus.UNDER_REVIEW,
          );
      if (input.disputeId && !dispute)
        throw new ApplicationException(
          'PICKUP_HANDOVER_DISPUTE_INVALID',
          'The selected dispute does not belong to this handover incident.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      const existing = incident.pickupHandoverOperationsResolution;
      if (existing) {
        if (existing.outcome === input.outcome && existing.reason === input.reason.trim()) return;
        throw new ApplicationException(
          'PICKUP_HANDOVER_RESOLUTION_IMMUTABLE',
          'An authoritative Operations outcome already exists for this handover case.',
          HttpStatus.CONFLICT,
        );
      }
      const inspection = await transaction.inspection.findFirstOrThrow({
        include: { conditionIssues: { select: { classification: true } } },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      if (input.outcome === PickupHandoverOperationsOutcome.HANDOVER_MAY_RESUME) {
        this.assertNoSafetyCriticalCondition(inspection.conditionIssues);
        if (booking.vehicle.operationalStatus === VehicleOperationalStatus.MAINTENANCE)
          throw new ApplicationException(
            'PICKUP_VEHICLE_MAINTENANCE',
            'The vehicle must leave Maintenance before handover can resume.',
            HttpStatus.CONFLICT,
          );
        if (booking.operationalHold)
          throw new ApplicationException(
            'PICKUP_OPERATIONS_HOLD',
            'Release the separate booking hold before authorizing handover.',
            HttpStatus.CONFLICT,
          );
        const [otherIncidents, otherDisputes] = await Promise.all([
          transaction.rentalIncident.count({
            where: {
              bookingId: booking.id,
              blocksCompletion: true,
              id: { not: incident.id },
              status: { in: [RentalIncidentStatus.OPEN, RentalIncidentStatus.ACKNOWLEDGED] },
            },
          }),
          transaction.dispute.count({
            where: {
              bookingId: booking.id,
              blocksCompletion: true,
              ...(dispute ? { id: { not: dispute.id } } : {}),
              status: {
                in: [
                  DisputeStatus.OPEN,
                  DisputeStatus.EVIDENCE_COLLECTION,
                  DisputeStatus.UNDER_REVIEW,
                ],
              },
            },
          }),
        ]);
        if (otherIncidents || otherDisputes)
          throw new ApplicationException(
            'PICKUP_OPERATIONS_HOLD',
            'Other unresolved Operations cases still block handover.',
            HttpStatus.CONFLICT,
          );
      }
      await transaction.pickupHandoverOperationsResolution.create({
        data: {
          bookingId: booking.id,
          discrepancyResolutionReviewId: review?.id ?? null,
          disputeId: dispute?.id ?? null,
          id: randomUUID(),
          incidentId: incident.id,
          outcome: input.outcome,
          reason: input.reason.trim(),
          resolvedByUserId: principal.userId,
        },
      });
      if (input.outcome === PickupHandoverOperationsOutcome.HANDOVER_MAY_RESUME) {
        const now = new Date();
        await transaction.rentalIncident.update({
          data: { resolvedAt: now, status: RentalIncidentStatus.RESOLVED },
          where: { id: incident.id },
        });
        if (dispute)
          await transaction.dispute.update({
            data: {
              closedAt: now,
              resolvedAt: now,
              resolvedByUserId: principal.userId,
              resolutionReason: input.reason.trim(),
              status: DisputeStatus.CLOSED,
            },
            where: { id: dispute.id },
          });
      } else if (input.outcome === PickupHandoverOperationsOutcome.MAINTENANCE_REQUIRED) {
        await transaction.vehicle.update({
          data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
          where: { id: booking.vehicleId },
        });
      }
      await this.outbox(transaction, booking.id, 'PICKUP_HANDOVER_OPERATIONS_RESOLVED', {
        bookingId: booking.id,
        outcome: input.outcome,
      });
    });
    await this.audit.record({
      action: 'PICKUP_HANDOVER_OPERATIONS_RESOLVED',
      actorUserId: principal.userId,
      metadata: { incidentId: input.incidentId, outcome: input.outcome },
      reason: input.reason.trim(),
      request: metadata,
      targetId: reference,
      targetType: 'BOOKING',
    });
    return this.adminDetail(reference);
  }

  async setOperationalHold(
    principal: RequestPrincipal,
    reference: string,
    input: OperationalHoldDto,
    metadata: RequestMetadata,
  ) {
    const booking = await this.database.client.booking.update({
      data: { operationalHold: input.hold },
      where: { publicReference: reference },
    });
    await this.audit.record({
      action: input.hold ? 'RENTAL_OPERATIONAL_HOLD_PLACED' : 'RENTAL_OPERATIONAL_HOLD_RELEASED',
      actorUserId: principal.userId,
      metadata: { hold: input.hold },
      reason: input.reason,
      request: metadata,
      targetId: booking.id,
      targetType: 'BOOKING',
    });
    return this.adminDetail(reference);
  }

  async adminResolveHandover(
    principal: RequestPrincipal,
    reference: string,
    input: AdminHandoverResolutionDto,
    metadata: RequestMetadata,
  ) {
    if (input.action === 'CONFIRM_PICKUP') {
      throw new ApplicationException(
        'PICKUP_PARTICIPANT_OTP_REQUIRED',
        'Pickup custody transfer requires the normal participant verification code.',
        HttpStatus.CONFLICT,
      );
    }
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 60_000) {
      throw new ApplicationException(
        'OPERATIONAL_RESOLUTION_TIME_INVALID',
        'The authoritative handover time cannot be in the future.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: {
          occupancy: true,
          policySnapshot: true,
          pricingSnapshot: true,
          vehicle: true,
        },
        where: { publicReference: reference },
      });
      const earliestOccurredAt = booking.actualPickupAt ?? booking.rentalStart;
      if (occurredAt.getTime() < earliestOccurredAt.getTime()) {
        throw new ApplicationException(
          'OPERATIONAL_RESOLUTION_TIME_INVALID',
          'The authoritative return time cannot precede pickup.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (input.incidentId) {
        const incident = await transaction.rentalIncident.findUniqueOrThrow({
          where: { id: input.incidentId },
        });
        if (incident.bookingId !== booking.id) this.denied();
      }
      {
        if (booking.status !== BookingStatus.RETURN_PENDING) {
          this.invalidState('Administrative return resolution requires a return-pending booking.');
        }
        const [pickup, returned, existingUsage] = await Promise.all([
          transaction.inspection.findFirst({
            include: {
              amendments: {
                orderBy: { reviewedAt: 'desc' },
                where: { status: InspectionAmendmentStatus.APPROVED },
              },
            },
            where: {
              bookingId: booking.id,
              status: InspectionStatus.FINALIZED,
              type: InspectionType.PICKUP,
            },
          }),
          transaction.inspection.findFirst({
            orderBy: { version: 'asc' },
            where: {
              bookingId: booking.id,
              status: InspectionStatus.FINALIZED,
              submittedByUserId: booking.renterUserId,
              type: InspectionType.RETURN,
            },
          }),
          transaction.bookingUsageSummary.findUnique({ where: { bookingId: booking.id } }),
        ]);
        if (
          !pickup ||
          !returned ||
          pickup.odometerMeters === null ||
          returned.odometerMeters === null
        ) {
          throw new ApplicationException(
            'RETURN_EVIDENCE_REQUIRED',
            'Finalized pickup and return inspections are required for administrative resolution.',
            HttpStatus.CONFLICT,
          );
        }
        const effectivePickup = this.effectiveInspection(pickup);
        if (effectivePickup.odometerMeters === null) {
          throw new ApplicationException(
            'RETURN_EVIDENCE_REQUIRED',
            'An effective pickup odometer is required for administrative resolution.',
            HttpStatus.CONFLICT,
          );
        }
        if (returned.odometerMeters < effectivePickup.odometerMeters) {
          throw new ApplicationException(
            'RETURN_ODOMETER_BELOW_PICKUP',
            `The return odometer (${Number(returned.odometerMeters) / 1000} km) is below the effective pickup odometer (${Number(effectivePickup.odometerMeters) / 1000} km). Correct the pickup evidence before resolving the physical return.`,
            HttpStatus.CONFLICT,
          );
        }
        if (!booking.policySnapshot || !booking.pricingSnapshot) {
          throw new ApplicationException(
            'BOOKING_SNAPSHOT_MISSING',
            'The immutable booking policy snapshot is unavailable.',
            HttpStatus.CONFLICT,
          );
        }
        if (!existingUsage) {
          const usage = calculateBookingUsage({
            actualReturnAt: occurredAt,
            decision: InspectionConfirmationDecision.AGREED,
            pickup: {
              batterySocBasisPoints: effectivePickup.batterySocBasisPoints,
              fuelBasisPoints: effectivePickup.fuelBasisPoints,
              odometerMeters: effectivePickup.odometerMeters,
            },
            policy: booking.policySnapshot,
            pricing: booking.pricingSnapshot,
            returned: {
              batterySocBasisPoints: returned.batterySocBasisPoints,
              fuelBasisPoints: returned.fuelBasisPoints,
              odometerMeters: returned.odometerMeters,
            },
            scheduledReturnAt: booking.rentalEnd,
          });
          await transaction.bookingUsageSummary.create({
            data: { bookingId: booking.id, id: randomUUID(), ...usage },
          });
        }
        const claimDeadlineAt = new Date(
          occurredAt.getTime() + booking.policySnapshot.claimWindowHours * 60 * 60 * 1000,
        );
        await transaction.booking.update({
          data: { actualReturnAt: occurredAt, claimDeadlineAt, status: BookingStatus.RETURNED },
          where: { id: booking.id },
        });
        await this.extendOccupancyOrEscalate(transaction, booking, occurredAt);
        await this.history(
          transaction,
          booking.id,
          BookingStatus.RETURN_PENDING,
          BookingStatus.RETURNED,
          BookingActorType.ADMIN,
          principal.userId,
          'ADMIN_RETURN_CONFIRMED',
          metadata,
        );
        await this.outbox(transaction, booking.id, 'RETURN_ADMIN_RESOLVED', {
          actualReturnAt: occurredAt.toISOString(),
          bookingId: booking.id,
          claimDeadlineAt: claimDeadlineAt.toISOString(),
        });
      }
      if (input.incidentId) {
        await transaction.rentalIncident.update({
          data: { resolvedAt: new Date(), status: RentalIncidentStatus.RESOLVED },
          where: { id: input.incidentId },
        });
      }
    });
    await this.audit.record({
      action: 'ADMIN_RETURN_CONFIRMED',
      actorUserId: principal.userId,
      metadata: { incidentId: input.incidentId ?? null, occurredAt: occurredAt.toISOString() },
      reason: input.reason,
      request: metadata,
      targetId: reference,
      targetType: 'BOOKING',
    });
    return this.adminDetail(reference);
  }

  async setIncidentStatus(
    principal: RequestPrincipal,
    incidentId: string,
    input: IncidentStatusDto,
    metadata: RequestMetadata,
  ) {
    if (input.status === RentalIncidentStatus.OPEN) {
      throw new ApplicationException(
        'INCIDENT_STATUS_INVALID',
        'Administrative commands cannot reopen incidents during Phase 7.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const incident = await this.database.client.rentalIncident.update({
      data: {
        resolvedAt:
          input.status === RentalIncidentStatus.RESOLVED ||
          input.status === RentalIncidentStatus.DISMISSED
            ? new Date()
            : null,
        status: input.status,
      },
      where: { id: incidentId },
    });
    await this.audit.record({
      action: 'RENTAL_INCIDENT_STATUS_CHANGED',
      actorUserId: principal.userId,
      metadata: { status: input.status },
      reason: input.reason,
      request: metadata,
      targetId: incident.id,
      targetType: 'RENTAL_INCIDENT',
    });
    return this.toSerializable(incident);
  }

  private async evaluateReadiness(reference: string) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      await this.ensureReady(transaction, booking);
    });
  }

  private async ensureReady<
    T extends {
      id: string;
      status: BookingStatus;
      rentalStart: Date;
      pickupWindowStart: Date | null;
      pickupWindowEnd: Date | null;
    },
  >(transaction: Prisma.TransactionClient, booking: T): Promise<T> {
    if (booking.status !== BookingStatus.CONFIRMED) return booking;
    const pickupWindowStart =
      booking.pickupWindowStart ??
      new Date(booking.rentalStart.getTime() - this.pickupEarlyMinutes * 60_000);
    const pickupWindowEnd =
      booking.pickupWindowEnd ??
      new Date(booking.rentalStart.getTime() + this.pickupGraceMinutes * 60_000);
    const ready = Date.now() >= pickupWindowStart.getTime();
    await transaction.booking.update({
      data: {
        pickupWindowEnd,
        pickupWindowStart,
        ...(ready ? { status: BookingStatus.READY_FOR_PICKUP } : {}),
      },
      where: { id: booking.id },
    });
    if (ready) {
      await this.history(
        transaction,
        booking.id,
        BookingStatus.CONFIRMED,
        BookingStatus.READY_FOR_PICKUP,
        BookingActorType.SYSTEM,
        null,
        'PICKUP_WINDOW_OPENED',
        {},
      );
      await this.outbox(transaction, booking.id, 'PICKUP_WINDOW_OPENED', { bookingId: booking.id });
    }
    return {
      ...booking,
      pickupWindowEnd,
      pickupWindowStart,
      ...(ready ? { status: BookingStatus.READY_FOR_PICKUP } : {}),
    };
  }

  private assertPickupWindow(booking: {
    pickupWindowStart: Date | null;
    pickupWindowEnd: Date | null;
  }) {
    const now = Date.now();
    if (
      !booking.pickupWindowStart ||
      !booking.pickupWindowEnd ||
      now < booking.pickupWindowStart.getTime()
    ) {
      throw new ApplicationException(
        'PICKUP_WINDOW_NOT_OPEN',
        'The pickup window has not opened.',
        HttpStatus.CONFLICT,
      );
    }
    // The end boundary governs overdue reminders, not workflow expiry. Lifecycle,
    // travel, holds, review and challenge-expiry checks remain independently enforced.
  }

  private async extendOccupancyOrEscalate(
    transaction: Prisma.TransactionClient,
    booking: Prisma.BookingGetPayload<{
      include: { occupancy: true; policySnapshot: true; pricingSnapshot: true; vehicle: true };
    }>,
    actualReturnAt: Date,
  ) {
    if (!booking.occupancy || !booking.policySnapshot) return;
    const desiredEnd = new Date(
      actualReturnAt.getTime() + booking.policySnapshot.turnaroundMinutes * 60_000,
    );
    if (desiredEnd <= booking.occupancy.occupiedEnd) return;
    const conflicts = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "vehicle_occupancies"
      WHERE "vehicle_id" = ${booking.vehicleId}::uuid
        AND "id" <> ${booking.occupancy.id}::uuid
        AND "active"
        AND "occupied_period" && tstzrange(${booking.occupancy.occupiedStart}, ${desiredEnd}, '[)')
      FOR UPDATE
    `);
    if (conflicts.length === 0) {
      await transaction.vehicleOccupancy.update({
        data: { occupiedEnd: desiredEnd },
        where: { id: booking.occupancy.id },
      });
      return;
    }
    const incident = await transaction.rentalIncident.create({
      data: {
        blocksCompletion: true,
        bookingId: booking.id,
        category: RentalIncidentCategory.DOWNSTREAM_BOOKING_CONFLICT,
        description:
          'Late return overlaps a downstream reservation. Operations intervention is required.',
        id: randomUUID(),
        reportedByUserId: booking.ownerUserId,
        severity: RentalIncidentSeverity.CRITICAL,
      },
    });
    await this.outbox(transaction, booking.id, 'DOWNSTREAM_BOOKING_CONFLICT', {
      bookingId: booking.id,
      conflictingOccupancyIds: conflicts.map(({ id }) => id),
      incidentId: incident.id,
    });
  }

  private async validateInspectionFiles(
    transaction: Prisma.TransactionClient,
    userId: string,
    input: SubmitInspectionDto,
  ) {
    await this.validateEvidenceFiles(
      transaction,
      userId,
      input.media.map(({ fileAssetId }) => fileAssetId),
    );
  }

  private async validateEvidenceFiles(
    transaction: Prisma.TransactionClient,
    userId: string,
    ids: string[],
  ) {
    if (new Set(ids).size !== ids.length) {
      throw new ApplicationException(
        'EVIDENCE_DUPLICATE',
        'Evidence files must be unique.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (ids.length === 0) return;
    const assets = await transaction.fileAsset.findMany({ where: { id: { in: ids } } });
    const valid =
      assets.length === ids.length &&
      assets.every(
        (asset) =>
          asset.uploadedById === userId &&
          asset.status === FileAssetStatus.READY &&
          asset.classification !== FileClassification.PUBLIC &&
          asset.mimeType.startsWith('image/') &&
          asset.size <= 20_000_000n,
      );
    if (!valid) {
      throw new ApplicationException(
        'EVIDENCE_FILE_INVALID',
        'Evidence must be a ready private image uploaded by the submitting participant.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private validatePerspectives(input: SubmitInspectionDto) {
    for (const perspective of requiredPerspectives) {
      if (input.media.filter((item) => item.perspective === perspective).length !== 1) {
        throw new ApplicationException(
          'INSPECTION_MEDIA_INCOMPLETE',
          `Exactly one ${perspective} image is required.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const interiorCount = input.media.filter(
      (item) =>
        item.perspective === InspectionPerspective.INTERIOR_DASHBOARD ||
        item.perspective === InspectionPerspective.INTERIOR,
    ).length;
    const dashboardCount = input.media.filter(
      (item) =>
        item.perspective === InspectionPerspective.INTERIOR_DASHBOARD ||
        item.perspective === InspectionPerspective.DASHBOARD,
    ).length;
    if (interiorCount < 1 || dashboardCount < 1) {
      throw new ApplicationException(
        'INSPECTION_MEDIA_INCOMPLETE',
        'At least one interior and one dashboard image are required.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private validateConditionDisclosure(input: SubmitInspectionDto) {
    const issues = input.conditionIssues ?? [];
    if (
      !input.conditionDisclosureState ||
      input.conditionDisclosureState === InspectionConditionDisclosureState.NOT_REVIEWED
    ) {
      throw new ApplicationException(
        'INSPECTION_CONDITION_DISCLOSURE_REQUIRED',
        'Declare no known existing issues or report the known issues before finalizing.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.conditionDisclosureState === InspectionConditionDisclosureState.NO_KNOWN_ISSUES &&
      issues.length
    ) {
      throw new ApplicationException(
        'INSPECTION_CONDITION_DISCLOSURE_INVALID',
        'No issues may be supplied with a no-known-issues declaration.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.conditionDisclosureState === InspectionConditionDisclosureState.ISSUES_REPORTED &&
      !issues.length
    ) {
      throw new ApplicationException(
        'INSPECTION_CONDITION_DISCLOSURE_INVALID',
        'At least one structured issue is required when issues are reported.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private assertNoSafetyCriticalCondition(
    issues: readonly { classification: InspectionConditionClassification }[],
  ) {
    if (
      issues.some(
        ({ classification }) =>
          classification === InspectionConditionClassification.SAFETY_CRITICAL,
      )
    ) {
      throw new ApplicationException(
        'PICKUP_SAFETY_CRITICAL_CONDITION',
        'Handover is blocked until the safety-critical condition is handled by maintenance or Operations.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private discrepancyAllowsHandover(
    review:
      | {
          decision: PickupDiscrepancyResolutionDecision;
          operationsResolution?: { outcome: PickupHandoverOperationsOutcome } | null;
        }
      | null
      | undefined,
  ) {
    return (
      review?.decision === PickupDiscrepancyResolutionDecision.ACCEPTED ||
      (review?.decision === PickupDiscrepancyResolutionDecision.STILL_DISAGREES &&
        review.operationsResolution?.outcome ===
          PickupHandoverOperationsOutcome.HANDOVER_MAY_RESUME)
    );
  }

  private async assertHandoverAvailable(transaction: Prisma.TransactionClient, bookingId: string) {
    const [booking, blockingIncidents, blockingDisputes] = await Promise.all([
      transaction.booking.findUniqueOrThrow({
        select: { operationalHold: true, vehicle: { select: { operationalStatus: true } } },
        where: { id: bookingId },
      }),
      transaction.rentalIncident.count({
        where: {
          bookingId,
          blocksCompletion: true,
          status: { in: [RentalIncidentStatus.OPEN, RentalIncidentStatus.ACKNOWLEDGED] },
        },
      }),
      transaction.dispute.count({
        where: {
          bookingId,
          blocksCompletion: true,
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.EVIDENCE_COLLECTION, DisputeStatus.UNDER_REVIEW],
          },
        },
      }),
    ]);
    if (
      booking.operationalHold ||
      booking.vehicle.operationalStatus === VehicleOperationalStatus.MAINTENANCE ||
      blockingIncidents ||
      blockingDisputes
    )
      throw new ApplicationException(
        'PICKUP_OPERATIONS_HOLD',
        'Handover is paused for Operations review.',
        HttpStatus.CONFLICT,
      );
  }

  private validatePowertrainMeasurements(
    powertrain: 'ICE' | 'HYBRID' | 'PLUG_IN_HYBRID' | 'BATTERY_ELECTRIC' | null,
    input: SubmitInspectionDto,
  ) {
    const fuelRequired =
      powertrain === 'ICE' || powertrain === 'HYBRID' || powertrain === 'PLUG_IN_HYBRID';
    const socRequired = powertrain === 'BATTERY_ELECTRIC' || powertrain === 'PLUG_IN_HYBRID';
    if (
      !powertrain ||
      (fuelRequired && input.fuelBasisPoints === undefined) ||
      (socRequired && input.batterySocBasisPoints === undefined)
    ) {
      throw new ApplicationException(
        'INSPECTION_MEASUREMENT_REQUIRED',
        'Inspection measurements do not satisfy the vehicle powertrain requirements.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      (powertrain === 'BATTERY_ELECTRIC' && input.fuelBasisPoints !== undefined) ||
      ((powertrain === 'ICE' || powertrain === 'HYBRID') &&
        input.batterySocBasisPoints !== undefined)
    ) {
      throw new ApplicationException(
        'INSPECTION_MEASUREMENT_NOT_APPLICABLE',
        'Inspection includes a measurement that does not apply to this powertrain.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private async lockBooking(transaction: Prisma.TransactionClient, reference: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "bookings" WHERE "public_reference" = ${reference} FOR UPDATE
    `);
    if (!rows[0])
      throw new ApplicationException(
        'BOOKING_NOT_FOUND',
        'Booking was not found.',
        HttpStatus.NOT_FOUND,
      );
  }

  private async assertNoBlockingAcceptedAmendment(
    transaction: Prisma.TransactionClient,
    bookingId: string,
  ) {
    if (await hasBlockingAcceptedBookingAmendment(transaction, bookingId))
      this.invalidState('An accepted booking change is still processing.');
  }

  private history(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    fromStatus: BookingStatus,
    toStatus: BookingStatus,
    actorType: BookingActorType,
    actorUserId: string | null,
    reasonCode: string,
    metadata: RequestMetadata,
  ) {
    return transaction.bookingStatusHistory.create({
      data: {
        actorType,
        actorUserId,
        bookingId,
        correlationId: metadata.correlationId ?? null,
        fromStatus,
        reasonCode,
        toStatus,
      },
    });
  }

  private outbox(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    eventType: string,
    payload: Prisma.InputJsonValue,
  ) {
    return transaction.outboxEvent.create({
      data: { aggregateId: bookingId, aggregateType: 'BOOKING', eventType, payload },
    });
  }

  private analytics(
    transaction: Prisma.TransactionClient,
    booking: { id: string; renterUserId: string; vehicleId: string },
    eventType: string,
    metadata: RequestMetadata,
  ) {
    return transaction.analyticsEvent.create({
      data: {
        bookingId: booking.id,
        correlationId: metadata.correlationId ?? null,
        eventType,
        metadata: {},
        userId: booking.renterUserId,
        vehicleId: booking.vehicleId,
      },
    });
  }

  private load(reference: string) {
    return this.database.client.booking.findUniqueOrThrow({
      include: rentalInclude,
      where: { publicReference: reference },
    });
  }

  private async participantDetailById(userId: string, reference: string) {
    const booking = await this.load(reference);
    this.assertParticipant(booking, userId);
    return this.serialize(booking);
  }

  private async ownerDetailById(userId: string, reference: string) {
    const booking = await this.load(reference);
    if (booking.ownerUserId !== userId) this.denied();
    return this.serialize(booking);
  }

  private async serialize(booking: RentalRecord) {
    const [compliance] = await this.database.client.$queryRaw<{ blocker: string | null }[]>(
      Prisma.sql`SELECT "booking_workflow_compliance_blocker"(${booking.id}::uuid) AS blocker`,
    );
    const fulfillment = booking.fulfillmentSnapshot;
    const location = (prefix: 'start' | 'end') =>
      fulfillment
        ? {
            addressLine1: fulfillment[`${prefix}AddressLine1`],
            barangay: fulfillment[`${prefix}Barangay`],
            city: fulfillment[`${prefix}City`],
            country: fulfillment[`${prefix}Country`],
            latitude: Number(fulfillment[`${prefix}Latitude`]),
            longitude: Number(fulfillment[`${prefix}Longitude`]),
            postalCode: fulfillment[`${prefix}PostalCode`],
            province: fulfillment[`${prefix}Province`],
          }
        : null;
    const events = booking.handoverTravelEvents.map((event) => ({
      actorUserId: event.actorUserId,
      occurredAt: event.occurredAt,
      phase: event.phase,
      status: event.status,
    }));
    const inspections = booking.inspections.map((inspection) => ({
      ...inspection,
      confirmations: inspection.confirmations.map((confirmation) => ({
        ...confirmation,
        discrepancyResponse: confirmation.discrepancyResponses.at(-1) ?? null,
        discrepancyResponses: confirmation.discrepancyResponses,
      })),
    }));
    const rentalIncidents = booking.rentalIncidents.map((incident) => ({
      ...incident,
      pickupDiscrepancyResponse: incident.pickupDiscrepancyResponses.at(-1) ?? null,
      pickupDiscrepancyResponses: incident.pickupDiscrepancyResponses,
    }));
    const overdueHandoverRecovery = currentOverdueHandoverRecovery(
      booking.overdueHandoverRecoveries,
    );
    return this.toSerializable({
      ...booking,
      overdueHandoverRecovery,
      workflowCompliance: workflowCompliance(
        booking,
        this.returnConfirmationGraceMinutes,
        compliance?.blocker ?? null,
      ),
      inspections,
      rentalIncidents,
      fulfillment: fulfillment
        ? {
            endLocation: location('end'),
            endMethod: fulfillment.endMethod,
            legacyCompatibility: false,
            startLocation: location('start'),
            startMethod: fulfillment.startMethod,
          }
        : {
            endLocation: null,
            endMethod: EndFulfillmentMethod.RENTER_RETURN,
            legacyCompatibility: true,
            startLocation: null,
            startMethod: StartFulfillmentMethod.RENTER_PICKUP,
          },
      handoverTravel: {
        events,
        returnStatus:
          [...events].reverse().find(({ phase }) => phase === HandoverPhase.RETURN)?.status ?? null,
        startStatus:
          [...events].reverse().find(({ phase }) => phase === HandoverPhase.START)?.status ?? null,
      },
      pickupVerification: {
        configuredMaxAttempts: this.challengeMaxAttempts,
        ttlMinutes: this.challengeTtlMinutes,
      },
      operationalPolicy: {
        returnConfirmationGraceMinutes: this.returnConfirmationGraceMinutes,
      },
    });
  }

  private effectiveInspection(inspection: {
    readonly odometerMeters: bigint | null;
    readonly fuelBasisPoints: number | null;
    readonly batterySocBasisPoints: number | null;
    readonly amendments: ReadonlyArray<{
      readonly proposedOdometerMeters: bigint | null;
      readonly proposedFuelBasisPoints: number | null;
      readonly proposedBatterySocBasisPoints: number | null;
    }>;
  }) {
    const amendment = inspection.amendments[0];
    return {
      batterySocBasisPoints:
        amendment?.proposedBatterySocBasisPoints ?? inspection.batterySocBasisPoints,
      fuelBasisPoints: amendment?.proposedFuelBasisPoints ?? inspection.fuelBasisPoints,
      odometerMeters: amendment?.proposedOdometerMeters ?? inspection.odometerMeters,
    };
  }

  private toSerializable<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (key, item: unknown) =>
        key === 'handoverWorkflowVersion'
          ? undefined
          : typeof item === 'bigint'
            ? item.toString()
            : item,
      ),
    ) as T;
  }

  private assertParticipant(
    booking: { ownerUserId: string; renterUserId: string },
    userId: string,
  ) {
    if (booking.ownerUserId !== userId && booking.renterUserId !== userId) this.denied();
  }

  private denied(): never {
    throw new ApplicationException(
      'PERMISSION_DENIED',
      'You are not authorized for this rental.',
      HttpStatus.FORBIDDEN,
    );
  }

  private invalidState(message: string): never {
    throw new ApplicationException('RENTAL_STATE_INVALID', message, HttpStatus.CONFLICT);
  }
}
