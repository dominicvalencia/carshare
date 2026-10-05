import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingErrorCode, DiscoveryErrorCode, IdentityErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import { MileagePolicyType, Prisma } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { AnalyticsEventType, DiscoveryAnalyticsService } from './analytics.service';
import { AvailabilityService } from './availability.service';
import { priceCompleteTripRental } from './complete-trip-pricing';
import { PRICING_ENGINE_VERSION, RentalDurationService } from './duration.service';
import { PublicVehiclesService } from './public-vehicles.service';
import type { CreatePricingQuoteDto } from './discovery.dto';
import { FulfillmentServiceabilityService } from '../fulfillment/fulfillment-serviceability';
import { securityDepositProjection } from '../common/security-deposit-policy';

type QuoteWithFulfillment = Prisma.PricingQuoteGetPayload<{
  include: { fulfillment: true; lines: true };
}>;
type QuoteFulfillment = NonNullable<QuoteWithFulfillment['fulfillment']>;

@Injectable()
export class PricingQuotesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly publicVehicles: PublicVehiclesService,
    private readonly availability: AvailabilityService,
    private readonly duration: RentalDurationService,
    private readonly redis: RedisService,
    private readonly analytics: DiscoveryAnalyticsService,
    private readonly fulfillmentServiceability: FulfillmentServiceabilityService,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  async create(
    userId: string,
    vehicleId: string,
    input: CreatePricingQuoteDto,
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
    const { chargeableDays, end, start } = this.duration.calculate(input.start, input.end);
    this.availability.assertQuotable(
      await this.availability.check(vehicle, input.start, input.end),
    );
    const policy = vehicle.policyVersions[0]!;
    const baseLocation = vehicle.location!;
    const deliveryDestination = input.deliveryDestination;
    const collectionDestination = input.collectionSameAsDelivery
      ? deliveryDestination
      : input.collectionDestination;
    if (input.startMethod === 'OWNER_DELIVERY' && !deliveryDestination)
      this.fulfillmentUnavailable('INVALID_DESTINATION');
    if (input.endMethod === 'OWNER_COLLECTION' && !collectionDestination)
      this.fulfillmentUnavailable('INVALID_DESTINATION');
    if (input.collectionSameAsDelivery && input.startMethod !== 'OWNER_DELIVERY')
      this.fulfillmentUnavailable('INVALID_DESTINATION');
    const delivery = await this.fulfillmentServiceability.evaluate({
      destinationLatitude: deliveryDestination?.latitude ?? Number(baseLocation.latitude),
      destinationLongitude: deliveryDestination?.longitude ?? Number(baseLocation.longitude),
      method: input.startMethod,
      policyVersionId: policy.id,
      scheduledAt: start,
    });
    const collection = await this.fulfillmentServiceability.evaluate({
      destinationLatitude: collectionDestination?.latitude ?? Number(baseLocation.latitude),
      destinationLongitude: collectionDestination?.longitude ?? Number(baseLocation.longitude),
      method: input.endMethod,
      policyVersionId: policy.id,
      scheduledAt: end,
    });
    if (!delivery.supported) this.fulfillmentUnavailable(delivery.reason);
    if (!collection.supported) this.fulfillmentUnavailable(collection.reason);
    const deliveryFeeMinor = input.startMethod === 'OWNER_DELIVERY' ? policy.deliveryFeeMinor! : 0;
    const collectionFeeMinor =
      input.endMethod === 'OWNER_COLLECTION' ? policy.collectionFeeMinor! : 0;
    let rentalPricing: ReturnType<typeof priceCompleteTripRental>;
    try {
      rentalPricing = priceCompleteTripRental(chargeableDays, policy);
    } catch {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
        'The calculated rental amount exceeds the supported range.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { baseRentalAmountMinor, discount } = rentalPricing;
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
      ...(input.startMethod === 'OWNER_DELIVERY'
        ? [
            {
              amountMinor: deliveryFeeMinor,
              code: 'OWNER_DELIVERY',
              description: 'Owner delivery',
              displayOrder: 2,
              quantity: 1,
              unitAmountMinor: deliveryFeeMinor,
            },
          ]
        : []),
      ...(input.endMethod === 'OWNER_COLLECTION'
        ? [
            {
              amountMinor: collectionFeeMinor,
              code: 'OWNER_COLLECTION',
              description: 'Owner collection',
              displayOrder: 3,
              quantity: 1,
              unitAmountMinor: collectionFeeMinor,
            },
          ]
        : []),
    ];
    const totalMinor = discount.discountedSubtotalMinor + deliveryFeeMinor + collectionFeeMinor;
    if (!Number.isSafeInteger(totalMinor) || totalMinor > 2_147_483_647) {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
        'The calculated booking amount exceeds the supported range.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const startLocation =
      input.startMethod === 'OWNER_DELIVERY' ? deliveryDestination! : baseLocation;
    const endLocation =
      input.endMethod === 'OWNER_COLLECTION' ? collectionDestination! : baseLocation;
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
        fulfillment: {
          create: {
            collectionDistanceMeters: collection.distanceMeters,
            collectionFeeMinor,
            currency: policy.currency,
            deliveryDistanceMeters: delivery.distanceMeters,
            deliveryFeeMinor,
            endAddressLine1: endLocation.addressLine1 ?? null,
            endBarangay: endLocation.barangay ?? null,
            endCity: endLocation.city,
            endCountry: endLocation.country ?? 'PH',
            endLatitude: endLocation.latitude,
            endLongitude: endLocation.longitude,
            endMethod: input.endMethod,
            endPostalCode: 'postalCode' in endLocation ? (endLocation.postalCode ?? null) : null,
            endProvince: endLocation.province,
            minimumNoticeMinutes: policy.fulfillmentMinimumNoticeMinutes,
            serviceRadiusMeters: policy.fulfillmentServiceRadiusMeters,
            sourcePolicyVersionId: policy.id,
            startAddressLine1: startLocation.addressLine1 ?? null,
            startBarangay: startLocation.barangay ?? null,
            startCity: startLocation.city,
            startCountry: startLocation.country ?? 'PH',
            startLatitude: startLocation.latitude,
            startLongitude: startLocation.longitude,
            startMethod: input.startMethod,
            startPostalCode:
              'postalCode' in startLocation ? (startLocation.postalCode ?? null) : null,
            startProvince: startLocation.province,
          },
        },
        policyVersionId: policy.id,
        pricingEngineVersion: PRICING_ENGINE_VERSION,
        rentalEnd: end,
        rentalStart: start,
        renterUserId: userId,
        subtotalMinor: totalMinor,
        totalMinor,
        turnaroundMinutes: policy.turnaroundMinutes,
        unlimitedMileage: policy.mileagePolicy === MileagePolicyType.UNLIMITED,
        vehicleId,
        vehicleTimezone: vehicle.location!.timezone,
      },
      include: { fulfillment: true, lines: { orderBy: { displayOrder: 'asc' } } },
    });
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.QUOTE_CREATED,
      quoteId: created.id,
      userId,
      vehicleId,
    });
    return this.project(created, 'VALID', true, securityDepositProjection(policy));
  }

  async get(userId: string, id: string) {
    const quote = await this.database.client.pricingQuote.findFirst({
      include: { fulfillment: true, lines: { orderBy: { displayOrder: 'asc' } } },
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
    const sourcePolicy = await this.database.client.vehiclePolicyVersion.findUniqueOrThrow({
      select: {
        securityDepositAmountMinor: true,
        securityDepositCurrency: true,
        securityDepositRequired: true,
      },
      where: { id: quote.policyVersionId },
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
    return this.project(
      quote,
      expired ? 'EXPIRED' : configurationCurrent ? 'VALID' : 'CONFIGURATION_CHANGED',
      configurationCurrent,
      securityDepositProjection(sourcePolicy),
    );
  }

  private fulfillmentUnavailable(reason: string): never {
    const messages: Record<string, [string, string]> = {
      METHOD_UNSUPPORTED: [
        DiscoveryErrorCode.FULFILLMENT_METHOD_UNSUPPORTED,
        'This handover option is no longer supported.',
      ],
      OUTSIDE_SERVICE_RADIUS: [
        DiscoveryErrorCode.FULFILLMENT_OUTSIDE_SERVICE_RADIUS,
        "This location is outside the owner's service area.",
      ],
      INSUFFICIENT_NOTICE: [
        DiscoveryErrorCode.FULFILLMENT_INSUFFICIENT_NOTICE,
        'The owner requires more notice for this handover option.',
      ],
      INVALID_DESTINATION: [
        DiscoveryErrorCode.FULFILLMENT_INVALID_DESTINATION,
        'Enter a valid destination for this handover option.',
      ],
    };
    const [code, message] = messages[reason] ?? [
      DiscoveryErrorCode.FULFILLMENT_POLICY_UNAVAILABLE,
      'This handover option is temporarily unavailable.',
    ];
    throw new ApplicationException(code, message, HttpStatus.UNPROCESSABLE_ENTITY);
  }

  private project(
    quote: QuoteWithFulfillment,
    status: string,
    configurationCurrent: boolean,
    securityDeposit: ReturnType<typeof securityDepositProjection>,
  ) {
    const fulfillment = quote.fulfillment;
    return {
      ...quote,
      advisory: true,
      configurationCurrent,
      fulfillment: fulfillment
        ? {
            collectionDistanceMeters: fulfillment.collectionDistanceMeters,
            collectionFeeMinor: fulfillment.collectionFeeMinor,
            endLocation: this.locationProjection(fulfillment, 'end'),
            endMethod: fulfillment.endMethod,
            minimumNoticeMinutes: fulfillment.minimumNoticeMinutes,
            deliveryDistanceMeters: fulfillment.deliveryDistanceMeters,
            deliveryFeeMinor: fulfillment.deliveryFeeMinor,
            serviceRadiusMeters: fulfillment.serviceRadiusMeters,
            sourcePolicyVersionId: fulfillment.sourcePolicyVersionId,
            startLocation: this.locationProjection(fulfillment, 'start'),
            startMethod: fulfillment.startMethod,
          }
        : null,
      reservesVehicle: false,
      securityDeposit,
      status,
    };
  }

  private locationProjection(record: QuoteFulfillment, prefix: 'start' | 'end') {
    if (prefix === 'start')
      return {
        addressLine1: record.startAddressLine1,
        barangay: record.startBarangay,
        city: record.startCity,
        country: record.startCountry,
        latitude: Number(record.startLatitude),
        longitude: Number(record.startLongitude),
        postalCode: record.startPostalCode,
        province: record.startProvince,
      };
    return {
      addressLine1: record.endAddressLine1,
      barangay: record.endBarangay,
      city: record.endCity,
      country: record.endCountry,
      latitude: Number(record.endLatitude),
      longitude: Number(record.endLongitude),
      postalCode: record.endPostalCode,
      province: record.endProvince,
    };
  }
}
