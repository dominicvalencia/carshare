import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import {
  FileAssetStatus,
  FileClassification,
  OwnerProfileStatus,
  RoleCode,
  VehicleLifecycleStatus,
  VehicleOperationalStatus,
  VerificationStatus,
} from '@carrental/database';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';

describe.sequential('Phase 4 public discovery integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let renterToken = '';
  let ownerUserId = '';
  let firstVehicleId = '';
  let secondVehicleId = '';
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'correct horse battery staple';
  const start = futureIso(2, 9);
  const end = futureIso(3, 10);

  beforeAll(async () => {
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'rate:*', 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
    redis.disconnect();
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bufferLogs: true });
    app.use(cookieParser());
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix(API_PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
    );
    await app.init();
    database = app.get(DatabaseService);

    const renter = await register(`phase4-renter-${unique}@example.test`);
    renterToken = renter.body.data.accessToken;
    const owner = await register(`phase4-owner-${unique}@example.test`);
    ownerUserId = owner.body.data.user.id;
    const ownerRole = await database.client.role.findUniqueOrThrow({
      where: { code: RoleCode.OWNER },
    });
    await database.client.userRole.create({ data: { roleId: ownerRole.id, userId: ownerUserId } });
    const ownerProfile = await database.client.ownerProfile.create({
      data: {
        legalName: 'Private Legal Name',
        status: OwnerProfileStatus.VERIFIED,
        userId: ownerUserId,
        verifiedAt: new Date(),
      },
    });
    firstVehicleId = await createPublicVehicle(ownerProfile.id, 'Near', 13.9414, 121.623, 250_000);
    secondVehicleId = await createPublicVehicle(ownerProfile.id, 'Farther', 13.98, 121.65, 220_000);
  });

  afterAll(async () => {
    await app.close();
  });

  it('searches with PostGIS, protects privacy, quotes immutable policies, and respects blocks', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ latitude: 13.9414, longitude: 121.623, radius: 101 })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('SEARCH_RADIUS_EXCEEDED'));

    const search = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({
        end,
        latitude: 13.9414,
        longitude: 121.623,
        make: `PhaseFour-${unique}`,
        radius: 25,
        sort: 'DISTANCE',
        start,
      })
      .expect(200);
    expect(search.body.data.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual([
      firstVehicleId,
      secondVehicleId,
    ]);
    expect(search.body.data.items[0].distanceKm).toBe(0);
    expect(JSON.stringify(search.body.data)).not.toContain('latitude');
    expect(JSON.stringify(search.body.data)).not.toContain('longitude');

    const filteredOut = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ latitude: 13.9414, longitude: 121.623, make: 'NotThisMake', radius: 25 })
      .expect(200);
    expect(filteredOut.body.data.items).toEqual([]);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${firstVehicleId}`)
      .expect(200);
    for (const privateKey of [
      'plateNumber',
      'vin',
      'documents',
      'objectKey',
      'pickupAreaLabel',
      'reviewReason',
    ]) {
      expect(hasKey(detail.body.data, privateKey)).toBe(false);
    }
    const publicJson = JSON.stringify(detail.body.data);
    expect(publicJson).not.toContain('Private Legal Name');
    expect(publicJson).not.toContain(`phase4-owner-${unique}@example.test`);

    await request(app.getHttpServer())
      .put(`/api/v1/favorites/${firstVehicleId}`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(200);
    const favorites = await request(app.getHttpServer())
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(200);
    expect(favorites.body.data.items[0].vehicle.vehicleId).toBe(firstVehicleId);

    const firstQuote = await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${firstVehicleId}/quotes`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ end, start })
      .expect(201);
    expect(firstQuote.body.data.chargeableDays).toBe(2);
    expect(firstQuote.body.data.totalMinor).toBe(500_000);
    expect(firstQuote.body.data.includedMileageKm).toBe(300);
    expect(firstQuote.body.data.reservesVehicle).toBe(false);
    const firstPolicyId = firstQuote.body.data.policyVersionId;

    await database.client.vehiclePolicyVersion.create({
      data: policy(firstVehicleId, 2, 300_000),
    });
    const oldQuote = await request(app.getHttpServer())
      .get(`/api/v1/quotes/${firstQuote.body.data.id}`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(200);
    expect(oldQuote.body.data.totalMinor).toBe(500_000);
    expect(oldQuote.body.data.policyVersionId).toBe(firstPolicyId);
    expect(oldQuote.body.data.status).toBe('CONFIGURATION_CHANGED');

    const secondQuote = await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${firstVehicleId}/quotes`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ end, start })
      .expect(201);
    expect(secondQuote.body.data.totalMinor).toBe(600_000);
    expect(secondQuote.body.data.policyVersionId).not.toBe(firstPolicyId);

    await database.client.$transaction(async (transaction) => {
      const occupancy = await transaction.vehicleOccupancy.create({
        data: {
          occupiedEnd: new Date(end),
          occupiedStart: new Date(start),
          type: 'OWNER_BLOCK',
          vehicleId: firstVehicleId,
        },
      });
      await transaction.vehicleBlockedPeriod.create({
        data: {
          createdByUserId: ownerUserId,
          endsAt: new Date(end),
          occupancyId: occupancy.id,
          reason: 'PERSONAL_USE',
          startsAt: new Date(start),
          vehicleId: firstVehicleId,
        },
      });
    });
    const unavailable = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${firstVehicleId}/availability`)
      .query({ end, start })
      .expect(200);
    expect(unavailable.body.data.available).toBe(false);
    expect(unavailable.body.data.reasons).toContain('OWNER_BLOCKED');
    await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${firstVehicleId}/quotes`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ end, start })
      .expect(409);
  });

  async function register(email: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, platform: 'WEB' })
      .expect(201);
  }

  async function createPublicVehicle(
    ownerProfileId: string,
    model: string,
    latitude: number,
    longitude: number,
    dailyRateMinor: number,
  ): Promise<string> {
    const category = await database.client.vehicleCategory.findFirstOrThrow({
      where: { active: true },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        approvedAt: new Date(),
        categoryId: category.id,
        description: 'A safe public description.',
        fuelType: 'GASOLINE',
        make: `PhaseFour-${unique}`,
        model,
        modelYear: 2025,
        operationalStatus: VehicleOperationalStatus.AVAILABLE,
        ownerProfileId,
        ownerUserId,
        plateNumber: `PRIVATE-${randomUUID().slice(0, 8)}`,
        powertrain: 'ICE',
        reviewReason: 'private admin review',
        seatCount: 5,
        status: VehicleLifecycleStatus.APPROVED,
        transmission: 'AUTOMATIC',
        vin: `PRIVATE-VIN-${randomUUID()}`,
      },
    });
    await database.client.vehicleLocation.create({
      data: {
        city: 'Lucena City',
        country: 'PH',
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        pickupAreaLabel: 'Private exact pickup landmark',
        province: 'Quezon',
        timezone: 'Asia/Manila',
        vehicleId: vehicle.id,
      },
    });
    const photo = await database.client.fileAsset.create({
      data: {
        checksum: 'a'.repeat(64),
        classification: FileClassification.PUBLIC,
        mimeType: 'image/jpeg',
        objectKey: `${unique}/${randomUUID()}`,
        originalName: 'public.jpg',
        size: 1n,
        status: FileAssetStatus.READY,
        uploadedById: ownerUserId,
      },
    });
    await database.client.vehiclePhoto.create({
      data: {
        displayOrder: 0,
        fileAssetId: photo.id,
        isCover: true,
        perspective: 'FRONT',
        vehicleId: vehicle.id,
      },
    });
    const required = await database.client.vehicleDocumentDefinition.findMany({
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    for (const definition of required) {
      const file = await database.client.fileAsset.create({
        data: {
          checksum: 'b'.repeat(64),
          classification: FileClassification.SENSITIVE,
          mimeType: 'application/pdf',
          objectKey: `${unique}/${randomUUID()}`,
          originalName: 'private-document.pdf',
          size: 1n,
          status: FileAssetStatus.READY,
          uploadedById: ownerUserId,
        },
      });
      await database.client.vehicleDocument.create({
        data: {
          definitionId: definition.id,
          expiresAt: futureDate(365),
          fileAssetId: file.id,
          reviewedAt: new Date(),
          status: VerificationStatus.VERIFIED,
          vehicleId: vehicle.id,
        },
      });
    }
    await database.client.vehiclePolicyVersion.create({
      data: policy(vehicle.id, 1, dailyRateMinor),
    });
    return vehicle.id;
  }

  function policy(vehicleId: string, version: number, dailyRateMinor: number) {
    return {
      availabilityPolicy: 'EVERY_DAY' as const,
      createdByUserId: ownerUserId,
      currency: 'PHP',
      dailyRateMinor,
      excessKilometerRateMinor: 1_200,
      fuelReturnPolicy: 'SAME_TO_SAME' as const,
      fuelTolerancePercent: 5,
      includedKilometersPerDay: 150,
      maximumRentalDays: 30,
      mileagePolicy: 'LIMITED' as const,
      minimumRentalDays: 1,
      turnaroundMinutes: 120,
      vehicleId,
      version,
    };
  }
});

function futureDate(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function futureIso(days: number, hour: number): string {
  const date = futureDate(days);
  date.setUTCHours(hour - 8, 0, 0, 0);
  return date.toISOString();
}

function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, key)) return true;
  return Object.values(value).some((nested) => hasKey(nested, key));
}
