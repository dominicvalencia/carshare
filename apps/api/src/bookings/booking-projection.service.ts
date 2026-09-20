import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import { FileAssetStatus, FileClassification, Prisma } from '@carrental/database';
import { FilesService } from '../files/files.service';
import { workflowCompliance } from '../rentals/workflow-compliance';

export const bookingInclude = {
  overdueHandoverRecovery: {
    include: {
      acceptance: true,
      response: true,
      reminders: {
        orderBy: [{ scheduledAt: 'asc' }, { channel: 'asc' }],
        select: {
          channel: true,
          failureCategory: true,
          safeFailureMessage: true,
          scheduledAt: true,
          stage: true,
          status: true,
          submittedAt: true,
          deliveredAt: true,
        },
      },
    },
  },
  handoverEvidenceWaivers: true,
  handoverTravelEvents: true,
  inspections: {
    where: { status: 'FINALIZED' as const },
    include: {
      confirmations: {
        include: {
          discrepancyResponses: {
            include: { resolutionReview: { include: { operationsResolution: true } } },
            orderBy: { roundNumber: 'asc' as const },
          },
        },
      },
    },
    orderBy: { version: 'asc' as const },
  },
  rentalIncidents: true,
  disputes: true,
  fulfillmentSnapshot: true,
  conversation: { select: { id: true } },
  cancellation: true,
  cancellationSettlement: { include: { refund: true } },
  occupancy: {
    select: {
      active: true,
      expiresAt: true,
      occupiedEnd: true,
      occupiedStart: true,
      releaseReason: true,
      releasedAt: true,
      type: true,
    },
  },
  owner: {
    select: { createdAt: true, profile: { select: { displayName: true, firstName: true } } },
  },
  ownerDecision: true,
  commissionSnapshot: true,
  ownerEarning: true,
  payments: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      amountMinor: true,
      authorizedAmountMinor: true,
      capturedAmountMinor: true,
      currency: true,
      purpose: true,
      refundedAmountMinor: true,
      status: true,
    },
  },
  policySnapshot: true,
  pricingSnapshot: { include: { lines: { orderBy: { displayOrder: 'asc' as const } } } },
  renter: {
    select: {
      _count: {
        select: { renterBookings: { where: { status: 'COMPLETED' as const } } },
      },
      createdAt: true,
      emailVerifiedAt: true,
      mobileVerifiedAt: true,
      profile: {
        select: {
          avatarFile: { select: { classification: true, id: true, status: true } },
          displayName: true,
          firstName: true,
          lastName: true,
        },
      },
      status: true,
      subjectReviews: {
        select: { rating: true },
        where: { moderationStatus: 'PUBLISHED' as const, type: 'RENTER' as const },
      },
      verifications: { select: { expiresAt: true, status: true, type: true } },
    },
  },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
  vehicle: {
    select: {
      operationalStatus: true,
      category: { select: { name: true } },
      fuelType: true,
      id: true,
      location: { select: { city: true, country: true, province: true } },
      make: true,
      model: true,
      modelYear: true,
      photos: {
        select: {
          fileAsset: { select: { classification: true, id: true, status: true } },
        },
        take: 1,
        where: { isCover: true, removedAt: null },
      },
      powertrain: true,
      transmission: true,
      variant: true,
    },
  },
} satisfies Prisma.BookingInclude;

export type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

