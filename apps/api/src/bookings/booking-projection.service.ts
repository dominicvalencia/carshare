import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingAmendmentSettlementStatus,
  BookingAmendmentStatus,
  FileAssetStatus,
  FileClassification,
  Prisma,
} from '@carrental/database';
import { FilesService } from '../files/files.service';
import { workflowCompliance } from '../rentals/workflow-compliance';
import { BookingErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import {
  isAllowedSecurityDepositTier,
  isSecurityDepositCurrency,
} from '../common/security-deposit-policy';

export const bookingInclude = {
  amendments: {
    include: { fulfillmentSnapshot: true, pricingSnapshot: true, settlement: true },
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
  overdueHandoverRecoveries: {
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
    orderBy: { reportedAt: 'desc' as const },
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
  securityDeposit: {
    include: {
      payment: {
        select: {
          customerActionUrl: true,
          reconciliationRequired: true,
          status: true,
        },
      },
    },
  },
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
        where: {
          moderationStatus: 'PUBLISHED' as const,
          publicationStatus: 'PUBLISHED' as const,
          type: 'RENTER' as const,
        },
      },
      verifications: {
        select: {
          documents: {
            select: {
              fileAsset: { select: { classification: true, id: true, status: true } },
            },
            where: {
              definition: { code: 'PROFILE_PHOTO' },
              replacedAt: null,
            },
          },
          expiresAt: true,
          status: true,
          type: true,
        },
      },
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
      policyVersions: {
        orderBy: { version: 'desc' as const },
        select: {
          supportsOwnerCollection: true,
          supportsOwnerDelivery: true,
          supportsRenterPickup: true,
          supportsRenterReturn: true,
        },
        take: 1,
      },
      powertrain: true,
      transmission: true,
      variant: true,
    },
  },
} satisfies Prisma.BookingInclude;

export type BookingRecord = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

type StartMethod = 'RENTER_PICKUP' | 'OWNER_DELIVERY';
type EndMethod = 'RENTER_RETURN' | 'OWNER_COLLECTION';

