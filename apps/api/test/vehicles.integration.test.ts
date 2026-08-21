import cookieParser from 'cookie-parser';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { argon2id, hash } from 'argon2';
import { Logger } from 'nestjs-pino';
import Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import { OwnerProfileStatus, RoleCode, VehicleLifecycleStatus } from '@carrental/database';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { CryptoService } from '../src/security/crypto.service';

describe.sequential('Phase 3 vehicle supply integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const password = 'correct horse battery staple';
  const ownerEmail = `vehicle-owner-${unique}@example.test`;
  let ownerToken = '';
  let ownerId = '';
  let renterToken = '';
  let adminToken = '';
  let supportToken = '';
  let vehicleId = '';
  let categoryId = '';
  let approvedPhotoFileId = '';
  let sensitiveDocumentFileId = '';
  let archivedVehicleId = '';

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
    const owner = await register(ownerEmail);
    ownerToken = owner.body.data.accessToken;
    const renter = await register(`vehicle-renter-${unique}@example.test`);
    renterToken = renter.body.data.accessToken;
    adminToken = await administrativeToken(
      RoleCode.SUPER_ADMIN,
      `vehicle-admin-${unique}@example.test`,
    );
    supportToken = await administrativeToken(
      RoleCode.SUPPORT,
      `vehicle-support-${unique}@example.test`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces OWNER plus VERIFIED before vehicle creation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/owner/vehicles')
      .set('Authorization', `Bearer ${renterToken}`)
      .send({})
      .expect(403);
    const started = await request(app.getHttpServer())
      .post('/api/v1/owners/onboarding')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    ownerId = started.body.data.id;
    await request(app.getHttpServer())
      .post('/api/v1/owner/vehicles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('OWNER_VERIFICATION_REQUIRED'));
    await request(app.getHttpServer())
      .patch('/api/v1/owners/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        addressLine1: '1 Vehicle Test Street',
        city: 'Makati',
        contactNumber: '+639171234567',
        legalName: 'Phase Three Owner',
        postalCode: '1200',
        province: 'Metro Manila',
      })
      .expect(200);
    const identityFile = await upload(ownerToken, 'SENSITIVE', 'owner-id.pdf', 'application/pdf');
    await request(app.getHttpServer())
      .post('/api/v1/owners/me/submission')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ verificationFileIds: [identityFile] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/owners/${ownerId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
  });

  it('creates an isolated structured draft and validates specifications', async () => {
    const categories = await request(app.getHttpServer())
      .get('/api/v1/owner/vehicle-reference-data/categories')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    categoryId = categories.body.data.find((item: { code: string }) => item.code === 'SUV').id;
    const created = await request(app.getHttpServer())
      .post('/api/v1/owner/vehicles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId, make: 'Toyota', model: 'Fortuner' })
      .expect(201);
    vehicleId = created.body.data.id;
    expect(created.body.data.status).toBe('DRAFT');
    const renter = await database.client.user.findUniqueOrThrow({
      where: { normalizedEmail: `vehicle-renter-${unique}@example.test` },
    });
    const ownerRole = await database.client.role.findUniqueOrThrow({
      where: { code: RoleCode.OWNER },
    });
    await database.client.userRole.create({ data: { roleId: ownerRole.id, userId: renter.id } });
    await database.client.ownerProfile.create({
      data: { status: OwnerProfileStatus.VERIFIED, userId: renter.id, verifiedAt: new Date() },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ modelYear: 2200 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ categoryId: '00000000-0000-4000-8000-000000000000' })
      .expect(422);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ seatCount: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        categoryId,
        color: 'White',
        description: 'Well-maintained seven-seat SUV.',
        doorCount: 5,
        fuelType: 'DIESEL',
        make: 'Toyota',
        model: 'Fortuner',
        modelYear: 2025,
        plateNumber: `ABC-${String(Date.now()).slice(-4)}`,
        powertrain: 'ICE',
        seatCount: 7,
        transmission: 'AUTOMATIC',
        variant: '2.4 V',
      })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/api/v1/owner/vehicles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(201);
    archivedVehicleId = second.body.data.id;
    const original = await database.client.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${second.body.data.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plateNumber: original.plateNumber })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DUPLICATE_VEHICLE_IDENTIFIER'));
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${archivedVehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ fuelType: 'ELECTRIC', powertrain: 'BATTERY_ELECTRIC' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${archivedVehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy())
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_EV_POLICY'));
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${archivedVehicleId}/archive`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${archivedVehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Cannot edit archived vehicle' })
      .expect(409);
  });

  it('configures features, PostGIS location, immutable policies, and blocked periods', async () => {
    const features = await request(app.getHttpServer())
      .get('/api/v1/owner/vehicle-reference-data/features')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/owner/vehicles/${vehicleId}/features`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ featureIds: features.body.data.slice(0, 3).map((item: { id: string }) => item.id) })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/owner/vehicles/${vehicleId}/location`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        city: 'Makati',
        latitude: '14.5547',
        longitude: '121.0244',
        pickupAreaLabel: 'Makati CBD',
        province: 'Metro Manila',
      })
      .expect(200);
    const spatial = await database.client.$queryRaw<Array<{ populated: boolean }>>`
      SELECT point IS NOT NULL AS populated FROM vehicle_locations WHERE vehicle_id = ${vehicleId}::uuid
    `;
    expect(spatial[0]?.populated).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy({ maximumRentalDays: 1, minimumRentalDays: 2 }))
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy({ includedKilometersPerDay: undefined }))
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy({ turnaroundMinutes: 60 }))
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy())
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy({ dailyRateMinor: 275_000, turnaroundMinutes: 240 }))
      .expect(201);
    const policies = await database.client.vehiclePolicyVersion.findMany({
      orderBy: { version: 'asc' },
      where: { vehicleId },
    });
    expect(policies.map(({ turnaroundMinutes }) => turnaroundMinutes)).toEqual([120, 240]);
    await expect(
      database.client.vehiclePolicyVersion.update({
        data: { dailyRateMinor: 1 },
        where: { id: policies[0]!.id },
      }),
    ).rejects.toThrow();
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(
        basePolicy({
          availabilityPolicy: 'WEEKLY',
          friday: false,
          monday: false,
          saturday: false,
          sunday: false,
          thursday: false,
          tuesday: false,
          wednesday: false,
        }),
      )
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/policy-versions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(basePolicy({ availabilityPolicy: 'WEEKLY', monday: true }))
      .expect(201);
    const startsAt = '2026-09-01T08:00:00+08:00';
    const endsAt = '2026-09-02T08:00:00+08:00';
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/blocked-periods`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ endsAt: startsAt, reason: 'MAINTENANCE', startsAt: endsAt })
      .expect(422);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/blocked-periods`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ endsAt, reason: 'MAINTENANCE', startsAt })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/blocked-periods`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        endsAt: '2026-09-03T08:00:00+08:00',
        reason: 'PERSONAL_USE',
        startsAt: '2026-09-01T12:00:00+08:00',
      })
      .expect(409);
    const storedBlock = await database.client.vehicleBlockedPeriod.findFirstOrThrow({
      where: { vehicleId },
    });
    expect(storedBlock.startsAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('requires five private photos and jurisdiction-required sensitive documents', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/submission`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(422)
      .expect(({ body }) => {
        expect(body.error.code).toBe('VEHICLE_INCOMPLETE');
        expect(body.error.details.some((item: { field: string }) => item.field === 'photos')).toBe(
          true,
        );
        expect(
          body.error.details.some((item: { field: string }) => item.field === 'documents'),
        ).toBe(true);
      });
    for (const [index, perspective] of [
      'FRONT',
      'REAR',
      'DRIVER_SIDE',
      'PASSENGER_SIDE',
      'INTERIOR_DASHBOARD',
    ].entries()) {
      const fileId = await upload(ownerToken, 'PRIVATE', `${perspective}.jpg`, 'image/jpeg');
      if (index === 0) approvedPhotoFileId = fileId;
      await request(app.getHttpServer())
        .post(`/api/v1/owner/vehicles/${vehicleId}/photos`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ displayOrder: index, fileAssetId: fileId, isCover: index === 0, perspective })
        .expect(201);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/files/${approvedPhotoFileId}/content`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(403);
    const definitions = await request(app.getHttpServer())
      .get('/api/v1/owner/vehicle-reference-data/document-definitions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    for (const definition of definitions.body.data.filter(
      (item: { required: boolean }) => item.required,
    )) {
      const fileId = await upload(
        ownerToken,
        'SENSITIVE',
        `${definition.code}.pdf`,
        'application/pdf',
      );
      sensitiveDocumentFileId ||= fileId;
      await request(app.getHttpServer())
        .post(`/api/v1/owner/vehicles/${vehicleId}/documents`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ definitionId: definition.id, fileAssetId: fileId })
        .expect(201);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/files/${sensitiveDocumentFileId}/content`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/files/${sensitiveDocumentFileId}/access-grants`)
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);
    const grant = await request(app.getHttpServer())
      .post(`/api/v1/files/${sensitiveDocumentFileId}/access-grants`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/file-access/${sensitiveDocumentFileId}`)
      .query({ grant: grant.body.data.grant })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/file-access/${sensitiveDocumentFileId}`)
      .query({ grant: `${grant.body.data.grant}tampered` })
      .expect(403);
    const crypto = app.get(CryptoService);
    const payload = Buffer.from(`${sensitiveDocumentFileId}:${Date.now() - 1}`).toString(
      'base64url',
    );
    const expiredGrant = `${payload}.${crypto.hashToken(`file-access:${payload}`)}`;
    await request(app.getHttpServer())
      .get(`/api/v1/file-access/${sensitiveDocumentFileId}`)
      .query({ grant: expiredGrant })
      .expect(403);
  });

  it('runs request-changes, correction, resubmission, and approval with permissions', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/submission`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/vehicles/${vehicleId}/approval`)
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/vehicles/${vehicleId}/change-request`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Clarify the listing description.' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Clarified seven-seat SUV listing.' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicleId}/submission`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/vehicles/${vehicleId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('APPROVED'));
    await request(app.getHttpServer())
      .get(`/api/v1/files/${approvedPhotoFileId}/content`)
      .set('Authorization', `Bearer ${renterToken}`)
      .expect(200);
    const history = await database.client.vehicleStatusHistory.findMany({
      where: { vehicleId },
    });
    expect(history.map(({ newStatus }) => newStatus)).toEqual([
      VehicleLifecycleStatus.DRAFT,
      VehicleLifecycleStatus.PENDING_APPROVAL,
      VehicleLifecycleStatus.CHANGES_REQUIRED,
      VehicleLifecycleStatus.PENDING_APPROVAL,
      VehicleLifecycleStatus.APPROVED,
    ]);
    const audit = await database.client.auditLog.findFirst({
      where: { action: 'VEHICLE_APPROVED', targetId: vehicleId },
    });
    expect(audit?.correlationId).toBeTruthy();
    await expect(
      database.client.vehicleStatusHistory.update({
        data: { reason: 'Mutation must fail' },
        where: { id: history[0]!.id },
      }),
    ).rejects.toThrow();
  });

  it('separates operational state and admin suspension from approval history', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}/operational-status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'MAINTENANCE' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ plateNumber: 'MATERIAL-CHANGE' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/vehicles/${vehicleId}/suspension`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Safety inspection required.' })
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('SUSPENDED'));
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicleId}/operational-status`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ status: 'AVAILABLE' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/vehicles/${vehicleId}/restoration`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Inspection completed.' })
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('APPROVED'));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/owners/${ownerId}/suspension`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Owner suspension authorization test' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/owner/vehicles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({})
      .expect(403);
  });

  async function register(email: string) {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, platform: 'WEB' })
      .expect(201);
  }

  async function administrativeToken(roleCode: RoleCode, email: string): Promise<string> {
    const role = await database.client.role.findUniqueOrThrow({ where: { code: roleCode } });
    await database.client.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
        normalizedEmail: email,
        passwordHash: await hash(password, {
          memoryCost: 19_456,
          parallelism: 1,
          timeCost: 2,
          type: argon2id,
        }),
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ identifier: email, password, platform: 'WEB' })
      .expect(200);
    return login.body.data.accessToken;
  }

  async function upload(
    token: string,
    classification: 'PRIVATE' | 'SENSITIVE',
    filename: string,
    contentType: string,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/files')
      .set('Authorization', `Bearer ${token}`)
      .field('classification', classification)
      .attach('file', Buffer.from(`${filename}-${unique}`), { contentType, filename });
    if (response.status !== 201) {
      throw new Error(
        `Upload ${filename} failed with ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    return response.body.data.id;
  }

  function basePolicy(overrides: Record<string, unknown> = {}) {
    return {
      availabilityPolicy: 'EVERY_DAY',
      dailyRateMinor: 250_000,
      excessKilometerRateMinor: 1_500,
      fuelReturnPolicy: 'SAME_TO_SAME',
      fuelTolerancePercent: 5,
      includedKilometersPerDay: 150,
      maximumRentalDays: 30,
      mileagePolicy: 'LIMITED',
      minimumRentalDays: 1,
      turnaroundMinutes: 120,
      ...overrides,
    };
  }
});
