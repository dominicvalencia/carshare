import { Injectable } from '@nestjs/common';
import { FileAssetStatus, FileClassification, MileagePolicyType } from '@carrental/database';
import { FilesService } from '../files/files.service';
import type { AdvisoryAvailability } from './availability.service';
import type { PublicVehicleRecord } from './public-eligibility.service';

function publicDurationDiscounts(policy: PublicVehicleRecord['policyVersions'][number]) {
  return [
    { discountBps: policy.shortDurationDiscountBps, minimumDays: 3 },
    { discountBps: policy.weeklyDiscountBps, minimumDays: 7 },
    { discountBps: policy.extendedTripDiscountBps, minimumDays: 14 },
    { discountBps: policy.monthlyDiscountBps, minimumDays: 30 },
  ].filter(
    (tier): tier is { discountBps: number; minimumDays: number } =>
      tier.discountBps !== null && tier.discountBps > 0,
  );
}

@Injectable()
export class PublicProjectionService {
  constructor(private readonly files: FilesService) {}

  publicFile(fileId: string) {
    return this.files.trustedPublicGrant(fileId);
  }

  card(
    vehicle: PublicVehicleRecord,
    distanceKm: number,
    favorite: boolean,
    availability?: AdvisoryAvailability,
    rating?: { readonly averageRating: string; readonly reviewCount: number } | null,
  ) {
    const policy = vehicle.policyVersions[0]!;
    const cover = vehicle.photos.find(({ isCover }) => isCover)!;
    return {
      approximateLocation: {
        city: vehicle.location!.city,
        country: vehicle.location!.country,
        province: vehicle.location!.province,
      },
      availability: availability ?? {
        advisory: true,
        available: true,
        reasons: [],
        warning: 'No rental dates were checked. Availability is not guaranteed.',
      },
      category: vehicle.category,
      coverPhoto: {
        ...this.files.trustedPublicGrant(cover.fileAsset.id),
        id: cover.id,
      },
      currency: policy.currency,
      displayPrice: {
        amountMinor: policy.dailyRateMinor,
        label: 'From',
        unit: 'DAY',
      },
      distanceKm: Math.round(distanceKm * 10) / 10,
      favorite,
      fuelType: vehicle.fuelType,
      make: vehicle.make,
      model: vehicle.model,
      rating: rating ?? { averageRating: null, label: 'New', reviewCount: 0 },
      powertrain: vehicle.powertrain,
      seats: vehicle.seatCount,
      transmission: vehicle.transmission,
      vehicleId: vehicle.id,
      year: vehicle.modelYear,
    };
  }

  detail(
    vehicle: PublicVehicleRecord,
    favorite: boolean,
    ratings?: {
      readonly vehicle?: { readonly averageRating: string; readonly reviewCount: number } | null;
      readonly owner?: { readonly averageRating: string; readonly reviewCount: number } | null;
    },
  ) {
    const policy = vehicle.policyVersions[0]!;
    const profile = vehicle.ownerProfile.user.profile;
    const avatar = profile?.avatarFile;
    return {
      availabilitySummary: {
        advisory: true,
        policy: policy.availabilityPolicy,
        warning: 'Calendar availability does not reserve this vehicle.',
      },
      category: vehicle.category,
      description: vehicle.description,
      doors: vehicle.doorCount,
      favorite,
      features: vehicle.features.map(({ feature }) => feature),
      fuelType: vehicle.fuelType,
      location: {
        city: vehicle.location!.city,
        country: vehicle.location!.country,
        province: vehicle.location!.province,
      },
      make: vehicle.make,
      rating: ratings?.vehicle ?? { averageRating: null, label: 'New', reviewCount: 0 },
      mileagePolicy:
        policy.mileagePolicy === MileagePolicyType.UNLIMITED
          ? { type: 'UNLIMITED' }
          : {
              excessKilometerRateMinor: policy.excessKilometerRateMinor,
              includedKilometersPerChargeableDay: policy.includedKilometersPerDay,
              type: 'LIMITED',
            },
      model: vehicle.model,
      owner: {
        avatar:
          avatar?.classification === FileClassification.PUBLIC &&
          avatar.status === FileAssetStatus.READY
            ? this.files.trustedPublicGrant(avatar.id)
            : null,
        displayName: profile?.displayName ?? profile?.firstName ?? 'Verified owner',
        memberSince: vehicle.ownerProfile.user.createdAt,
        publicReference: vehicle.ownerProfile.publicReference,
        rating: ratings?.owner ?? { averageRating: null, label: 'New', reviewCount: 0 },
        verified: true,
      },
      photos: vehicle.photos.map((photo) => ({
        ...this.files.trustedPublicGrant(photo.fileAsset.id),
        id: photo.id,
        perspective: photo.perspective,
      })),
      powertrain: vehicle.powertrain,
      pricing: {
        authoritative: false,
        currency: policy.currency,
        dailyRateMinor: policy.dailyRateMinor,
        durationDiscounts: publicDurationDiscounts(policy),
        label: 'From',
      },
      rentalRequirements: vehicle.rentalRequirements,
      returnPolicy: {
        ev: policy.evReturnPolicy,
        evRequiredPercentage: policy.evRequiredPercentage,
        evTolerancePercent: policy.evTolerancePercent,
        fuel: policy.fuelReturnPolicy,
        fuelTolerancePercent: policy.fuelTolerancePercent,
      },
      seats: vehicle.seatCount,
      transmission: vehicle.transmission,
      turnaroundMinutes: policy.turnaroundMinutes,
      variant: vehicle.variant,
      vehicleId: vehicle.id,
      year: vehicle.modelYear,
    };
  }
}
