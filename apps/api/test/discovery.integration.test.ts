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
  VerificationType,
} from '@carrental/database';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';

describe.sequential('Phase 4 public discovery integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let renterToken = '';
  let renterUserId = '';
  let ownerToken = '';
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
    renterUserId = renter.body.data.user.id;
    await approveRenter(renterUserId);
    const owner = await register(`phase4-owner-${unique}@example.test`);
    ownerToken = owner.body.data.accessToken;
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
    firstVehicleId = await createPublicVehicle(
      ownerProfile.id,
      ownerUserId,
      'Near',
      13.9414,
      121.623,
      250_000,
    );
    const secondOwner = await register(`phase4-second-owner-${unique}@example.test`);
    const secondOwnerProfile = await database.client.ownerProfile.create({
      data: {
        legalName: 'Second Private Legal Name',
        status: OwnerProfileStatus.VERIFIED,
        userId: secondOwner.body.data.user.id,
        verifiedAt: new Date(),
      },
    });
    secondVehicleId = await createPublicVehicle(
      secondOwnerProfile.id,
      secondOwner.body.data.user.id,
      'Farther',
      13.98,
      121.65,
      220_000,
    );
  });

  it('excludes the authenticated owner’s vehicles before pagination and rejects direct access', async () => {
    const query = {
      latitude: 13.9414,
      longitude: 121.623,
      make: `PhaseFour-${unique}`,
      radius: 25,
      sort: 'DISTANCE',
    };
    const anonymous = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query(query)
      .expect(200);
    expect(anonymous.body.data.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual([
      firstVehicleId,
      secondVehicleId,
    ]);

    const asOwner = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ ...query, limit: 1 })
      .expect(200);
    expect(asOwner.body.data.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual([
      secondVehicleId,
    ]);
    expect(asOwner.body.data.pageInfo.hasNextPage).toBe(false);

    await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${firstVehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${firstVehicleId}/quotes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ end, start })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('OWNER_CANNOT_BOOK_OWN_VEHICLE'));
    await request(app.getHttpServer())
      .put(`/api/v1/favorites/${firstVehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('filters unified booking occupancy before pagination and honors exact buffer boundaries', async () => {
    const occupiedStart = futureIso(10, 9);
    const rentalEnd = futureIso(11, 10);
    const quote = await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${firstVehicleId}/quotes`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ start: occupiedStart, end: rentalEnd })
      .expect(201);
    const hold = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .set('Idempotency-Key', `discovery-occupancy-${unique}`)
      .send({ quoteId: quote.body.data.id })
      .expect(201);
    const booking = await database.client.booking.findUniqueOrThrow({
      where: { publicReference: hold.body.data.publicReference },
    });
    expect(booking.renterUserId).toBe(renterUserId);
    const occupancy = await database.client.vehicleOccupancy.findFirstOrThrow({
      where: { bookingId: booking.id, active: true },
    });
    const baseQuery = {
      latitude: 13.9414,
      longitude: 121.623,
      make: `PhaseFour-${unique}`,
      radius: 25,
      sort: 'DISTANCE',
    };
    const overlapping = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ ...baseQuery, start: occupiedStart, end: rentalEnd, limit: 1 })
      .expect(200);
    expect(
      overlapping.body.data.items.map((item: { vehicleId: string }) => item.vehicleId),
    ).toEqual([secondVehicleId]);
    expect(overlapping.body.data.pageInfo.hasNextPage).toBe(false);

    const afterStart = occupancy.occupiedEnd.toISOString();
    const afterEnd = new Date(occupancy.occupiedEnd.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const exactAfter = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ ...baseQuery, start: afterStart, end: afterEnd })
      .expect(200);
    expect(exactAfter.body.data.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual(
      [firstVehicleId, secondVehicleId],
    );

    const exactBeforeEnd = new Date(occupancy.occupiedStart.getTime() - 120 * 60 * 1000);
    const exactBeforeStart = new Date(exactBeforeEnd.getTime() - 24 * 60 * 60 * 1000);
    const exactBefore = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({
        ...baseQuery,
        start: exactBeforeStart.toISOString(),
        end: exactBeforeEnd.toISOString(),
      })
      .expect(200);
    expect(
      exactBefore.body.data.items.map((item: { vehicleId: string }) => item.vehicleId),
    ).toEqual([firstVehicleId, secondVehicleId]);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${hold.body.data.publicReference}/cancel`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ reason: 'Release Phase 12 discovery test occupancy.' })
      .expect(201);
  });

  it('returns stable cursor pages without duplicates when availability changes between requests', async () => {
    const owner = await database.client.ownerProfile.findFirstOrThrow({
      where: { userId: ownerUserId },
    });
    const vehicleIds: string[] = [];
    for (let index = 0; index < 22; index += 1) {
      vehicleIds.push(
        await createPublicVehicle(
          owner.id,
          ownerUserId,
          `Page-${String(index).padStart(2, '0')}`,
          13.9414 + index * 0.0001,
          121.623,
          200_000 + index,
        ),
      );
    }
    const query = {
      latitude: 13.9414,
      longitude: 121.623,
      make: `PhaseFour-${unique}`,
      model: 'Page-',
      radius: 25,
      sort: 'DISTANCE',
      limit: 10,
    };
    const first = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query(query)
      .expect(200);
    expect(first.body.data.items).toHaveLength(10);
    expect(first.body.data.pageInfo.hasNextPage).toBe(true);

    const repeated = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query(query)
      .expect(200);
    expect(repeated.body.data.items.map((item: { vehicleId: string }) => item.vehicleId)).toEqual(
      first.body.data.items.map((item: { vehicleId: string }) => item.vehicleId),
    );

    await database.client.vehicle.update({
      data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
      where: { id: vehicleIds[10] },
    });
    const second = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ ...query, cursor: first.body.data.pageInfo.nextCursor })
      .expect(200);
    expect(second.body.data.items).toHaveLength(10);
    const third = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ ...query, cursor: second.body.data.pageInfo.nextCursor })
      .expect(200);
    expect(third.body.data.items).toHaveLength(1);
    expect(third.body.data.pageInfo).toEqual({ hasNextPage: false, nextCursor: null });
    const allIds = [
      ...first.body.data.items,
      ...second.body.data.items,
      ...third.body.data.items,
    ].map((item: { vehicleId: string }) => item.vehicleId);
    expect(new Set(allIds).size).toBe(21);
    expect(allIds).not.toContain(vehicleIds[10]);

    await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({ ...query, cursor: Buffer.from('{}').toString('base64') })
      .expect(400);
    await database.client.vehicle.updateMany({
      data: { operationalStatus: VehicleOperationalStatus.MAINTENANCE },
      where: { id: { in: vehicleIds } },
    });
  }, 120_000);

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
    expect(detail.body.data.pricing.durationDiscounts).toEqual([]);
    expect(hasKey(detail.body.data, 'policyVersionId')).toBe(false);
    expect(detail.body.data.owner.publicReference).toMatch(/^HOST-|^[a-z0-9]+$/i);
    const host = await request(app.getHttpServer())
      .get(`/api/v1/hosts/${detail.body.data.owner.publicReference}`)
      .expect(200);
    expect(
      host.body.data.availableVehicles.some(
        (item: { vehicleId: string }) => item.vehicleId === firstVehicleId,
      ),
    ).toBe(true);
    expect(JSON.stringify(host.body.data)).not.toContain('Private Legal Name');
    expect(hasKey(host.body.data, 'id')).toBe(false);

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

    await database.client.vehiclePolicyVersion.create({
      data: { ...policy(secondVehicleId, 2, 220_000), weeklyDiscountBps: 1_000 },
    });
    const detailWithDiscount = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${secondVehicleId}`)
      .expect(200);
    expect(detailWithDiscount.body.data.pricing.durationDiscounts).toEqual([
      { discountBps: 1_000, minimumDays: 7 },
    ]);
    expect(hasKey(detailWithDiscount.body.data, 'policyVersionId')).toBe(false);
    const discountStart = new Date(start);
    discountStart.setUTCDate(discountStart.getUTCDate() + 20);
    const discountEnd = new Date(discountStart);
    discountEnd.setUTCDate(discountEnd.getUTCDate() + 7);
    const discountedQuote = await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${secondVehicleId}/quotes`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ end: discountEnd.toISOString(), start: discountStart.toISOString() })
      .expect(201);
    expect(discountedQuote.body.data).toMatchObject({
      baseRentalAmountMinor: 1_540_000,
      discountedRentalSubtotalMinor: 1_386_000,
      durationDiscountAmountMinor: 154_000,
      durationDiscountBps: 1_000,
      durationDiscountTier: 'WEEKLY_7_DAY',
      totalMinor: 1_386_000,
    });
    expect(discountedQuote.body.data.lines.map((line: { code: string }) => line.code)).toEqual([
      'RENTAL_BASE',
      'DURATION_DISCOUNT',
    ]);
    const discountedHold = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${renterToken}`)
      .set('Idempotency-Key', `discount-hold-${unique}`)
      .send({ quoteId: discountedQuote.body.data.id })
      .expect(201);
    await database.client.vehiclePolicyVersion.create({
      data: { ...policy(secondVehicleId, 3, 220_000), weeklyDiscountBps: 2_000 },
    });
    const frozenBooking = await database.client.booking.findUniqueOrThrow({
      include: { pricingSnapshot: true },
      where: { publicReference: discountedHold.body.data.publicReference },
    });
    expect(frozenBooking.pricingSnapshot).toMatchObject({
      durationDiscountBps: 1_000,
      totalMinor: 1_386_000,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${discountedHold.body.data.publicReference}/continue`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${discountedHold.body.data.publicReference}/payment/authorize`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(201);
    const authorizedPayment = await database.client.payment.findFirstOrThrow({
      where: { bookingId: frozenBooking.id, purpose: 'RENTAL' },
    });
    expect(authorizedPayment.amountMinor).toBe(1_386_000n);

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

  async function approveRenter(userId: string) {
    await database.client.user.update({
      data: {
        emailVerifiedAt: new Date(),
        mobileNumber: `+639${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`,
        mobileVerifiedAt: new Date(),
        profile: {
          upsert: {
            create: {
              driverLicenseExpiry: futureDate(365),
              firstName: 'Pilot',
              lastName: 'Renter',
            },
            update: { driverLicenseExpiry: futureDate(365) },
          },
        },
      },
      where: { id: userId },
    });
    await database.client.verification.createMany({
      data: [VerificationType.IDENTITY, VerificationType.DRIVER_LICENSE].map((type) => ({
        expiresAt: futureDate(365),
        reviewedAt: new Date(),
        status: VerificationStatus.APPROVED,
        type,
        userId,
      })),
    });
  }

  async function createPublicVehicle(
    ownerProfileId: string,
    vehicleOwnerUserId: string,
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
        ownerUserId: vehicleOwnerUserId,
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
        uploadedById: vehicleOwnerUserId,
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
          uploadedById: vehicleOwnerUserId,
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
      data: policy(vehicle.id, 1, dailyRateMinor, vehicleOwnerUserId),
    });
    return vehicle.id;
  }

  function policy(
    vehicleId: string,
    version: number,
    dailyRateMinor: number,
    createdByUserId = ownerUserId,
  ) {
    return {
      availabilityPolicy: 'EVERY_DAY' as const,
      createdByUserId,
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
