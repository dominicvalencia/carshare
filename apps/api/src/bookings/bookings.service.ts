import { randomBytes, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingErrorCode,
  DiscoveryErrorCode,
  HANDOVER_WORKFLOW_VERSION_B4,
} from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingOwnerDecisionType,
  BookingStatus,
  Prisma,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DiscoveryAnalyticsService, AnalyticsEventType } from '../discovery/analytics.service';
import { RentalDurationService } from '../discovery/duration.service';
import { PublicVehicleEligibilityService } from '../discovery/public-eligibility.service';
import { DatabaseService } from '../infrastructure/database/database.service';
import { CryptoService } from '../security/crypto.service';
import type { RequestMetadata } from '../security/security-context';
import type { OwnerAccessContext } from '../security/security-context';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import { OwnersService } from '../owners/owners.service';
import { RenterEligibilityService } from '../renter-verification/renter-eligibility.service';
import { FulfillmentServiceabilityService } from '../fulfillment/fulfillment-serviceability';
import {
  BookingProjectionService,
  bookingInclude,
  type BookingRecord,
} from './booking-projection.service';
import { OccupancyService } from './occupancy.service';
import { OutboxService } from './outbox.service';

const IDEMPOTENCY_SCOPE = 'BOOKING_HOLD_CREATE';
@Injectable()
export class BookingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: PublicVehicleEligibilityService,
    private readonly duration: RentalDurationService,
    private readonly occupancy: OccupancyService,
    private readonly outbox: OutboxService,
    private readonly projection: BookingProjectionService,
    private readonly crypto: CryptoService,
    private readonly analytics: DiscoveryAnalyticsService,
    private readonly owners: OwnersService,
    private readonly ownerAccess: OwnerAccessService,
    private readonly renterEligibility: RenterEligibilityService,
    private readonly fulfillmentServiceability: FulfillmentServiceabilityService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async createHold(
    renterUserId: string,
    quoteId: string,
    idempotencyKey: string,
    request: RequestMetadata,
  ) {
    const requestHash = this.crypto.hashIdentifier(`${IDEMPOTENCY_SCOPE}:${quoteId}`);
    this.analytics.record({
      correlationId: request.correlationId,
      eventType: AnalyticsEventType.BOOKING_HOLD_ATTEMPTED,
      quoteId,
      userId: renterUserId,
    });
    try {
      const bookingId = await this.database.client.$transaction(
        async (transaction) => {
          await this.renterEligibility.assertEligible(renterUserId, transaction);
          await this.occupancy.expireStale(transaction);
          const existing = await transaction.bookingIdempotencyRecord.findUnique({
            where: {
              actorUserId_scope_key: {
                actorUserId: renterUserId,
                key: idempotencyKey,
                scope: IDEMPOTENCY_SCOPE,
              },
            },
          });
          if (existing) {
            this.assertIdempotencyHash(existing.requestHash, requestHash);
            if (existing.bookingId) return existing.bookingId;
          }
          const idempotency = await transaction.bookingIdempotencyRecord.create({
            data: {
              actorUserId: renterUserId,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              key: idempotencyKey,
              requestHash,
              scope: IDEMPOTENCY_SCOPE,
            },
          });
          const quote = await transaction.pricingQuote.findUnique({
            include: {
              lines: { orderBy: { displayOrder: 'asc' } },
              fulfillment: true,
              policyVersion: true,
            },
            where: { id: quoteId },
          });
          if (!quote) this.quoteRequired();
          if (quote.renterUserId !== renterUserId) {
            throw new ApplicationException(
              BookingErrorCode.QUOTE_NOT_OWNED,
              'The quote does not belong to this renter.',
              HttpStatus.FORBIDDEN,
            );
          }
          if (quote.expiresAt <= new Date()) {
            throw new ApplicationException(
              DiscoveryErrorCode.QUOTE_EXPIRED,
              'Create a new quote before starting checkout.',
              HttpStatus.CONFLICT,
            );
          }
          const vehicle = await this.eligibility.findOne(quote.vehicleId, transaction);
          if (!vehicle) {
            throw new ApplicationException(
              BookingErrorCode.QUOTE_VEHICLE_UNAVAILABLE,
              'The quoted vehicle is no longer operationally eligible.',
              HttpStatus.CONFLICT,
            );
          }
          if (vehicle.ownerProfile.userId === renterUserId) {
            throw new ApplicationException(
              BookingErrorCode.OWNER_CANNOT_BOOK_OWN_VEHICLE,
              'Owners cannot rent their own vehicle.',
              HttpStatus.CONFLICT,
            );
          }
          if (vehicle.policyVersions[0]?.id !== quote.policyVersionId) {
            throw new ApplicationException(
              DiscoveryErrorCode.QUOTE_CONFIGURATION_CHANGED,
              "The vehicle's pricing or handover options changed. Please get a new quote.",
              HttpStatus.CONFLICT,
            );
          }
          if (
            quote.fulfillment &&
            quote.fulfillment.sourcePolicyVersionId !== quote.policyVersionId
          ) {
            throw new ApplicationException(
              BookingErrorCode.QUOTE_REQUIRED,
              'The quote is missing authoritative handover terms.',
              HttpStatus.CONFLICT,
            );
          }
          const fulfillment = quote.fulfillment ?? {
            collectionDistanceMeters: null,
            collectionFeeMinor: 0,
            currency: quote.currency,
            deliveryDistanceMeters: null,
            deliveryFeeMinor: 0,
            endAddressLine1: vehicle.location!.addressLine1,
            endBarangay: vehicle.location!.barangay,
            endCity: vehicle.location!.city,
            endCountry: vehicle.location!.country,
            endLatitude: vehicle.location!.latitude,
            endLongitude: vehicle.location!.longitude,
            endMethod: 'RENTER_RETURN' as const,
            endPostalCode: null,
            endProvince: vehicle.location!.province,
            minimumNoticeMinutes: quote.policyVersion.fulfillmentMinimumNoticeMinutes,
            serviceRadiusMeters: quote.policyVersion.fulfillmentServiceRadiusMeters,
            sourcePolicyVersionId: quote.policyVersionId,
            startAddressLine1: vehicle.location!.addressLine1,
            startBarangay: vehicle.location!.barangay,
            startCity: vehicle.location!.city,
            startCountry: vehicle.location!.country,
            startLatitude: vehicle.location!.latitude,
            startLongitude: vehicle.location!.longitude,
            startMethod: 'RENTER_PICKUP' as const,
            startPostalCode: null,
            startProvince: vehicle.location!.province,
          };
          const startServiceability =
            fulfillment.startMethod === 'OWNER_DELIVERY'
              ? await this.fulfillmentServiceability.evaluate({
                  destinationLatitude: Number(fulfillment.startLatitude),
                  destinationLongitude: Number(fulfillment.startLongitude),
                  method: fulfillment.startMethod,
                  policyVersionId: quote.policyVersionId,
                  scheduledAt: quote.rentalStart,
                })
              : { distanceMeters: null, supported: true };
          const endServiceability =
            fulfillment.endMethod === 'OWNER_COLLECTION'
              ? await this.fulfillmentServiceability.evaluate({
                  destinationLatitude: Number(fulfillment.endLatitude),
                  destinationLongitude: Number(fulfillment.endLongitude),
                  method: fulfillment.endMethod,
                  policyVersionId: quote.policyVersionId,
                  scheduledAt: quote.rentalEnd,
                })
              : { distanceMeters: null, supported: true };
          if (!startServiceability.supported || !endServiceability.supported) {
            throw new ApplicationException(
              DiscoveryErrorCode.QUOTE_CONFIGURATION_CHANGED,
              'The handover terms changed. Please review your booking and get a new quote.',
              HttpStatus.CONFLICT,
            );
          }
          if (
            startServiceability.distanceMeters !== fulfillment.deliveryDistanceMeters ||
            endServiceability.distanceMeters !== fulfillment.collectionDistanceMeters
          ) {
            throw new ApplicationException(
              DiscoveryErrorCode.QUOTE_CONFIGURATION_CHANGED,
              'The handover location changed. Please get a new quote.',
              HttpStatus.CONFLICT,
            );
          }
          this.validateQuoteIntegrity(quote);
          const period = this.duration.calculate(quote.rentalStart, quote.rentalEnd);
          this.validatePolicyPeriod(
            quote.policyVersion,
            quote.vehicleTimezone,
            period.start,
            period.end,
            period.chargeableDays,
          );
          const bookingId = randomUUID();
          const holdExpiresAt = new Date(
            Date.now() +
              this.configuration.getOrThrow('BOOKING_HOLD_TTL_MINUTES', { infer: true }) * 60_000,
          );
          await transaction.booking.create({
            data: {
              handoverWorkflowVersion: HANDOVER_WORKFLOW_VERSION_B4,
              holdExpiresAt,
              id: bookingId,
              ownerProfileId: vehicle.ownerProfile.id,
              ownerUserId: vehicle.ownerProfile.userId,
              fulfillmentSnapshot: {
                create: {
                  collectionDistanceMeters: fulfillment.collectionDistanceMeters,
                  collectionFeeMinor: fulfillment.collectionFeeMinor,
                  currency: fulfillment.currency,
                  deliveryDistanceMeters: fulfillment.deliveryDistanceMeters,
                  deliveryFeeMinor: fulfillment.deliveryFeeMinor,
                  endAddressLine1: fulfillment.endAddressLine1,
                  endBarangay: fulfillment.endBarangay,
                  endCity: fulfillment.endCity,
                  endCountry: fulfillment.endCountry,
                  endLatitude: fulfillment.endLatitude,
                  endLongitude: fulfillment.endLongitude,
                  endMethod: fulfillment.endMethod,
                  endPostalCode: fulfillment.endPostalCode,
                  endProvince: fulfillment.endProvince,
                  minimumNoticeMinutes: fulfillment.minimumNoticeMinutes,
                  serviceRadiusMeters: fulfillment.serviceRadiusMeters,
                  sourcePolicyVersionId: fulfillment.sourcePolicyVersionId,
                  startAddressLine1: fulfillment.startAddressLine1,
                  startBarangay: fulfillment.startBarangay,
                  startCity: fulfillment.startCity,
                  startCountry: fulfillment.startCountry,
                  startLatitude: fulfillment.startLatitude,
                  startLongitude: fulfillment.startLongitude,
                  startMethod: fulfillment.startMethod,
                  startPostalCode: fulfillment.startPostalCode,
                  startProvince: fulfillment.startProvince,
                },
              },
              policySnapshot: {
                create: {
                  availabilityPolicy: quote.policyVersion.availabilityPolicy,
                  cancellationPolicyRef: null,
                  claimWindowHours: 24,
                  evCalculationPolicyRef: quote.policyVersion.evCalculationPolicyRef,
                  evRequiredPercentage: quote.policyVersion.evRequiredPercentage,
                  evReturnPolicy: quote.policyVersion.evReturnPolicy,
                  evTolerancePercent: quote.policyVersion.evTolerancePercent,
                  excessKilometerRateMinor: quote.policyVersion.excessKilometerRateMinor,
                  friday: quote.policyVersion.friday,
                  fuelCalculationPolicyRef: quote.policyVersion.fuelCalculationPolicyRef,
                  fuelReturnPolicy: quote.policyVersion.fuelReturnPolicy,
                  fuelTolerancePercent: quote.policyVersion.fuelTolerancePercent,
                  includedKilometersPerDay: quote.policyVersion.includedKilometersPerDay,
                  mileagePolicy: quote.policyVersion.mileagePolicy,
                  monday: quote.policyVersion.monday,
                  policyVersionId: quote.policyVersionId,
                  securityDepositAmountMinor: quote.policyVersion.securityDepositAmountMinor,
                  securityDepositCurrency: quote.policyVersion.securityDepositCurrency,
                  securityDepositRequired: quote.policyVersion.securityDepositRequired,
                  saturday: quote.policyVersion.saturday,
                  sunday: quote.policyVersion.sunday,
                  thursday: quote.policyVersion.thursday,
                  turnaroundMinutes: quote.turnaroundMinutes,
                  tuesday: quote.policyVersion.tuesday,
                  wednesday: quote.policyVersion.wednesday,
                },
              },
              pricingSnapshot: {
                create: {
                  baseRentalAmountMinor: quote.baseRentalAmountMinor,
                  chargeableDays: quote.chargeableDays,
                  currency: quote.currency,
                  discountedRentalSubtotalMinor: quote.discountedRentalSubtotalMinor,
                  durationDiscountAmountMinor: quote.durationDiscountAmountMinor,
                  durationDiscountBps: quote.durationDiscountBps,
                  durationDiscountTier: quote.durationDiscountTier,
                  excessKilometerRateMinor: quote.excessKilometerRateMinor,
                  includedMileageKm: quote.includedMileageKm,
                  lines: {
                    create: quote.lines.map((line) => ({
                      amountMinor: line.amountMinor,
                      code: line.code,
                      description: line.description,
                      displayOrder: line.displayOrder,
                      quantity: line.quantity,
                      unitAmountMinor: line.unitAmountMinor,
                    })),
                  },
                  policyVersionId: quote.policyVersionId,
                  pricingEngineVersion: quote.pricingEngineVersion,
                  quoteId: quote.id,
                  rentalEnd: quote.rentalEnd,
                  rentalStart: quote.rentalStart,
                  subtotalMinor: quote.subtotalMinor,
                  totalMinor: quote.totalMinor,
                  unlimitedMileage: quote.unlimitedMileage,
                  vehicleTimezone: quote.vehicleTimezone,
                },
              },
              publicReference: this.publicReference(),
              quoteId: quote.id,
              rentalEnd: quote.rentalEnd,
              rentalStart: quote.rentalStart,
              renterUserId,
              status: BookingStatus.HOLD,
              vehicleId: quote.vehicleId,
            },
          });
          await this.occupancy.createBooking(transaction, {
            bookingId,
            expiresAt: holdExpiresAt,
            rentalEnd: quote.rentalEnd,
            rentalStart: quote.rentalStart,
            turnaroundMinutes: quote.turnaroundMinutes,
            vehicleId: quote.vehicleId,
          });
          await transaction.bookingStatusHistory.create({
            data: {
              actorType: BookingActorType.USER,
              actorUserId: renterUserId,
              bookingId,
              correlationId: request.correlationId ?? null,
              reasonCode: 'CHECKOUT_HOLD_CREATED',
              toStatus: BookingStatus.HOLD,
            },
          });
          await transaction.bookingIdempotencyRecord.update({
            data: { bookingId },
            where: { id: idempotency.id },
          });
          await this.outbox.write(transaction, {
            aggregateId: bookingId,
            eventType: 'BOOKING_HOLD_CREATED',
            payload: { bookingId, quoteId, renterUserId, vehicleId: quote.vehicleId },
          });
          return bookingId;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );
      this.analytics.record({
        bookingId,
        correlationId: request.correlationId,
        eventType: AnalyticsEventType.BOOKING_HOLD_CREATED,
        quoteId,
        userId: renterUserId,
      });
      return this.renterDetail(renterUserId, bookingId);
    } catch (error) {
      const recovered = await this.recoverIdempotent(
        renterUserId,
        quoteId,
        idempotencyKey,
        requestHash,
      );
      if (recovered) return this.renterDetail(renterUserId, recovered.id);
      if (this.occupancy.isExclusionConflict(error) || this.isSerializationFailure(error)) {
        this.analytics.record({
          correlationId: request.correlationId,
          eventType: AnalyticsEventType.BOOKING_HOLD_CONFLICT,
          quoteId,
          userId: renterUserId,
        });
        throw this.occupancy.bookingConflict();
      }
      throw error;
    }
  }

  async listRenter(userId: string) {
    await this.occupancy.expireStale();
    const records = await this.database.client.booking.findMany({
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: { renterUserId: userId },
    });
    return records.map((record) => this.projection.renter(record));
  }

  async renterDetail(userId: string, reference: string) {
    await this.occupancy.expireStale();
    const booking = await this.findBooking(reference, { renterUserId: userId });
    return this.projection.renter(booking);
  }

  async continueToPayment(userId: string, reference: string, request: RequestMetadata) {
    const booking = await this.transitionOwned(
      reference,
      { renterUserId: userId },
      [BookingStatus.HOLD],
      BookingStatus.AWAITING_PAYMENT,
      'BOOKING_AWAITING_PAYMENT',
      BookingActorType.USER,
      userId,
      request,
    );
    return this.projection.renter(booking);
  }

  async cancel(
    userId: string,
    reference: string,
    reason: string | undefined,
    request: RequestMetadata,
  ) {
    const id = await this.resolveId(reference, { renterUserId: userId });
    const record = await this.database.client.$transaction(async (transaction) => {
      await this.occupancy.expireStale(transaction);
      const booking = await this.locked(transaction, id);
      if (booking.renterUserId !== userId) this.notOwned();
      if (booking.status === BookingStatus.CANCELLED) {
        throw new ApplicationException(
          BookingErrorCode.BOOKING_ALREADY_CANCELLED,
          'The booking is already cancelled.',
          HttpStatus.CONFLICT,
        );
      }
      if (
        !(
          [
            BookingStatus.HOLD,
            BookingStatus.AWAITING_PAYMENT,
            BookingStatus.AWAITING_OWNER,
          ] as readonly BookingStatus[]
        ).includes(booking.status)
      ) {
        this.invalidState('This booking can no longer be cancelled without a controlled workflow.');
      }
      await transaction.booking.update({
        data: { status: BookingStatus.CANCELLED },
        where: { id },
      });
      await transaction.vehicleOccupancy.updateMany({
        data: { active: false, releaseReason: 'RENTER_CANCELLED', releasedAt: new Date() },
        where: { active: true, bookingId: id },
      });
      await transaction.bookingCancellation.create({
        data: {
          actorType: BookingActorType.USER,
          actorUserId: userId,
          bookingId: id,
          correlationId: request.correlationId ?? null,
          reasonCode: 'RENTER_CANCELLED',
          reasonText: reason ?? null,
        },
      });
      await this.historyAndOutbox(
        transaction,
        id,
        booking.status,
        BookingStatus.CANCELLED,
        'BOOKING_CANCELLED',
        BookingActorType.USER,
        userId,
        request,
        reason,
      );
      return transaction.booking.findUniqueOrThrow({ include: bookingInclude, where: { id } });
    });
    this.analytics.record({
      bookingId: id,
      eventType: AnalyticsEventType.BOOKING_CANCELLED,
      userId,
    });
    return this.projection.renter(record);
  }

  async listOwner(ownerUserId: string) {
    await this.owners.assertOperational(ownerUserId);
    await this.occupancy.expireStale();
    const records = await this.database.client.booking.findMany({
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: { ownerUserId },
    });
    return records.map((record) => this.projection.owner(record));
  }

  async listForOwnerAccess(context: OwnerAccessContext) {
    await this.owners.assertOperational(await this.ownerUserIdForAccess(context));
    const vehicle = this.ownerAccess.vehicleWhere(context, 'bookings.view');
    await this.occupancy.expireStale();
    const records = await this.database.client.booking.findMany({
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 100,
      where: { vehicle },
    });
    return records.map((record) => this.projection.owner(record));
  }

  async ownerDetail(ownerUserId: string, reference: string) {
    await this.owners.assertOperational(ownerUserId);
    await this.occupancy.expireStale();
    return this.projection.owner(await this.findBooking(reference, { ownerUserId }));
  }

  async ownerDetailForAccess(context: OwnerAccessContext, reference: string) {
    await this.owners.assertOperational(await this.ownerUserIdForAccess(context));
    const vehicle = this.ownerAccess.vehicleWhere(context, 'bookings.view');
    await this.occupancy.expireStale();
    const record = await this.database.client.booking.findFirst({
      include: bookingInclude,
      where: { publicReference: reference, vehicle },
    });
    if (!record) this.notOwned();
    return this.projection.owner(record);
  }

  async ownerAccept(ownerUserId: string, reference: string, request: RequestMetadata) {
    await this.owners.assertOperational(ownerUserId);
    const booking = await this.ownerDecision(
      ownerUserId,
      reference,
      BookingOwnerDecisionType.ACCEPTED,
      undefined,
      request,
      ownerUserId,
    );
    this.analytics.record({
      bookingId: booking.id,
      eventType: AnalyticsEventType.BOOKING_OWNER_ACCEPTED,
      userId: ownerUserId,
    });
    return this.projection.owner(booking);
  }

  async ownerReject(
    ownerUserId: string,
    reference: string,
    reason: string | undefined,
    request: RequestMetadata,
  ) {
    await this.owners.assertOperational(ownerUserId);
    const booking = await this.ownerDecision(
      ownerUserId,
      reference,
      BookingOwnerDecisionType.REJECTED,
      reason,
      request,
      ownerUserId,
    );
    this.analytics.record({
      bookingId: booking.id,
      eventType: AnalyticsEventType.BOOKING_OWNER_REJECTED,
      userId: ownerUserId,
    });
    return this.projection.owner(booking);
  }

  async ownerAcceptForAccess(
    context: OwnerAccessContext,
    actorUserId: string,
    reference: string,
    request: RequestMetadata,
  ) {
    return this.ownerDecisionForAccess(
      context,
      actorUserId,
      reference,
      BookingOwnerDecisionType.ACCEPTED,
      undefined,
      request,
      'bookings.accept',
    );
  }

  async ownerRejectForAccess(
    context: OwnerAccessContext,
    actorUserId: string,
    reference: string,
    reason: string | undefined,
    request: RequestMetadata,
  ) {
    return this.ownerDecisionForAccess(
      context,
      actorUserId,
      reference,
      BookingOwnerDecisionType.REJECTED,
      reason,
      request,
      'bookings.reject',
    );
  }

  private async ownerDecisionForAccess(
    context: OwnerAccessContext,
    actorUserId: string,
    reference: string,
    decision: BookingOwnerDecisionType,
    reason: string | undefined,
    request: RequestMetadata,
    permission: 'bookings.accept' | 'bookings.reject',
  ) {
    const vehicle = this.ownerAccess.vehicleWhere(context, permission);
    const accessible = await this.database.client.booking.findFirst({
      select: { ownerUserId: true },
      where: { publicReference: reference, vehicle },
    });
    if (!accessible) this.notOwned();
    await this.owners.assertOperational(accessible.ownerUserId);
    const booking = await this.ownerDecision(
      accessible.ownerUserId,
      reference,
      decision,
      reason,
      request,
      actorUserId,
    );
    this.analytics.record({
      bookingId: booking.id,
      eventType:
        decision === BookingOwnerDecisionType.ACCEPTED
          ? AnalyticsEventType.BOOKING_OWNER_ACCEPTED
          : AnalyticsEventType.BOOKING_OWNER_REJECTED,
      userId: actorUserId,
    });
    return this.projection.owner(booking);
  }

  private async ownerUserIdForAccess(context: OwnerAccessContext) {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: { userId: true },
      where: { id: context.ownerProfileId },
    });
    if (!owner) this.notOwned();
    return owner.userId;
  }

  async listAdmin() {
    await this.occupancy.expireStale();
    const records = await this.database.client.booking.findMany({
      include: bookingInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return records.map((record) => this.projection.admin(record));
  }

  async adminDetail(reference: string) {
    await this.occupancy.expireStale();
    return this.projection.admin(await this.findBooking(reference, {}));
  }

  expireStale() {
    return this.occupancy.expireStale();
  }

  private async ownerDecision(
    ownerUserId: string,
    reference: string,
    decision: BookingOwnerDecisionType,
    reason: string | undefined,
    request: RequestMetadata,
    actorUserId: string,
  ): Promise<BookingRecord> {
    const id = await this.resolveId(reference, { ownerUserId });
    return this.database.client.$transaction(async (transaction) => {
      await this.occupancy.expireStale(transaction);
      const booking = await this.locked(transaction, id);
      if (booking.ownerUserId !== ownerUserId) this.notOwned();
      if (booking.status !== BookingStatus.AWAITING_OWNER) {
        throw new ApplicationException(
          BookingErrorCode.OWNER_DECISION_NOT_ALLOWED,
          'Owner decision is not allowed in the current booking state.',
          HttpStatus.CONFLICT,
        );
      }
      const next =
        decision === BookingOwnerDecisionType.ACCEPTED
          ? BookingStatus.CAPTURE_PENDING
          : BookingStatus.CANCELLED;
      await transaction.booking.update({
        data: { ownerResponseDeadlineAt: null, status: next },
        where: { id },
      });
      await transaction.bookingOwnerDecision.create({
        data: {
          actorUserId,
          bookingId: id,
          correlationId: request.correlationId ?? null,
          decision,
          reasonText: reason ?? null,
        },
      });
      if (decision === BookingOwnerDecisionType.REJECTED) {
        await transaction.vehicleOccupancy.updateMany({
          data: { active: false, releaseReason: 'OWNER_REJECTED', releasedAt: new Date() },
          where: { active: true, bookingId: id },
        });
      } else {
        await transaction.vehicleOccupancy.updateMany({
          data: { expiresAt: null },
          where: { active: true, bookingId: id },
        });
      }
      await this.historyAndOutbox(
        transaction,
        id,
        booking.status,
        next,
        decision === BookingOwnerDecisionType.ACCEPTED
          ? 'BOOKING_OWNER_ACCEPTED'
          : 'BOOKING_OWNER_REJECTED',
        BookingActorType.USER,
        actorUserId,
        request,
        reason,
      );
      return transaction.booking.findUniqueOrThrow({ include: bookingInclude, where: { id } });
    });
  }

  private async transitionOwned(
    reference: string,
    ownership: { renterUserId?: string; ownerUserId?: string },
    allowed: readonly BookingStatus[],
    next: BookingStatus,
    eventType: string,
    actorType: BookingActorType,
    actorUserId: string | undefined,
    request: RequestMetadata,
    beforeTransition?: (transaction: Prisma.TransactionClient, id: string) => Promise<void>,
  ): Promise<BookingRecord> {
    const id = await this.resolveId(reference, ownership);
    return this.database.client.$transaction(async (transaction) => {
      await this.occupancy.expireStale(transaction);
      const booking = await this.locked(transaction, id);
      if (!allowed.includes(booking.status)) this.invalidState('Booking state has changed.');
      if (beforeTransition) await beforeTransition(transaction, id);
      await transaction.booking.update({ data: { status: next }, where: { id } });
      await this.historyAndOutbox(
        transaction,
        id,
        booking.status,
        next,
        eventType,
        actorType,
        actorUserId,
        request,
      );
      return transaction.booking.findUniqueOrThrow({ include: bookingInclude, where: { id } });
    });
  }

  private async historyAndOutbox(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    fromStatus: BookingStatus,
    toStatus: BookingStatus,
    eventType: string,
    actorType: BookingActorType,
    actorUserId: string | undefined,
    request: RequestMetadata,
    reasonText?: string,
  ) {
    await transaction.bookingStatusHistory.create({
      data: {
        actorType,
        actorUserId: actorUserId ?? null,
        bookingId,
        correlationId: request.correlationId ?? null,
        fromStatus,
        reasonCode: eventType,
        reasonText: reasonText ?? null,
        toStatus,
      },
    });
    await this.outbox.write(transaction, {
      aggregateId: bookingId,
      eventType,
      payload: { bookingId, fromStatus, toStatus },
    });
  }

  private async locked(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
    if (!rows.length) this.notFound();
    return transaction.booking.findUniqueOrThrow({ where: { id } });
  }

  private async findBooking(
    reference: string,
    ownership: { renterUserId?: string; ownerUserId?: string },
  ): Promise<BookingRecord> {
    const record = await this.database.client.booking.findFirst({
      include: bookingInclude,
      where: {
        ...ownership,
        OR: [
          { publicReference: reference },
          ...(this.isUuid(reference) ? [{ id: reference }] : []),
        ],
      },
    });
    if (!record) this.notFound();
    return record;
  }

  private async resolveId(
    reference: string,
    ownership: { renterUserId?: string; ownerUserId?: string },
  ): Promise<string> {
    const booking = await this.database.client.booking.findFirst({
      select: { id: true },
      where: {
        ...ownership,
        OR: [
          { publicReference: reference },
          ...(this.isUuid(reference) ? [{ id: reference }] : []),
        ],
      },
    });
    if (!booking) this.notFound();
    return booking.id;
  }

  private async recoverIdempotent(
    userId: string,
    quoteId: string,
    key: string,
    requestHash: string,
  ) {
    const record = await this.database.client.bookingIdempotencyRecord.findUnique({
      where: { actorUserId_scope_key: { actorUserId: userId, key, scope: IDEMPOTENCY_SCOPE } },
    });
    if (record) {
      this.assertIdempotencyHash(record.requestHash, requestHash);
      if (record.bookingId) {
        return this.database.client.booking.findUnique({ where: { id: record.bookingId } });
      }
    }
    const quoteBooking = await this.database.client.booking.findUnique({ where: { quoteId } });
    return quoteBooking?.renterUserId === userId ? quoteBooking : null;
  }

  private validateQuoteIntegrity(quote: {
    chargeableDays: number;
    subtotalMinor: number;
    totalMinor: number;
    lines: readonly { amountMinor: number }[];
  }): void {
    const lineTotal = quote.lines.reduce((sum, line) => sum + line.amountMinor, 0);
    if (
      quote.chargeableDays <= 0 ||
      lineTotal !== quote.subtotalMinor ||
      quote.subtotalMinor !== quote.totalMinor
    ) {
      throw new ApplicationException(
        BookingErrorCode.QUOTE_REQUIRED,
        'The quote cannot be reproduced safely.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private validatePolicyPeriod(
    policy: {
      availabilityPolicy: string;
      minimumRentalDays: number;
      maximumRentalDays: number;
      monday: boolean;
      tuesday: boolean;
      wednesday: boolean;
      thursday: boolean;
      friday: boolean;
      saturday: boolean;
      sunday: boolean;
    },
    timezone: string,
    start: Date,
    end: Date,
    chargeableDays: number,
  ): void {
    if (chargeableDays < policy.minimumRentalDays || chargeableDays > policy.maximumRentalDays) {
      throw new ApplicationException(
        BookingErrorCode.QUOTE_VEHICLE_UNAVAILABLE,
        'The quoted period no longer satisfies its policy.',
        HttpStatus.CONFLICT,
      );
    }
    if (policy.availabilityPolicy === 'WEEKLY') {
      const weekly = policy as unknown as Record<string, unknown>;
      const weekdays = this.duration.touchedWeekdays(start, end, timezone);
      if ([...weekdays].some((weekday) => weekly[weekday] !== true)) {
        throw new ApplicationException(
          BookingErrorCode.QUOTE_VEHICLE_UNAVAILABLE,
          'The requested period is outside weekly availability.',
          HttpStatus.CONFLICT,
        );
      }
    }
  }

  private assertIdempotencyHash(existing: string, requested: string): void {
    if (existing !== requested) {
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        'This idempotency key was already used with a different request.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private isSerializationFailure(error: unknown): boolean {
    const value = String(
      error instanceof Error ? `${error.name} ${error.message} ${JSON.stringify(error)}` : error,
    );
    return (
      value.includes('40001') ||
      value.includes('P2034') ||
      value.includes('could not serialize') ||
      value.includes('write conflict') ||
      value.includes('deadlock')
    );
  }

  private publicReference(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    let suffix = '';
    for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
    return `CR-${new Date().getUTCFullYear()}-${suffix}`;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private quoteRequired(): never {
    throw new ApplicationException(
      BookingErrorCode.QUOTE_REQUIRED,
      'An authoritative quote is required.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  private notFound(): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_NOT_FOUND,
      'Booking was not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private notOwned(): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_NOT_OWNED,
      'This booking does not belong to this account.',
      HttpStatus.FORBIDDEN,
    );
  }

  private invalidState(message: string): never {
    throw new ApplicationException(
      BookingErrorCode.BOOKING_INVALID_STATE,
      message,
      HttpStatus.CONFLICT,
    );
  }
}
