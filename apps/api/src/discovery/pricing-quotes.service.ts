import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingErrorCode, DiscoveryErrorCode, IdentityErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import { MileagePolicyType } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { AnalyticsEventType, DiscoveryAnalyticsService } from './analytics.service';
import { AvailabilityService } from './availability.service';
import { durationDiscount } from './duration-discounts';
import { PRICING_ENGINE_VERSION, RentalDurationService } from './duration.service';
import { PublicVehiclesService } from './public-vehicles.service';

@Injectable()
export class PricingQuotesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly publicVehicles: PublicVehiclesService,
    private readonly availability: AvailabilityService,
    private readonly duration: RentalDurationService,
    private readonly redis: RedisService,
    private readonly analytics: DiscoveryAnalyticsService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async create(
    userId: string,
    vehicleId: string,
    startInput: string,
    endInput: string,
    correlationId?: string,
  ) {
    const remaining = await this.redis.consumeLimit(`quote:${userId}`, 20, 3600);
    if (remaining < 0) {
      throw new ApplicationException(
        IdentityErrorCode.RATE_LIMITED,
        'Too many quote requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.QUOTE_REQUESTED,
      userId,
      vehicleId,
    });
    const vehicle = await this.publicVehicles.publicVehicle(vehicleId);
    if (vehicle.ownerProfile.userId === userId) {
      throw new ApplicationException(
        BookingErrorCode.OWNER_CANNOT_BOOK_OWN_VEHICLE,
        'Owners cannot request a price or rent their own vehicle.',
        HttpStatus.FORBIDDEN,
      );
    }
    const { chargeableDays, end, start } = this.duration.calculate(startInput, endInput);
    this.availability.assertQuotable(await this.availability.check(vehicle, startInput, endInput));
    const policy = vehicle.policyVersions[0]!;
    const baseRentalAmountMinor = policy.dailyRateMinor * chargeableDays;
    if (!Number.isSafeInteger(baseRentalAmountMinor) || baseRentalAmountMinor > 2_147_483_647) {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
        'The calculated rental amount exceeds the supported range.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const discount = durationDiscount(baseRentalAmountMinor, chargeableDays, policy);
    const lines = [
      {
        amountMinor: baseRentalAmountMinor,
        code: 'RENTAL_BASE',
        description: `${chargeableDays} chargeable day${chargeableDays === 1 ? '' : 's'}`,
        displayOrder: 0,
        quantity: chargeableDays,
        unitAmountMinor: policy.dailyRateMinor,
      },
      ...(discount.tier
        ? [
            {
              amountMinor: -discount.amountMinor,
              code: 'DURATION_DISCOUNT',
              description: `${discount.label} (${(discount.basisPoints / 100).toFixed(2).replace(/\.00$/, '')}%)`,
              displayOrder: 1,
              quantity: 1,
              unitAmountMinor: -discount.amountMinor,
            },
          ]
        : []),
    ];
    const created = await this.database.client.pricingQuote.create({
      data: {
        baseRentalAmountMinor,
        chargeableDays,
        currency: policy.currency,
        evReturnPolicy: policy.evReturnPolicy,
        excessKilometerRateMinor: policy.excessKilometerRateMinor,
        expiresAt: new Date(
          Date.now() +
            this.configuration.getOrThrow('QUOTE_TTL_MINUTES', { infer: true }) * 60 * 1000,
        ),
        fuelReturnPolicy: policy.fuelReturnPolicy,
        includedMileageKm:
          policy.mileagePolicy === MileagePolicyType.LIMITED
            ? policy.includedKilometersPerDay! * chargeableDays
            : null,
        discountedRentalSubtotalMinor: discount.discountedSubtotalMinor,
        durationDiscountAmountMinor: discount.amountMinor,
        durationDiscountBps: discount.basisPoints,
        durationDiscountTier: discount.tier,
        lines: { create: lines },
        policyVersionId: policy.id,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        rentalEnd: end,
        rentalStart: start,
        renterUserId: userId,
        subtotalMinor: discount.discountedSubtotalMinor,
        totalMinor: discount.discountedSubtotalMinor,
        turnaroundMinutes: policy.turnaroundMinutes,
        unlimitedMileage: policy.mileagePolicy === MileagePolicyType.UNLIMITED,
        vehicleId,
        vehicleTimezone: vehicle.location!.timezone,
      },
      include: { lines: { orderBy: { displayOrder: 'asc' } } },
    });
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.QUOTE_CREATED,
      quoteId: created.id,
      userId,
      vehicleId,
    });
    return { ...created, advisory: true, reservesVehicle: false, status: 'VALID' };
  }

  async get(userId: string, id: string) {
    const quote = await this.database.client.pricingQuote.findFirst({
      include: { lines: { orderBy: { displayOrder: 'asc' } } },
      where: { id, renterUserId: userId },
    });
    if (!quote) {
      throw new ApplicationException(
        DiscoveryErrorCode.QUOTE_EXPIRED,
        'Quote was not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const latest = await this.database.client.vehiclePolicyVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { id: true },
      where: { vehicleId: quote.vehicleId },
    });
    const expired = quote.expiresAt <= new Date();
    const configurationCurrent = latest?.id === quote.policyVersionId;
    if (expired) {
      this.analytics.record({
        eventType: AnalyticsEventType.QUOTE_EXPIRED,
        quoteId: quote.id,
        userId,
        vehicleId: quote.vehicleId,
      });
    }
    return {
      ...quote,
      advisory: true,
      configurationCurrent,
      reservesVehicle: false,
      status: expired ? 'EXPIRED' : configurationCurrent ? 'VALID' : 'CONFIGURATION_CHANGED',
    };
  }
}