@Injectable()
export class BookingProjectionService {
  constructor(
    private readonly files: FilesService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  renter(booking: BookingRecord) {
    return {
      workflowCompliance: workflowCompliance(
        {
          ...booking,
          pickupWindowEnd:
            booking.pickupWindowEnd ??
            new Date(
              booking.rentalStart.getTime() +
                this.configuration.getOrThrow('PICKUP_WINDOW_GRACE_MINUTES', { infer: true }) *
                  60_000,
            ),
        },
        this.configuration.getOrThrow('RETURN_CONFIRMATION_GRACE_MINUTES', { infer: true }),
        null,
      ),
      cancellation: booking.cancellation
        ? {
            createdAt: booking.cancellation.createdAt,
            reasonCode: booking.cancellation.reasonCode,
            reasonText: booking.cancellation.reasonText,
          }
        : null,
      cancellationSettlement: booking.cancellationSettlement
        ? this.serializeSettlement(booking.cancellationSettlement)
        : null,
      createdAt: booking.createdAt,
      conversationId: booking.conversation?.id ?? null,
      holdExpiresAt: booking.holdExpiresAt,
      fulfillment: this.fulfillment(booking),
      owner: {
        displayName:
          booking.owner.profile?.displayName ??
          booking.owner.profile?.firstName ??
          'Verified owner',
        memberSince: booking.owner.createdAt,
        verified: true,
      },
      ownerResponseDeadlineAt: booking.ownerResponseDeadlineAt,
      overdueHandoverRecovery: booking.overdueHandoverRecovery
        ? {
            acceptance: booking.overdueHandoverRecovery.acceptance
              ? {
                  acceptedAt: booking.overdueHandoverRecovery.acceptance.acceptedAt,
                  acceptanceSource: booking.overdueHandoverRecovery.acceptance.acceptanceSource,
                }
              : null,
            reportedAt: booking.overdueHandoverRecovery.reportedAt,
            reportedPickupAt: booking.overdueHandoverRecovery.reportedPickupAt,
            reportedReturnAt: booking.overdueHandoverRecovery.reportedReturnAt,
            response: booking.overdueHandoverRecovery.response
              ? {
                  decision: booking.overdueHandoverRecovery.response.decision,
                  reason: booking.overdueHandoverRecovery.response.reason,
                  respondedAt: booking.overdueHandoverRecovery.response.respondedAt,
                }
              : null,
            responseDeadlineAt: booking.overdueHandoverRecovery.responseDeadlineAt,
            reminders: booking.overdueHandoverRecovery.reminders,
            scope: booking.overdueHandoverRecovery.scope,
          }
        : null,
      pickupWindow: {
        closesAt: new Date(
          booking.rentalStart.getTime() +
            this.configuration.getOrThrow('PICKUP_WINDOW_GRACE_MINUTES', { infer: true }) * 60_000,
        ),
        opensAt: new Date(
          booking.rentalStart.getTime() -
            this.configuration.getOrThrow('PICKUP_WINDOW_EARLY_MINUTES', { infer: true }) * 60_000,
        ),
      },
      policy: this.policy(booking),
      payments: booking.payments.map((payment) => ({
        amountMinor: Number(payment.amountMinor),
        authorizedAmountMinor: Number(payment.authorizedAmountMinor),
        capturedAmountMinor: Number(payment.capturedAmountMinor),
        currency: payment.currency,
        purpose: payment.purpose,
        refundedAmountMinor: Number(payment.refundedAmountMinor),
        status: payment.status,
      })),
      pricing: this.pricing(booking),
      publicReference: booking.publicReference,
      rentalEnd: booking.rentalEnd,
      rentalStart: booking.rentalStart,
      status: booking.status,
      statusHistory: booking.statusHistory.map((history) => ({
        actorType: history.actorType,
        fromStatus: history.fromStatus,
        occurredAt: history.occurredAt,
        reasonCode: history.reasonCode,
        reasonText: history.reasonText,
        toStatus: history.toStatus,
      })),
      vehicle: this.vehicle(booking),
    };
  }

  private serializeSettlement(settlement: NonNullable<BookingRecord['cancellationSettlement']>) {
    return {
      calculationVersion: settlement.calculationVersion,
      capturedAmountMinor: settlement.capturedAmountMinor.toString(),
      collectionRefundedMinor: settlement.collectionRefundedMinor.toString(),
      commissionRetainedMinor: settlement.commissionRetainedMinor.toString(),
      currency: settlement.currency,
      deliveryCompleted: settlement.deliveryCompleted,
      deliveryCompletionBasis: settlement.deliveryCompletionBasis,
      deliveryRefundedMinor: settlement.deliveryRefundedMinor.toString(),
      deliveryRetainedMinor: settlement.deliveryRetainedMinor.toString(),
      refundAmountMinor: settlement.refundAmountMinor.toString(),
      refundStatus: settlement.refund?.status ?? null,
      rentalComponentMinor: settlement.rentalComponentMinor.toString(),
    };
  }

  owner(booking: BookingRecord) {
    const profile = booking.renter.profile;
    const identity = booking.renter.verifications.find(({ type }) => type === 'IDENTITY');
    const license = booking.renter.verifications.find(({ type }) => type === 'DRIVER_LICENSE');
    const approved = (status?: string) => status === 'APPROVED' || status === 'VERIFIED';
    const driverLicenseVerified = Boolean(
      license && approved(license.status) && (!license.expiresAt || license.expiresAt > new Date()),
    );
    const identityVerified = approved(identity?.status);
    const emailVerified = Boolean(booking.renter.emailVerifiedAt);
    const mobileVerified = Boolean(booking.renter.mobileVerifiedAt);
    const verified =
      booking.renter.status === 'ACTIVE' &&
      identityVerified &&
      driverLicenseVerified &&
      emailVerified &&
      mobileVerified;
    const avatar = profile?.avatarFile;
    const ratings = booking.renter.subjectReviews.map(({ rating }) => rating);
    return {
      ...this.renter(booking),
      owner: undefined,
      renter: {
        accountStanding: booking.renter.status === 'ACTIVE' ? 'GOOD_STANDING' : 'RESTRICTED',
        averageRating: ratings.length
          ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length
          : null,
        completedRentals: booking.renter._count.renterBookings,
        displayName:
          profile?.displayName ??
          ([profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || 'Renter'),
        driverLicenseVerified,
        emailVerified,
        identityVerified,
        memberSince: booking.renter.createdAt,
        mobileVerified,
        profilePhoto:
          avatar?.classification === FileClassification.PUBLIC &&
          avatar.status === FileAssetStatus.READY
            ? this.files.trustedPublicGrant(avatar.id)
            : null,
        reviewCount: ratings.length,
        verificationLabel: verified
          ? 'Verified renter'
          : identity?.status === 'SUSPENDED' || license?.status === 'SUSPENDED'
            ? 'Verification suspended'
            : [identity?.status, license?.status].includes('SUBMITTED') ||
                [identity?.status, license?.status].includes('UNDER_REVIEW')
              ? 'Verification pending'
              : 'Verification incomplete',
        verified,
      },
      earning: booking.ownerEarning
        ? {
            collectionEarningMinor: Number(booking.ownerEarning.collectionEarningMinor),
            commissionAmountMinor: Number(booking.ownerEarning.commissionAmountMinor),
            currency: booking.ownerEarning.currency,
            deliveryEarningMinor: Number(booking.ownerEarning.deliveryEarningMinor),
            netEarningAmountMinor: Number(booking.ownerEarning.netEarningAmountMinor),
            status: booking.ownerEarning.status,
          }
        : null,
    };
  }

  admin(booking: BookingRecord) {
    return {
      ...this.owner(booking),
      bookingId: booking.id,
      diagnostics: {
        canProgress:
          booking.status === 'HOLD' ||
          booking.status === 'AWAITING_PAYMENT' ||
          booking.status === 'AWAITING_OWNER',
        occupancy: booking.occupancy,
        reason: booking.payments.some(
          (payment) => payment.status === 'AUTHORIZING' || payment.status === 'CAPTURING',
        )
          ? 'PAYMENT_RECONCILIATION_MAY_BE_REQUIRED'
          : null,
      },
      ownerUserId: booking.ownerUserId,
      renterUserId: booking.renterUserId,
      vehicleId: booking.vehicleId,
    };
  }

  private vehicle(booking: BookingRecord) {
    const photo = booking.vehicle.photos[0]?.fileAsset;
    return {
      category: booking.vehicle.category?.name ?? null,
      coverPhoto:
        photo?.classification === FileClassification.PUBLIC &&
        photo.status === FileAssetStatus.READY
          ? this.files.trustedPublicGrant(photo.id)
          : null,
      fuelType: booking.vehicle.fuelType,
      location: booking.vehicle.location,
      make: booking.vehicle.make,
      model: booking.vehicle.model,
      powertrain: booking.vehicle.powertrain,
      transmission: booking.vehicle.transmission,
      variant: booking.vehicle.variant,
      vehicleId: booking.vehicle.id,
      year: booking.vehicle.modelYear,
    };
  }

  private policy(booking: BookingRecord) {
    const policy = booking.policySnapshot;
    if (!policy) return null;
    return {
      availability: {
        monday: policy.monday,
        tuesday: policy.tuesday,
        wednesday: policy.wednesday,
        thursday: policy.thursday,
        friday: policy.friday,
        saturday: policy.saturday,
        sunday: policy.sunday,
        type: policy.availabilityPolicy,
      },
      cancellationPolicyRef: policy.cancellationPolicyRef,
      claimWindowHours: policy.claimWindowHours,
      evReturn: policy.evReturnPolicy
        ? {
            calculationPolicyRef: policy.evCalculationPolicyRef,
            requiredPercentage: policy.evRequiredPercentage,
            tolerancePercent: policy.evTolerancePercent,
            type: policy.evReturnPolicy,
          }
        : null,
      fuelReturn: policy.fuelReturnPolicy
        ? {
            calculationPolicyRef: policy.fuelCalculationPolicyRef,
            tolerancePercent: policy.fuelTolerancePercent,
            type: policy.fuelReturnPolicy,
          }
        : null,
      mileage: {
        excessKilometerRateMinor: policy.excessKilometerRateMinor,
        includedKilometersPerDay: policy.includedKilometersPerDay,
        type: policy.mileagePolicy,
      },
      policyVersionId: policy.policyVersionId,
      turnaroundMinutes: policy.turnaroundMinutes,
    };
  }

  private pricing(booking: BookingRecord) {
    const pricing = booking.pricingSnapshot;
    if (!pricing) return null;
    return {
      baseRentalAmountMinor: pricing.baseRentalAmountMinor,
      chargeableDays: pricing.chargeableDays,
      currency: pricing.currency,
      discountedRentalSubtotalMinor: pricing.discountedRentalSubtotalMinor,
      durationDiscountAmountMinor: pricing.durationDiscountAmountMinor,
      durationDiscountBps: pricing.durationDiscountBps,
      durationDiscountTier: pricing.durationDiscountTier,
      excessKilometerRateMinor: pricing.excessKilometerRateMinor,
      includedMileageKm: pricing.includedMileageKm,
      lines: pricing.lines.map((line) => ({
        amountMinor: line.amountMinor,
        code: line.code,
        description: line.description,
        displayOrder: line.displayOrder,
        quantity: line.quantity,
        unitAmountMinor: line.unitAmountMinor,
      })),
      policyVersionId: pricing.policyVersionId,
      pricingEngineVersion: pricing.pricingEngineVersion,
      quoteId: pricing.quoteId,
      rentalEnd: pricing.rentalEnd,
      rentalStart: pricing.rentalStart,
      subtotalMinor: pricing.subtotalMinor,
      totalMinor: pricing.totalMinor,
      unlimitedMileage: pricing.unlimitedMileage,
      vehicleTimezone: pricing.vehicleTimezone,
    };
  }

  private fulfillment(booking: BookingRecord) {
    const snapshot = booking.fulfillmentSnapshot;
    if (!snapshot)
      return {
        collectionDistanceMeters: null,
        collectionFeeMinor: 0,
        deliveryDistanceMeters: null,
        deliveryFeeMinor: 0,
        endMethod: 'RENTER_RETURN',
        legacyCompatibility: true,
        startMethod: 'RENTER_PICKUP',
      };
    const location = (prefix: 'start' | 'end') => ({
      addressLine1: snapshot[`${prefix}AddressLine1`],
      barangay: snapshot[`${prefix}Barangay`],
      city: snapshot[`${prefix}City`],
      country: snapshot[`${prefix}Country`],
      latitude: Number(snapshot[`${prefix}Latitude`]),
      longitude: Number(snapshot[`${prefix}Longitude`]),
      postalCode: snapshot[`${prefix}PostalCode`],
      province: snapshot[`${prefix}Province`],
    });
    return {
      collectionDistanceMeters: snapshot.collectionDistanceMeters,
      collectionFeeMinor: snapshot.collectionFeeMinor,
      endLocation: location('end'),
      endMethod: snapshot.endMethod,
      legacyCompatibility: false,
      minimumNoticeMinutes: snapshot.minimumNoticeMinutes,
      deliveryDistanceMeters: snapshot.deliveryDistanceMeters,
      deliveryFeeMinor: snapshot.deliveryFeeMinor,
      serviceRadiusMeters: snapshot.serviceRadiusMeters,
      startLocation: location('start'),
      startMethod: snapshot.startMethod,
    };
  }
}
