import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import {
  BookingAmendmentStatus,
  BookingStatus,
  CommissionScope,
  FileAssetStatus,
  FileClassification,
  OwnerProfileStatus,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RoleCode,
  VerificationStatus,
  VerificationType,
  VehicleOccupancyType,
} from '@carrental/database';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';

interface Actor {
  token: string;
  userId: string;
}

describe.sequential('Task 18C-2A amendment preview HTTP integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let renter: Actor;
  let unrelatedRenter: Actor;
  let owner: Actor;
  let bookingId = '';
  let reference = '';
  let vehicleId = '';
  let paymentId = '';
  let paymentProviderReference = '';
  let ownerProfileId = '';
  let policyId = '';
  let rentalStart: Date;
  let rentalEnd: Date;
  let fixtureIndex = 0;
  const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;

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
    renter = await createActor('renter', [RoleCode.RENTER]);
    unrelatedRenter = await createActor('other-renter', [RoleCode.RENTER]);
    owner = await createActor('owner', [RoleCode.OWNER]);
    const ownerProfile = await database.client.ownerProfile.create({
      data: {
        legalName: 'Amendment Preview Owner',
        status: OwnerProfileStatus.VERIFIED,
        userId: owner.userId,
        verifiedAt: new Date(),
      },
    });
    ownerProfileId = ownerProfile.id;
    const category = await database.client.vehicleCategory.findFirstOrThrow({
      where: { active: true },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        approvedAt: new Date(),
        categoryId: category.id,
        make: 'Preview',
        model: unique,
        modelYear: 2026,
        operationalStatus: 'AVAILABLE',
        ownerProfileId: ownerProfile.id,
        ownerUserId: owner.userId,
        status: 'APPROVED',
      },
    });
    vehicleId = vehicle.id;
    await database.client.vehicleLocation.create({
      data: {
        city: 'Makati City',
        latitude: '14.554700',
        longitude: '121.024400',
        province: 'Metro Manila',
        timezone: 'Asia/Manila',
        vehicleId,
      },
    });
    const cover = await database.client.fileAsset.create({
      data: {
        checksum: 'c'.repeat(64),
        classification: FileClassification.PUBLIC,
        mimeType: 'image/jpeg',
        objectKey: `${unique}/${randomUUID()}`,
        originalName: 'cover.jpg',
        size: 1n,
        status: FileAssetStatus.READY,
        uploadedById: owner.userId,
      },
    });
    await database.client.vehiclePhoto.create({
      data: {
        displayOrder: 0,
        fileAssetId: cover.id,
        isCover: true,
        perspective: 'FRONT',
        vehicleId,
      },
    });
    const requiredDocuments = await database.client.vehicleDocumentDefinition.findMany({
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    for (const definition of requiredDocuments) {
      const file = await database.client.fileAsset.create({
        data: {
          checksum: 'd'.repeat(64),
          classification: FileClassification.SENSITIVE,
          mimeType: 'application/pdf',
          objectKey: `${unique}/${randomUUID()}`,
          originalName: 'vehicle-document.pdf',
          size: 1n,
          status: FileAssetStatus.READY,
          uploadedById: owner.userId,
        },
      });
      await database.client.vehicleDocument.create({
        data: {
          definitionId: definition.id,
          expiresAt: future(365, 0),
          fileAssetId: file.id,
          reviewedAt: new Date(),
          status: VerificationStatus.VERIFIED,
          vehicleId,
        },
      });
    }
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        availabilityPolicy: 'EVERY_DAY',
        collectionFeeMinor: 30_000,
        createdByUserId: owner.userId,
        dailyRateMinor: 100_000,
        deliveryFeeMinor: 30_000,
        extendedTripDiscountBps: 1_500,
        fulfillmentMinimumNoticeMinutes: 0,
        fulfillmentServiceRadiusMeters: 50_000,
        maximumRentalDays: 30,
        mileagePolicy: 'UNLIMITED',
        minimumRentalDays: 1,
        monthlyDiscountBps: 2_000,
        shortDurationDiscountBps: 500,
        supportsOwnerCollection: true,
        supportsOwnerDelivery: true,
        turnaroundMinutes: 120,
        vehicleId,
        version: 1,
        weeklyDiscountBps: 1_000,
      },
    });
    policyId = policy.id;
  }, 60_000);

  beforeEach(async () => {
    await createBookingFixture();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createBookingFixture(status = BookingStatus.CONFIRMED) {
    fixtureIndex += 1;
    rentalStart = future(10 + fixtureIndex * 4, 9);
    rentalEnd = new Date(rentalStart.getTime() + 2 * 86_400_000);
    const quote = await database.client.pricingQuote.create({
      data: {
        baseRentalAmountMinor: 200_000,
        chargeableDays: 2,
        currency: 'PHP',
        discountedRentalSubtotalMinor: 200_000,
        expiresAt: new Date(Date.now() + 900_000),
        policyVersionId: policyId,
        pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        subtotalMinor: 200_000,
        totalMinor: 200_000,
        turnaroundMinutes: 120,
        unlimitedMileage: true,
        vehicleId,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    reference = `CR-2026-${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const booking = await database.client.booking.create({
      data: {
        fulfillmentSnapshot: {
          create: {
            collectionFeeMinor: 0,
            currency: 'PHP',
            deliveryFeeMinor: 0,
            endCity: 'Makati City',
            endCountry: 'PH',
            endLatitude: '14.554700',
            endLongitude: '121.024400',
            endMethod: 'RENTER_RETURN',
            endProvince: 'Metro Manila',
            minimumNoticeMinutes: 0,
            sourcePolicyVersionId: policyId,
            startCity: 'Makati City',
            startCountry: 'PH',
            startLatitude: '14.554700',
            startLongitude: '121.024400',
            startMethod: 'RENTER_PICKUP',
            startProvince: 'Metro Manila',
          },
        },
        ...(status === BookingStatus.HOLD || status === BookingStatus.AWAITING_PAYMENT
          ? { holdExpiresAt: new Date(Date.now() + 900_000) }
          : {}),
        ownerProfileId,
        ownerResponseDeadlineAt: new Date(Date.now() + 3_600_000),
        ownerUserId: owner.userId,
        policySnapshot: {
          create: {
            availabilityPolicy: 'EVERY_DAY',
            friday: true,
            monday: true,
            policyVersionId: policyId,
            saturday: true,
            sunday: true,
            thursday: true,
            turnaroundMinutes: 120,
            tuesday: true,
            wednesday: true,
            mileagePolicy: 'UNLIMITED',
          },
        },
        pricingSnapshot: {
          create: {
            baseRentalAmountMinor: 200_000,
            chargeableDays: 2,
            currency: 'PHP',
            discountedRentalSubtotalMinor: 200_000,
            policyVersionId: policyId,
            pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
            quoteId: quote.id,
            rentalEnd,
            rentalStart,
            subtotalMinor: 200_000,
            totalMinor: 200_000,
            unlimitedMileage: true,
            vehicleTimezone: 'Asia/Manila',
          },
        },
        publicReference: reference,
        quoteId: quote.id,
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        status,
        vehicleId,
      },
    });
    bookingId = booking.id;
    paymentProviderReference = `preview-payment-${unique}-${randomUUID()}`;
    const payment = await database.client.payment.create({
      data: {
        amountMinor: 200_000n,
        authorizedAmountMinor: 200_000n,
        bookingId,
        capturedAmountMinor: 200_000n,
        capturedAt: new Date(),
        currency: 'PHP',
        provider: 'FAKE',
        providerRequestReference: paymentProviderReference,
        purpose: PaymentPurpose.RENTAL,
        status: PaymentStatus.CAPTURED,
      },
    });
    paymentId = payment.id;
    let commissionRule = await database.client.commissionRule.findFirst({
      where: { currency: 'PHP', scope: CommissionScope.PLATFORM_DEFAULT },
    });
    commissionRule ??= await database.client.commissionRule.create({
      data: {
        calculationVersion: 'COMMISSION_BPS_V1',
        currency: 'PHP',
        effectiveFrom: new Date(0),
        rateBasisPoints: 1_000,
        reason: 'Task 18C-2A integration fixture',
        scope: CommissionScope.PLATFORM_DEFAULT,
        version: 1,
      },
    });
    await database.client.commissionSnapshot.create({
      data: {
        bookingId,
        calculatedCommissionMinor: 20_000n,
        calculationVersion: commissionRule.calculationVersion,
        commissionableBaseMinor: 200_000n,
        currency: 'PHP',
        fixedAmountMinor: commissionRule.fixedAmountMinor,
        paymentId,
        rateBasisPoints: commissionRule.rateBasisPoints,
        ruleId: commissionRule.id,
        ruleVersion: commissionRule.version,
        scope: commissionRule.scope,
      },
    });
    await database.client.ownerEarning.create({
      data: {
        bookingId,
        commissionAmountMinor: 20_000n,
        currency: 'PHP',
        grossRentalAmountMinor: 200_000n,
        netEarningAmountMinor: 180_000n,
        ownerProfileId,
        paymentId,
      },
    });
    await database.client.vehicleOccupancy.create({
      data: {
        active: true,
        bookingId,
        ...(status === BookingStatus.HOLD ||
        status === BookingStatus.AWAITING_PAYMENT ||
        status === BookingStatus.AWAITING_OWNER
          ? { expiresAt: new Date(Date.now() + 900_000) }
          : {}),
        occupiedEnd: new Date(rentalEnd.getTime() + 120 * 60_000),
        occupiedStart: rentalStart,
        type: VehicleOccupancyType.BOOKING_RESERVATION,
        vehicleId,
      },
    });
  }

  it('serves an owned booking by public reference and changes no durable authority', async () => {
    const before = await mutationSnapshot();
    const availabilityBefore = await availability();
    const listBefore = await search('LIST');
    const mapBefore = await search('MAP');
    const response = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    }).expect(201);
    expect(response.body.data).toMatchObject({
      bookingReference: reference,
      current: { rentalEnd: rentalEnd.toISOString() },
      financial: { currency: 'PHP' },
    });
    expect(response.body.data.previewToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.body.data)).not.toMatch(
      /ownerEarning|ownerEarnings|commissionMinor|commissionRule/u,
    );
    expect(await mutationSnapshot()).toEqual(before);
    expect(await availability()).toEqual(availabilityBefore);
    expect(await search('LIST')).toEqual(listBefore);
    expect(await search('MAP')).toEqual(mapBefore);
  });

  it('returns a privacy-safe conflict without exposing authoritative blocker details', async () => {
    const occupiedStart = new Date(rentalEnd.getTime() + 2 * 60 * 60_000);
    const occupiedEnd = new Date(rentalEnd.getTime() + 4 * 60 * 60_000);
    const blocker = await database.client.vehicleOccupancy.create({
      data: {
        occupiedEnd,
        occupiedStart,
        type: VehicleOccupancyType.OWNER_BLOCK,
        vehicleId,
      },
    });
    const response = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 3 * 60 * 60_000).toISOString(),
    }).expect(409);
    const serialized = JSON.stringify(response.body);
    expect(response.body.error).toMatchObject({
      code: 'VEHICLE_UNAVAILABLE',
      message: 'The vehicle is unavailable for the proposed period.',
    });
    for (const privateValue of [
      blocker.id,
      occupiedStart.toISOString(),
      occupiedEnd.toISOString(),
      'latestAvailableReturnAt',
      'Prisma',
      'stack',
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it('durably expires an amendment hold and releases Search, quote, preview, and direct booking', async () => {
    const protectedStart = new Date(rentalEnd.getTime() + 2 * 60 * 60_000);
    const protectedEnd = new Date(protectedStart.getTime() + 24 * 60 * 60_000);
    const futureExpiry = new Date(Date.now() + 10 * 60_000);
    const directQuote = await quote(unrelatedRenter, protectedStart, protectedEnd).expect(201);
    const amendment = await database.client.bookingAmendment.create({
      data: {
        bookingId,
        expiresAt: futureExpiry,
        idempotencyKey: `expiry-amendment-${randomUUID()}`,
        policyVersion: 'BOOKING_AMENDMENT_V1',
        proposedEndMethod: 'RENTER_RETURN',
        proposedRentalEnd: protectedEnd,
        proposedRentalStart: rentalStart,
        proposedStartMethod: 'RENTER_PICKUP',
        requestHash: 'b'.repeat(64),
        requesterUserId: renter.userId,
        scope: 'PRE_TRIP',
        sourcePricingPolicyVersionId: policyId,
        status: BookingAmendmentStatus.PENDING_OWNER,
      },
    });
    const occupancy = await database.client.vehicleOccupancy.create({
      data: {
        active: true,
        expiresAt: futureExpiry,
        occupiedEnd: protectedEnd,
        occupiedStart: protectedStart,
        type: VehicleOccupancyType.AMENDMENT_HOLD,
        vehicleId,
      },
    });
    const hold = await database.client.bookingAmendmentHold.create({
      data: {
        amendmentId: amendment.id,
        expiresAt: futureExpiry,
        idempotencyKey: `expiry-hold-${randomUUID()}`,
        occupancyId: occupancy.id,
        protectedEnd,
        protectedStart,
        status: 'ACTIVE',
        vehicleId,
      },
    });

    expect(await searchRange('LIST', protectedStart, protectedEnd)).not.toContain(vehicleId);
    expect(await searchRange('MAP', protectedStart, protectedEnd)).not.toContain(vehicleId);
    await quote(unrelatedRenter, protectedStart, protectedEnd)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('VEHICLE_UNAVAILABLE'));
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `held-before-expiry-${randomUUID()}`)
      .send({ quoteId: directQuote.body.data.id })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BOOKING_CONFLICT'));

    const expiredAt = new Date(Date.now() - 1_000);
    await database.client.vehicleOccupancy.update({
      data: { expiresAt: expiredAt },
      where: { id: occupancy.id },
    });
    await database.client.bookingAmendmentHold.update({
      data: { expiresAt: expiredAt },
      where: { id: hold.id },
    });
    await database.client.bookingAmendment.update({
      data: { expiresAt: expiredAt },
      where: { id: amendment.id },
    });
    const first = await database.client.$queryRaw<Array<{ expired: number }>>(Prisma.sql`
      SELECT "expire_stale_booking_amendments"() AS "expired"
    `);
    const retry = await database.client.$queryRaw<Array<{ expired: number }>>(Prisma.sql`
      SELECT "expire_stale_booking_amendments"() AS "expired"
    `);
    expect(Number(first[0]?.expired)).toBe(1);
    expect(Number(retry[0]?.expired)).toBe(0);

    const [persistedAmendment, persistedHold, persistedOccupancy, historyCount, outboxCount] =
      await Promise.all([
        database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendment.id } }),
        database.client.bookingAmendmentHold.findUniqueOrThrow({ where: { id: hold.id } }),
        database.client.vehicleOccupancy.findUniqueOrThrow({ where: { id: occupancy.id } }),
        database.client.bookingAmendmentStatusHistory.count({
          where: { amendmentId: amendment.id },
        }),
        database.client.outboxEvent.count({
          where: { aggregateId: amendment.id, eventType: 'BOOKING_AMENDMENT_TERMINATED' },
        }),
      ]);
    expect(persistedAmendment.status).toBe(BookingAmendmentStatus.EXPIRED);
    expect(persistedHold).toMatchObject({
      releaseReason: 'OWNER_RESPONSE_DEADLINE_EXPIRED',
      status: 'EXPIRED',
    });
    expect(persistedHold.releasedAt).toBeInstanceOf(Date);
    expect(persistedOccupancy).toMatchObject({
      active: false,
      releaseReason: 'OWNER_RESPONSE_DEADLINE_EXPIRED',
    });
    expect(persistedOccupancy.releasedAt).toBeInstanceOf(Date);
    expect(historyCount).toBe(1);
    expect(outboxCount).toBe(1);

    expect(await searchRange('LIST', protectedStart, protectedEnd)).toContain(vehicleId);
    expect(await searchRange('MAP', protectedStart, protectedEnd)).toContain(vehicleId);
    await quote(unrelatedRenter, protectedStart, protectedEnd).expect(201);
    await preview(renter.token, { proposedReturnAt: protectedEnd.toISOString() }).expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `held-after-expiry-${randomUUID()}`)
      .send({ quoteId: directQuote.body.data.id })
      .expect(201);
    expect(
      (await database.client.vehicleOccupancy.findUniqueOrThrow({ where: { id: occupancy.id } }))
        .active,
    ).toBe(false);
  });

  it('keeps explicit release and conversion idempotent with first release evidence', async () => {
    const createAuthority = async (suffix: string, offsetHours: number) => {
      const protectedStart = new Date(rentalEnd.getTime() + offsetHours * 60 * 60_000);
      const protectedEnd = new Date(protectedStart.getTime() + 60 * 60_000);
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const amendment = await database.client.bookingAmendment.create({
        data: {
          bookingId,
          expiresAt,
          idempotencyKey: `${suffix}-amendment-${randomUUID()}`,
          policyVersion: 'BOOKING_AMENDMENT_V1',
          proposedEndMethod: 'RENTER_RETURN',
          proposedRentalEnd: protectedEnd,
          proposedRentalStart: rentalStart,
          proposedStartMethod: 'RENTER_PICKUP',
          requestHash: suffix.repeat(64).slice(0, 64),
          requesterUserId: renter.userId,
          scope: 'PRE_TRIP',
          sourcePricingPolicyVersionId: policyId,
          status: BookingAmendmentStatus.PENDING_OWNER,
        },
      });
      const occupancy = await database.client.vehicleOccupancy.create({
        data: {
          expiresAt,
          occupiedEnd: protectedEnd,
          occupiedStart: protectedStart,
          type: VehicleOccupancyType.AMENDMENT_HOLD,
          vehicleId,
        },
      });
      const hold = await database.client.bookingAmendmentHold.create({
        data: {
          amendmentId: amendment.id,
          expiresAt,
          idempotencyKey: `${suffix}-hold-${randomUUID()}`,
          occupancyId: occupancy.id,
          protectedEnd,
          protectedStart,
          vehicleId,
        },
      });
      return { amendment, hold, occupancy };
    };

    const released = await createAuthority('r', 3);
    const releaseFirst = await database.client.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT "release_booking_amendment_holds"(
        ${released.amendment.id}::uuid,
        'RELEASED'::"BookingAmendmentHoldStatus",
        'RENTER_WITHDRAWN'
      ) AS "count"
    `);
    const releasedSnapshot = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { id: released.occupancy.id },
    });
    const releaseRetry = await database.client.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT "release_booking_amendment_holds"(
        ${released.amendment.id}::uuid,
        'RELEASED'::"BookingAmendmentHoldStatus",
        'DIFFERENT_REASON'
      ) AS "count"
    `);
    const releasedAfterRetry = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { id: released.occupancy.id },
    });
    expect(Number(releaseFirst[0]?.count)).toBe(1);
    expect(Number(releaseRetry[0]?.count)).toBe(0);
    expect(releasedSnapshot).toMatchObject({ active: false, releaseReason: 'RENTER_WITHDRAWN' });
    expect(releasedSnapshot.releasedAt).toBeInstanceOf(Date);
    expect(releasedAfterRetry.releasedAt).toEqual(releasedSnapshot.releasedAt);
    expect(releasedAfterRetry.releaseReason).toBe('RENTER_WITHDRAWN');
    expect(
      await database.client.bookingAmendmentHold.findUniqueOrThrow({
        where: { id: released.hold.id },
      }),
    ).toMatchObject({ status: 'RELEASED', releaseReason: 'RENTER_WITHDRAWN' });

    await database.client.bookingAmendment.update({
      data: { status: BookingAmendmentStatus.DECLINED },
      where: { id: released.amendment.id },
    });
    const converted = await createAuthority('c', 5);
    const convertFirst = await database.client.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT "convert_booking_amendment_holds"(${converted.amendment.id}::uuid) AS "count"
    `);
    const convertedSnapshot = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { id: converted.occupancy.id },
    });
    const convertRetry = await database.client.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT "convert_booking_amendment_holds"(${converted.amendment.id}::uuid) AS "count"
    `);
    expect(Number(convertFirst[0]?.count)).toBe(1);
    expect(Number(convertRetry[0]?.count)).toBe(0);
    expect(convertedSnapshot).toMatchObject({
      active: false,
      releaseReason: 'AMENDMENT_APPLIED',
    });
    expect(convertedSnapshot.releasedAt).toBeInstanceOf(Date);
    expect(
      await database.client.bookingAmendmentHold.findUniqueOrThrow({
        where: { id: converted.hold.id },
      }),
    ).toMatchObject({ status: 'CONVERTED', releaseReason: 'AMENDMENT_APPLIED' });
    expect(
      await database.client.vehicleOccupancy.count({ where: { active: true, bookingId } }),
    ).toBe(1);
  });

  it('enforces authentication and ownership without leaking booking details', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendment-preview`)
      .send({ proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString() })
      .expect(401);
    for (const actor of [unrelatedRenter, owner]) {
      const before = await mutationSnapshot();
      const response = await preview(actor.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
      });
      expect([403, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain(bookingId);
      expect(JSON.stringify(response.body)).not.toContain(renter.userId);
      expect(JSON.stringify(response.body)).not.toContain(paymentProviderReference);
      expect(JSON.stringify(response.body)).not.toMatch(/stack|database|FAKE/u);
      expect(await mutationSnapshot()).toEqual(before);
    }
    await preview(renter.token, { proposedReturnAt: rentalEnd.toISOString() }, 'CR-2026-NOTFOUND')
      .expect(404)
      .expect(({ body }) => expect(JSON.stringify(body)).not.toContain(bookingId));
  });

  it.each([
    BookingStatus.HOLD,
    BookingStatus.AWAITING_PAYMENT,
    BookingStatus.AWAITING_OWNER,
    BookingStatus.CAPTURE_PENDING,
    BookingStatus.ACTIVE,
    BookingStatus.RETURN_PENDING,
    BookingStatus.RETURNED,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ])('rejects lifecycle state %s without mutation', async (status) => {
    await createBookingFixture(status);
    const before = await mutationSnapshot();
    const response = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BOOKING_STATE_CHANGED');
    expect(await mutationSnapshot()).toEqual(before);
  });

  it.each([
    BookingAmendmentStatus.PENDING_OWNER,
    BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
  ])('rejects unresolved amendment %s', async (status) => {
    const amendment = await createAmendment(status);
    const before = await mutationSnapshot();
    const response = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('AMENDMENT_ALREADY_PENDING');
    expect(await mutationSnapshot()).toEqual(before);
    await database.client.bookingAmendment.delete({ where: { id: amendment.id } });
  });

  it.each([
    BookingAmendmentStatus.DECLINED,
    BookingAmendmentStatus.WITHDRAWN,
    BookingAmendmentStatus.EXPIRED,
    BookingAmendmentStatus.FAILED,
    BookingAmendmentStatus.APPLIED,
  ])('does not treat terminal amendment %s as unresolved', async (status) => {
    const amendment = await createAmendment(status);
    const response = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    });
    expect(response.status).toBe(201);
    await database.client.bookingAmendment.delete({ where: { id: amendment.id } });
  });

  it('enforces DTO validation and rejects client authority', async () => {
    const cases: Array<Record<string, unknown>> = [
      { proposedPickupAt: 'not-a-date' },
      { proposedReturnAt: 'not-a-date' },
      { proposedReturnAt: rentalStart.toISOString(), proposedPickupAt: rentalEnd.toISOString() },
      { vehicleId: randomUUID(), proposedReturnAt: rentalEnd.toISOString() },
      { proposedStartMethod: 'TELEPORT', proposedReturnAt: rentalEnd.toISOString() },
      { proposedStartMethod: 'OWNER_DELIVERY', proposedReturnAt: rentalEnd.toISOString() },
      { priceMinor: 1, proposedReturnAt: rentalEnd.toISOString() },
      { refundMinor: 999_999, proposedReturnAt: rentalEnd.toISOString() },
      { commissionMinor: 0, proposedReturnAt: rentalEnd.toISOString() },
      { currency: 'USD', proposedReturnAt: rentalEnd.toISOString() },
      { pricingVersion: 'CLIENT', proposedReturnAt: rentalEnd.toISOString() },
      { excludeBookingId: bookingId, proposedReturnAt: rentalEnd.toISOString() },
    ];
    for (const input of cases) {
      const before = await mutationSnapshot();
      const response = await preview(renter.token, input);
      expect([400, 422]).toContain(response.status);
      expect(response.body.data?.previewToken).toBeUndefined();
      expect(await mutationSnapshot()).toEqual(before);
    }
  });

  it('rejects start-date movement and canonical no-op without mutation', async () => {
    for (const input of [
      { proposedPickupAt: new Date(rentalStart.getTime() + 86_400_000).toISOString() },
      { proposedReturnAt: rentalEnd.toISOString() },
      {
        proposedEndMethod: 'RENTER_RETURN',
        proposedPickupAt: rentalStart.toISOString(),
        proposedReturnAt: rentalEnd.toISOString(),
        proposedStartMethod: 'RENTER_PICKUP',
      },
    ]) {
      const before = await mutationSnapshot();
      const response = await preview(renter.token, input);
      expect(response.status).toBe(422);
      expect(['NO_CHANGES', 'UNSUPPORTED_CHANGE']).toContain(response.body.error.code);
      expect(await mutationSnapshot()).toEqual(before);
    }
  });

  it('accepts a partial zero-delta operational change as a real preview', async () => {
    const response = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    expect(response.body.data.financial).toMatchObject({
      additionalPaymentMinor: '0',
      expectedRefundMinor: '0',
    });
  });

  function preview(token: string, input: object, bookingReference = reference) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingReference}/amendment-preview`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);
  }

  function availability() {
    return request(app.getHttpServer())
      .get(`/api/v1/vehicles/${vehicleId}/availability`)
      .query({ end: rentalEnd.toISOString(), start: rentalStart.toISOString() })
      .then(({ body }) => body.data);
  }

  function search(mode: 'LIST' | 'MAP') {
    return request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({
        end: rentalEnd.toISOString(),
        latitude: 14.5547,
        longitude: 121.0244,
        make: 'Preview',
        mode,
        radius: 25,
        start: rentalStart.toISOString(),
      })
      .then(({ body }) => body.data);
  }

  function searchRange(mode: 'LIST' | 'MAP', start: Date, end: Date) {
    return request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({
        end: end.toISOString(),
        latitude: 14.5547,
        longitude: 121.0244,
        make: 'Preview',
        mode,
        radius: 25,
        start: start.toISOString(),
      })
      .then(({ body }) =>
        body.data.items.map((item: { vehicleId: string }) => item.vehicleId as string),
      );
  }

  function quote(actor: Actor, start: Date, end: Date) {
    return request(app.getHttpServer())
      .post(`/api/v1/vehicles/${vehicleId}/quotes`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ end: end.toISOString(), start: start.toISOString() });
  }

  async function createAmendment(status: BookingAmendmentStatus) {
    return database.client.bookingAmendment.create({
      data: {
        ...(status === BookingAmendmentStatus.APPLIED ? { appliedAt: new Date() } : {}),
        bookingId,
        expiresAt: new Date(Date.now() + 3_600_000),
        idempotencyKey: `${status}-${randomUUID()}`,
        policyVersion: 'BOOKING_AMENDMENT_V1',
        proposedEndMethod: 'RENTER_RETURN',
        proposedRentalEnd: rentalEnd,
        proposedRentalStart: rentalStart,
        proposedStartMethod: 'RENTER_PICKUP',
        requestHash: 'a'.repeat(64),
        requesterUserId: renter.userId,
        scope: 'PRE_TRIP',
        sourcePricingPolicyVersionId: (
          await database.client.bookingPricingSnapshot.findUniqueOrThrow({
            where: { bookingId },
          })
        ).policyVersionId,
        status,
      },
    });
  }

  async function mutationSnapshot() {
    const [booking, payment, ownerEarning, commissionSnapshot, counts] = await Promise.all([
      database.client.booking.findUniqueOrThrow({
        include: { fulfillmentSnapshot: true, pricingSnapshot: true },
        where: { id: bookingId },
      }),
      database.client.payment.findUniqueOrThrow({ where: { id: paymentId } }),
      database.client.ownerEarning.findUniqueOrThrow({ where: { paymentId } }),
      database.client.commissionSnapshot.findUniqueOrThrow({ where: { paymentId } }),
      Promise.all([
        database.client.bookingAmendment.count({ where: { bookingId } }),
        database.client.bookingAmendmentHold.count({ where: { amendment: { bookingId } } }),
        database.client.bookingAmendmentSettlement.count({ where: { amendment: { bookingId } } }),
        database.client.bookingAmendmentStatusHistory.count({
          where: { amendment: { bookingId } },
        }),
        database.client.vehicleOccupancy.count({ where: { vehicleId } }),
        database.client.ownerEarning.count({ where: { bookingId } }),
        database.client.payment.count({ where: { bookingId } }),
        database.client.paymentOperation.count({ where: { paymentId } }),
        database.client.refund.count({ where: { paymentId } }),
        database.client.ledgerTransaction.count({
          where: { sourceId: { in: [bookingId, paymentId] } },
        }),
        database.client.outboxEvent.count({ where: { aggregateId: bookingId } }),
      ]),
    ]);
    return {
      booking: {
        fulfillment: booking.fulfillmentSnapshot,
        pricing: booking.pricingSnapshot,
        rentalEnd: booking.rentalEnd,
        rentalStart: booking.rentalStart,
        status: booking.status,
      },
      commissionSnapshot,
      counts,
      ownerEarning,
      payment,
    };
  }

  async function createActor(label: string, roles: readonly RoleCode[]): Promise<Actor> {
    const roleRows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    await database.client.user.create({
      data: {
        email: `${label}-${unique}@example.test`,
        emailVerifiedAt: new Date(),
        id: userId,
        mobileNumber: `+63918${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        mobileVerifiedAt: new Date(),
        normalizedEmail: `${label}-${unique}@example.test`,
        ...(roles.includes(RoleCode.RENTER)
          ? {
              profile: {
                create: {
                  driverLicenseExpiry: future(365, 0),
                  firstName: 'Preview',
                  lastName: label,
                },
              },
            }
          : {}),
        roles: { create: roleRows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: { expiresAt: new Date(Date.now() + 86_400_000), id: sessionId, platform: 'WEB' },
        },
      },
    });
    if (roles.includes(RoleCode.RENTER))
      await database.client.verification.createMany({
        data: [VerificationType.IDENTITY, VerificationType.DRIVER_LICENSE].map((type) => ({
          expiresAt: future(365, 0),
          reviewedAt: new Date(),
          status: VerificationStatus.APPROVED,
          type,
          userId,
        })),
      });
    return { token: await tokens.signAccessToken(userId, sessionId, roles), userId };
  }
});

function future(days: number, hour: number): Date {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value;
}