export function bookingSecurityDepositProjection(input: {
  readonly bookingStatus?: string;
  readonly executionAvailable?: boolean;
  readonly leadHours?: number;
  readonly now?: Date;
  readonly rentalPaymentCaptured?: boolean;
  readonly rentalStart?: Date;
  readonly policySnapshot: {
    readonly securityDepositAmountMinor: number | null;
    readonly securityDepositCurrency: string | null;
    readonly securityDepositRequired: boolean;
  } | null;
  readonly securityDeposit: {
    readonly authorizedAmountMinor: bigint;
    readonly currency: string;
    readonly requiredAmountMinor: bigint;
    readonly status: string;
    readonly usedAmountMinor: bigint;
    readonly payment?: {
      readonly customerActionUrl: string | null;
      readonly reconciliationRequired: boolean;
      readonly status: string;
    } | null;
  } | null;
}) {
  const snapshot = input.policySnapshot;
  if (!snapshot) return null;
  const inconsistent = (message: string): never => {
    throw new ApplicationException(
      BookingErrorCode.SECURITY_DEPOSIT_SNAPSHOT_INCONSISTENT,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  };
  if (!snapshot.securityDepositRequired) {
    if (snapshot.securityDepositAmountMinor !== null || snapshot.securityDepositCurrency !== null) {
      inconsistent('The booking no-deposit snapshot is inconsistent.');
    }
    if (
      input.securityDeposit &&
      (input.securityDeposit.requiredAmountMinor !== 0n ||
        input.securityDeposit.authorizedAmountMinor !== 0n ||
        input.securityDeposit.usedAmountMinor !== 0n)
    ) {
      inconsistent('The booking no-deposit lifecycle state is inconsistent.');
    }
    return {
      actionRequired: false,
      availableAt: null,
      eligibleAt: null,
      amountMinor: null,
      blockingPickup: false,
      capturedMinor: 0,
      currency: null,
      executionAvailable: false,
      heldMinor: 0,
      leadHours: input.leadHours ?? 48,
      isEligibleNow: false,
      releasedMinor: 0,
      required: false,
      status: 'NOT_REQUIRED',
    };
  }
  const amountMinor = snapshot.securityDepositAmountMinor;
  const currency = snapshot.securityDepositCurrency;
  const requiredAmountMinor =
    amountMinor ?? inconsistent('The required security deposit snapshot is incomplete.');
  const requiredCurrency =
    currency ?? inconsistent('The required security deposit snapshot is incomplete.');
  if (
    requiredAmountMinor <= 0 ||
    !isSecurityDepositCurrency(requiredCurrency) ||
    !isAllowedSecurityDepositTier(requiredCurrency, requiredAmountMinor)
  ) {
    inconsistent('The required security deposit snapshot is inconsistent.');
  }
  const lifecycle = input.securityDeposit;
  if (
    lifecycle &&
    (lifecycle.requiredAmountMinor !== BigInt(requiredAmountMinor) ||
      lifecycle.currency !== requiredCurrency)
  ) {
    inconsistent('The security deposit lifecycle does not match the booking snapshot.');
  }
  const authorizedMinor = Number(lifecycle?.authorizedAmountMinor ?? 0n);
  const usedMinor = Number(lifecycle?.usedAmountMinor ?? 0n);
  const leadHours = input.leadHours ?? 48;
  const availableAt = input.rentalStart
    ? new Date(input.rentalStart.getTime() - leadHours * 60 * 60 * 1000)
    : null;
  const now = input.now ?? new Date();
  const lifecycleEligible =
    input.bookingStatus === 'CONFIRMED' || input.bookingStatus === 'READY_FOR_PICKUP';
  const windowOpen = availableAt ? now >= availableAt : false;
  const held = lifecycle?.status === 'AUTHORIZED' && authorizedMinor >= requiredAmountMinor;
  const executionAvailable = input.executionAvailable ?? false;
  const payment = lifecycle?.payment;
  const providerOutcomeUnknown =
    lifecycle?.status === 'AUTHORIZING' &&
    Boolean(payment?.reconciliationRequired) &&
    !payment?.customerActionUrl;
  const resumableCheckout =
    lifecycle?.status === 'AUTHORIZING' && Boolean(payment?.customerActionUrl);
  const retrySafe =
    !lifecycle ||
    lifecycle.status === 'PENDING' ||
    lifecycle.status === 'FAILED' ||
    resumableCheckout;
  const isEligibleNow =
    executionAvailable && lifecycleEligible && Boolean(input.rentalPaymentCaptured) && windowOpen;
  return {
    actionRequired: isEligibleNow && !held && retrySafe,
    availableAt: availableAt?.toISOString() ?? null,
    eligibleAt: availableAt?.toISOString() ?? null,
    amountMinor: requiredAmountMinor,
    blockingPickup: executionAvailable && lifecycleEligible && !held,
    capturedMinor: usedMinor,
    currency: requiredCurrency,
    executionAvailable,
    heldMinor: Math.max(0, authorizedMinor - usedMinor),
    leadHours,
    isEligibleNow,
    releasedMinor: lifecycle?.status === 'RELEASED' ? authorizedMinor - usedMinor : 0,
    required: true,
    status: providerOutcomeUnknown
      ? 'UNKNOWN'
      : (lifecycle?.status ?? (availableAt && !windowOpen ? 'NOT_ELIGIBLE' : 'PENDING')),
  };
}

export function bookingAmendmentFulfillmentCapabilities(input: {
  actualPickupAt: Date | null;
  currentEndMethod: EndMethod;
  currentStartMethod: StartMethod;
  policy?: {
    supportsOwnerCollection: boolean;
    supportsOwnerDelivery: boolean;
    supportsRenterPickup: boolean;
    supportsRenterReturn: boolean;
  };
  status: string;
}) {
  const changeable =
    (input.status === 'CONFIRMED' || input.status === 'READY_FOR_PICKUP') && !input.actualPickupAt;
  const allowedStartMethods: StartMethod[] = [
    ...(input.policy?.supportsRenterPickup ? (['RENTER_PICKUP'] as const) : []),
    ...(input.policy?.supportsOwnerDelivery ? (['OWNER_DELIVERY'] as const) : []),
  ];
  const allowedEndMethods: EndMethod[] = [
    ...(input.policy?.supportsRenterReturn ? (['RENTER_RETURN'] as const) : []),
    ...(input.policy?.supportsOwnerCollection ? (['OWNER_COLLECTION'] as const) : []),
  ];
  if (!allowedStartMethods.includes(input.currentStartMethod))
    allowedStartMethods.push(input.currentStartMethod);
  if (!allowedEndMethods.includes(input.currentEndMethod))
    allowedEndMethods.push(input.currentEndMethod);
  return {
    allowedEndMethods,
    allowedStartMethods,
    endFulfillmentChangeable: changeable,
    startFulfillmentChangeable: changeable,
  };
}

@Injectable()
export class BookingProjectionService {
  constructor(
    private readonly files: FilesService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  renter(booking: BookingRecord) {
    const applied = booking.amendments.find(
      (amendment) => amendment.status === BookingAmendmentStatus.APPLIED,
    );
    const refundRecovery = booking.amendments.find(
      (amendment) => amendment.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    );
    const latestAmendment = booking.amendments[0] ?? null;
    const rentalStart = applied?.proposedRentalStart ?? booking.rentalStart;
    const rentalEnd = applied?.proposedRentalEnd ?? booking.rentalEnd;
    const serializeOverdueRecovery = (
      recovery: BookingRecord['overdueHandoverRecoveries'][number],
    ) => ({
      acceptance: recovery.acceptance
        ? {
            acceptedAt: recovery.acceptance.acceptedAt,
            acceptanceSource: recovery.acceptance.acceptanceSource,
          }
        : null,
      reportedAt: recovery.reportedAt,
      reportedPickupAt: recovery.reportedPickupAt,
      reportedReturnAt: recovery.reportedReturnAt,
      response: recovery.response
        ? {
            decision: recovery.response.decision,
            reason: recovery.response.reason,
            respondedAt: recovery.response.respondedAt,
          }
        : null,
      responseDeadlineAt: recovery.responseDeadlineAt,
      reminders: recovery.reminders,
      scope: recovery.scope,
    });
    const overdueHandoverRecovery =
      booking.overdueHandoverRecoveries.find(
        (recovery) => !recovery.acceptance && !recovery.response,
      ) ??
      booking.overdueHandoverRecoveries[0] ??
      null;
    return {
      workflowCompliance: workflowCompliance(
        {
          ...booking,
          rentalStart,
          rentalEnd,
          pickupWindowEnd:
            booking.pickupWindowEnd ??
            new Date(
              rentalStart.getTime() +
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
      amendmentRefundRecovery: refundRecovery
        ? {
            amendmentId: refundRecovery.id,
            operationallyExpiredAt: refundRecovery.operationallyExpiredAt,
            state:
              refundRecovery.settlement?.status === BookingAmendmentSettlementStatus.COMPLETED
                ? 'REFUND_SETTLED'
                : 'FINANCIAL_REFUND_RECOVERY',
          }
        : null,
      latestAmendment: latestAmendment
        ? {
            amendmentId: latestAmendment.id,
            createdAt: latestAmendment.createdAt,
            expiresAt: latestAmendment.expiresAt,
            paymentDeadlineAt: latestAmendment.paymentDeadlineAt,
            reasonCode: latestAmendment.reasonCode,
            scope: latestAmendment.scope,
            status: latestAmendment.status,
            withdrawable: latestAmendment.status === BookingAmendmentStatus.PENDING_OWNER,
          }
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
      overdueHandoverRecoveries: booking.overdueHandoverRecoveries.map(serializeOverdueRecovery),
      overdueHandoverRecovery: overdueHandoverRecovery
        ? serializeOverdueRecovery(overdueHandoverRecovery)
        : null,
      pickupWindow: {
        closesAt: new Date(
          rentalStart.getTime() +
            this.configuration.getOrThrow('PICKUP_WINDOW_GRACE_MINUTES', { infer: true }) * 60_000,
        ),
        opensAt: new Date(
          rentalStart.getTime() -
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
      securityDeposit: this.securityDeposit(booking),
      publicReference: booking.publicReference,
      rentalEnd,
      rentalStart,
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
    const avatar =
      profile?.avatarFile ??
      booking.renter.verifications.flatMap(({ documents }) => documents)[0]?.fileAsset;
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
          avatar?.status === FileAssetStatus.READY
            ? this.files.trustedAuthorizedGrant(avatar.id)
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

  private securityDeposit(booking: BookingRecord) {
    const executionAvailable = this.configuration.getOrThrow('SECURITY_DEPOSIT_EXECUTION_ENABLED', {
      infer: true,
    });
    return bookingSecurityDepositProjection({
      ...booking,
      bookingStatus: booking.status,
      executionAvailable,
      leadHours: this.configuration.getOrThrow('SECURITY_DEPOSIT_LEAD_HOURS', { infer: true }),
      rentalPaymentCaptured: booking.payments.some(
        (payment) => payment.purpose === 'RENTAL' && payment.status === 'CAPTURED',
      ),
      rentalStart: booking.rentalStart,
    });
  }

  private pricing(booking: BookingRecord) {
    const pricing = booking.pricingSnapshot;
    if (!pricing) return null;
    const applied = booking.amendments.find(
      (amendment) => amendment.status === BookingAmendmentStatus.APPLIED,
    );
    const amendment = applied?.pricingSnapshot;
    return {
      baseRentalAmountMinor: amendment
        ? Number(amendment.proposedBaseRentalAmountMinor)
        : pricing.baseRentalAmountMinor,
      chargeableDays: amendment?.proposedChargeableDays ?? pricing.chargeableDays,
      currency: pricing.currency,
      discountedRentalSubtotalMinor: amendment
        ? Number(amendment.proposedRentalSubtotalMinor)
        : pricing.discountedRentalSubtotalMinor,
      durationDiscountAmountMinor: amendment
        ? Number(amendment.durationDiscountAmountMinor)
        : pricing.durationDiscountAmountMinor,
      durationDiscountBps: amendment?.durationDiscountBps ?? pricing.durationDiscountBps,
      durationDiscountTier: amendment?.durationDiscountTier ?? pricing.durationDiscountTier,
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
      rentalEnd: applied?.proposedRentalEnd ?? pricing.rentalEnd,
      rentalStart: applied?.proposedRentalStart ?? pricing.rentalStart,
      subtotalMinor: amendment ? Number(amendment.proposedTotalMinor) : pricing.subtotalMinor,
      totalMinor: amendment ? Number(amendment.proposedTotalMinor) : pricing.totalMinor,
      unlimitedMileage: pricing.unlimitedMileage,
      vehicleTimezone: pricing.vehicleTimezone,
    };
  }

  private fulfillment(booking: BookingRecord) {
    const snapshot = booking.fulfillmentSnapshot;
    if (!snapshot)
      return {
        allowedEndMethods: ['RENTER_RETURN'] as const,
        allowedStartMethods: ['RENTER_PICKUP'] as const,
        collectionDistanceMeters: null,
        collectionFeeMinor: 0,
        deliveryDistanceMeters: null,
        deliveryFeeMinor: 0,
        endMethod: 'RENTER_RETURN',
        endFulfillmentChangeable: false,
        legacyCompatibility: true,
        startMethod: 'RENTER_PICKUP',
        startFulfillmentChangeable: false,
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
    const applied = booking.amendments.find(
      (amendment) => amendment.status === BookingAmendmentStatus.APPLIED,
    );
    const amendment = applied?.fulfillmentSnapshot;
    const destinations = jsonRecord(amendment?.destinationSnapshot);
    const delivery = destination(destinations?.deliveryDestination) ?? location('start');
    const collection = destination(destinations?.collectionDestination) ?? location('end');
    const evidence = jsonRecord(amendment?.serviceabilitySnapshot);
    const startMethod = applied?.proposedStartMethod ?? snapshot.startMethod;
    const endMethod = applied?.proposedEndMethod ?? snapshot.endMethod;
    const capabilities = bookingAmendmentFulfillmentCapabilities({
      actualPickupAt: booking.actualPickupAt,
      currentEndMethod: endMethod,
      currentStartMethod: startMethod,
      ...(booking.vehicle.policyVersions[0] ? { policy: booking.vehicle.policyVersions[0] } : {}),
      status: booking.status,
    });
    return {
      ...capabilities,
      collectionDistanceMeters: snapshot.collectionDistanceMeters,
      collectionFeeMinor:
        numberFromJson(evidence?.proposedCollectionFeeMinor) ?? snapshot.collectionFeeMinor,
      endLocation: collection,
      endMethod,
      legacyCompatibility: false,
      minimumNoticeMinutes: snapshot.minimumNoticeMinutes,
      deliveryDistanceMeters: snapshot.deliveryDistanceMeters,
      deliveryFeeMinor:
        numberFromJson(evidence?.proposedDeliveryFeeMinor) ?? snapshot.deliveryFeeMinor,
      serviceRadiusMeters: snapshot.serviceRadiusMeters,
      startLocation: delivery,
      startMethod,
    };
  }
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function numberFromJson(value: Prisma.JsonValue | undefined) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value);
  return null;
}

function destination(value: Prisma.JsonValue | undefined) {
  const item = jsonRecord(value);
  if (!item || typeof item.city !== 'string' || typeof item.province !== 'string') return null;
  return item as unknown as {
    addressLine1?: string;
    barangay?: string;
    city: string;
    country: string;
    latitude: number;
    longitude: number;
    postalCode?: string;
    province: string;
  };
}
