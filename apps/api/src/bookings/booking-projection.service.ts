import { Injectable } from '@nestjs/common';
import { FileAssetStatus, FileClassification, Prisma } from '@carrental/database';
import { FilesService } from '../files/files.service';

export const bookingInclude = {
  conversation: { select: { id: true } },
  cancellation: true,
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
      emailVerifiedAt: true,
      mobileVerifiedAt: true,
      profile: { select: { displayName: true, firstName: true } },
      verifications: { select: { status: true, type: true } },
    },
  },
  statusHistory: { orderBy: { occurredAt: 'asc' as const } },
  vehicle: {
    select: {
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
  constructor(private readonly files: FilesService) {}

  renter(booking: BookingRecord) {
    return {
      cancellation: booking.cancellation
        ? {
            createdAt: booking.cancellation.createdAt,
            reasonCode: booking.cancellation.reasonCode,
            reasonText: booking.cancellation.reasonText,
          }
        : null,
      createdAt: booking.createdAt,
      conversationId: booking.conversation?.id ?? null,
      holdExpiresAt: booking.holdExpiresAt,
      owner: {
        displayName:
          booking.owner.profile?.displayName ??
          booking.owner.profile?.firstName ??
          'Verified owner',
        memberSince: booking.owner.createdAt,
        verified: true,
      },
      ownerResponseDeadlineAt: booking.ownerResponseDeadlineAt,
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

  owner(booking: BookingRecord) {
    const profile = booking.renter.profile;
    return {
      ...this.renter(booking),
      owner: undefined,
      renter: {
        displayName: profile?.displayName ?? profile?.firstName ?? 'Verified renter',
        driverLicenseVerified: booking.renter.verifications.some(
          ({ status, type }) => type === 'DRIVER_LICENSE' && status === 'VERIFIED',
        ),
        emailVerified: Boolean(booking.renter.emailVerifiedAt),
        mobileVerified: Boolean(booking.renter.mobileVerifiedAt),
      },
      earning: booking.ownerEarning
        ? {
            commissionAmountMinor: Number(booking.ownerEarning.commissionAmountMinor),
            currency: booking.ownerEarning.currency,
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
      chargeableDays: pricing.chargeableDays,
      currency: pricing.currency,
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
}
