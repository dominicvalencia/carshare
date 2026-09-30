import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentStatus,
  BookingStatus,
  HandoverPhase,
  HandoverTravelStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
} from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { AvailabilityService } from '../discovery/availability.service';
import { priceCompleteTripRental } from '../discovery/complete-trip-pricing';
import { PRICING_ENGINE_VERSION } from '../discovery/duration.service';
import { FulfillmentServiceabilityService } from '../fulfillment/fulfillment-serviceability';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { AmendmentDestinationDto, BookingAmendmentPreviewDto } from './bookings.dto';
import { evaluateConfirmedCancellationTiming } from './cancellation-policy';

const PREVIEW_VERSION = 'BOOKING_AMENDMENT_PREVIEW_V1';
const FINANCIAL_VERSION = 'BOOKING_AMENDMENT_COMPLETE_TRIP_V1';

export const AMENDMENT_PREVIEW_INCLUDE = {
  amendments: {
    include: { fulfillmentSnapshot: true, pricingSnapshot: true, settlement: true },
    orderBy: [{ appliedAt: 'asc' as const }, { id: 'asc' as const }],
  },
  commissionSnapshot: true,
  cancellationSettlement: true,
  disputes: true,
  fulfillmentSnapshot: true,
  handoverTravelEvents: true,
  ownerEarning: true,
  postReturnClaims: true,
  payments: {
    orderBy: { createdAt: 'desc' as const },
    where: { purpose: PaymentPurpose.RENTAL },
  },
  policySnapshot: true,
  pickupChallenges: { select: { consumedAt: true } },
  pricingSnapshot: true,
  vehicle: { include: { location: true } },
} satisfies Prisma.BookingInclude;

export type PreviewBooking = Prisma.BookingGetPayload<{
  include: typeof AMENDMENT_PREVIEW_INCLUDE;
}>;

interface Destination {
  addressLine1?: string;
  barangay?: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  postalCode?: string;
  province: string;
}

export interface AmendmentPreviewClaims {
  authority: {
    current: AmendmentCurrentResponse;
    fulfillmentPolicyVersionId: string;
    proposed: AmendmentProposedResponse;
  };
  bookingId: string;
  bookingReference: string;
  currentFingerprint: string;
  expiresAt: string;
  financial: {
    additionalPaymentMinor: string;
    currency: string;
    expectedRefundMinor: string;
    proposedEconomicTotalMinor: string;
    retainedNonRefundableRentalMinor: string;
  };
  financialDigest: string;
  issuedAt: string;
  proposal: CanonicalAmendmentProposal;
  policyDigest: string;
  renterUserId: string;
  version: typeof PREVIEW_VERSION;
}

export interface AmendmentCurrentResponse {
  chargeableDays: number;
  endMethod: CanonicalAmendmentProposal['endMethod'];
  rentalEnd: string;
  rentalStart: string;
  startMethod: CanonicalAmendmentProposal['startMethod'];
  totalMinor: string;
}

export interface AmendmentProposedResponse {
  addedDurationMinutes: number;
  chargeableDays: number;
  collectionFeeMinor: string;
  durationDiscount: {
    amountMinor: string;
    applied: boolean;
    basisPoints: number;
    tier: string | null;
  };
  deliveryFeeMinor: string;
  endMethod: CanonicalAmendmentProposal['endMethod'];
  fulfillmentMinor: string;
  rentalEnd: string;
  rentalMinor: string;
  rentalStart: string;
  startMethod: CanonicalAmendmentProposal['startMethod'];
  totalDurationMinutes: number;
}

export interface CanonicalAmendmentProposal {
  collectionDestination: Destination | null;
  deliveryDestination: Destination | null;
  endMethod: 'OWNER_COLLECTION' | 'RENTER_RETURN';
  rentalEnd: string;
  rentalStart: string;
  startMethod: 'OWNER_DELIVERY' | 'RENTER_PICKUP';
}

export interface AmendmentPreviewVerificationAuthority {
  financial?: AmendmentPreviewClaims['financial'];
  policyDigest?: string;
  proposal?: CanonicalAmendmentProposal;
}

export type AmendmentPreviewWarning =
  | 'ADDITIONAL_PAYMENT_REQUIRED'
  | 'DURATION_DISCOUNT_APPLIED'
  | 'DURATION_DISCOUNT_REMOVED'
  | 'NON_REFUNDABLE_SHORTENING'
  | 'REFUND_EXPECTED';

