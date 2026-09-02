import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import {
  BookingStatus,
  InspectionAmendmentStatus,
  InspectionStatus,
  InspectionType,
  RoleCode,
} from '@carrental/database';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';

interface Actor {
  readonly userId: string;
  readonly token: string;
}

describe.sequential('Phase 12 inspection correction workflow', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let owner: Actor;
  let admin: Actor;
  let renter: Actor;
  let outsider: Actor;
  let reference = '';
  let inspectionId = '';
  const originalOdometer = 125_000_000n;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  beforeAll(async () => {
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
    tokens = app.get(TokenService);
    owner = await actor('owner', [RoleCode.RENTER, RoleCode.OWNER]);
    admin = await actor('admin', [RoleCode.ADMIN]);
    renter = await actor('renter', [RoleCode.RENTER]);
    outsider = await actor('outsider', [RoleCode.RENTER]);
    const ownerProfile = await database.client.ownerProfile.create({
      data: {
        userId: owner.userId,
        status: 'VERIFIED',
        legalName: 'Correction Test Owner',
        verifiedAt: new Date(),
      },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        ownerUserId: owner.userId,
        ownerProfileId: ownerProfile.id,
        make: 'Toyota',
        model: 'Fortuner',
        modelYear: 2026,
        status: 'APPROVED',
      },
    });
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        vehicleId: vehicle.id,
        version: 1,
        createdByUserId: owner.userId,
        dailyRateMinor: 100_000,
        minimumRentalDays: 1,
        maximumRentalDays: 30,
        mileagePolicy: 'UNLIMITED',
        turnaroundMinutes: 120,
      },
    });
    const start = new Date(Date.now() - 3_600_000);
    const end = new Date(Date.now() + 86_400_000);
    const quote = await database.client.pricingQuote.create({
      data: {
        renterUserId: renter.userId,
        vehicleId: vehicle.id,
        policyVersionId: policy.id,
        rentalStart: start,
        rentalEnd: end,
        vehicleTimezone: 'Asia/Manila',
        chargeableDays: 1,
        currency: 'PHP',
        subtotalMinor: 100_000,
        totalMinor: 100_000,
        unlimitedMileage: true,
        turnaroundMinutes: 120,
        pricingEngineVersion: 'PHASE12_CORRECTION_TEST',
        expiresAt: new Date(Date.now() + 900_000),
      },
    });
    reference = `P12-CORR-${unique}`.slice(0, 32);
    const booking = await database.client.booking.create({
      data: {
        publicReference: reference,
        renterUserId: renter.userId,
        ownerUserId: owner.userId,
        ownerProfileId: ownerProfile.id,
        vehicleId: vehicle.id,
        quoteId: quote.id,
        status: BookingStatus.ACTIVE,
        rentalStart: start,
        rentalEnd: end,
        actualPickupAt: start,
      },
    });
    inspectionId = (
      await database.client.inspection.create({
        data: {
          bookingId: booking.id,
          type: InspectionType.PICKUP,
          status: InspectionStatus.FINALIZED,
          submittedByUserId: owner.userId,
          odometerMeters: originalOdometer,
          fuelBasisPoints: 7500,
          batterySocBasisPoints: 8200,
          finalizedAt: start,
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => app.close());

  it('creates one pending request and protects against duplicate pending requests', async () => {
    const first = await auth(
      request(app.getHttpServer()).post(
        `/api/v1/owner/bookings/${reference}/rental/inspections/${inspectionId}/corrections`,
      ),
      owner,
    )
      .send({
        proposedOdometerMeters: '12500000',
        reason: 'An accidental extra zero was entered during pickup.',
      })
      .expect(201);
    expect(first.body.data).toMatchObject({
      status: InspectionAmendmentStatus.PENDING_REVIEW,
      proposedOdometerMeters: '12500000',
    });
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/owner/bookings/${reference}/rental/inspections/${inspectionId}/corrections`,
      ),
      owner,
    )
      .send({
        proposedOdometerMeters: '12500000',
        reason: 'A second duplicate correction must not be accepted.',
      })
      .expect(409);
  });

  it('requires admin permissions and approves without mutating original evidence', async () => {
    const correction = await database.client.inspectionAmendment.findFirstOrThrow({
      where: { inspectionId, status: InspectionAmendmentStatus.PENDING_REVIEW },
    });
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/rentals/inspection-corrections/${correction.id}/review`,
      ),
      outsider,
    )
      .send({ approved: true, reason: 'Unauthorized review must fail safely.' })
      .expect(403);
    const queue = await auth(
      request(app.getHttpServer()).get(
        '/api/v1/admin/rentals/inspection-corrections?status=PENDING_REVIEW',
      ),
      admin,
    ).expect(200);
    expect(queue.body.data.some(({ id }: { id: string }) => id === correction.id)).toBe(true);
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/rentals/inspection-corrections/${correction.id}/review`,
      ),
      admin,
    )
      .send({
        approved: true,
        reason: 'Dashboard evidence supports removal of the accidental zero.',
      })
      .expect(201);
    expect(
      await database.client.inspection.findUniqueOrThrow({ where: { id: inspectionId } }),
    ).toMatchObject({ odometerMeters: originalOdometer });
    expect(
      await database.client.inspectionAmendment.findUniqueOrThrow({ where: { id: correction.id } }),
    ).toMatchObject({ status: InspectionAmendmentStatus.APPROVED, reviewedByUserId: admin.userId });
  });

  it('supports fuel/SOC proposals, rejection, and prevents requester self-review', async () => {
    const rejected = await database.client.inspectionAmendment.create({
      data: {
        inspectionId,
        createdByUserId: owner.userId,
        reason: 'Fuel and SOC values were transposed during the inspection.',
        proposedFuelBasisPoints: 8200,
        proposedBatterySocBasisPoints: 7500,
      },
    });
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/rentals/inspection-corrections/${rejected.id}/review`,
      ),
      admin,
    )
      .send({
        approved: false,
        reason: 'The available dashboard evidence does not support this proposal.',
      })
      .expect(201);
    expect(
      await database.client.inspectionAmendment.findUniqueOrThrow({ where: { id: rejected.id } }),
    ).toMatchObject({ status: InspectionAmendmentStatus.REJECTED });
    const selfReview = await database.client.inspectionAmendment.create({
      data: {
        inspectionId,
        createdByUserId: admin.userId,
        reason: 'Conflict-of-interest regression record for admin requester.',
        proposedFuelBasisPoints: 7000,
      },
    });
    await auth(
      request(app.getHttpServer()).post(
        `/api/v1/admin/rentals/inspection-corrections/${selfReview.id}/review`,
      ),
      admin,
    )
      .send({ approved: true, reason: 'A requester must not approve their own correction.' })
      .expect(403);
  });

  async function actor(label: string, roles: readonly RoleCode[]): Promise<Actor> {
    const rows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    await database.client.user.create({
      data: {
        id: userId,
        email: `${label}-${unique}@example.test`,
        normalizedEmail: `${label}-${unique}@example.test`,
        roles: { create: rows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: { id: sessionId, expiresAt: new Date(Date.now() + 86_400_000), platform: 'WEB' },
        },
      },
    });
    return { userId, token: await tokens.signAccessToken(userId, sessionId, roles) };
  }
  function auth<T extends request.Test>(operation: T, value: Actor): T {
    return operation.set('Authorization', `Bearer ${value.token}`) as T;
  }
});
