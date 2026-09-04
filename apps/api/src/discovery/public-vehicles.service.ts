import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  ReviewModerationStatus,
  ReviewPublicationStatus,
  ReviewType,
} from '@carrental/database';
import { DiscoveryErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestPrincipal } from '../security/security-context';
import { AnalyticsEventType, DiscoveryAnalyticsService } from './analytics.service';
import { AvailabilityService } from './availability.service';
import type { SearchVehiclesDto } from './discovery.dto';
import { VehicleSearchSort } from './discovery.dto';
import { RentalDurationService } from './duration.service';
import { durationDiscount } from './duration-discounts';
import {
  PublicVehicleEligibilityService,
  type PublicVehicleRecord,
} from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';

interface SpatialCandidate {
  readonly id: string;
  readonly distanceKm: number;
}

interface SearchCursor {
  readonly approvedAt: number;
  readonly criteria: string;
  readonly distanceKm: number;
  readonly id: string;
  readonly priceMinor: number;
  readonly sort: VehicleSearchSort;
}

@Injectable()
export class PublicVehiclesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: PublicVehicleEligibilityService,
    private readonly availability: AvailabilityService,
    private readonly duration: RentalDurationService,
    private readonly projection: PublicProjectionService,
    private readonly analytics: DiscoveryAnalyticsService,
  ) {}

  async referenceData() {
    const [categories, makes] = await Promise.all([
      this.database.client.vehicleCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { code: true, id: true, name: true },
        where: { active: true },
      }),
      this.database.client.vehicleMake.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { code: true, id: true, name: true },
        where: { active: true },
      }),
    ]);
    return { categories, makes };
  }

  async search(input: SearchVehiclesDto, principal?: RequestPrincipal, correlationId?: string) {
    this.assertSearch(input);
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    const spatial = await this.database.client.$queryRaw<SpatialCandidate[]>(Prisma.sql`
      SELECT v."id",
        (ST_Distance(l."point", ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) / 1000.0)::double precision AS "distanceKm"
      FROM "vehicles" v
      INNER JOIN "vehicle_locations" l ON l."vehicle_id" = v."id"
      WHERE v."status" = 'APPROVED'::"VehicleLifecycleStatus"
        AND v."operational_status" = 'AVAILABLE'::"VehicleOperationalStatus"
        ${principal ? Prisma.sql`AND v."owner_user_id" <> ${principal.userId}::uuid` : Prisma.empty}
        AND l."point" IS NOT NULL
        AND ST_DWithin(
          l."point",
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${input.radius * 1000}
        )
      ORDER BY "distanceKm" ASC, v."id" ASC
      LIMIT 500
    `);
    const distance = new Map(spatial.map((item) => [item.id, item.distanceKm]));
    let vehicles = await this.eligibility.findEligible(
      spatial.map(({ id }) => id),
      undefined,
      principal?.userId,
    );
    vehicles = vehicles.filter((vehicle) => this.matches(vehicle, input));
    let availabilities: Awaited<ReturnType<AvailabilityService['checkMany']>> | undefined;
    let chargeableDays: number | undefined;
    if (input.start && input.end) {
      chargeableDays = this.duration.calculate(input.start, input.end).chargeableDays;
      availabilities = await this.availability.checkMany(vehicles, input.start, input.end);
      vehicles = vehicles.filter((vehicle) => availabilities!.get(vehicle.id)?.available);
    }
    vehicles.sort((left, right) => this.compare(left, right, distance, input.sort));
    if (input.cursor) {
      const cursor = this.decodeCursor(input.cursor, input);
      vehicles = vehicles.filter(
        (vehicle) => this.compareToCursor(vehicle, cursor, distance, input.sort) > 0,
      );
    }
    const hasNextPage = vehicles.length > input.limit;
    const page = vehicles.slice(0, input.limit);
    const favoriteIds = principal
      ? new Set(
          (
            await this.database.client.userFavorite.findMany({
              select: { vehicleId: true },
              where: { userId: principal.userId, vehicleId: { in: page.map(({ id }) => id) } },
            })
          ).map(({ vehicleId }) => vehicleId),
        )
      : new Set<string>();
    const ratingRows = await this.database.client.ratingProjection.findMany({
      where: { subjectType: ReviewType.VEHICLE, subjectId: { in: page.map(({ id }) => id) } },
    });
    const ratings = new Map(
      ratingRows.map((rating) => [
        rating.subjectId,
        { averageRating: rating.averageRating.toString(), reviewCount: rating.reviewCount },
      ]),
    );
    const items = page.map((vehicle) => {
      const card = this.projection.card(
        vehicle,
        distance.get(vehicle.id)!,
        favoriteIds.has(vehicle.id),
        availabilities?.get(vehicle.id),
        ratings.get(vehicle.id),
      );
      if (chargeableDays) {
        const policy = vehicle.policyVersions[0]!;
        const discount = durationDiscount(
          policy.dailyRateMinor * chargeableDays,
          chargeableDays,
          policy,
        );
        return {
          ...card,
          estimatedRentalTotal: {
            amountMinor: discount.discountedSubtotalMinor,
            authoritative: false,
            baseRentalAmountMinor: policy.dailyRateMinor * chargeableDays,
            chargeableDays,
            currency: policy.currency,
            durationDiscountAmountMinor: discount.amountMinor,
            durationDiscountBps: discount.basisPoints,
            durationDiscountTier: discount.tier,
          },
        };
      }
      return card;
    });
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.SEARCH_PERFORMED,
      metadata: {
        datesSupplied: Boolean(input.start),
        filterCount: this.filterCount(input),
        radiusKm: input.radius,
        resultCount: items.length,
        sort: input.sort,
      },
      userId: principal?.userId,
    });
    return {
      items,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && page.length ? this.encodeCursor(page.at(-1)!, distance, input) : null,
      },
      search: { candidateLimit: 500, locationPrivacy: 'CITY_PROVINCE_AND_ROUNDED_DISTANCE' },
    };
  }

  async detail(id: string, principal?: RequestPrincipal, correlationId?: string) {
    const vehicle = await this.publicVehicle(id, principal?.userId);
    const favorite = principal
      ? Boolean(
          await this.database.client.userFavorite.findUnique({
            where: { userId_vehicleId: { userId: principal.userId, vehicleId: id } },
          }),
        )
      : false;
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.VEHICLE_VIEWED,
      userId: principal?.userId,
      vehicleId: id,
    });
    const ratingRows = await this.database.client.ratingProjection.findMany({
      where: {
        OR: [
          { subjectType: ReviewType.VEHICLE, subjectId: vehicle.id },
          { subjectType: ReviewType.OWNER, subjectId: vehicle.ownerProfile.id },
        ],
      },
    });
    const rating = (type: ReviewType) => {
      const value = ratingRows.find((row) => row.subjectType === type);
      return value
        ? { averageRating: value.averageRating.toString(), reviewCount: value.reviewCount }
        : null;
    };
    return this.projection.detail(vehicle, favorite, {
      vehicle: rating(ReviewType.VEHICLE),
      owner: rating(ReviewType.OWNER),
    });
  }

  async host(publicReference: string) {
    const owner = await this.database.client.ownerProfile.findUnique({
      select: {
        id: true,
        publicReference: true,
        user: {
          select: {
            createdAt: true,
            profile: {
              select: {
                avatarFile: { select: { classification: true, id: true, status: true } },
                displayName: true,
                firstName: true,
              },
            },
          },
        },
        vehicles: { select: { id: true } },
        verifiedAt: true,
      },
      where: { publicReference },
    });
    if (!owner)
      throw new ApplicationException('HOST_NOT_FOUND', 'Host not found.', HttpStatus.NOT_FOUND);
    const vehicles = await this.eligibility.findEligible(owner.vehicles.map(({ id }) => id));
    const [rating, completedRentalCount, reviews] = await Promise.all([
      this.database.client.ratingProjection.findUnique({
        where: {
          subjectType_subjectId: { subjectId: owner.id, subjectType: ReviewType.OWNER },
        },
      }),
      this.database.client.booking.count({
        where: { ownerProfileId: owner.id, status: 'COMPLETED' },
      }),
      this.database.client.review.findMany({
        select: { categoryRatings: true },
        where: {
          moderationStatus: ReviewModerationStatus.PUBLISHED,
          ownerProfileId: owner.id,
          publicationStatus: ReviewPublicationStatus.PUBLISHED,
        },
      }),
    ]);
    const avatar = owner.user.profile?.avatarFile;
    const categoryValues = new Map<string, number[]>();
    for (const review of reviews) {
      const values = review.categoryRatings as Record<string, unknown>;
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'number')
          categoryValues.set(name, [...(categoryValues.get(name) ?? []), value]);
      }
    }
    return {
      avatar:
        avatar?.classification === 'PUBLIC' && avatar.status === 'READY'
          ? this.projection.publicFile(avatar.id)
          : null,
      availableVehicles: vehicles.map((vehicle) => {
        const policy = vehicle.policyVersions[0]!;
        const cover = vehicle.photos.find(({ isCover }) => isCover)!;
        return {
          coverPhoto: this.projection.publicFile(cover.fileAsset.id),
          currency: policy.currency,
          dailyRateMinor: policy.dailyRateMinor,
          make: vehicle.make,
          model: vehicle.model,
          vehicleId: vehicle.id,
          year: vehicle.modelYear,
        };
      }),
      categoryAverages: Object.fromEntries(
        [...categoryValues].map(([name, values]) => [
          name,
          Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100,
        ]),
      ),
      completedRentalCount,
      displayName:
        owner.user.profile?.displayName ?? owner.user.profile?.firstName ?? 'Verified host',
      memberSince: owner.user.createdAt,
      publicReference: owner.publicReference,
      rating: rating
        ? { averageRating: rating.averageRating.toString(), reviewCount: rating.reviewCount }
        : { averageRating: null, reviewCount: 0 },
      verifiedAt: owner.verifiedAt,
    };
  }

  async availabilityFor(id: string, start: string, end: string) {
    return this.availability.check(await this.publicVehicle(id), start, end);
  }

  publicVehicle(id: string, excludedOwnerUserId?: string): Promise<PublicVehicleRecord> {
    return this.eligibility.findOne(id, undefined, excludedOwnerUserId).then((vehicle) => {
      if (!vehicle) {
        throw new ApplicationException(
          DiscoveryErrorCode.VEHICLE_NOT_PUBLIC,
          'The vehicle is not publicly available.',
          HttpStatus.NOT_FOUND,
        );
      }
      return vehicle;
    });
  }

  diagnostic(id: string) {
    return this.eligibility.diagnostic(id);
  }

  private matches(vehicle: PublicVehicleRecord, input: SearchVehiclesDto): boolean {
    const policy = vehicle.policyVersions[0]!;
    const featureIds = new Set(vehicle.features.map(({ feature }) => feature.id));
    return (
      (!input.categoryId || vehicle.category?.id === input.categoryId) &&
      (!input.make || vehicle.make?.toLowerCase() === input.make.toLowerCase()) &&
      (!input.model || Boolean(vehicle.model?.toLowerCase().includes(input.model.toLowerCase()))) &&
      (!input.transmission || vehicle.transmission === input.transmission) &&
      (!input.powertrain || vehicle.powertrain === input.powertrain) &&
      (!input.fuelType || vehicle.fuelType === input.fuelType) &&
      (!input.seats || (vehicle.seatCount ?? 0) >= input.seats) &&
      (input.minPrice === undefined || policy.dailyRateMinor >= input.minPrice) &&
      (input.maxPrice === undefined || policy.dailyRateMinor <= input.maxPrice) &&
      (input.unlimitedMileage === undefined ||
        (policy.mileagePolicy === 'UNLIMITED') === input.unlimitedMileage) &&
      (!input.featureIds ||
        input.featureIds.length === 0 ||
        input.featureIds.every((id) => featureIds.has(id)))
    );
  }

  private compare(
    left: PublicVehicleRecord,
    right: PublicVehicleRecord,
    distance: ReadonlyMap<string, number>,
    sort: VehicleSearchSort,
  ): number {
    const byId = left.id.localeCompare(right.id);
    const byDistance = distance.get(left.id)! - distance.get(right.id)!;
    const byPrice =
      left.policyVersions[0]!.dailyRateMinor - right.policyVersions[0]!.dailyRateMinor;
    const byNewest = (right.approvedAt?.getTime() ?? 0) - (left.approvedAt?.getTime() ?? 0);
    if (sort === VehicleSearchSort.PRICE_LOW_TO_HIGH) return byPrice || byDistance || byId;
    if (sort === VehicleSearchSort.PRICE_HIGH_TO_LOW) return -byPrice || byDistance || byId;
    if (sort === VehicleSearchSort.NEWEST) return byNewest || byDistance || byId;
    if (sort === VehicleSearchSort.DISTANCE) return byDistance || byId;
    return byDistance || byPrice || byNewest || byId;
  }

  private assertSearch(input: SearchVehiclesDto): void {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_SEARCH_LOCATION,
        'Search coordinates are invalid.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (input.radius > 100) {
      throw new ApplicationException(
        DiscoveryErrorCode.SEARCH_RADIUS_EXCEEDED,
        'Search radius cannot exceed 100 kilometers.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if ((input.featureIds?.length ?? 0) > 10) {
      throw new ApplicationException(
        DiscoveryErrorCode.TOO_MANY_FEATURE_FILTERS,
        'A search may include at most 10 feature filters.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (Boolean(input.start) !== Boolean(input.end)) {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
        'Rental start and end must be supplied together.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.minPrice !== undefined &&
      input.maxPrice !== undefined &&
      input.minPrice > input.maxPrice
    ) {
      throw new ApplicationException(
        DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
        'Minimum price cannot exceed maximum price.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private encodeCursor(
    vehicle: PublicVehicleRecord,
    distance: ReadonlyMap<string, number>,
    input: SearchVehiclesDto,
  ): string {
    return Buffer.from(
      JSON.stringify({
        approvedAt: vehicle.approvedAt?.getTime() ?? 0,
        criteria: this.cursorCriteria(input),
        distanceKm: distance.get(vehicle.id)!,
        id: vehicle.id,
        priceMinor: vehicle.policyVersions[0]!.dailyRateMinor,
        sort: input.sort,
      } satisfies SearchCursor),
    ).toString('base64url');
  }

  private decodeCursor(value: string, input: SearchVehiclesDto): SearchCursor {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SearchCursor;
      if (
        typeof parsed.id !== 'string' ||
        typeof parsed.distanceKm !== 'number' ||
        !Number.isFinite(parsed.distanceKm) ||
        typeof parsed.priceMinor !== 'number' ||
        !Number.isSafeInteger(parsed.priceMinor) ||
        typeof parsed.approvedAt !== 'number' ||
        !Number.isSafeInteger(parsed.approvedAt) ||
        parsed.sort !== input.sort ||
        parsed.criteria !== this.cursorCriteria(input)
      )
        this.invalidCursor();
      return parsed;
    } catch (error) {
      if (error instanceof ApplicationException) throw error;
      this.invalidCursor();
    }
  }

  private compareToCursor(
    vehicle: PublicVehicleRecord,
    cursor: SearchCursor,
    distance: ReadonlyMap<string, number>,
    sort: VehicleSearchSort,
  ): number {
    const byId = vehicle.id.localeCompare(cursor.id);
    const byDistance = distance.get(vehicle.id)! - cursor.distanceKm;
    const byPrice = vehicle.policyVersions[0]!.dailyRateMinor - cursor.priceMinor;
    const byNewest = cursor.approvedAt - (vehicle.approvedAt?.getTime() ?? 0);
    if (sort === VehicleSearchSort.PRICE_LOW_TO_HIGH) return byPrice || byDistance || byId;
    if (sort === VehicleSearchSort.PRICE_HIGH_TO_LOW) return -byPrice || byDistance || byId;
    if (sort === VehicleSearchSort.NEWEST) return byNewest || byDistance || byId;
    if (sort === VehicleSearchSort.DISTANCE) return byDistance || byId;
    return byDistance || byPrice || byNewest || byId;
  }

  private cursorCriteria(input: SearchVehiclesDto): string {
    return JSON.stringify({
      categoryId: input.categoryId ?? null,
      end: input.end ?? null,
      featureIds: [...(input.featureIds ?? [])].sort(),
      fuelType: input.fuelType ?? null,
      latitude: input.latitude,
      longitude: input.longitude,
      make: input.make?.toLowerCase() ?? null,
      maxPrice: input.maxPrice ?? null,
      minPrice: input.minPrice ?? null,
      model: input.model?.toLowerCase() ?? null,
      powertrain: input.powertrain ?? null,
      radius: input.radius,
      seats: input.seats ?? null,
      sort: input.sort,
      start: input.start ?? null,
      transmission: input.transmission ?? null,
      unlimitedMileage: input.unlimitedMileage ?? null,
    });
  }

  private invalidCursor(): never {
    throw new ApplicationException(
      DiscoveryErrorCode.INVALID_CURSOR,
      'Search cursor is invalid for these results.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private filterCount(input: SearchVehiclesDto): number {
    return [
      input.categoryId,
      input.make,
      input.model,
      input.transmission,
      input.powertrain,
      input.fuelType,
      input.seats,
      input.minPrice,
      input.maxPrice,
      input.unlimitedMileage,
      input.featureIds?.length,
    ].filter((value) => value !== undefined).length;
  }
}