@Injectable()
export class AmendmentPreviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly availability: AvailabilityService,
    private readonly fulfillment: FulfillmentServiceabilityService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async previewRenter(
    renterUserId: string,
    reference: string,
    input: BookingAmendmentPreviewDto,
    evaluatedAt = new Date(),
  ) {
    const booking = await this.findAuthorized(renterUserId, reference);
    if (!booking) this.fail('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const authority = await this.authority(booking!, input, evaluatedAt);
    const expiresAt = new Date(
      evaluatedAt.getTime() +
        this.configuration.getOrThrow('QUOTE_TTL_MINUTES', { infer: true }) * 60_000,
    );
    const privateFinancialAuthority = {
      commission: authority.privateCommission,
      ownerEarnings: authority.privateOwnerEarnings,
    };
    const financialDigest = digest(privateFinancialAuthority);
    const claims: AmendmentPreviewClaims = {
      authority: {
        current: authority.currentResponse,
        fulfillmentPolicyVersionId: authority.fulfillmentPolicyVersionId,
        proposed: authority.proposedResponse,
      },
      bookingId: booking!.id,
      bookingReference: booking!.publicReference,
      currentFingerprint: authority.currentFingerprint,
      expiresAt: expiresAt.toISOString(),
      financial: authority.financialResponse,
      financialDigest,
      issuedAt: evaluatedAt.toISOString(),
      proposal: authority.proposal,
      policyDigest: digest({
        commissionCalculationVersion: booking!.commissionSnapshot!.calculationVersion,
        commissionRuleId: booking!.commissionSnapshot!.ruleId,
        commissionRuleVersion: booking!.commissionSnapshot!.ruleVersion,
        fulfillmentPolicyVersionId: authority.fulfillmentPolicyVersionId,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        rentalPolicyVersionId: booking!.pricingSnapshot!.policyVersionId,
      }),
      renterUserId,
      version: PREVIEW_VERSION,
    };
    return {
      availability: { available: true as const },
      bookingReference: booking!.publicReference,
      current: authority.currentResponse,
      evaluatedAt: evaluatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      financial: authority.financialResponse,
      policy: {
        financialVersion: FINANCIAL_VERSION,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        rentalPolicyVersionId: booking!.pricingSnapshot!.policyVersionId,
      },
      previewToken: this.sign(claims),
      proposed: authority.proposedResponse,
      warnings: authority.warnings,
    };
  }

  async verifyPreviewToken(
    token: string,
    renterUserId: string,
    reference: string,
    evaluatedAt = new Date(),
    expected: AmendmentPreviewVerificationAuthority = {},
  ): Promise<AmendmentPreviewClaims> {
    const claims = this.inspectPreviewToken(token, renterUserId, reference);
    if (new Date(claims.expiresAt) <= evaluatedAt)
      this.fail('QUOTE_EXPIRED', 'Amendment preview expired.', HttpStatus.CONFLICT);
    const booking = await this.findAuthorized(renterUserId, reference);
    if (!booking || booking.id !== claims.bookingId) this.invalidToken();
    if (this.fingerprint(booking) !== claims.currentFingerprint)
      this.fail('BOOKING_STATE_CHANGED', 'Booking authority changed.', HttpStatus.CONFLICT);
    if (expected.proposal && digest(expected.proposal) !== digest(claims.proposal))
      this.invalidToken();
    if (expected.financial && digest(expected.financial) !== digest(claims.financial))
      this.invalidToken();
    if (expected.policyDigest && expected.policyDigest !== claims.policyDigest) this.invalidToken();
    return claims;
  }

  inspectPreviewToken(token: string, renterUserId: string, reference: string) {
    const claims = this.verifySignature(token);
    if (claims.renterUserId !== renterUserId || claims.bookingReference !== reference)
      this.invalidToken();
    return claims;
  }

  assertSubmissionAuthority(
    claims: AmendmentPreviewClaims,
    booking: PreviewBooking,
    evaluatedAt: Date,
  ) {
    if (booking.id !== claims.bookingId || booking.renterUserId !== claims.renterUserId)
      this.invalidToken();
    if (this.fingerprint(booking) !== claims.currentFingerprint)
      this.fail('BOOKING_STATE_CHANGED', 'Booking authority changed.', HttpStatus.CONFLICT);
    this.assertEligible(booking, evaluatedAt);
  }

  assertSubmissionFulfillmentRemovalAllowed(
    booking: PreviewBooking,
    proposal: CanonicalAmendmentProposal,
  ) {
    const latestApplied = booking.amendments
      .filter((item) => item.status === BookingAmendmentStatus.APPLIED)
      .toSorted(compareAppliedAmendments)
      .at(-1);
    this.assertFulfillmentRemovalAllowed(
      booking,
      latestApplied?.proposedStartMethod ?? booking.fulfillmentSnapshot!.startMethod,
      latestApplied?.proposedEndMethod ?? booking.fulfillmentSnapshot!.endMethod,
      proposal.startMethod,
      proposal.endMethod,
    );
  }

  private async authority(
    booking: PreviewBooking,
    input: BookingAmendmentPreviewDto,
    evaluatedAt: Date,
  ) {
    this.assertEligible(booking, evaluatedAt);
    const applied = booking.amendments
      .filter((item) => item.status === BookingAmendmentStatus.APPLIED)
      .toSorted(compareAppliedAmendments);
    const latestApplied = applied.at(-1);
    const bookingCurrency = booking.pricingSnapshot!.currency;
    if (
      (latestApplied?.pricingSnapshot &&
        latestApplied.pricingSnapshot.currency !== bookingCurrency) ||
      (latestApplied?.fulfillmentSnapshot &&
        latestApplied.fulfillmentSnapshot.currency !== bookingCurrency)
    )
      this.fail(
        'BOOKING_STATE_CHANGED',
        'Booking currency authority is inconsistent.',
        HttpStatus.CONFLICT,
      );
    const currentStart = latestApplied?.proposedRentalStart ?? booking.rentalStart;
    const currentEnd = latestApplied?.proposedRentalEnd ?? booking.rentalEnd;
    const currentStartMethod =
      latestApplied?.proposedStartMethod ?? booking.fulfillmentSnapshot!.startMethod;
    const currentEndMethod =
      latestApplied?.proposedEndMethod ?? booking.fulfillmentSnapshot!.endMethod;
    const appliedDestinations = jsonRecord(latestApplied?.fulfillmentSnapshot?.destinationSnapshot);
    const currentDelivery =
      destinationFromJson(appliedDestinations?.deliveryDestination) ??
      this.snapshotDestination(booking.fulfillmentSnapshot!, 'start');
    const currentCollection =
      destinationFromJson(appliedDestinations?.collectionDestination) ??
      this.snapshotDestination(booking.fulfillmentSnapshot!, 'end');
    const proposedStart = input.proposedPickupAt ? new Date(input.proposedPickupAt) : currentStart;
    const proposedEnd = input.proposedReturnAt ? new Date(input.proposedReturnAt) : currentEnd;
    const activeExtension = booking.status === BookingStatus.ACTIVE;
    if (
      activeExtension &&
      (proposedStart.getTime() !== currentStart.getTime() ||
        proposedEnd <= currentEnd ||
        input.proposedStartMethod !== undefined ||
        input.proposedEndMethod !== undefined ||
        input.proposedDeliveryDestination !== undefined ||
        input.proposedCollectionDestination !== undefined)
    )
      this.fail(
        'UNSUPPORTED_CHANGE',
        'An active trip can only be extended to a later return time.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (
      localDate(proposedStart, booking.pricingSnapshot!.vehicleTimezone) !==
      localDate(currentStart, booking.pricingSnapshot!.vehicleTimezone)
    )
      this.fail(
        'UNSUPPORTED_CHANGE',
        'Pickup date changes are not supported.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (proposedStart >= proposedEnd)
      this.fail(
        'DATES_UNAVAILABLE',
        'Return must be after pickup.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const startMethod = input.proposedStartMethod ?? currentStartMethod;
    const endMethod = input.proposedEndMethod ?? currentEndMethod;
    const deliveryDestination = this.destination(
      input.proposedDeliveryDestination,
      startMethod === 'OWNER_DELIVERY' && currentStartMethod === 'OWNER_DELIVERY'
        ? currentDelivery
        : null,
      startMethod === 'OWNER_DELIVERY',
    );
    const collectionDestination = this.destination(
      input.proposedCollectionDestination,
      endMethod === 'OWNER_COLLECTION' && currentEndMethod === 'OWNER_COLLECTION'
        ? currentCollection
        : null,
      endMethod === 'OWNER_COLLECTION',
    );
    this.assertFulfillmentRemovalAllowed(
      booking,
      currentStartMethod,
      currentEndMethod,
      startMethod,
      endMethod,
    );
    const proposal: CanonicalAmendmentProposal = {
      collectionDestination,
      deliveryDestination,
      endMethod,
      rentalEnd: proposedEnd.toISOString(),
      rentalStart: proposedStart.toISOString(),
      startMethod,
    };
    const currentProposal: CanonicalAmendmentProposal = {
      collectionDestination: currentEndMethod === 'OWNER_COLLECTION' ? currentCollection : null,
      deliveryDestination: currentStartMethod === 'OWNER_DELIVERY' ? currentDelivery : null,
      endMethod: currentEndMethod,
      rentalEnd: currentEnd.toISOString(),
      rentalStart: currentStart.toISOString(),
      startMethod: currentStartMethod,
    };
    if (digest(proposal) === digest(currentProposal))
      this.fail(
        'NO_CHANGES',
        'The proposed booking is unchanged.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const originalPolicy = await this.database.client.vehiclePolicyVersion.findUnique({
      where: { id: booking.pricingSnapshot!.policyVersionId },
    });
    const currentPolicy = await this.database.client.vehiclePolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      where: { vehicleId: booking.vehicleId },
    });
    if (!originalPolicy || !currentPolicy)
      this.fail('BOOKING_STATE_CHANGED', 'Pricing authority is unavailable.', HttpStatus.CONFLICT);
    const chargeableDays = Math.ceil(
      (proposedEnd.getTime() - proposedStart.getTime()) / 86_400_000,
    );
    if (
      chargeableDays < originalPolicy!.minimumRentalDays ||
      chargeableDays > originalPolicy!.maximumRentalDays
    )
      this.fail('DATES_UNAVAILABLE', 'The proposed duration is unavailable.', HttpStatus.CONFLICT);

    await this.assertFulfillment(currentPolicy!.id, proposal, booking, evaluatedAt);
    await this.assertAvailable(
      booking,
      proposedStart,
      proposedEnd,
      originalPolicy!.turnaroundMinutes,
      currentStart,
      currentEnd,
    );

    let proposedPricing: ReturnType<typeof priceCompleteTripRental>;
    try {
      proposedPricing = priceCompleteTripRental(chargeableDays, originalPolicy!);
    } catch {
      this.fail(
        'DATES_UNAVAILABLE',
        'The proposed rental amount is unsupported.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const proposedDiscount = proposedPricing!.discount;
    const currentRental = BigInt(
      latestApplied?.pricingSnapshot?.proposedRentalSubtotalMinor ??
        booking.pricingSnapshot!.discountedRentalSubtotalMinor,
    );
    const currentFulfillment = BigInt(
      latestApplied?.fulfillmentSnapshot?.proposedFulfillmentTotalMinor ??
        booking.fulfillmentSnapshot!.deliveryFeeMinor +
          booking.fulfillmentSnapshot!.collectionFeeMinor,
    );
    const grossCurrentTotal = BigInt(
      latestApplied?.settlement?.proposedTotalMinor ?? currentRental + currentFulfillment,
    );
    const survivingRefundObligation = booking.amendments.find(
      (item) =>
        item.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING &&
        item.settlement?.direction === BookingAmendmentFinancialDirection.REFUND &&
        item.settlement.financialDeltaMinor < 0n,
    )?.settlement;
    const committedRefundMinor = survivingRefundObligation
      ? -survivingRefundObligation.financialDeltaMinor
      : 0n;
    const currentTotal =
      grossCurrentTotal > committedRefundMinor ? grossCurrentTotal - committedRefundMinor : 0n;
    const fulfillmentUnchanged =
      startMethod === currentStartMethod &&
      endMethod === currentEndMethod &&
      digest(deliveryDestination) === digest(currentProposal.deliveryDestination) &&
      digest(collectionDestination) === digest(currentProposal.collectionDestination);
    const currentServiceFees = this.currentServiceFees(
      booking,
      latestApplied?.fulfillmentSnapshot ?? null,
      currentStartMethod,
      currentEndMethod,
      currentFulfillment,
    );
    const proposedDeliveryFee =
      startMethod === 'OWNER_DELIVERY'
        ? startMethod === currentStartMethod &&
          digest(deliveryDestination) === digest(currentProposal.deliveryDestination)
          ? currentServiceFees.delivery
          : BigInt(currentPolicy!.deliveryFeeMinor ?? 0)
        : 0n;
    const proposedCollectionFee =
      endMethod === 'OWNER_COLLECTION'
        ? endMethod === currentEndMethod &&
          digest(collectionDestination) === digest(currentProposal.collectionDestination)
          ? currentServiceFees.collection
          : BigInt(currentPolicy!.collectionFeeMinor ?? 0)
        : 0n;
    const proposedRental = BigInt(proposedDiscount.discountedSubtotalMinor);
    const proposedFulfillment = fulfillmentUnchanged
      ? currentFulfillment
      : proposedDeliveryFee + proposedCollectionFee;
    const proposedEconomicTotal = proposedRental + proposedFulfillment;
    const payment = booking.payments[0]!;
    const shortening = proposedEnd < currentEnd;
    const timing = evaluateConfirmedCancellationTiming({
      confirmedAt: payment.capturedAt!,
      evaluatedAt,
      scheduledPickupAt: booking.rentalStart,
    });
    const rentalReduction = currentRental > proposedRental ? currentRental - proposedRental : 0n;
    const retainedRentalReduction = shortening && !timing.refundable ? rentalReduction : 0n;
    // Final renter obligation = theoretical complete-trip rental + policy-retained
    // committed rental + proposed fulfillment. The delta is always against the
    // reconstructed CURRENT total, never against the original booking total.
    const reconciled = reconcileAmendmentPreviewFinancials({
      commission: booking.commissionSnapshot!,
      currentTotal,
      proposedFulfillment,
      proposedRental,
      retainedRental: retainedRentalReduction,
    });
    const { additionalPaymentMinor, proposedCommission, proposedOwnerEarnings, refundMinor } =
      reconciled;
    if (activeExtension && refundMinor > 0n)
      this.fail(
        'BOOKING_STATE_CHANGED',
        'An active trip extension cannot produce a refund.',
        HttpStatus.CONFLICT,
      );
    const currentCommission =
      latestApplied?.pricingSnapshot?.proposedCommissionMinor ??
      booking.commissionSnapshot!.calculatedCommissionMinor;
    const currentOwnerEarnings =
      latestApplied?.pricingSnapshot?.proposedOwnerEarningsMinor ??
      booking.ownerEarning!.netEarningAmountMinor +
        (booking.ownerEarning!.deliveryEarningMinor ?? 0n) +
        (booking.ownerEarning!.collectionEarningMinor ?? 0n) +
        (booking.ownerEarning!.additionalCompensationMinor ?? 0n) +
        (booking.ownerEarning!.adjustmentAmountMinor ?? 0n);
    const warnings: AmendmentPreviewWarning[] = [];
    const currentDiscountTier =
      latestApplied?.pricingSnapshot?.durationDiscountTier ??
      booking.pricingSnapshot!.durationDiscountTier;
    if (!currentDiscountTier && proposedDiscount.tier) warnings.push('DURATION_DISCOUNT_APPLIED');
    if (currentDiscountTier && !proposedDiscount.tier) warnings.push('DURATION_DISCOUNT_REMOVED');
    if (retainedRentalReduction > 0n) warnings.push('NON_REFUNDABLE_SHORTENING');
    if (additionalPaymentMinor > 0n) warnings.push('ADDITIONAL_PAYMENT_REQUIRED');
    if (refundMinor > 0n) warnings.push('REFUND_EXPECTED');

    return {
      currentFingerprint: this.fingerprint(booking),
      currentResponse: {
        chargeableDays:
          latestApplied?.pricingSnapshot?.proposedChargeableDays ??
          booking.pricingSnapshot!.chargeableDays,
        endMethod: currentEndMethod,
        rentalEnd: currentEnd.toISOString(),
        rentalStart: currentStart.toISOString(),
        startMethod: currentStartMethod,
        totalMinor: currentTotal.toString(),
      },
      financialResponse: {
        additionalPaymentMinor: additionalPaymentMinor.toString(),
        currency: bookingCurrency,
        expectedRefundMinor: refundMinor.toString(),
        proposedEconomicTotalMinor: proposedEconomicTotal.toString(),
        retainedNonRefundableRentalMinor: retainedRentalReduction.toString(),
      },
      fulfillmentPolicyVersionId: currentPolicy!.id,
      privateCommission: {
        currentMinor: currentCommission.toString(),
        proposedMinor: proposedCommission.toString(),
        ruleId: booking.commissionSnapshot!.ruleId,
        ruleVersion: booking.commissionSnapshot!.ruleVersion,
      },
      privateOwnerEarnings: {
        currentMinor: currentOwnerEarnings.toString(),
        proposedMinor: proposedOwnerEarnings.toString(),
      },
      proposal,
      proposedResponse: {
        addedDurationMinutes: Math.max(
          0,
          Math.round((proposedEnd.getTime() - currentEnd.getTime()) / 60_000),
        ),
        chargeableDays,
        collectionFeeMinor: proposedCollectionFee.toString(),
        durationDiscount: {
          amountMinor: proposedDiscount.amountMinor.toString(),
          applied: proposedDiscount.amountMinor > 0,
          basisPoints: proposedDiscount.basisPoints,
          tier: proposedDiscount.tier,
        },
        endMethod,
        deliveryFeeMinor: proposedDeliveryFee.toString(),
        fulfillmentMinor: proposedFulfillment.toString(),
        rentalEnd: proposedEnd.toISOString(),
        rentalMinor: proposedRental.toString(),
        rentalStart: proposedStart.toISOString(),
        startMethod,
        totalDurationMinutes: Math.round(
          (proposedEnd.getTime() - proposedStart.getTime()) / 60_000,
        ),
      },
      warnings,
    };
  }

  private assertEligible(booking: PreviewBooking, evaluatedAt: Date) {
    const activeExtension = booking.status === BookingStatus.ACTIVE;
    if (
      !activeExtension &&
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.READY_FOR_PICKUP
    )
      this.fail('BOOKING_STATE_CHANGED', 'Booking cannot be changed.', HttpStatus.CONFLICT);
    if (activeExtension ? !booking.actualPickupAt : Boolean(booking.actualPickupAt))
      this.fail(
        'BOOKING_STATE_CHANGED',
        'Booking lifecycle authority is unavailable.',
        HttpStatus.CONFLICT,
      );
    if (
      !activeExtension &&
      (booking.pickupChallenges.some((item) => item.consumedAt) ||
        evaluatedAt >= booking.rentalStart)
    )
      this.fail(
        'BOOKING_STATE_CHANGED',
        'Booking cannot be changed after pickup.',
        HttpStatus.CONFLICT,
      );
    if (booking.operationalHold)
      this.fail(
        'BOOKING_STATE_CHANGED',
        'Booking changes are temporarily unavailable.',
        HttpStatus.CONFLICT,
      );
    if (
      booking.cancellationSettlement ||
      booking.disputes.length ||
      booking.postReturnClaims.length
    )
      this.fail('BOOKING_STATE_CHANGED', 'Booking changes are unavailable.', HttpStatus.CONFLICT);
    if (
      booking.amendments.some(
        (item) =>
          item.status === BookingAmendmentStatus.PENDING_OWNER ||
          item.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING ||
          item.status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      )
    )
      this.fail(
        'AMENDMENT_ALREADY_PENDING',
        'A booking change is already pending.',
        HttpStatus.CONFLICT,
      );
    const payment = booking.payments[0];
    if (
      !payment ||
      payment.status !== PaymentStatus.CAPTURED ||
      !payment.capturedAt ||
      payment.reconciliationRequired ||
      !booking.pricingSnapshot ||
      !booking.fulfillmentSnapshot ||
      !booking.commissionSnapshot ||
      !booking.ownerEarning ||
      !booking.vehicle.location
    )
      this.fail(
        'BOOKING_STATE_CHANGED',
        'Booking financial authority is unavailable.',
        HttpStatus.CONFLICT,
      );
    if (
      booking.vehicle.status !== VehicleLifecycleStatus.APPROVED ||
      booking.vehicle.operationalStatus !== VehicleOperationalStatus.AVAILABLE
    )
      this.fail('VEHICLE_UNAVAILABLE', 'The vehicle is unavailable.', HttpStatus.CONFLICT);
  }

  private async assertFulfillment(
    policyVersionId: string,
    proposal: CanonicalAmendmentProposal,
    booking: PreviewBooking,
    evaluatedAt: Date,
  ) {
    const base = booking.vehicle.location!;
    const candidates = [
      {
        destination: proposal.deliveryDestination,
        method: proposal.startMethod,
        scheduledAt: new Date(proposal.rentalStart),
      },
      {
        destination: proposal.collectionDestination,
        method: proposal.endMethod,
        scheduledAt: new Date(proposal.rentalEnd),
      },
    ];
    for (const candidate of booking.status === BookingStatus.ACTIVE
      ? candidates.slice(1)
      : candidates) {
      let result: Awaited<ReturnType<FulfillmentServiceabilityService['evaluate']>>;
      try {
        result = await this.fulfillment.evaluate({
          destinationLatitude: candidate.destination?.latitude ?? Number(base.latitude),
          destinationLongitude: candidate.destination?.longitude ?? Number(base.longitude),
          method: candidate.method,
          now: evaluatedAt,
          policyVersionId,
          scheduledAt: candidate.scheduledAt,
        });
      } catch {
        this.fail(
          'FULFILLMENT_UNAVAILABLE',
          'The requested handover option is unavailable.',
          HttpStatus.CONFLICT,
        );
      }
      if (!result.supported)
        this.fail(
          result.reason === 'OUTSIDE_SERVICE_RADIUS'
            ? 'DESTINATION_NOT_SERVICEABLE'
            : 'FULFILLMENT_UNAVAILABLE',
          'The requested handover option is unavailable.',
          HttpStatus.CONFLICT,
        );
    }
  }

  private async assertAvailable(
    booking: PreviewBooking,
    start: Date,
    end: Date,
    turnaroundMinutes: number,
    currentStart: Date,
    currentEnd: Date,
  ) {
    const activeExtension = booking.status === BookingStatus.ACTIVE;
    const conflict = await this.availability.occupancyConflict({
      end,
      excludeBookingId: booking.id,
      start: activeExtension ? currentEnd : start,
      turnaroundMinutes,
      vehicleId: booking.vehicleId,
    });
    if (!conflict) return;
    const returnBoundaryOnly =
      start.getTime() === currentStart.getTime() && end.getTime() > currentEnd.getTime();
    this.fail(
      conflict.turnaroundOnly
        ? 'PREPARATION_TIME_CONFLICT'
        : returnBoundaryOnly &&
            (conflict.reason === 'BOOKING_RESERVED' || conflict.reason === 'AMENDMENT_HELD')
          ? 'RETURN_TIME_UNAVAILABLE'
          : conflict.reason === 'BOOKING_RESERVED' || conflict.reason === 'AMENDMENT_HELD'
            ? 'DATES_UNAVAILABLE'
            : 'VEHICLE_UNAVAILABLE',
      'The vehicle is unavailable for the proposed period.',
      HttpStatus.CONFLICT,
    );
  }

  private assertFulfillmentRemovalAllowed(
    booking: PreviewBooking,
    currentStartMethod: CanonicalAmendmentProposal['startMethod'],
    currentEndMethod: CanonicalAmendmentProposal['endMethod'],
    proposedStartMethod: CanonicalAmendmentProposal['startMethod'],
    proposedEndMethod: CanonicalAmendmentProposal['endMethod'],
  ) {
    const deliveryRemoved =
      currentStartMethod === 'OWNER_DELIVERY' && proposedStartMethod !== 'OWNER_DELIVERY';
    const collectionRemoved =
      currentEndMethod === 'OWNER_COLLECTION' && proposedEndMethod !== 'OWNER_COLLECTION';
    if (!deliveryRemoved && !collectionRemoved) return;
    const performed = booking.handoverTravelEvents.some(
      (event) =>
        event.status === HandoverTravelStatus.ARRIVED &&
        ((deliveryRemoved && event.phase === HandoverPhase.START) ||
          (collectionRemoved && event.phase === HandoverPhase.RETURN)),
    );
    if (performed)
      this.fail(
        'FULFILLMENT_UNAVAILABLE',
        'The requested handover option is unavailable.',
        HttpStatus.CONFLICT,
      );
  }

  private destination(
    proposed: AmendmentDestinationDto | null | undefined,
    inherited: Destination | null,
    required: boolean,
  ): Destination | null {
    if (!required) return null;
    const value = proposed === undefined ? inherited : proposed;
    if (!value)
      this.fail('VALIDATION_ERROR', 'A destination is required.', HttpStatus.UNPROCESSABLE_ENTITY);
    return {
      ...(value!.addressLine1 ? { addressLine1: value!.addressLine1 } : {}),
      ...(value!.barangay ? { barangay: value!.barangay } : {}),
      city: value!.city,
      country: value!.country ?? 'PH',
      latitude: Number(value!.latitude),
      longitude: Number(value!.longitude),
      ...(value!.postalCode ? { postalCode: value!.postalCode } : {}),
      province: value!.province,
    };
  }

  private snapshotDestination(
    snapshot: NonNullable<PreviewBooking['fulfillmentSnapshot']>,
    side: 'end' | 'start',
  ): Destination {
    return {
      ...(snapshot[`${side}AddressLine1`]
        ? { addressLine1: snapshot[`${side}AddressLine1`]! }
        : {}),
      ...(snapshot[`${side}Barangay`] ? { barangay: snapshot[`${side}Barangay`]! } : {}),
      city: snapshot[`${side}City`],
      country: snapshot[`${side}Country`],
      latitude: Number(snapshot[`${side}Latitude`]),
      longitude: Number(snapshot[`${side}Longitude`]),
      ...(snapshot[`${side}PostalCode`] ? { postalCode: snapshot[`${side}PostalCode`]! } : {}),
      province: snapshot[`${side}Province`],
    };
  }

  private currentServiceFees(
    booking: PreviewBooking,
    applied: PreviewBooking['amendments'][number]['fulfillmentSnapshot'] | null,
    startMethod: CanonicalAmendmentProposal['startMethod'],
    endMethod: CanonicalAmendmentProposal['endMethod'],
    total: bigint,
  ): { collection: bigint; delivery: bigint } {
    if (!applied)
      return {
        collection: BigInt(booking.fulfillmentSnapshot!.collectionFeeMinor),
        delivery: BigInt(booking.fulfillmentSnapshot!.deliveryFeeMinor),
      };
    const evidence = jsonRecord(applied.serviceabilitySnapshot);
    const delivery = bigintFromJson(evidence?.proposedDeliveryFeeMinor);
    const collection = bigintFromJson(evidence?.proposedCollectionFeeMinor);
    if (delivery !== null && collection !== null) return { collection, delivery };
    if (startMethod === 'OWNER_DELIVERY' && endMethod !== 'OWNER_COLLECTION')
      return { collection: 0n, delivery: total };
    if (startMethod !== 'OWNER_DELIVERY' && endMethod === 'OWNER_COLLECTION')
      return { collection: total, delivery: 0n };
    if (startMethod !== 'OWNER_DELIVERY' && endMethod !== 'OWNER_COLLECTION')
      return { collection: 0n, delivery: 0n };
    this.fail(
      'BOOKING_STATE_CHANGED',
      'Applied fulfillment pricing cannot be reconstructed.',
      HttpStatus.CONFLICT,
    );
  }

  private findAuthorized(renterUserId: string, reference: string) {
    return this.database.client.booking.findFirst({
      include: AMENDMENT_PREVIEW_INCLUDE,
      where: {
        renterUserId,
        OR: [{ publicReference: reference }, ...(isUuid(reference) ? [{ id: reference }] : [])],
      },
    });
  }

  private fingerprint(booking: PreviewBooking): string {
    const applied = booking.amendments
      .filter((item) => item.status === BookingAmendmentStatus.APPLIED)
      .toSorted(compareAppliedAmendments)
      .map((item) => ({
        appliedAt: item.appliedAt?.toISOString(),
        fulfillment: item.fulfillmentSnapshot
          ? {
              currency: item.fulfillmentSnapshot.currency,
              destinationSnapshot: item.fulfillmentSnapshot.destinationSnapshot,
              proposedFulfillmentTotalMinor:
                item.fulfillmentSnapshot.proposedFulfillmentTotalMinor.toString(),
              serviceabilitySnapshot: item.fulfillmentSnapshot.serviceabilitySnapshot,
            }
          : null,
        id: item.id,
        pricing: item.pricingSnapshot
          ? {
              currency: item.pricingSnapshot.currency,
              durationDiscountTier: item.pricingSnapshot.durationDiscountTier,
              proposedChargeableDays: item.pricingSnapshot.proposedChargeableDays,
              proposedCommissionMinor: item.pricingSnapshot.proposedCommissionMinor.toString(),
              proposedOwnerEarningsMinor:
                item.pricingSnapshot.proposedOwnerEarningsMinor.toString(),
              proposedRentalSubtotalMinor:
                item.pricingSnapshot.proposedRentalSubtotalMinor.toString(),
            }
          : null,
        proposedEndMethod: item.proposedEndMethod,
        proposedRentalEnd: item.proposedRentalEnd.toISOString(),
        proposedRentalStart: item.proposedRentalStart.toISOString(),
        proposedStartMethod: item.proposedStartMethod,
        settlement: item.settlement
          ? { proposedTotalMinor: item.settlement.proposedTotalMinor.toString() }
          : null,
      }));
    return digest({
      amendments: applied,
      booking: {
        actualPickupAt: booking.actualPickupAt?.toISOString(),
        fulfillment: booking.fulfillmentSnapshot
          ? {
              collectionFeeMinor: booking.fulfillmentSnapshot.collectionFeeMinor.toString(),
              endDestination: this.snapshotDestination(booking.fulfillmentSnapshot, 'end'),
              endMethod: booking.fulfillmentSnapshot.endMethod,
              startDestination: this.snapshotDestination(booking.fulfillmentSnapshot, 'start'),
              startMethod: booking.fulfillmentSnapshot.startMethod,
              deliveryFeeMinor: booking.fulfillmentSnapshot.deliveryFeeMinor.toString(),
            }
          : null,
        operationalHold: booking.operationalHold,
        originalCommission: booking.commissionSnapshot
          ? {
              calculatedCommissionMinor:
                booking.commissionSnapshot.calculatedCommissionMinor.toString(),
              calculationVersion: booking.commissionSnapshot.calculationVersion,
              fixedAmountMinor: booking.commissionSnapshot.fixedAmountMinor.toString(),
              maximumAmountMinor: booking.commissionSnapshot.maximumAmountMinor?.toString() ?? null,
              minimumAmountMinor: booking.commissionSnapshot.minimumAmountMinor?.toString() ?? null,
              rateBasisPoints: booking.commissionSnapshot.rateBasisPoints,
              ruleId: booking.commissionSnapshot.ruleId,
              ruleVersion: booking.commissionSnapshot.ruleVersion,
            }
          : null,
        originalPricing: booking.pricingSnapshot
          ? {
              chargeableDays: booking.pricingSnapshot.chargeableDays,
              currency: booking.pricingSnapshot.currency,
              discountedRentalSubtotalMinor:
                booking.pricingSnapshot.discountedRentalSubtotalMinor.toString(),
              durationDiscountTier: booking.pricingSnapshot.durationDiscountTier,
              policyVersionId: booking.pricingSnapshot.policyVersionId,
              vehicleTimezone: booking.pricingSnapshot.vehicleTimezone,
            }
          : null,
        ownerEarningMinor: booking.ownerEarning?.netEarningAmountMinor.toString() ?? null,
        rentalEnd: booking.rentalEnd.toISOString(),
        rentalStart: booking.rentalStart.toISOString(),
        status: booking.status,
      },
      payment: booking.payments[0]
        ? {
            capturedAmountMinor: booking.payments[0].capturedAmountMinor.toString(),
            reconciliationRequired: booking.payments[0].reconciliationRequired,
            status: booking.payments[0].status,
          }
        : null,
    });
  }

  private sign(claims: AmendmentPreviewClaims): string {
    const payload = Buffer.from(canonicalJson(claims)).toString('base64url');
    const signature = createHmac(
      'sha256',
      this.configuration.getOrThrow('TOKEN_HASH_SECRET', { infer: true }),
    )
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private verifySignature(token: string): AmendmentPreviewClaims {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) this.invalidToken();
    const expected = createHmac(
      'sha256',
      this.configuration.getOrThrow('TOKEN_HASH_SECRET', { infer: true }),
    )
      .update(payload!)
      .digest();
    const actual = Buffer.from(signature!, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      this.invalidToken();
    try {
      const claims = JSON.parse(
        Buffer.from(payload!, 'base64url').toString('utf8'),
      ) as AmendmentPreviewClaims;
      if (claims.version !== PREVIEW_VERSION) this.invalidToken();
      return claims;
    } catch {
      this.invalidToken();
    }
  }

  private invalidToken(): never {
    this.fail('AMENDMENT_PREVIEW_INVALID', 'Invalid amendment preview token.', HttpStatus.CONFLICT);
  }

  private fail(code: string, message: string, status: HttpStatus): never {
    throw new ApplicationException(code, message, status);
  }
}

export function calculateAmendmentCommission(gross: bigint, snapshot: CommissionAuthority): bigint {
  let value = (gross * BigInt(snapshot.rateBasisPoints)) / 10_000n + snapshot.fixedAmountMinor;
  if (snapshot.minimumAmountMinor !== null && value < snapshot.minimumAmountMinor)
    value = snapshot.minimumAmountMinor;
  if (snapshot.maximumAmountMinor !== null && value > snapshot.maximumAmountMinor)
    value = snapshot.maximumAmountMinor;
  return value > gross ? gross : value;
}

interface CommissionAuthority {
  fixedAmountMinor: bigint;
  maximumAmountMinor: bigint | null;
  minimumAmountMinor: bigint | null;
  rateBasisPoints: number;
}

export function reconcileAmendmentPreviewFinancials(input: {
  commission: CommissionAuthority;
  currentTotal: bigint;
  proposedFulfillment: bigint;
  proposedRental: bigint;
  retainedRental: bigint;
}) {
  const policyAdjustedRental = input.proposedRental + input.retainedRental;
  const policyAdjustedTotal = policyAdjustedRental + input.proposedFulfillment;
  const delta = policyAdjustedTotal - input.currentTotal;
  const additionalPaymentMinor = delta > 0n ? delta : 0n;
  const refundMinor = delta < 0n ? -delta : 0n;
  const proposedCommission = calculateAmendmentCommission(policyAdjustedRental, input.commission);
  const proposedOwnerEarnings =
    policyAdjustedRental - proposedCommission + input.proposedFulfillment;
  return {
    additionalPaymentMinor,
    policyAdjustedRental,
    policyAdjustedTotal,
    proposedCommission,
    proposedOwnerEarnings,
    refundMinor,
  };
}

function compareAppliedAmendments(
  left: PreviewBooking['amendments'][number],
  right: PreviewBooking['amendments'][number],
): number {
  const appliedOrder = (left.appliedAt?.getTime() ?? 0) - (right.appliedAt?.getTime() ?? 0);
  return appliedOrder || left.id.localeCompare(right.id);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const serializable = value as { toJSON?: () => unknown };
    if (typeof serializable.toJSON === 'function') return canonicalJson(serializable.toJSON());
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function localDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(value);
}

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function bigintFromJson(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function destinationFromJson(value: unknown): Destination | null {
  const record = jsonRecord(value as Prisma.JsonValue);
  if (
    !record ||
    typeof record.city !== 'string' ||
    typeof record.province !== 'string' ||
    !Number.isFinite(Number(record.latitude)) ||
    !Number.isFinite(Number(record.longitude))
  )
    return null;
  return {
    ...(typeof record.addressLine1 === 'string' ? { addressLine1: record.addressLine1 } : {}),
    ...(typeof record.barangay === 'string' ? { barangay: record.barangay } : {}),
    city: record.city,
    country: typeof record.country === 'string' ? record.country : 'PH',
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    ...(typeof record.postalCode === 'string' ? { postalCode: record.postalCode } : {}),
    province: record.province,
  };
}
