import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RecordRenterSearchDto } from './discovery.dto';
import { PublicVehicleEligibilityService } from './public-eligibility.service';
import { PublicProjectionService } from './public-projection.service';

export const RECENT_SEARCH_LIMIT = 20;
export const RECENT_VEHICLE_LIMIT = 30;

export function coarseSearchCenter(value: number): number {
  return Math.round(value * 10) / 10;
}

export function committedSearchDates(input: RecordRenterSearchDto): {
  rentalStart: Date | null;
  rentalEnd: Date | null;
} {
  if (!input.datesExplicit) {
    if (input.start || input.end)
      throw new BadRequestException('Unselected dates cannot be saved.');
    return { rentalStart: null, rentalEnd: null };
  }
  if (!input.start || !input.end || new Date(input.end) <= new Date(input.start)) {
    throw new BadRequestException('Select valid trip dates before saving them.');
  }
  return { rentalStart: new Date(input.start), rentalEnd: new Date(input.end) };
}

@Injectable()
export class RenterHistoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly eligibility: PublicVehicleEligibilityService,
    private readonly projection: PublicProjectionService,
  ) {}

  async recordSearch(userId: string, input: RecordRenterSearchDto) {
    const dates = committedSearchDates(input);
    const city = input.source === 'DEVICE' ? '' : input.city.trim();
    const province = input.source === 'DEVICE' ? '' : input.province.trim();
    if (input.source === 'PLACE' && !city) {
      throw new BadRequestException('Select a city before saving a search.');
    }
    const criteria: Prisma.InputJsonObject = {
      source: input.source,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.make ? { make: input.make.trim() } : {}),
      ...(input.seats ? { seats: input.seats } : {}),
      ...(input.transmission ? { transmission: input.transmission } : {}),
      ...(input.powertrain ? { powertrain: input.powertrain } : {}),
      ...(input.minPrice !== undefined ? { minPrice: input.minPrice } : {}),
      ...(input.maxPrice !== undefined ? { maxPrice: input.maxPrice } : {}),
      ...(input.handover ? { handover: input.handover } : {}),
    };
    return this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const created = await transaction.renterRecentSearch.create({
        data: {
          userId,
          placeLabel: input.source === 'DEVICE' ? 'Current area' : city,
          city,
          province,
          // DEVICE uses a non-location sentinel; future use must obtain current-area authority again.
          centerLatitude: input.source === 'DEVICE' ? 0 : coarseSearchCenter(input.latitude),
          centerLongitude: input.source === 'DEVICE' ? 0 : coarseSearchCenter(input.longitude),
          radiusKm: input.radiusKm,
          ...dates,
          criteria,
        },
        select: { id: true, searchedAt: true },
      });
      const excess = await transaction.renterRecentSearch.findMany({
        orderBy: [{ searchedAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
        skip: RECENT_SEARCH_LIMIT,
        where: { userId },
      });
      if (excess.length) {
        await transaction.renterRecentSearch.deleteMany({
          where: { userId, id: { in: excess.map(({ id }) => id) } },
        });
      }
      return created;
    });
  }

  async listSearches(userId: string) {
    const items = await this.database.client.renterRecentSearch.findMany({
      orderBy: [{ searchedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        placeLabel: true,
        city: true,
        province: true,
        centerLatitude: true,
        centerLongitude: true,
        radiusKm: true,
        rentalStart: true,
        rentalEnd: true,
        criteria: true,
        searchedAt: true,
      },
      take: RECENT_SEARCH_LIMIT,
      where: { userId },
    });
    return {
      items: items.map(({ centerLatitude, centerLongitude, ...item }) => {
        const currentArea =
          typeof item.criteria === 'object' &&
          item.criteria !== null &&
          !Array.isArray(item.criteria) &&
          item.criteria.source === 'DEVICE';
        return {
          ...item,
          centerLatitude: currentArea ? null : centerLatitude.toNumber(),
          centerLongitude: currentArea ? null : centerLongitude.toNumber(),
        };
      }),
    };
  }

  async recordVehicleView(userId: string, vehicleId: string): Promise<void> {
    await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      await transaction.renterRecentVehicleView.upsert({
        create: { userId, vehicleId },
        update: { viewedAt: new Date() },
        where: { userId_vehicleId: { userId, vehicleId } },
      });
      const excess = await transaction.renterRecentVehicleView.findMany({
        orderBy: [{ viewedAt: 'desc' }, { vehicleId: 'desc' }],
        select: { vehicleId: true },
        skip: RECENT_VEHICLE_LIMIT,
        where: { userId },
      });
      if (excess.length) {
        await transaction.renterRecentVehicleView.deleteMany({
          where: { userId, vehicleId: { in: excess.map(({ vehicleId }) => vehicleId) } },
        });
      }
    });
  }

  async listVehicleViews(userId: string) {
    const views = await this.database.client.renterRecentVehicleView.findMany({
      orderBy: [{ viewedAt: 'desc' }, { vehicleId: 'desc' }],
      select: { vehicleId: true, viewedAt: true },
      take: RECENT_VEHICLE_LIMIT,
      where: { userId },
    });
    const ids = views.map(({ vehicleId }) => vehicleId);
    const [eligible, favorites] = await Promise.all([
      this.eligibility.findEligible(ids, undefined, userId),
      this.database.client.userFavorite.findMany({
        select: { vehicleId: true },
        where: { userId, vehicleId: { in: ids } },
      }),
    ]);
    const byId = new Map(eligible.map((vehicle) => [vehicle.id, vehicle]));
    const favoriteIds = new Set(favorites.map(({ vehicleId }) => vehicleId));
    return {
      items: views.flatMap(({ vehicleId, viewedAt }) => {
        const vehicle = byId.get(vehicleId);
        return vehicle
          ? [{ viewedAt, vehicle: this.projection.detail(vehicle, favoriteIds.has(vehicleId)) }]
          : [];
      }),
    };
  }
}
