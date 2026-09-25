import { Injectable } from '@nestjs/common';
import { Prisma, ReviewType } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import { AvailabilityService } from './availability.service';
import type { SavedSimilarityQueryDto } from './discovery.dto';
import { PublicVehicleEligibilityService } from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';
import {
  interleaveSimilarity,
  qualifiedForAnchor,
  selectDiverseSavedAnchors,
  type SimilarityVehicle,
} from './saved-similarity';

interface SpatialCandidate {
  readonly id: string;
  readonly distanceKm: number;
}

@Injectable()
export class SavedSimilarityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: PublicVehicleEligibilityService,
    private readonly availability: AvailabilityService,
    private readonly projection: PublicProjectionService,
  ) {}

  async recommend(userId: string, input: SavedSimilarityQueryDto) {
    const favorites = await this.database.client.userFavorite.findMany({
      orderBy: [{ createdAt: 'desc' }, { vehicleId: 'desc' }],
      select: { vehicleId: true },
      take: 100,
      where: { userId },
    });
    if (!favorites.length || input.latitude === undefined || input.longitude === undefined)
      return { items: [] };

    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return { items: [] };
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return { items: [] };

    const savedIds = favorites.map(({ vehicleId }) => vehicleId);
    const eligibleAnchors = await this.eligibility.findEligible(savedIds, undefined, userId);
    const anchorById = new Map(eligibleAnchors.map((vehicle) => [vehicle.id, vehicle]));
    const anchors = selectDiverseSavedAnchors(
      savedIds.flatMap((id) => {
        const vehicle = anchorById.get(id);
        return vehicle ? [this.similarityVehicle(vehicle, 0, 0)] : [];
      }),
    );
    if (!anchors.length) return { items: [] };

    const spatial = await this.database.client.$queryRaw<SpatialCandidate[]>(Prisma.sql`
      SELECT v."id",
        (ST_Distance(l."point", ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography) / 1000.0)::double precision AS "distanceKm"
      FROM "vehicles" v
      INNER JOIN "vehicle_locations" l ON l."vehicle_id" = v."id"
      WHERE v."status" = 'APPROVED'::"VehicleLifecycleStatus"
        AND v."operational_status" = 'AVAILABLE'::"VehicleOperationalStatus"
        AND v."owner_user_id" <> ${userId}::uuid
        AND l."point" IS NOT NULL
        AND ST_DWithin(
          l."point",
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
          ${input.radius * 1000}
        )
      ORDER BY "distanceKm" ASC, v."id" ASC
      LIMIT 100
    `);
    const savedSet = new Set(savedIds);
    const boundedSpatial = spatial.filter(({ id }) => !savedSet.has(id)).slice(0, 100);
    const distanceById = new Map(boundedSpatial.map(({ id, distanceKm }) => [id, distanceKm]));
    let candidates = await this.eligibility.findEligible(
      boundedSpatial.map(({ id }) => id),
      undefined,
      userId,
    );
    const availability =
      input.start && input.end
        ? await this.availability.checkMany(candidates, input.start, input.end)
        : undefined;
    if (availability)
      candidates = candidates.filter((vehicle) => availability.get(vehicle.id)?.available);

    const ratings = await this.database.client.ratingProjection.findMany({
      select: { averageRating: true, reviewCount: true, subjectId: true },
      where: { subjectId: { in: candidates.map(({ id }) => id) }, subjectType: ReviewType.VEHICLE },
    });
    const ratingById = new Map(ratings.map((rating) => [rating.subjectId, rating]));
    const candidateById = new Map(candidates.map((vehicle) => [vehicle.id, vehicle]));
    const similarityCandidates = candidates.map((vehicle) =>
      this.similarityVehicle(
        vehicle,
        distanceById.get(vehicle.id) ?? Number.POSITIVE_INFINITY,
        ratingById.get(vehicle.id)?.reviewCount ?? 0,
      ),
    );
    const selected = interleaveSimilarity(
      anchors.map((anchor) => qualifiedForAnchor(anchor, similarityCandidates)),
      savedSet,
    );
    if (selected.length < 2) return { items: [] };

    return {
      items: selected.map(({ reason, vehicle: selectedVehicle }) => {
        const vehicle = candidateById.get(selectedVehicle.id)!;
        const rating = ratingById.get(vehicle.id);
        return {
          ...this.projection.card(
            vehicle,
            selectedVehicle.distanceKm,
            false,
            availability?.get(vehicle.id),
            rating
              ? { averageRating: rating.averageRating.toString(), reviewCount: rating.reviewCount }
              : null,
            input.start
              ? {
                  distanceMeters: selectedVehicle.distanceKm * 1000,
                  scheduledAt: new Date(input.start),
                }
              : undefined,
          ),
          recommendationReason: reason,
        };
      }),
    };
  }

  private similarityVehicle(
    vehicle: Awaited<ReturnType<PublicVehicleEligibilityService['findEligible']>>[number],
    distanceKm: number,
    ratingReviewCount: number,
  ): SimilarityVehicle {
    return {
      id: vehicle.id,
      categoryId: vehicle.category?.id ?? null,
      dailyRateMinor: vehicle.policyVersions[0]!.dailyRateMinor,
      distanceKm,
      make: vehicle.make,
      powertrain: vehicle.powertrain,
      ratingReviewCount,
      seats: vehicle.seatCount,
      transmission: vehicle.transmission,
    };
  }
}
