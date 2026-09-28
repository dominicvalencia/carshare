import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PREFIX, BookingErrorCode } from '@carrental/api-contracts';
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
import { AmendmentPreviewService } from '../src/bookings/amendment-preview.service';
import { AmendmentSubmissionService } from '../src/bookings/amendment-submission.service';
import { AvailabilityService } from '../src/discovery/availability.service';
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
  let amendmentPreviews: AmendmentPreviewService;
  let amendmentSubmissions: AmendmentSubmissionService;
  let availabilityService: AvailabilityService;
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
    amendmentPreviews = app.get(AmendmentPreviewService);
    amendmentSubmissions = app.get(AmendmentSubmissionService);
    availabilityService = app.get(AvailabilityService);
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

  async function createBookingFixture(status = BookingStatus.CONFIRMED, ownerDelivery = false) {
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
            deliveryFeeMinor: ownerDelivery ? 30_000 : 0,
            ...(ownerDelivery ? { deliveryDistanceMeters: 0, serviceRadiusMeters: 50_000 } : {}),
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
            startMethod: ownerDelivery ? 'OWNER_DELIVERY' : 'RENTER_PICKUP',
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

  it('submits an extension atomically, protects only the net-new tail, and replays idempotently', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const tailStart = new Date(rentalEnd.getTime() + 120 * 60_000);
    const tailEnd = new Date(proposedEnd.getTime() + 120 * 60_000);
    const competingQuote = await quote(unrelatedRenter, tailStart, tailEnd).expect(201);
    const previewResponse = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({ where: { amendment: { bookingId } } }),
    ).toBe(0);
    const beforeBooking = await database.client.booking.findUniqueOrThrow({
      include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
      where: { id: bookingId },
    });
    const key = `submit-extension-${randomUUID()}`;
    const first = await submit(renter.token, previewResponse.body.data.previewToken, key).expect(
      201,
    );
    const retry = await submit(renter.token, previewResponse.body.data.previewToken, key).expect(
      201,
    );
    expect(retry.body.data).toEqual(first.body.data);
    expect(first.body.data).toMatchObject({ status: BookingAmendmentStatus.PENDING_OWNER });

    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        fulfillmentSnapshot: true,
        holds: { include: { occupancy: true } },
        pricingSnapshot: true,
        settlement: true,
        statusHistory: true,
      },
      where: { id: first.body.data.amendmentId },
    });
    expect(amendment.holds).toHaveLength(1);
    expect(amendment.holds[0]).toMatchObject({
      expiresAt: amendment.expiresAt,
      protectedEnd: tailEnd,
      protectedStart: tailStart,
      status: 'ACTIVE',
    });
    expect(amendment.holds[0]!.occupancy).toMatchObject({
      active: true,
      occupiedEnd: tailEnd,
      occupiedStart: tailStart,
      type: VehicleOccupancyType.AMENDMENT_HOLD,
    });
    expect(amendment.pricingSnapshot?.finalizedAt).toBeInstanceOf(Date);
    expect(amendment.fulfillmentSnapshot?.finalizedAt).toBeInstanceOf(Date);
    expect(amendment.pricingSnapshot).toMatchObject({
      currency: previewResponse.body.data.financial.currency,
      proposedChargeableDays: previewResponse.body.data.proposed.chargeableDays,
      proposedRentalSubtotalMinor: BigInt(previewResponse.body.data.proposed.rentalMinor),
      proposedTotalMinor:
        BigInt(previewResponse.body.data.proposed.rentalMinor) +
        BigInt(previewResponse.body.data.proposed.fulfillmentMinor),
      sourceBookingPolicyVersionId: policyId,
    });
    expect(amendment.fulfillmentSnapshot).toMatchObject({
      proposedEndMethod: previewResponse.body.data.proposed.endMethod,
      proposedFulfillmentTotalMinor: BigInt(previewResponse.body.data.proposed.fulfillmentMinor),
      proposedStartMethod: previewResponse.body.data.proposed.startMethod,
    });
    expect(amendment.statusHistory).toHaveLength(1);
    expect(amendment.statusHistory[0]).toMatchObject({
      fromStatus: null,
      toStatus: BookingAmendmentStatus.PENDING_OWNER,
    });
    expect(amendment.settlement).toMatchObject({ status: 'PENDING' });
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_REQUESTED' },
      }),
    ).toBe(1);
    const outbox = await database.client.outboxEvent.findFirstOrThrow({
      where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_REQUESTED' },
    });
    expect(outbox.payload).toMatchObject({
      amendmentId: amendment.id,
      bookingId,
      ownerUserId: owner.userId,
      requesterUserId: renter.userId,
    });
    expect(JSON.stringify(outbox.payload)).not.toMatch(/previewToken|address|payment|commission/u);
    expect(amendment.expiresAt.getTime() - amendment.createdAt.getTime()).toBeCloseTo(
      60 * 60_000,
      -3,
    );
    expect(await searchRange('LIST', tailStart, tailEnd)).not.toContain(vehicleId);
    expect(await searchRange('MAP', tailStart, tailEnd)).not.toContain(vehicleId);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `direct-vs-amendment-${randomUUID()}`)
      .send({ quoteId: competingQuote.body.data.id })
      .expect(409);
    await preview(renter.token, {
      proposedReturnAt: new Date(proposedEnd.getTime() + 60 * 60_000).toISOString(),
    })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('AMENDMENT_ALREADY_PENDING'));

    const afterBooking = await database.client.booking.findUniqueOrThrow({
      include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
      where: { id: bookingId },
    });
    expect(afterBooking).toEqual(beforeBooking);
    expect(await database.client.payment.count({ where: { bookingId } })).toBe(1);
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
    expect(await database.client.ledgerTransaction.count({ where: { sourceId: bookingId } })).toBe(
      0,
    );
    await database.client.booking.update({
      data: { operationalHold: true },
      where: { id: bookingId },
    });
    await submit(renter.token, previewResponse.body.data.previewToken, key)
      .expect(201)
      .expect(({ body }) => expect(body.data).toEqual(first.body.data));
    await expect(
      amendmentSubmissions.submitRenter(
        renter.userId,
        reference,
        previewResponse.body.data.previewToken,
        key,
        {},
        new Date(Date.now() + 60 * 60_000),
      ),
    ).resolves.toEqual(first.body.data);
  });

  it('submits shortening and fulfillment-only changes without releasing or duplicating occupancy', async () => {
    const originalOccupancy = await database.client.vehicleOccupancy.findFirstOrThrow({
      where: { bookingId },
    });
    const shorteningPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const shortening = await submit(
      renter.token,
      shorteningPreview.body.data.previewToken,
      `shortening-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: shortening.body.data.amendmentId },
      }),
    ).toBe(0);
    expect(
      await database.client.vehicleOccupancy.findUniqueOrThrow({
        where: { id: originalOccupancy.id },
      }),
    ).toEqual(originalOccupancy);

    await createBookingFixture();
    const fulfillmentPreview = await preview(renter.token, {
      proposedDeliveryDestination: {
        city: 'Makati City',
        country: 'PH',
        latitude: 14.5547,
        longitude: 121.0244,
        province: 'Metro Manila',
      },
      proposedStartMethod: 'OWNER_DELIVERY',
    }).expect(201);
    const fulfillment = await submit(
      renter.token,
      fulfillmentPreview.body.data.previewToken,
      `fulfillment-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: fulfillment.body.data.amendmentId },
      }),
    ).toBe(0);
  });

  it('withdraws through HTTP atomically, idempotently releases holds, and permits a fresh request', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const tailStart = new Date(rentalEnd.getTime() + 120 * 60_000);
    const tailEnd = new Date(proposedEnd.getTime() + 120 * 60_000);
    const competingQuote = await quote(unrelatedRenter, tailStart, tailEnd).expect(201);
    const previewResponse = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submissionKey = `withdraw-${randomUUID()}`;
    const submitted = await submit(
      renter.token,
      previewResponse.body.data.previewToken,
      submissionKey,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    const beforeBooking = await database.client.booking.findUniqueOrThrow({
      include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
      where: { id: bookingId },
    });
    const activeHold = await database.client.bookingAmendmentHold.findFirstOrThrow({
      include: { occupancy: true },
      where: { amendmentId, status: 'ACTIVE' },
    });
    expect(
      await searchRange('LIST', activeHold.protectedStart, activeHold.protectedEnd),
    ).not.toContain(vehicleId);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `withdrawal-held-${randomUUID()}`)
      .send({ quoteId: competingQuote.body.data.id })
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments/${amendmentId}/withdraw`)
      .expect(401);
    for (const actor of [unrelatedRenter, owner])
      await withdraw(actor.token, amendmentId).expect(({ status }) =>
        expect([403, 404]).toContain(status),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments/not-a-uuid/withdraw`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(400);

    const first = await withdraw(renter.token, amendmentId).expect(201);
    const retry = await withdraw(renter.token, amendmentId).expect(201);
    expect(retry.body.data).toEqual(first.body.data);
    expect(first.body.data).toMatchObject({ amendmentReference: amendmentId, status: 'WITHDRAWN' });
    const released = await database.client.bookingAmendmentHold.findUniqueOrThrow({
      include: { occupancy: true },
      where: { id: activeHold.id },
    });
    expect(released.status).toBe('RELEASED');
    expect(released.releasedAt).toBeInstanceOf(Date);
    expect(released.releaseReason).toBe('RENTER_WITHDREW_REQUEST');
    expect(released.occupancy).toMatchObject({
      active: false,
      releaseReason: 'RENTER_WITHDREW_REQUEST',
    });
    expect(released.occupancy.releasedAt).toBeInstanceOf(Date);
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: 'WITHDRAWN' },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_WITHDRAWN' },
      }),
    ).toBe(1);
    expect(await searchRange('LIST', activeHold.protectedStart, activeHold.protectedEnd)).toContain(
      vehicleId,
    );
    expect(await searchRange('MAP', activeHold.protectedStart, activeHold.protectedEnd)).toContain(
      vehicleId,
    );
    expect(
      await database.client.booking.findUniqueOrThrow({
        include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
        where: { id: bookingId },
      }),
    ).toEqual(beforeBooking);
    await submit(renter.token, previewResponse.body.data.previewToken, submissionKey)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('WITHDRAWN'));

    const freshPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 12 * 60 * 60_000).toISOString(),
    }).expect(201);
    const freshSubmission = await submit(
      renter.token,
      freshPreview.body.data.previewToken,
      `after-withdrawal-${randomUUID()}`,
    );
    expect(freshSubmission.status, JSON.stringify(freshSubmission.body)).toBe(201);
    expect(freshSubmission.body.data.status).toBe('PENDING_OWNER');
    await withdraw(renter.token, freshSubmission.body.data.amendmentId).expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `withdrawal-released-${randomUUID()}`)
      .send({ quoteId: competingQuote.body.data.id })
      .expect(201);
  });

  it('withdraws a zero-hold shortening and rejects payment-pending withdrawal', async () => {
    const previewResponse = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      previewResponse.body.data.previewToken,
      `short-withdraw-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    const occupancy = await database.client.vehicleOccupancy.findFirstOrThrow({
      where: { bookingId, type: VehicleOccupancyType.BOOKING },
    });
    expect(await database.client.bookingAmendmentHold.count({ where: { amendmentId } })).toBe(0);
    await withdraw(renter.token, amendmentId).expect(201);
    expect(
      await database.client.vehicleOccupancy.findUniqueOrThrow({ where: { id: occupancy.id } }),
    ).toEqual(occupancy);

    await createBookingFixture();
    const paymentPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    }).expect(201);
    const paymentSubmission = await submit(
      renter.token,
      paymentPreview.body.data.previewToken,
      `payment-pending-${randomUUID()}`,
    ).expect(201);
    await database.client.bookingAmendment.update({
      data: {
        acceptedAt: new Date(),
        paymentDeadlineAt: new Date(Date.now() + 10 * 60_000),
        status: 'OWNER_ACCEPTED_PAYMENT_PENDING',
      },
      where: { id: paymentSubmission.body.data.amendmentId },
    });
    await withdraw(renter.token, paymentSubmission.body.data.amendmentId)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BOOKING_INVALID_STATE'));
    await database.client.bookingAmendment.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: paymentSubmission.body.data.amendmentId },
    });
    expect(await expireAmendments()).toBe(0);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: paymentSubmission.body.data.amendmentId },
      }),
    ).toMatchObject({ status: 'OWNER_ACCEPTED_PAYMENT_PENDING' });

    await createBookingFixture();
    const expiringShorteningPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const expiringShortening = await submit(
      renter.token,
      expiringShorteningPreview.body.data.previewToken,
      `expire-shortening-${randomUUID()}`,
    ).expect(201);
    await database.client.bookingAmendment.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: expiringShortening.body.data.amendmentId },
    });
    expect(await expireAmendments()).toBe(1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: expiringShortening.body.data.amendmentId },
      }),
    ).toMatchObject({ status: 'EXPIRED' });
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: expiringShortening.body.data.amendmentId },
      }),
    ).toBe(0);
  });

  it('releases leading and two-interval hold shapes through terminal lifecycle paths', async () => {
    const leadingPreview = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() - 60 * 60_000).toISOString(),
    }).expect(201);
    const leading = await submit(
      renter.token,
      leadingPreview.body.data.previewToken,
      `leading-withdraw-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: leading.body.data.amendmentId, status: 'ACTIVE' },
      }),
    ).toBe(1);
    await withdraw(renter.token, leading.body.data.amendmentId).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: leading.body.data.amendmentId, status: 'ACTIVE' },
      }),
    ).toBe(0);

    await createBookingFixture();
    const twoIntervalPreview = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() - 60 * 60_000).toISOString(),
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const twoInterval = await submit(
      renter.token,
      twoIntervalPreview.body.data.previewToken,
      `two-interval-expiry-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: twoInterval.body.data.amendmentId, status: 'ACTIVE' },
      }),
    ).toBe(2);
    await database.client.bookingAmendment.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: twoInterval.body.data.amendmentId },
    });
    expect(await expireAmendments()).toBe(1);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: twoInterval.body.data.amendmentId, status: 'ACTIVE' },
      }),
    ).toBe(0);
    expect(
      await database.client.vehicleOccupancy.count({
        where: {
          active: true,
          amendmentHold: { amendmentId: twoInterval.body.data.amendmentId },
          type: VehicleOccupancyType.AMENDMENT_HOLD,
        },
      }),
    ).toBe(0);
  });

  it('naturally expires a submitted amendment idempotently and restores inventory', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const previewResponse = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      previewResponse.body.data.previewToken,
      `expire-submitted-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    const beforeBooking = await database.client.booking.findUniqueOrThrow({
      include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
      where: { id: bookingId },
    });
    const hold = await database.client.bookingAmendmentHold.findFirstOrThrow({
      include: { occupancy: true },
      where: { amendmentId },
    });
    await database.client.bookingAmendment.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: amendmentId },
    });
    const first = await expireAmendments();
    const retry = await expireAmendments();
    expect(first).toBe(1);
    expect(retry).toBe(0);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ status: 'EXPIRED' });
    const released = await database.client.bookingAmendmentHold.findUniqueOrThrow({
      include: { occupancy: true },
      where: { id: hold.id },
    });
    expect(released.status).toBe('EXPIRED');
    expect(released.occupancy.active).toBe(false);
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: 'EXPIRED' },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: amendmentId, eventType: 'BOOKING_AMENDMENT_TERMINATED' },
      }),
    ).toBe(1);
    expect(await searchRange('LIST', hold.protectedStart, hold.protectedEnd)).toContain(vehicleId);
    expect(await searchRange('MAP', hold.protectedStart, hold.protectedEnd)).toContain(vehicleId);
    expect(
      await database.client.booking.findUniqueOrThrow({
        include: { commissionSnapshot: true, fulfillmentSnapshot: true, ownerEarning: true },
        where: { id: bookingId },
      }),
    ).toEqual(beforeBooking);

    const freshPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 12 * 60 * 60_000).toISOString(),
    }).expect(201);
    const freshSubmission = await submit(
      renter.token,
      freshPreview.body.data.previewToken,
      `after-expiry-${randomUUID()}`,
    );
    expect(freshSubmission.status, JSON.stringify(freshSubmission.body)).toBe(201);
  });

  it('converges withdrawal and natural expiry to exactly one terminal winner', async () => {
    const previewResponse = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      previewResponse.body.data.previewToken,
      `terminal-race-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await database.client.bookingAmendment.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: amendmentId },
    });
    await Promise.allSettled([withdraw(renter.token, amendmentId), expireAmendments()]);
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, statusHistory: true },
      where: { id: amendmentId },
    });
    expect(['WITHDRAWN', 'EXPIRED']).toContain(amendment.status);
    expect(
      amendment.statusHistory.filter(({ toStatus }) => ['WITHDRAWN', 'EXPIRED'].includes(toStatus)),
    ).toHaveLength(1);
    expect(
      amendment.holds.every(({ occupancy, status }) => !occupancy.active && status !== 'ACTIVE'),
    ).toBe(true);
    expect(
      await database.client.outboxEvent.count({
        where: {
          OR: [
            { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_WITHDRAWN' },
            { aggregateId: amendmentId, eventType: 'BOOKING_AMENDMENT_TERMINATED' },
          ],
        },
      }),
    ).toBe(1);
  });

  it('enforces submission authentication, ownership, token expiry/tampering, and idempotency identity', async () => {
    const firstPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    }).expect(201);
    const secondPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 2 * 60 * 60_000).toISOString(),
    }).expect(201);
    const token = firstPreview.body.data.previewToken as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments`)
      .set('Idempotency-Key', `anonymous-${randomUUID()}`)
      .send({ previewToken: token })
      .expect(401);
    for (const actor of [unrelatedRenter, owner])
      await submit(actor.token, token, `unauthorized-${randomUUID()}`).expect(({ status }) =>
        expect([403, 409]).toContain(status),
      );
    await submit(renter.token, `${token}x`, `tampered-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('AMENDMENT_PREVIEW_INVALID'));

    const expired = await amendmentPreviews.previewRenter(
      renter.userId,
      reference,
      { proposedReturnAt: new Date(rentalEnd.getTime() + 3 * 60 * 60_000).toISOString() },
      new Date(Date.now() - 16 * 60_000),
    );
    await submit(renter.token, expired.previewToken, `expired-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('QUOTE_EXPIRED'));

    const key = `mismatch-${randomUUID()}`;
    await submit(renter.token, token, key).expect(201);
    await submit(renter.token, secondPreview.body.data.previewToken, key)
      .expect(409)
      .expect(({ body }) =>
        expect(body.error.code).toBe(BookingErrorCode.IDEMPOTENCY_KEY_CONFLICT),
      );
    await submit(renter.token, secondPreview.body.data.previewToken, `new-key-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('AMENDMENT_ALREADY_PENDING'));
  });

  it('rejects stale and post-preview inventory changes with zero partial submission artifacts', async () => {
    const stalePreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    }).expect(201);
    await database.client.booking.update({
      data: { operationalHold: true },
      where: { id: bookingId },
    });
    await submit(renter.token, stalePreview.body.data.previewToken, `stale-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BOOKING_STATE_CHANGED'));
    expect(await database.client.bookingAmendment.count({ where: { bookingId } })).toBe(0);

    await createBookingFixture();
    const proposedEnd = new Date(rentalEnd.getTime() + 4 * 60 * 60_000);
    const racePreview = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const blocker = await database.client.vehicleOccupancy.create({
      data: {
        occupiedEnd: new Date(proposedEnd.getTime() + 120 * 60_000),
        occupiedStart: new Date(rentalEnd.getTime() + 120 * 60_000),
        type: VehicleOccupancyType.OWNER_BLOCK,
        vehicleId,
      },
    });
    const before = await mutationSnapshot();
    await submit(renter.token, racePreview.body.data.previewToken, `inventory-race-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DATES_UNAVAILABLE'));
    expect(await mutationSnapshot()).toEqual(before);
    expect(await database.client.bookingAmendment.count({ where: { bookingId } })).toBe(0);
    await database.client.vehicleOccupancy.delete({ where: { id: blocker.id } });
  });

  it('freezes reviewed fulfillment pricing and revalidates live fulfillment capability', async () => {
    const destination = {
      city: 'Makati City',
      country: 'PH',
      latitude: 14.5547,
      longitude: 121.0244,
      province: 'Metro Manila',
    };
    const reviewed = await preview(renter.token, {
      proposedDeliveryDestination: destination,
      proposedStartMethod: 'OWNER_DELIVERY',
    }).expect(201);
    expect(reviewed.body.data.proposed.deliveryFeeMinor).toBe('30000');
    await database.client.vehiclePolicyVersion.create({
      data: {
        availabilityPolicy: 'EVERY_DAY',
        collectionFeeMinor: 30_000,
        createdByUserId: owner.userId,
        dailyRateMinor: 100_000,
        deliveryFeeMinor: 99_000,
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
        version: 2,
        weeklyDiscountBps: 1_000,
      },
    });
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `pricing-freeze-${randomUUID()}`,
    ).expect(201);
    const snapshot = await database.client.bookingAmendmentFulfillmentSnapshot.findUniqueOrThrow({
      where: { amendmentId: submitted.body.data.amendmentId },
    });
    expect(snapshot.proposedFulfillmentTotalMinor).toBe(30_000n);
  });

  it('revalidates fulfillment removal against service-performance evidence', async () => {
    await createBookingFixture(BookingStatus.CONFIRMED, true);
    const reviewed = await preview(renter.token, {
      proposedDeliveryDestination: null,
      proposedStartMethod: 'RENTER_PICKUP',
    }).expect(201);
    await database.client.bookingHandoverTravelEvent.create({
      data: {
        actorUserId: renter.userId,
        bookingId,
        phase: 'START',
        status: 'ARRIVED',
      },
    });
    const before = await mutationSnapshot();
    await submit(renter.token, reviewed.body.data.previewToken, `performed-service-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('FULFILLMENT_UNAVAILABLE'));
    expect(await mutationSnapshot()).toEqual(before);
    expect(await database.client.bookingAmendment.count({ where: { bookingId } })).toBe(0);
  });

  it('rolls back every artifact when the final PostgreSQL exclusion race is lost', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 4 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const tailStart = new Date(rentalEnd.getTime() + 120 * 60_000);
    const tailEnd = new Date(proposedEnd.getTime() + 120 * 60_000);
    let blockerId = '';
    const spy = vi
      .spyOn(availabilityService, 'occupancyConflict')
      .mockImplementationOnce(async () => {
        const blocker = await database.client.vehicleOccupancy.create({
          data: {
            occupiedEnd: tailEnd,
            occupiedStart: tailStart,
            type: VehicleOccupancyType.OWNER_BLOCK,
            vehicleId,
          },
        });
        blockerId = blocker.id;
        return null;
      });
    const before = await mutationSnapshot();
    await submit(renter.token, reviewed.body.data.previewToken, `exclusion-race-${randomUUID()}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('DATES_UNAVAILABLE'));
    spy.mockRestore();
    await database.client.vehicleOccupancy.delete({ where: { id: blockerId } });
    expect(await mutationSnapshot()).toEqual(before);
    expect(await database.client.bookingAmendment.count({ where: { bookingId } })).toBe(0);
    expect(
      await database.client.bookingAmendmentPricingSnapshot.count({
        where: { amendment: { bookingId } },
      }),
    ).toBe(0);
    expect(
      await database.client.bookingAmendmentFulfillmentSnapshot.count({
        where: { amendment: { bookingId } },
      }),
    ).toBe(0);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_REQUESTED' },
      }),
    ).toBe(0);
  });

  it('allows exactly one winner for concurrent submissions', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 4 * 60 * 60_000).toISOString(),
    }).expect(201);
    const [left, right] = await Promise.all([
      submit(renter.token, reviewed.body.data.previewToken, `concurrent-left-${randomUUID()}`),
      submit(renter.token, reviewed.body.data.previewToken, `concurrent-right-${randomUUID()}`),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    expect(await database.client.bookingAmendment.count({ where: { bookingId } })).toBe(1);
    const winner = await database.client.bookingAmendment.findFirstOrThrow({
      include: {
        fulfillmentSnapshot: true,
        holds: true,
        pricingSnapshot: true,
        settlement: true,
        statusHistory: true,
      },
      where: { bookingId },
    });
    expect(winner).toMatchObject({ status: BookingAmendmentStatus.PENDING_OWNER });
    expect(winner.pricingSnapshot).not.toBeNull();
    expect(winner.fulfillmentSnapshot).not.toBeNull();
    expect(winner.settlement).not.toBeNull();
    expect(winner.holds).toHaveLength(1);
    expect(winner.statusHistory).toHaveLength(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_REQUESTED' },
      }),
    ).toBe(1);
  });

  function preview(token: string, input: object, bookingReference = reference) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingReference}/amendment-preview`)
      .set('Authorization', `Bearer ${token}`)
      .send(input);
  }

  function submit(token: string, previewToken: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ previewToken });
  }

  function withdraw(token: string, amendmentReference: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments/${amendmentReference}/withdraw`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function expireAmendments() {
    const result = await database.client.$queryRaw<Array<{ expired: number }>>(Prisma.sql`
      SELECT "expire_stale_booking_amendments"() AS "expired"
    `);
    return Number(result[0]?.expired ?? 0);
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
