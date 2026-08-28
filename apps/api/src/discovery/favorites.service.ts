import { HttpStatus, Injectable } from '@nestjs/common';
import { DiscoveryErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { AnalyticsEventType, DiscoveryAnalyticsService } from './analytics.service';
import { PublicVehicleEligibilityService } from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';

@Injectable()
export class FavoritesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: PublicVehicleEligibilityService,
    private readonly projection: PublicProjectionService,
    private readonly analytics: DiscoveryAnalyticsService,
  ) {}

  async add(userId: string, vehicleId: string, correlationId?: string) {
    if (!(await this.eligibility.findOne(vehicleId, undefined, userId))) {
      throw new ApplicationException(
        DiscoveryErrorCode.VEHICLE_NOT_PUBLIC,
        'Only a public vehicle can be added to favorites.',
        HttpStatus.NOT_FOUND,
      );
    }
    const favorite = await this.database.client.userFavorite.upsert({
      create: { userId, vehicleId },
      update: {},
      where: { userId_vehicleId: { userId, vehicleId } },
    });
    this.analytics.record({
      correlationId,
      eventType: AnalyticsEventType.FAVORITE_ADDED,
      userId,
      vehicleId,
    });
    return favorite;
  }

  async remove(userId: string, vehicleId: string) {
    await this.database.client.userFavorite.deleteMany({ where: { userId, vehicleId } });
  }

  async list(userId: string) {
    const favorites = await this.database.client.userFavorite.findMany({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, vehicleId: true },
      take: 100,
      where: { userId },
    });
    const vehicles = await this.eligibility.findEligible(
      favorites.map(({ vehicleId }) => vehicleId),
      undefined,
      userId,
    );
    const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
    return {
      items: favorites.flatMap((favorite) => {
        const vehicle = vehicleById.get(favorite.vehicleId);
        return vehicle
          ? [{ favoritedAt: favorite.createdAt, vehicle: this.projection.detail(vehicle, true) }]
          : [];
      }),
      unavailableCount: favorites.length - vehicles.length,
    };
  }
}
