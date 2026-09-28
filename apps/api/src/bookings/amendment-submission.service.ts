import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentStatus,
  Prisma,
  VehicleOccupancyType,
} from '@carrental/database';
import { BookingErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { AvailabilityService } from '../discovery/availability.service';
import { PRICING_ENGINE_VERSION } from '../discovery/duration.service';
import { FulfillmentServiceabilityService } from '../fulfillment/fulfillment-serviceability';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import { amendmentHoldDifference } from './amendment-hold-difference';
import {
  AMENDMENT_PREVIEW_INCLUDE,
  AmendmentPreviewService,
  calculateAmendmentCommission,
  type AmendmentPreviewClaims,
  type PreviewBooking,
} from './amendment-preview.service';
import {
  BOOKING_AMENDMENT_POLICY_VERSION,
  unresolvedBookingAmendmentStatuses,
} from './booking-amendment-foundation';
import { OccupancyService } from './occupancy.service';
import { OutboxService } from './outbox.service';

const FULFILLMENT_CALCULATION_VERSION = 'BOOKING_AMENDMENT_FULFILLMENT_V1';

const RESULT_INCLUDE = {
  fulfillmentSnapshot: true,
  holds: { include: { occupancy: true }, orderBy: { protectedStart: 'asc' as const } },
  pricingSnapshot: true,
  settlement: true,
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
} satisfies Prisma.BookingAmendmentInclude;

type SubmissionResult = Prisma.BookingAmendmentGetPayload<{ include: typeof RESULT_INCLUDE }>;

@Injectable()
export class AmendmentSubmissionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly previews: AmendmentPreviewService,
    private readonly availability: AvailabilityService,
    private readonly fulfillment: FulfillmentServiceabilityService,
    private readonly occupancy: OccupancyService,
    private readonly outbox: OutboxService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async submitRenter(
    renterUserId: string,
    reference: string,
    previewToken: string,
    idempotencyKey: string,
    request: RequestMetadata,
    evaluatedAt = new Date(),
  ) {
    const inspected = this.previews.inspectPreviewToken(previewToken, renterUserId, reference);
    const requestHash = submissionHash(inspected);
    const replay = await this.findReplay(renterUserId, idempotencyKey, requestHash);
    if (replay) return this.project(replay);

    const claims = await this.previews.verifyPreviewToken(
      previewToken,
      renterUserId,
      reference,
      evaluatedAt,
    );
    try {
      const amendmentId = await this.database.client.$transaction(
        async (transaction) => {
          const existing = await transaction.bookingAmendment.findUnique({
            include: RESULT_INCLUDE,
            where: {
              requesterUserId_idempotencyKey: { idempotencyKey, requesterUserId: renterUserId },
            },
          });
          if (existing) {
            this.assertSameRequest(existing.requestHash, requestHash);
            return existing.id;
          }
          const booking = await transaction.booking.findFirst({
            include: AMENDMENT_PREVIEW_INCLUDE,
            where: { id: claims.bookingId, publicReference: reference, renterUserId },
          });
          if (!booking)
            throw new ApplicationException(
              BookingErrorCode.BOOKING_NOT_FOUND,
              'Booking not found.',
              HttpStatus.NOT_FOUND,
            );
          this.previews.assertSubmissionAuthority(claims, booking, evaluatedAt);
          this.previews.assertSubmissionFulfillmentRemovalAllowed(booking, claims.proposal);
          if (
            booking.amendments.some((item) =>
              unresolvedBookingAmendmentStatuses.includes(
                item.status as (typeof unresolvedBookingAmendmentStatuses)[number],
              ),
            )
          )
            this.pendingConflict();

          const originalPolicy = await transaction.vehiclePolicyVersion.findUniqueOrThrow({
            where: { id: booking.pricingSnapshot!.policyVersionId },
          });
          await this.revalidateFulfillment(transaction, booking, claims, evaluatedAt);
          const availabilityConflict = await this.availability.occupancyConflict(
            {
              end: new Date(claims.proposal.rentalEnd),
              excludeBookingId: booking.id,
              start: new Date(claims.proposal.rentalStart),
              turnaroundMinutes: originalPolicy.turnaroundMinutes,
              vehicleId: booking.vehicleId,
            },
            transaction,
          );
          if (availabilityConflict) this.inventoryConflict();

          const evidence = this.snapshotEvidence(
            booking,
            claims,
            originalPolicy.dailyRateMinor,
            requestHash,
          );
          const submittedAt = evaluatedAt;
          const expiresAt = new Date(
            submittedAt.getTime() +
              this.configuration.getOrThrow('AMENDMENT_OWNER_RESPONSE_TTL_MINUTES', {
                infer: true,
              }) *
                60_000,
          );
          const correlationId = request.correlationId ?? idempotencyKey;
          const amendment = await transaction.bookingAmendment.create({
            data: {
              bookingId: booking.id,
              correlationId,
              expiresAt,
              idempotencyKey,
              policyVersion: BOOKING_AMENDMENT_POLICY_VERSION,
              proposedEndMethod: claims.proposal.endMethod,
              proposedRentalEnd: new Date(claims.proposal.rentalEnd),
              proposedRentalStart: new Date(claims.proposal.rentalStart),
              proposedStartMethod: claims.proposal.startMethod,
              requestHash,
              requesterUserId: renterUserId,
              scope: 'PRE_TRIP',
              sourcePricingPolicyVersionId: booking.pricingSnapshot!.policyVersionId,
              status: BookingAmendmentStatus.PENDING_OWNER,
              fulfillmentSnapshot: { create: evidence.fulfillment },
              pricingSnapshot: { create: evidence.pricing },
              settlement: { create: evidence.settlement },
              statusHistory: {
                create: {
                  actorType: BookingActorType.USER,
                  actorUserId: renterUserId,
                  correlationId,
                  idempotencyKey: `${idempotencyKey}:initial`,
                  reasonCode: 'RENTER_CHANGE_REQUESTED',
                  toStatus: BookingAmendmentStatus.PENDING_OWNER,
                },
              },
            },
          });

          const current = claims.authority.current;
          const intervals = amendmentHoldDifference({
            currentEnd: new Date(current.rentalEnd),
            currentStart: new Date(current.rentalStart),
            proposedEnd: new Date(claims.proposal.rentalEnd),
            proposedStart: new Date(claims.proposal.rentalStart),
            turnaroundMinutes: originalPolicy.turnaroundMinutes,
          });
          for (const [index, interval] of intervals.entries()) {
            const occupancy = await transaction.vehicleOccupancy.create({
              data: {
                active: true,
                expiresAt,
                occupiedEnd: interval.end,
                occupiedStart: interval.start,
                type: VehicleOccupancyType.AMENDMENT_HOLD,
                vehicleId: booking.vehicleId,
              },
            });
            await transaction.bookingAmendmentHold.create({
              data: {
                amendmentId: amendment.id,
                correlationId,
                expiresAt,
                idempotencyKey: `${amendment.id}:hold:${index}`,
                occupancyId: occupancy.id,
                protectedEnd: interval.end,
                protectedStart: interval.start,
                status: 'ACTIVE',
                vehicleId: booking.vehicleId,
              },
            });
          }
          await this.outbox.write(transaction, {
            aggregateId: booking.id,
            eventType: 'BOOKING_AMENDMENT_REQUESTED',
            payload: {
              amendmentId: amendment.id,
              bookingId: booking.id,
              correlationId,
              ownerUserId: booking.ownerUserId,
              requesterUserId: renterUserId,
            },
          });
          return amendment.id;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );
      const result = await this.database.client.bookingAmendment.findUniqueOrThrow({
        include: RESULT_INCLUDE,
        where: { id: amendmentId },
      });
      return this.project(result);
    } catch (error) {
      const replayAfterRace = await this.findReplay(renterUserId, idempotencyKey, requestHash);
      if (replayAfterRace) return this.project(replayAfterRace);
      const unresolved = await this.database.client.bookingAmendment.findFirst({
        select: { id: true },
        where: {
          bookingId: claims.bookingId,
          status: { in: [...unresolvedBookingAmendmentStatuses] },
        },
      });
      if (unresolved) this.pendingConflict();
      if (this.isOneActiveConflict(error)) this.pendingConflict();
      if (this.occupancy.isExclusionConflict(error) || this.isSerializationFailure(error))
        this.inventoryConflict();
      throw error;
    }
  }

  private snapshotEvidence(
    booking: PreviewBooking,
    claims: AmendmentPreviewClaims,
    dailyRateMinor: number,
    requestHash: string,
  ) {
    const latestApplied = booking.amendments
      .filter((item) => item.status === BookingAmendmentStatus.APPLIED)
      .toSorted(
        (left, right) =>
          (left.appliedAt?.getTime() ?? 0) - (right.appliedAt?.getTime() ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .at(-1);
    const currentFulfillment = BigInt(
      latestApplied?.fulfillmentSnapshot?.proposedFulfillmentTotalMinor ??
        booking.fulfillmentSnapshot!.deliveryFeeMinor +
          booking.fulfillmentSnapshot!.collectionFeeMinor,
    );
    const currentTotal = BigInt(claims.authority.current.totalMinor);
    const proposedRental = BigInt(claims.authority.proposed.rentalMinor);
    const proposedFulfillment = BigInt(claims.authority.proposed.fulfillmentMinor);
    const retainedRental = BigInt(claims.financial.retainedNonRefundableRentalMinor);
    const policyAdjustedRental = proposedRental + retainedRental;
    const proposedTotal = policyAdjustedRental + proposedFulfillment;
    const delta = proposedTotal - currentTotal;
    const currentCommission = BigInt(
      latestApplied?.pricingSnapshot?.proposedCommissionMinor ??
        booking.commissionSnapshot!.calculatedCommissionMinor,
    );
    const currentOwnerEarnings = BigInt(
      latestApplied?.pricingSnapshot?.proposedOwnerEarningsMinor ??
        booking.ownerEarning!.netEarningAmountMinor,
    );
    const proposedCommission = calculateAmendmentCommission(
      policyAdjustedRental,
      booking.commissionSnapshot!,
    );
    const proposedOwnerEarnings = policyAdjustedRental - proposedCommission + proposedFulfillment;
    const expectedDigest = digest({
      commission: {
        currentMinor: currentCommission.toString(),
        proposedMinor: proposedCommission.toString(),
        ruleId: booking.commissionSnapshot!.ruleId,
        ruleVersion: booking.commissionSnapshot!.ruleVersion,
      },
      ownerEarnings: {
        currentMinor: currentOwnerEarnings.toString(),
        proposedMinor: proposedOwnerEarnings.toString(),
      },
    });
    if (
      expectedDigest !== claims.financialDigest ||
      proposedRental + proposedFulfillment !==
        BigInt(claims.financial.proposedEconomicTotalMinor) ||
      (delta > 0n ? delta : 0n) !== BigInt(claims.financial.additionalPaymentMinor) ||
      (delta < 0n ? -delta : 0n) !== BigInt(claims.financial.expectedRefundMinor)
    )
      throw new ApplicationException(
        'AMENDMENT_PREVIEW_INVALID',
        'Invalid amendment preview token.',
        HttpStatus.CONFLICT,
      );
    const direction =
      delta > 0n
        ? BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT
        : delta < 0n
          ? BookingAmendmentFinancialDirection.REFUND
          : BookingAmendmentFinancialDirection.NONE;
    const finalizedAt = new Date();
    return {
      fulfillment: {
        calculationVersion: FULFILLMENT_CALCULATION_VERSION,
        currency: claims.financial.currency,
        currentEndMethod: claims.authority.current.endMethod,
        currentFulfillmentTotalMinor: currentFulfillment,
        currentStartMethod: claims.authority.current.startMethod,
        destinationSnapshot: {
          collectionDestination: claims.proposal.collectionDestination,
          deliveryDestination: claims.proposal.deliveryDestination,
        } as Prisma.InputJsonValue,
        finalizedAt,
        fulfillmentDeltaMinor: proposedFulfillment - currentFulfillment,
        proposedEndMethod: claims.proposal.endMethod,
        proposedFulfillmentTotalMinor: proposedFulfillment,
        proposedStartMethod: claims.proposal.startMethod,
        serviceabilitySnapshot: {
          proposedCollectionFeeMinor: claims.authority.proposed.collectionFeeMinor,
          proposedDeliveryFeeMinor: claims.authority.proposed.deliveryFeeMinor,
          previewPolicyDigest: claims.policyDigest,
        } as Prisma.InputJsonValue,
        sourceFulfillmentPolicyVersionId: claims.authority.fulfillmentPolicyVersionId,
      },
      pricing: {
        commissionCalculationVersion: booking.commissionSnapshot!.calculationVersion,
        commissionDeltaMinor: proposedCommission - currentCommission,
        commissionRuleId: booking.commissionSnapshot!.ruleId,
        commissionRuleVersion: booking.commissionSnapshot!.ruleVersion,
        currency: claims.financial.currency,
        currentCommissionMinor: currentCommission,
        currentOwnerEarningsMinor: currentOwnerEarnings,
        currentTotalMinor: currentTotal,
        durationDiscountAmountMinor: BigInt(claims.authority.proposed.durationDiscount.amountMinor),
        durationDiscountBps: claims.authority.proposed.durationDiscount.basisPoints,
        durationDiscountTier: claims.authority.proposed.durationDiscount.tier,
        finalizedAt,
        ownerEarningsDeltaMinor: proposedOwnerEarnings - currentOwnerEarnings,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        proposedBaseRentalAmountMinor:
          BigInt(dailyRateMinor) * BigInt(claims.authority.proposed.chargeableDays),
        proposedChargeableDays: claims.authority.proposed.chargeableDays,
        proposedCommissionMinor: proposedCommission,
        proposedDailyRateMinor: BigInt(dailyRateMinor),
        proposedFulfillmentTotalMinor: proposedFulfillment,
        proposedOwnerEarningsMinor: proposedOwnerEarnings,
        proposedRentalSubtotalMinor: policyAdjustedRental,
        proposedTotalMinor: proposedTotal,
        renterFinancialDeltaMinor: delta,
        sourceBookingPolicyVersionId: booking.pricingSnapshot!.policyVersionId,
      },
      settlement: {
        currency: claims.financial.currency,
        currentTotalMinor: currentTotal,
        direction,
        financialDeltaMinor: delta,
        idempotencyKey: `${booking.id}:${requestHash}:settlement`,
        proposedTotalMinor: proposedTotal,
        reconciliationRequired: false,
        status: 'PENDING' as const,
      },
    };
  }

  private async revalidateFulfillment(
    transaction: Prisma.TransactionClient,
    booking: PreviewBooking,
    claims: AmendmentPreviewClaims,
    evaluatedAt: Date,
  ) {
    const base = booking.vehicle.location!;
    for (const candidate of [
      {
        destination: claims.proposal.deliveryDestination,
        method: claims.proposal.startMethod,
        scheduledAt: new Date(claims.proposal.rentalStart),
      },
      {
        destination: claims.proposal.collectionDestination,
        method: claims.proposal.endMethod,
        scheduledAt: new Date(claims.proposal.rentalEnd),
      },
    ]) {
      const result = await this.fulfillment.evaluate(
        {
          destinationLatitude: candidate.destination?.latitude ?? Number(base.latitude),
          destinationLongitude: candidate.destination?.longitude ?? Number(base.longitude),
          method: candidate.method,
          now: evaluatedAt,
          policyVersionId: claims.authority.fulfillmentPolicyVersionId,
          scheduledAt: candidate.scheduledAt,
        },
        transaction,
      );
      if (!result.supported)
        throw new ApplicationException(
          result.reason === 'OUTSIDE_SERVICE_RADIUS'
            ? 'DESTINATION_NOT_SERVICEABLE'
            : 'FULFILLMENT_UNAVAILABLE',
          'The requested handover option is unavailable.',
          HttpStatus.CONFLICT,
        );
    }
  }

  private findReplay(renterUserId: string, idempotencyKey: string, requestHash: string) {
    return this.database.client.bookingAmendment
      .findUnique({
        include: RESULT_INCLUDE,
        where: {
          requesterUserId_idempotencyKey: { idempotencyKey, requesterUserId: renterUserId },
        },
      })
      .then((existing) => {
        if (!existing) return null;
        this.assertSameRequest(existing.requestHash, requestHash);
        return existing;
      });
  }

  private project(record: SubmissionResult) {
    return {
      amendmentId: record.id,
      current: {
        endMethod: record.fulfillmentSnapshot!.currentEndMethod,
        startMethod: record.fulfillmentSnapshot!.currentStartMethod,
        totalMinor: record.pricingSnapshot!.currentTotalMinor.toString(),
      },
      expiresAt: record.expiresAt.toISOString(),
      financial: {
        additionalPaymentMinor:
          record.settlement!.financialDeltaMinor > 0n
            ? record.settlement!.financialDeltaMinor.toString()
            : '0',
        currency: record.settlement!.currency,
        expectedRefundMinor:
          record.settlement!.financialDeltaMinor < 0n
            ? (-record.settlement!.financialDeltaMinor).toString()
            : '0',
      },
      proposed: {
        chargeableDays: record.pricingSnapshot!.proposedChargeableDays,
        endMethod: record.fulfillmentSnapshot!.proposedEndMethod,
        rentalEnd: record.proposedRentalEnd.toISOString(),
        rentalStart: record.proposedRentalStart.toISOString(),
        startMethod: record.fulfillmentSnapshot!.proposedStartMethod,
        totalMinor: record.pricingSnapshot!.proposedTotalMinor.toString(),
      },
      status: record.status,
    };
  }

  private assertSameRequest(existing: string, requested: string) {
    if (existing !== requested)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        'This idempotency key was already used with a different request.',
        HttpStatus.CONFLICT,
      );
  }

  private pendingConflict(): never {
    throw new ApplicationException(
      'AMENDMENT_ALREADY_PENDING',
      'A booking change is already pending.',
      HttpStatus.CONFLICT,
    );
  }

  private inventoryConflict(): never {
    throw new ApplicationException(
      'DATES_UNAVAILABLE',
      'The vehicle is unavailable for the proposed period.',
      HttpStatus.CONFLICT,
    );
  }

  private isOneActiveConflict(error: unknown) {
    const value = String(
      error instanceof Error ? `${error.name} ${error.message} ${JSON.stringify(error)}` : error,
    );
    return (
      value.includes('booking_amendments_one_unresolved_per_booking_idx') ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    );
  }

  private isSerializationFailure(error: unknown) {
    const value = String(error instanceof Error ? `${error.name} ${error.message}` : error);
    return (
      value.includes('40001') ||
      value.includes('P2034') ||
      value.includes('could not serialize') ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
    );
  }
}

function submissionHash(claims: AmendmentPreviewClaims) {
  return digest({
    authority: claims.authority,
    bookingId: claims.bookingId,
    financial: claims.financial,
    financialDigest: claims.financialDigest,
    policyDigest: claims.policyDigest,
    proposal: claims.proposal,
    renterUserId: claims.renterUserId,
  });
}

function digest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
