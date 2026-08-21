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
  InspectionConfirmationDecision,
  InspectionParticipantRole,
  InspectionPerspective,
  InspectionStatus,
  InspectionType,
  OwnerProfileStatus,
  Prisma,
  RentalIncidentCategory,
  RentalIncidentSeverity,
  RentalIncidentStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata, RequestPrincipal } from '../security/security-context';
import type {
  CreateClaimDto,
  CreateIncidentDto,
  IncidentStatusDto,
  OperationalHoldDto,
  ReturnConfirmationDto,
  SubmitInspectionDto,
} from './rentals.dto';
import { calculateBookingUsage } from './usage-calculation';

const requiredPerspectives = [
  InspectionPerspective.FRONT,
  InspectionPerspective.REAR,
  InspectionPerspective.DRIVER_SIDE,
  InspectionPerspective.PASSENGER_SIDE,
  InspectionPerspective.INTERIOR_DASHBOARD,
  InspectionPerspective.ODOMETER,
  InspectionPerspective.FUEL_OR_BATTERY_DISPLAY,
] as const;

const rentalInclude = {
  inspections: {
    include: {
      confirmations: { orderBy: { confirmedAt: 'asc' as const } },
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
    include: { evidence: { include: { fileAsset: { select: { id: true } } } } },
    orderBy: { reportedAt: 'asc' as const },
  },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
  usageSummary: true,
  vehicle: {
    select: {
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

@Injectable()
export class RentalsService {
  private readonly pickupEarlyMinutes: number;
  private readonly pickupGraceMinutes: number;
  private readonly challengeTtlMinutes: number;
  private readonly challengeMaxAttempts: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
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

  async submitInspection(
    ownerUserId: string,
    reference: string,
    type: InspectionType,
    input: SubmitInspectionDto,
    metadata: RequestMetadata,
  ) {
    const inspectionId = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      let booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true, vehicle: true },
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
      await this.validateInspectionFiles(transaction, ownerUserId, input);
      this.validatePerspectives(input);
      const existing = await transaction.inspection.findFirst({
        where: { bookingId: booking.id, status: InspectionStatus.FINALIZED, type },
      });
      if (existing) return existing.id;
      const inspection = await transaction.inspection.create({
        data: {
          batterySocBasisPoints: input.batterySocBasisPoints ?? null,
          bookingId: booking.id,
          fuelBasisPoints: input.fuelBasisPoints ?? null,
          id: randomUUID(),
          notes: input.notes ?? null,
          odometerMeters: BigInt(input.odometerMeters),
          submittedByUserId: ownerUserId,
          type,
        },
      });
      await transaction.inspectionMedia.createMany({
        data: input.media.map((media) => ({
          clientCapturedAt: media.clientCapturedAt ? new Date(media.clientCapturedAt) : null,
          evidenceSequence: media.evidenceSequence ?? 1,
          fileAssetId: media.fileAssetId,
          id: randomUUID(),
          inspectionId: inspection.id,
          perspective: media.perspective,
          submittedById: ownerUserId,
        })),
      });
      await transaction.inspection.update({
        data: { finalizedAt: new Date(), status: InspectionStatus.FINALIZED },
        where: { id: inspection.id },
      });
      await transaction.inspectionConfirmation.create({
        data: {
          decision: InspectionConfirmationDecision.AGREED,
          id: randomUUID(),
          inspectionId: inspection.id,
          role: InspectionParticipantRole.OWNER,
          userId: ownerUserId,
        },
      });
      await this.outbox(transaction, booking.id, `${type}_INSPECTION_SUBMITTED`, {
        bookingId: booking.id,
        inspectionId: inspection.id,
      });
      await this.analytics(transaction, booking, `${type}_INSPECTION_SUBMITTED`, metadata);
      return inspection.id;
    });
    return { inspectionId, rental: await this.ownerDetailById(ownerUserId, reference) };
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
      this.assertPickupWindow(booking);
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Pickup confirmation requires a booking ready for pickup.');
      }
      const inspection = await transaction.inspection.findFirst({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      if (!inspection) {
        throw new ApplicationException(
          'PICKUP_INSPECTION_REQUIRED',
          'Review the finalized pickup inspection before confirming handover.',
          HttpStatus.CONFLICT,
        );
      }
      const confirmation = await transaction.inspectionConfirmation.findUnique({
        where: {
          inspectionId_role: {
            inspectionId: inspection.id,
            role: InspectionParticipantRole.RENTER,
          },
        },
      });
      if (!confirmation) {
        await transaction.inspectionConfirmation.create({
          data: {
            decision: InspectionConfirmationDecision.AGREED,
            id: randomUUID(),
            inspectionId: inspection.id,
            role: InspectionParticipantRole.RENTER,
            userId: renterUserId,
          },
        });
      }
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
  ) {
    const result = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: { ownerProfile: true },
        where: { publicReference: reference },
      });
      if (booking.ownerUserId !== ownerUserId) this.denied();
      if (booking.ownerProfile.status !== OwnerProfileStatus.VERIFIED) this.denied();
      if (booking.status === BookingStatus.ACTIVE) {
        return { error: 'PICKUP_CODE_REUSED' as const };
      }
      if (booking.status !== BookingStatus.READY_FOR_PICKUP) {
        this.invalidState('Booking is not ready for pickup verification.');
      }
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
      const inspection = await transaction.inspection.findFirstOrThrow({
        include: { confirmations: true },
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
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
      const now = new Date();
      await transaction.inspectionVerificationChallenge.update({
        data: { consumedAt: now, consumedByUserId: ownerUserId },
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
        ownerUserId,
        'PICKUP_CONFIRMED',
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

  async initiateReturn(userId: string, reference: string, metadata: RequestMetadata) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      this.assertParticipant(booking, userId);
      if (booking.status === BookingStatus.RETURN_PENDING) return;
      if (booking.status !== BookingStatus.ACTIVE) {
        this.invalidState('Only an active rental can begin return.');
      }
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
        userId,
        'RETURN_STARTED',
        metadata,
      );
      await this.outbox(transaction, booking.id, 'RETURN_STARTED', { bookingId: booking.id });
      await this.analytics(transaction, booking, 'RETURN_STARTED', metadata);
    });
    return this.participantDetailById(userId, reference);
  }

  async confirmReturn(
    renterUserId: string,
    reference: string,
    input: ReturnConfirmationDto,
    metadata: RequestMetadata,
  ) {
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
      if (booking.renterUserId !== renterUserId) this.denied();
      if (booking.status === BookingStatus.RETURNED) {
        const finalizedReturn = await transaction.inspection.findFirst({
          include: { confirmations: true },
          where: {
            bookingId: booking.id,
            status: InspectionStatus.FINALIZED,
            type: InspectionType.RETURN,
          },
        });
        const confirmation = finalizedReturn?.confirmations.find(
          ({ role }) => role === InspectionParticipantRole.RENTER,
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
      const pickup = await transaction.inspection.findFirstOrThrow({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.PICKUP,
        },
      });
      const returned = await transaction.inspection.findFirstOrThrow({
        where: {
          bookingId: booking.id,
          status: InspectionStatus.FINALIZED,
          type: InspectionType.RETURN,
        },
      });
      const existing = await transaction.inspectionConfirmation.findUnique({
        where: {
          inspectionId_role: { inspectionId: returned.id, role: InspectionParticipantRole.RENTER },
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
            role: InspectionParticipantRole.RENTER,
            userId: renterUserId,
          },
        });
      }
      if (pickup.odometerMeters === null || returned.odometerMeters === null) {
        throw new ApplicationException(
          'INSPECTION_MEASUREMENT_REQUIRED',
          'Both inspections require odometer measurements.',
          HttpStatus.CONFLICT,
        );
      }
      if (returned.odometerMeters < pickup.odometerMeters) {
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
      const usage = calculateBookingUsage({
        actualReturnAt: now,
        decision: input.decision,
        pickup: {
          batterySocBasisPoints: pickup.batterySocBasisPoints,
          fuelBasisPoints: pickup.fuelBasisPoints,
          odometerMeters: pickup.odometerMeters,
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
      if (input.decision === InspectionConfirmationDecision.DISAGREED) {
        const dispute = await transaction.dispute.create({
          data: {
            blocksCompletion: true,
            bookingId: booking.id,
            openedByUserId: renterUserId,
            originType: DisputeOriginType.OTHER,
            reason: input.reason ?? 'Renter disputed the recorded return measurements.',
            status: DisputeStatus.EVIDENCE_COLLECTION,
          },
        });
        const earning = await transaction.ownerEarning.findUnique({
          where: { bookingId: booking.id },
        });
        if (earning) {
          const exposure =
            earning.netEarningAmountMinor +
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
        renterUserId,
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
    return this.participantDetailById(renterUserId, reference);
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
  ) {
    const incident = await this.database.client.$transaction(async (transaction) => {
      await this.lockBooking(transaction, reference);
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { publicReference: reference },
      });
      this.assertParticipant(booking, userId);
      if (
        !new Set<BookingStatus>([
          BookingStatus.READY_FOR_PICKUP,
          BookingStatus.ACTIVE,
          BookingStatus.RETURN_PENDING,
        ]).has(booking.status)
      ) {
        this.invalidState('Incidents can be reported during pickup, active rental, or return.');
      }
      await this.validateEvidenceFiles(transaction, userId, input.evidenceFileIds ?? []);
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
          reportedByUserId: userId,
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
    return bookings.map((booking) => this.serialize(booking));
  }

  async adminDetail(reference: string) {
    return this.serialize(await this.load(reference));
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
    if (now > booking.pickupWindowEnd.getTime()) {
      throw new ApplicationException(
        'PICKUP_WINDOW_CLOSED',
        'The pickup grace period has ended. Report a no-show or contact operations.',
        HttpStatus.CONFLICT,
      );
    }
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

  private serialize(booking: RentalRecord) {
    return this.toSerializable({
      ...booking,
      pickupVerification: {
        configuredMaxAttempts: this.challengeMaxAttempts,
        ttlMinutes: this.challengeTtlMinutes,
      },
    });
  }

  private toSerializable<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
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
