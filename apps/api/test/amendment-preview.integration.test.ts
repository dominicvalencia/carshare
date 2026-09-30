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
  BookingActorType,
  AmendmentRefundEvidenceOutcome,
  AmendmentRefundEvidenceType,
  BookingStatus,
  CommissionScope,
  FileAssetStatus,
  FileClassification,
  FinancialAccountType,
  LedgerTransactionType,
  OwnerProfileStatus,
  PaymentPurpose,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentStatus,
  PaymentProviderCode,
  Prisma,
  RefundStatus,
  RoleCode,
  VerificationStatus,
  VerificationType,
  VehicleOccupancyType,
  applyRefundBookingAmendment,
  applyZeroDeltaBookingAmendment,
  applyPaidBookingAmendment,
  createDatabaseClient,
  expireDueBookingAmendmentPayments,
  expireBookingRefundAmendmentForBooking,
  executeBookingAmendmentRefund,
  findRecoverableBookingAmendmentRefunds,
  finalizeBookingAmendmentPaymentCapture,
  resolveAmendmentRefundManually,
  findEscalatedUnknownAmendmentPayments,
  reconcileZeroDeltaBookingAmendments,
  reconcilePaidBookingAmendments,
  reconcileRefundBookingAmendments,
  isBookingAmendmentReadyForPaidApplication,
  refundAmendmentCanApplyOperationally,
  type PrismaClient,
} from '@carrental/database';
import { AppModule } from '../src/app.module';
import { AmendmentPreviewService } from '../src/bookings/amendment-preview.service';
import { AmendmentOwnerDecisionService } from '../src/bookings/amendment-owner-decision.service';
import { AmendmentSubmissionService } from '../src/bookings/amendment-submission.service';
import { AvailabilityService } from '../src/discovery/availability.service';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.factory';
import { PaymentsService } from '../src/payments/payments.service';
import { RentalsService } from '../src/rentals/rentals.service';
import type { FakePaymentProvider, PaymentProvider } from '@carrental/payments';

interface Actor {
  roles: readonly RoleCode[];
  sessionId: string;
  token: string;
  userId: string;
}

describe.sequential('Task 18C-2A amendment preview HTTP integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let amendmentPreviews: AmendmentPreviewService;
  let amendmentDecisions: AmendmentOwnerDecisionService;
  let amendmentSubmissions: AmendmentSubmissionService;
  let availabilityService: AvailabilityService;
  let raceLocker: PrismaClient;
  let raceObserver: PrismaClient;
  let paymentProvider: PaymentProvider;
  let paymentsService: PaymentsService;
  let rentalsService: RentalsService;
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
    amendmentDecisions = app.get(AmendmentOwnerDecisionService);
    amendmentSubmissions = app.get(AmendmentSubmissionService);
    availabilityService = app.get(AvailabilityService);
    paymentProvider = app.get(PAYMENT_PROVIDER);
    paymentsService = app.get(PaymentsService);
    rentalsService = app.get(RentalsService);
    raceLocker = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    raceObserver = createDatabaseClient(process.env.TEST_DATABASE_URL!);
    await Promise.all([raceLocker.$connect(), raceObserver.$connect()]);
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
    renter.token = await tokens.signAccessToken(renter.userId, renter.sessionId, renter.roles);
    unrelatedRenter.token = await tokens.signAccessToken(
      unrelatedRenter.userId,
      unrelatedRenter.sessionId,
      unrelatedRenter.roles,
    );
    owner.token = await tokens.signAccessToken(owner.userId, owner.sessionId, owner.roles);
    await createBookingFixture();
  });

  afterAll(async () => {
    await Promise.all([raceLocker.$disconnect(), raceObserver.$disconnect()]);
    await app.close();
  });

  async function createBookingFixture(
    status = BookingStatus.CONFIRMED,
    ownerDelivery = false,
    daysUntilPickup?: number,
    handoverReady = false,
  ) {
    fixtureIndex += 1;
    const deliveryFeeMinor = ownerDelivery ? 30_000 : 0;
    rentalStart = future(daysUntilPickup ?? 10 + fixtureIndex * 4, 9);
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
            deliveryFeeMinor,
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
        ...(handoverReady
          ? {
              handoverWorkflowVersion: 1,
              pickupWindowEnd: new Date(Date.now() + 60 * 60_000),
              pickupWindowStart: new Date(Date.now() - 60_000),
            }
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
        amountMinor: BigInt(200_000 + deliveryFeeMinor),
        authorizedAmountMinor: BigInt(200_000 + deliveryFeeMinor),
        bookingId,
        capturedAmountMinor: BigInt(200_000 + deliveryFeeMinor),
        capturedAt: new Date(),
        currency: 'PHP',
        externalPaymentId: paymentProviderReference,
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
        deliveryEarningMinor: BigInt(deliveryFeeMinor),
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
    expect(withoutExpiringFileGrants(await search('LIST'))).toEqual(
      withoutExpiringFileGrants(listBefore),
    );
    expect(withoutExpiringFileGrants(await search('MAP'))).toEqual(
      withoutExpiringFileGrants(mapBefore),
    );
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
    expect(Number(first[0]?.expired)).toBeGreaterThan(0);
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
    BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
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
    await expireAmendments();
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

  it('lets only the owning Owner review and accept zero-delta and refund requests for processing', async () => {
    const unrelatedOwner = await createActor(`other-owner-${fixtureIndex}`, [RoleCode.OWNER]);
    const zeroPreview = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const zero = await submit(
      renter.token,
      zeroPreview.body.data.previewToken,
      `zero-submit-${randomUUID()}`,
    ).expect(201);

    await ownerAmendmentDetail(unrelatedOwner.token, zero.body.data.amendmentId).expect(404);
    await ownerAmendmentDetail(renter.token, zero.body.data.amendmentId).expect(403);
    const actionable = await ownerAmendments(owner.token).expect(200);
    expect(
      actionable.body.data.items.map(
        (item: { amendmentReference: string }) => item.amendmentReference,
      ),
    ).toContain(zero.body.data.amendmentId);
    const beforeBooking = await database.client.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    const zeroKey = `zero-accept-${randomUUID()}`;
    const accepted = await ownerAccept(owner.token, zero.body.data.amendmentId, zeroKey).expect(
      201,
    );
    const replay = await ownerAccept(owner.token, zero.body.data.amendmentId, zeroKey).expect(201);
    expect(replay.body.data).toEqual(accepted.body.data);
    expect(accepted.body.data).toMatchObject({
      actionable: false,
      paymentDeadlineAt: null,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    });
    await renterAmendmentDetail(renter.token, zero.body.data.amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          bookingAlreadyApplied: false,
          financial: { additionalPaymentMinor: '0', expectedRefundMinor: '0' },
          paymentDeadlineAt: null,
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        });
        expect(body.data.financial).not.toHaveProperty('currentOwnerEarningsMinor');
        expect(body.data).not.toHaveProperty('reasonCode');
      });
    expect(await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } })).toEqual(
      beforeBooking,
    );
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId: zero.body.data.amendmentId, toStatus: 'OWNER_ACCEPTED_PROCESSING' },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_ACCEPTED' },
      }),
    ).toBe(1);
    await withdraw(renter.token, zero.body.data.amendmentId).expect(409);
    await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 60 * 60_000).toISOString(),
    }).expect(409);

    await createBookingFixture();
    const refundPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    expect(BigInt(refundPreview.body.data.financial.expectedRefundMinor)).toBeGreaterThan(0n);
    const refund = await submit(
      renter.token,
      refundPreview.body.data.previewToken,
      `refund-submit-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(owner.token, refund.body.data.amendmentId, `refund-accept-${randomUUID()}`)
      .expect(201)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          paymentDeadlineAt: null,
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        }),
      );
    await renterAmendmentDetail(renter.token, refund.body.data.amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(BigInt(body.data.financial.expectedRefundMinor)).toBeGreaterThan(0n);
        expect(body.data).toMatchObject({
          bookingAlreadyApplied: false,
          paymentDeadlineAt: null,
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        });
      });
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
  });

  it('executes an accepted amendment refund exactly once and hands off without applying', async () => {
    await createBookingFixture();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-execution-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `refund-execution-accept-${randomUUID()}`).expect(
      201,
    );
    const before = await database.client.booking.findUniqueOrThrow({
      include: { commissionSnapshot: true, ownerEarning: true },
      where: { id: bookingId },
    });
    const refundSpy = vi.spyOn(paymentProvider, 'refund');
    const [first, concurrent] = await Promise.all([
      refundAmendment(renter.token, amendmentId),
      refundAmendment(renter.token, amendmentId),
    ]);
    expect([first.status, concurrent.status]).toEqual([201, 201]);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    await refundAmendment(renter.token, amendmentId).expect(201);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    refundSpy.mockRestore();

    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        booking: { include: { commissionSnapshot: true, ownerEarning: true } },
        settlement: { include: { refund: { include: { operation: true, payment: true } } } },
      },
      where: { id: amendmentId },
    });
    expect(persisted.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING);
    expect(persisted.appliedAt).toBeNull();
    expect(persisted.booking.rentalStart).toEqual(before.rentalStart);
    expect(persisted.booking.rentalEnd).toEqual(before.rentalEnd);
    expect(persisted.booking.ownerEarning).toEqual(before.ownerEarning);
    expect(persisted.booking.commissionSnapshot).toEqual(before.commissionSnapshot);
    expect(persisted.settlement).toMatchObject({
      reconciliationRequired: false,
      status: 'COMPLETED',
    });
    expect(persisted.settlement?.refund).toMatchObject({
      status: 'COMPLETED',
      operation: { status: PaymentOperationStatus.SUCCEEDED },
    });
    expect(
      await database.client.refund.count({
        where: { amendmentSettlement: { amendmentId } },
      }),
    ).toBe(1);
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: amendmentId,
          sourceType: 'BOOKING_AMENDMENT_REFUND_OBLIGATION',
          type: LedgerTransactionType.ADJUSTMENT,
        },
      }),
    ).toBe(1);
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: persisted.settlement!.id,
          sourceType: 'BOOKING_AMENDMENT_REFUND',
          type: LedgerTransactionType.REFUND,
        },
      }),
    ).toBe(1);
  });

  it('applies a completed amendment refund atomically exactly once without another provider call', async () => {
    await createBookingFixture();
    const proposedEnd = new Date(rentalEnd.getTime() - 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-apply-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `refund-apply-accept-${randomUUID()}`).expect(201);
    await refundAmendment(renter.token, amendmentId).expect(201);

    const before = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        booking: { include: { ownerEarning: true } },
        pricingSnapshot: true,
        settlement: { include: { refund: { include: { operation: true, payment: true } } } },
      },
      where: { id: amendmentId },
    });
    const refundBefore = before.settlement!.refund!;
    const paymentBefore = refundBefore.payment;
    const earningBefore = before.booking.ownerEarning!;
    const applicationBaseline = async () => ({
      amendment: await database.client.bookingAmendment.findUniqueOrThrow({
        select: { appliedAt: true, status: true },
        where: { id: amendmentId },
      }),
      applicationLedger: await database.client.ledgerTransaction.count({
        where: {
          sourceId: amendmentId,
          sourceType: 'BOOKING_AMENDMENT',
          type: LedgerTransactionType.ADJUSTMENT,
        },
      }),
      earning: await database.client.ownerEarning.findUniqueOrThrow({ where: { bookingId } }),
      history: await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
      occupancy: await database.client.vehicleOccupancy.findUniqueOrThrow({
        where: { bookingId },
      }),
      outbox: await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
      settlement: await database.client.bookingAmendmentSettlement.findUniqueOrThrow({
        where: { amendmentId },
      }),
    });
    const unapplied = await applicationBaseline();
    for (const failurePoint of [
      'AFTER_OCCUPANCY_CONVERSION',
      'AFTER_BOOKING_MUTATION',
      'AFTER_OWNER_EARNINGS',
      'AFTER_FINANCIAL_APPLICATION',
      'AFTER_SETTLEMENT_FINALIZATION',
      'AFTER_APPLIED_HISTORY_OUTBOX',
    ] as const) {
      await expect(
        applyRefundBookingAmendment(database.client, amendmentId, { failurePoint }),
      ).rejects.toMatchObject({ code: 'APPLICATION_FAILURE_INJECTED' });
      expect(await applicationBaseline()).toEqual(unapplied);
      expect(
        await database.client.refund.findUniqueOrThrow({ where: { id: refundBefore.id } }),
      ).toMatchObject({
        amountMinor: refundBefore.amountMinor,
        externalRefundId: refundBefore.externalRefundId,
        status: RefundStatus.COMPLETED,
      });
    }

    const providerRefund = vi.spyOn(paymentProvider, 'refund');
    const [first, concurrent] = await Promise.all([
      applyRefundBookingAmendment(database.client, amendmentId),
      applyRefundBookingAmendment(raceObserver, amendmentId),
    ]);
    const retry = await applyRefundBookingAmendment(database.client, amendmentId);
    const workerRetry = await reconcileRefundBookingAmendments(database.client, 1_000);
    expect(concurrent).toEqual(first);
    expect(retry).toEqual(first);
    expect(workerRetry.failed).toBeGreaterThanOrEqual(0);
    expect(providerRefund).not.toHaveBeenCalled();
    providerRefund.mockRestore();

    const applied = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        booking: { include: { ownerEarning: true } },
        holds: { include: { occupancy: true } },
        pricingSnapshot: true,
        settlement: { include: { refund: { include: { operation: true, payment: true } } } },
      },
      where: { id: amendmentId },
    });
    expect(applied).toMatchObject({ appliedAt: expect.any(Date), status: 'APPLIED' });
    expect(applied.settlement).toMatchObject({
      refundId: refundBefore.id,
      status: 'COMPLETED',
    });
    expect(applied.settlement!.refund).toMatchObject({
      amountMinor: refundBefore.amountMinor,
      externalRefundId: refundBefore.externalRefundId,
      status: RefundStatus.COMPLETED,
    });
    expect(applied.settlement!.refund!.payment).toMatchObject({
      id: paymentBefore.id,
      capturedAmountMinor: paymentBefore.capturedAmountMinor,
      refundedAmountMinor: paymentBefore.refundedAmountMinor,
    });
    const occupancy = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { bookingId },
    });
    expect(occupancy.occupiedEnd.getTime()).toBeLessThan(unapplied.occupancy.occupiedEnd.getTime());
    expect(applied.booking.ownerEarning!.adjustmentAmountMinor).toBe(
      earningBefore.adjustmentAmountMinor + applied.pricingSnapshot!.ownerEarningsDeltaMinor,
    );
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: amendmentId,
          sourceType: 'BOOKING_AMENDMENT',
          type: LedgerTransactionType.ADJUSTMENT,
        },
      }),
    ).toBe(1);
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
    ).toBe(1);
    await renterAmendmentDetail(renter.token, amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          bookingAlreadyApplied: true,
          current: { rentalEnd: proposedEnd.toISOString() },
          refundState: null,
          status: BookingAmendmentStatus.APPLIED,
        });
      });
  });

  it('persists UNKNOWN durably and recovers by exact request replay after restart', async () => {
    await createBookingFixture();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-unknown-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `refund-unknown-accept-${randomUUID()}`).expect(
      201,
    );
    const fake = paymentProvider as FakePaymentProvider;
    fake.setOutcome('unknown');
    const spy = vi.spyOn(paymentProvider, 'refund');
    await refundAmendment(renter.token, amendmentId)
      .expect(201)
      .expect(({ body }) => expect(body.data.outcome).toBe('UNKNOWN'));
    const unknown = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        settlement: { include: { refund: { include: { operation: true, payment: true } } } },
      },
      where: { id: amendmentId },
    });
    expect(unknown.settlement).toMatchObject({
      reconciliationRequired: true,
      status: 'RECONCILIATION_REQUIRED',
    });
    expect(unknown.settlement?.refund?.operation).toMatchObject({
      status: PaymentOperationStatus.UNKNOWN,
    });
    expect(unknown.settlement?.refund?.payment).toMatchObject({ reconciliationRequired: true });
    await database.client.paymentOperation.update({
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      where: { id: unknown.settlement!.refund!.operation!.id },
    });
    fake.setOutcome('succeed');
    await executeBookingAmendmentRefund(database.client, paymentProvider, amendmentId, {
      allowReplay: true,
      unknownGraceMinutes: 60,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: spy.mock.calls[0]?.[0].idempotencyKey,
      requestReference: spy.mock.calls[0]?.[0].requestReference,
    });
    spy.mockRestore();
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { settlement: { include: { refund: { include: { operation: true } } } } },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      settlement: {
        status: 'COMPLETED',
        refund: { status: 'COMPLETED', operation: { attemptCount: 2, status: 'SUCCEEDED' } },
      },
    });
  });

  it('records a definitive amendment refund failure without erasing entitlement', async () => {
    await createBookingFixture();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-decline-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `refund-decline-accept-${randomUUID()}`).expect(
      201,
    );
    const fake = paymentProvider as FakePaymentProvider;
    fake.setOutcome('decline');
    await refundAmendment(renter.token, amendmentId)
      .expect(201)
      .expect(({ body }) => expect(body.data.outcome).toBe('DEFINITIVE_FAILURE'));
    fake.setOutcome('succeed');
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { settlement: { include: { refund: { include: { operation: true } } } } },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      settlement: {
        reconciliationRequired: true,
        status: 'RECONCILIATION_REQUIRED',
        refund: { status: 'FAILED', operation: { status: 'FAILED' } },
      },
    });
  });

  it('recovers provider success after local finalization failure without a second financial refund', async () => {
    await createBookingFixture();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-local-failure-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(
      owner.token,
      amendmentId,
      `refund-local-failure-accept-${randomUUID()}`,
    ).expect(201);
    const providerReceivable = await database.client.financialAccount.findFirstOrThrow({
      where: {
        active: true,
        currency: 'PHP',
        type: FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
      },
    });
    const fake = paymentProvider as FakePaymentProvider;
    fake.setOutcome('succeed');
    const spy = vi.spyOn(paymentProvider, 'refund');
    await database.client.financialAccount.update({
      data: { active: false },
      where: { id: providerReceivable.id },
    });
    try {
      await refundAmendment(renter.token, amendmentId).expect(500);
    } finally {
      await database.client.financialAccount.update({
        data: { active: true },
        where: { id: providerReceivable.id },
      });
    }
    const interrupted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { settlement: { include: { refund: { include: { operation: true } } } } },
      where: { id: amendmentId },
    });
    expect(interrupted.settlement?.refund).toMatchObject({
      status: 'PROCESSING',
      operation: { status: PaymentOperationStatus.PROCESSING },
    });
    await database.client.paymentOperation.update({
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
      where: { id: interrupted.settlement!.refund!.operation!.id },
    });
    await executeBookingAmendmentRefund(database.client, paymentProvider, amendmentId, {
      allowReplay: true,
      unknownGraceMinutes: 60,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: spy.mock.calls[0]?.[0].idempotencyKey,
      requestReference: spy.mock.calls[0]?.[0].requestReference,
    });
    const externalPaymentId = spy.mock.calls[0]?.[0].externalPaymentId;
    spy.mockRestore();
    expect(externalPaymentId).toBeTruthy();
    const providerPayment = await paymentProvider.retrievePayment(externalPaymentId!);
    expect(providerPayment.refundedAmountMinor).toBe(interrupted.settlement!.refund!.amountMinor);
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: interrupted.settlement!.id,
          sourceType: 'BOOKING_AMENDMENT_REFUND',
        },
      }),
    ).toBe(1);
  });

  it('applies an accepted zero-delta change atomically and converges on retry', async () => {
    const proposedStart = new Date(rentalStart.getTime() + 30 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedPickupAt: proposedStart.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `apply-zero-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accept-zero-${randomUUID()}`).expect(201);

    const before = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: true, settlement: true },
      where: { id: amendmentId },
    });
    expect(before.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING);
    expect(before.settlement).toMatchObject({ direction: 'NONE', status: 'PENDING' });

    const paymentCount = await database.client.payment.count({ where: { bookingId } });
    const refundCount = await database.client.refund.count({ where: { payment: { bookingId } } });
    const [first, concurrent] = await Promise.all([
      applyZeroDeltaBookingAmendment(database.client, amendmentId),
      applyZeroDeltaBookingAmendment(raceObserver, amendmentId),
    ]);
    const retry = await applyZeroDeltaBookingAmendment(database.client, amendmentId);
    expect(concurrent).toEqual(first);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ rentalStart: proposedStart, status: 'APPLIED' });

    const applied = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, settlement: true },
      where: { id: amendmentId },
    });
    expect(applied).toMatchObject({
      paymentDeadlineAt: null,
      status: BookingAmendmentStatus.APPLIED,
      settlement: { direction: 'NONE', status: 'COMPLETED' },
    });
    expect(applied.appliedAt).toBeInstanceOf(Date);
    expect(applied.holds.every((hold) => hold.status !== 'ACTIVE' && !hold.occupancy.active)).toBe(
      true,
    );
    const occupancy = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { bookingId },
    });
    expect(occupancy.occupiedStart).toEqual(proposedStart);
    expect(await database.client.payment.count({ where: { bookingId } })).toBe(paymentCount);
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(
      refundCount,
    );
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
    ).toBe(1);
    await renterAmendmentDetail(renter.token, amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          appliedAt: first.appliedAt.toISOString(),
          bookingAlreadyApplied: true,
          paymentDeadlineAt: null,
          status: BookingAmendmentStatus.APPLIED,
        });
        expect(body.data.financial).not.toHaveProperty('currentOwnerEarningsMinor');
      });
    await ownerAmendmentDetail(owner.token, amendmentId)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          actionable: false,
          appliedAt: first.appliedAt.toISOString(),
          status: BookingAmendmentStatus.APPLIED,
        }),
      );
    for (const [path, token] of [
      [`/api/v1/bookings/${reference}`, renter.token],
      [`/api/v1/owner/bookings/${reference}`, owner.token],
    ] as const) {
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect(({ body }) =>
          expect(body.data).toMatchObject({ rentalStart: proposedStart.toISOString() }),
        );
    }
  });

  it('keeps an accepted refund-due amendment authoritative over cancellation and pickup', async () => {
    await createBookingFixture(BookingStatus.READY_FOR_PICKUP);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-lifecycle-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `refund-lifecycle-accept-${randomUUID()}`)
      .expect(201)
      .expect(({ body }) =>
        expect(body.data).toMatchObject({
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        }),
      );

    const cancellation = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/cancellation-preview`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ reasonCode: 'CHANGE_OF_PLANS' })
      .expect(201);
    const cancelAttempt = () =>
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/cancellation`)
        .set('Authorization', `Bearer ${renter.token}`)
        .set('Idempotency-Key', `refund-lifecycle-cancel-${randomUUID()}`)
        .send({
          previewToken: cancellation.body.data.previewToken,
          reasonCode: 'CHANGE_OF_PLANS',
        });
    await cancelAttempt().expect(409);
    await cancelAttempt().expect(409);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({})
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: '123456' })
      .expect(409);

    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ actualPickupAt: null, status: BookingStatus.READY_FOR_PICKUP });
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { settlement: true },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      settlement: { direction: 'REFUND', status: 'PENDING' },
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    });
    expect(
      await database.client.bookingCancellationSettlement.count({ where: { bookingId } }),
    ).toBe(0);
    expect(
      await database.client.inspectionVerificationChallenge.count({ where: { bookingId } }),
    ).toBe(0);
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
  });

  it('serializes refund acceptance against cancellation at the booking lock', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `refund-cancel-race-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    const cancellation = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/cancellation-preview`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ reasonCode: 'CHANGE_OF_PLANS' })
      .expect(201);

    const [accepted, cancelled] = await Promise.all([
      ownerAccept(owner.token, amendmentId, `refund-cancel-race-accept-${randomUUID()}`),
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/cancellation`)
        .set('Authorization', `Bearer ${renter.token}`)
        .set('Idempotency-Key', `refund-cancel-race-cancel-${randomUUID()}`)
        .send({
          previewToken: cancellation.body.data.previewToken,
          reasonCode: 'CHANGE_OF_PLANS',
        }),
    ]);

    expect([accepted.status, cancelled.status].sort()).toEqual([201, 409]);
    const booking = await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      where: { id: amendmentId },
    });
    if (accepted.status === 201) {
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
      expect(amendment.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING);
      expect(
        await database.client.bookingCancellationSettlement.count({ where: { bookingId } }),
      ).toBe(0);
    } else {
      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(amendment.status).toBe(BookingAmendmentStatus.PENDING_OWNER);
      expect(
        await database.client.bookingCancellationSettlement.count({ where: { bookingId } }),
      ).toBe(1);
    }
  });

  it.each(['EXPIRY_FIRST', 'CANCELLATION_FIRST'] as const)(
    'conserves cancellation settlement when refund expiry race is %s',
    async (winner) => {
      await createBookingFixture(BookingStatus.CONFIRMED, false);
      const reviewed = await preview(renter.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
      }).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `r4b-${winner}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId as string;
      const previewCancellation = () =>
        request(app.getHttpServer())
          .post(`/api/v1/bookings/${reference}/cancellation-preview`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({ reasonCode: 'CHANGE_OF_PLANS' });
      const beforeAcceptance =
        winner === 'EXPIRY_FIRST' ? await previewCancellation().expect(201) : null;
      await ownerAccept(owner.token, amendmentId, `r4b-accept-${winner}-${randomUUID()}`).expect(
        201,
      );
      const oldCancellation = beforeAcceptance ?? (await previewCancellation().expect(201));
      await database.client.booking.update({
        data: {
          pickupWindowStart: new Date(Date.now() - 60_000),
        },
        where: { id: bookingId },
      });
      const expire = () =>
        database.client.$transaction((transaction) =>
          expireBookingRefundAmendmentForBooking(transaction, bookingId, new Date()),
        );
      const cancel = (token: string, key: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/bookings/${reference}/cancellation`)
          .set('Authorization', `Bearer ${renter.token}`)
          .set('Idempotency-Key', key)
          .send({ previewToken: token, reasonCode: 'CHANGE_OF_PLANS' });
      const [first, second] =
        winner === 'EXPIRY_FIRST'
          ? await raceBehindBookingTableLock(expire, () =>
              cancel(oldCancellation.body.data.previewToken, `r4b-old-${randomUUID()}`),
            )
          : await raceBehindBookingTableLock(
              () => cancel(oldCancellation.body.data.previewToken, `r4b-cancel-${randomUUID()}`),
              expire,
            );
      if (winner === 'EXPIRY_FIRST') {
        expect(first).toBe(true);
        expect(second.status).toBe(409);
        expect(second.body.error.code).toBe('CANCELLATION_PREVIEW_STALE');
        const refreshed = await request(app.getHttpServer())
          .post(`/api/v1/bookings/${reference}/cancellation-preview`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({ reasonCode: 'CHANGE_OF_PLANS' })
          .expect(201);
        await cancel(refreshed.body.data.previewToken, `r4b-refreshed-${randomUUID()}`).expect(201);
      } else {
        expect(first.status).toBe(201);
        expect(second).toBe(false);
      }
      const [booking, amendment, settlement] = await Promise.all([
        database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
        database.client.bookingAmendment.findUniqueOrThrow({
          include: { holds: true, statusHistory: true },
          where: { id: amendmentId },
        }),
        database.client.bookingCancellationSettlement.findUniqueOrThrow({
          where: { bookingId },
        }),
      ]);
      expect(booking.status).toBe(BookingStatus.CANCELLED);
      expect(amendment.status).toBe(BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING);
      expect(amendment.holds.every(({ status }) => status === 'RELEASED')).toBe(true);
      expect(settlement.amendmentRefundObligationOffsetMinor).toBeGreaterThan(0n);
      expect(
        settlement.refundAmountMinor +
          settlement.amendmentRefundObligationOffsetMinor +
          settlement.commissionRetainedMinor +
          settlement.deliveryRetainedMinor,
      ).toBe(settlement.capturedAmountMinor);
      if (winner === 'EXPIRY_FIRST') {
        await expect(
          database.client.bookingCancellationSettlement.update({
            data: {
              amendmentRefundObligationOffsetMinor:
                settlement.amendmentRefundObligationOffsetMinor - 1n,
            },
            where: { id: settlement.id },
          }),
        ).rejects.toThrow();
        await expect(
          database.client.bookingCancellationSettlement.update({
            data: {
              amendmentRefundObligationOffsetMinor:
                settlement.amendmentRefundObligationOffsetMinor + 1n,
            },
            where: { id: settlement.id },
          }),
        ).rejects.toThrow();
      }
      expect(
        amendment.statusHistory.filter(
          ({ toStatus }) => toStatus === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
        ),
      ).toHaveLength(1);
      await refundAmendment(renter.token, amendmentId)
        .expect(201)
        .expect(({ body }) => {
          expect(body.data).toMatchObject({
            amendmentStatus: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
            fiveC2Eligible: false,
            outcome: 'COMPLETED',
          });
        });
      const afterRefund = await database.client.bookingCancellationSettlement.findUniqueOrThrow({
        where: { bookingId },
      });
      expect(afterRefund.amendmentRefundObligationOffsetMinor).toBe(
        settlement.amendmentRefundObligationOffsetMinor,
      );
      expect(
        await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
      ).toMatchObject({
        appliedAt: null,
        status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      });
      await expect(applyRefundBookingAmendment(database.client, amendmentId)).rejects.toMatchObject(
        { code: 'AMENDMENT_NOT_APPLICABLE' },
      );
    },
    30_000,
  );

  it.each(['APPLICATION_FIRST', 'EXPIRY_FIRST'] as const)(
    'serializes future refund application eligibility against expiry when %s',
    async (winner) => {
      await createBookingFixture(BookingStatus.CONFIRMED, false);
      const reviewed = await preview(renter.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
      }).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `r4b-application-${winner}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId as string;
      await ownerAccept(owner.token, amendmentId, `r4b-gate-${winner}-${randomUUID()}`).expect(201);
      await database.client.booking.update({
        data: {
          pickupWindowStart:
            winner === 'APPLICATION_FIRST'
              ? new Date(Date.now() + 60_000)
              : new Date(Date.now() - 60_000),
        },
        where: { id: bookingId },
      });
      const gate = () =>
        database.client.$transaction(async (transaction) => {
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE`,
          );
          await transaction.$queryRaw(
            Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${amendmentId}::uuid FOR UPDATE`,
          );
          const row = await transaction.bookingAmendment.findUniqueOrThrow({
            where: { id: amendmentId },
          });
          return refundAmendmentCanApplyOperationally(row.status);
        });
      const expire = () =>
        database.client.$transaction((transaction) =>
          expireBookingRefundAmendmentForBooking(transaction, bookingId, new Date()),
        );
      const [first, second] =
        winner === 'APPLICATION_FIRST'
          ? await raceBehindBookingTableLock(gate, expire)
          : await raceBehindBookingTableLock(expire, gate);
      expect(first).toBe(true);
      expect(second).toBe(false);
      const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: amendmentId },
      });
      expect(amendment.status).toBe(
        winner === 'APPLICATION_FIRST'
          ? BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING
          : BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      );
    },
    30_000,
  );

  it.each(['ACCEPT_FIRST', 'PICKUP_FIRST'] as const)(
    'serializes refund acceptance against a successful pickup when %s is queued first',
    async (winner) => {
      await createBookingFixture(BookingStatus.READY_FOR_PICKUP, false, undefined, true);
      const reviewed = await preview(renter.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
      }).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `refund-pickup-race-${winner}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId as string;
      const reportedPhysicalHandoverAt = new Date();
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${reference}/rental/pickup/evidence-waiver`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          acknowledged: true,
          acknowledgementVersion: 'HANDOVER_EVIDENCE_WAIVER_V1',
          reportedPhysicalHandoverAt: reportedPhysicalHandoverAt.toISOString(),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/rental/pickup/handover-report/respond`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({ decision: 'CONFIRMED' })
        .expect(201);
      const challenge = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({})
        .expect(201);
      const accept = () =>
        ownerAccept(owner.token, amendmentId, `refund-pickup-accept-${winner}-${randomUUID()}`);
      const pickup = () =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ code: challenge.body.data.code });
      const [first, second] =
        winner === 'ACCEPT_FIRST'
          ? await raceBehindBookingTableLock(accept, pickup)
          : await raceBehindBookingTableLock(pickup, accept);

      expect(first.status, JSON.stringify(first.body)).toBe(201);
      expect(second.status, JSON.stringify(second.body)).toBe(
        winner === 'ACCEPT_FIRST' ? 201 : 409,
      );
      expect(JSON.stringify(second.body)).not.toMatch(
        /Prisma|PostgreSQL|serialization|constraint|stack/iu,
      );
      const [booking, amendment, persistedChallenge] = await Promise.all([
        database.client.booking.findUniqueOrThrow({
          include: {
            commissionSnapshot: true,
            occupancy: true,
            ownerEarning: true,
            payments: true,
          },
          where: { id: bookingId },
        }),
        database.client.bookingAmendment.findUniqueOrThrow({
          include: {
            holds: { include: { occupancy: true } },
            settlement: true,
            statusHistory: true,
          },
          where: { id: amendmentId },
        }),
        database.client.inspectionVerificationChallenge.findFirstOrThrow({
          orderBy: { createdAt: 'desc' },
          where: { bookingId },
        }),
      ]);
      if (winner === 'ACCEPT_FIRST') {
        expect(booking).toMatchObject({
          status: BookingStatus.ACTIVE,
        });
        expect(booking.actualPickupAt).not.toBeNull();
        expect(amendment).toMatchObject({
          settlement: { direction: 'REFUND', status: 'PENDING' },
          status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
        });
        expect(amendment.acceptedAt).not.toBeNull();
        expect(persistedChallenge.consumedAt).not.toBeNull();
        expect([400, 409]).toContain((await pickup()).status);
      } else {
        expect(booking.status).toBe(BookingStatus.ACTIVE);
        expect(booking.actualPickupAt).not.toBeNull();
        expect(amendment).toMatchObject({
          acceptedAt: null,
          status: BookingAmendmentStatus.PENDING_OWNER,
        });
        expect(persistedChallenge.consumedAt).not.toBeNull();
        await accept().expect(409);
      }
      expect(
        amendment.statusHistory.filter(({ toStatus }) =>
          [
            BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
            BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
          ].includes(toStatus as never),
        ),
      ).toHaveLength(winner === 'ACCEPT_FIRST' ? 1 : 0);
      expect(
        await database.client.outboxEvent.count({
          where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_ACCEPTED' },
        }),
      ).toBe(winner === 'ACCEPT_FIRST' ? 1 : 0);
      expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
      expect(booking.payments).toHaveLength(1);
      expect(booking.ownerEarning).not.toBeNull();
      expect(booking.commissionSnapshot).not.toBeNull();
      expect(booking.occupancy?.active).toBe(true);
      expect(
        amendment.holds.every((hold) =>
          winner === 'ACCEPT_FIRST' ? hold.status === 'RELEASED' : hold.status === 'ACTIVE',
        ),
      ).toBe(true);
      expect(
        amendment.holds.every((hold) =>
          winner === 'ACCEPT_FIRST' ? !hold.occupancy.active : hold.occupancy.active,
        ),
      ).toBe(true);
    },
    30_000,
  );

  it('applies a user-reachable fulfillment-only zero-delta destination change', async () => {
    await createBookingFixture(BookingStatus.CONFIRMED, true);
    await database.client.vehiclePolicyVersion.create({
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
        version: 3,
        weeklyDiscountBps: 1_000,
      },
    });
    const originalOccupancy = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { bookingId },
    });
    const reviewed = await preview(renter.token, {
      proposedDeliveryDestination: {
        addressLine1: 'Ayala Avenue entrance',
        city: 'Makati City',
        country: 'PH',
        latitude: 14.5547,
        longitude: 121.0244,
        province: 'Metro Manila',
      },
    }).expect(201);
    expect(reviewed.body.data).toMatchObject({
      current: { startMethod: 'OWNER_DELIVERY', totalMinor: '230000' },
      financial: {
        additionalPaymentMinor: '0',
        expectedRefundMinor: '0',
      },
      proposed: {
        deliveryFeeMinor: '30000',
        fulfillmentMinor: '30000',
        startMethod: 'OWNER_DELIVERY',
      },
    });

    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `fulfillment-zero-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accept-fulfillment-zero-${randomUUID()}`)
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING),
      );
    await expect(
      applyZeroDeltaBookingAmendment(database.client, amendmentId),
    ).resolves.toMatchObject({ status: 'APPLIED' });

    const applied = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { fulfillmentSnapshot: true, pricingSnapshot: true, settlement: true },
      where: { id: amendmentId },
    });
    expect(applied).toMatchObject({
      status: BookingAmendmentStatus.APPLIED,
      fulfillmentSnapshot: {
        currentFulfillmentTotalMinor: 30_000n,
        fulfillmentDeltaMinor: 0n,
        proposedFulfillmentTotalMinor: 30_000n,
        proposedStartMethod: 'OWNER_DELIVERY',
      },
      settlement: { direction: 'NONE', financialDeltaMinor: 0n, status: 'COMPLETED' },
    });
    expect(applied.fulfillmentSnapshot?.destinationSnapshot).toMatchObject({
      deliveryDestination: { addressLine1: 'Ayala Avenue entrance' },
    });
    expect(applied.pricingSnapshot?.proposedTotalMinor).toBe(
      applied.pricingSnapshot?.currentTotalMinor,
    );
    expect(
      await database.client.vehicleOccupancy.findUniqueOrThrow({ where: { bookingId } }),
    ).toEqual(originalOccupancy);
  });

  it('applies non-refundable shortening, releases the tail, and preserves original evidence', async () => {
    await createBookingFixture(BookingStatus.CONFIRMED, false, 2);
    await database.client.payment.update({
      data: { capturedAt: new Date(Date.now() - 7 * 60 * 60_000) },
      where: { id: paymentId },
    });
    const originalStart = rentalStart;
    const originalEnd = rentalEnd;
    const shortenedEnd = new Date(originalEnd.getTime() - 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: shortenedEnd.toISOString(),
    }).expect(201);
    expect(reviewed.body.data.financial).toMatchObject({
      additionalPaymentMinor: '0',
      expectedRefundMinor: '0',
    });
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `shorten-zero-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accept-shorten-${randomUUID()}`).expect(201);
    await applyZeroDeltaBookingAmendment(database.client, amendmentId);

    const [booking, pricing, occupancy, amendment] = await Promise.all([
      database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      database.client.bookingPricingSnapshot.findUniqueOrThrow({ where: { bookingId } }),
      database.client.vehicleOccupancy.findUniqueOrThrow({ where: { bookingId } }),
      database.client.bookingAmendment.findUniqueOrThrow({
        include: { pricingSnapshot: true, settlement: true },
        where: { id: amendmentId },
      }),
    ]);
    expect(booking).toMatchObject({ rentalEnd: originalEnd, rentalStart: originalStart });
    expect(pricing).toMatchObject({ rentalEnd: originalEnd, rentalStart: originalStart });
    expect(occupancy).toMatchObject({ occupiedStart: originalStart });
    expect(occupancy.occupiedEnd).toEqual(new Date(shortenedEnd.getTime() + 120 * 60_000));
    expect(amendment).toMatchObject({
      proposedRentalEnd: shortenedEnd,
      status: BookingAmendmentStatus.APPLIED,
      settlement: { direction: 'NONE', status: 'COMPLETED' },
    });
    expect(amendment.pricingSnapshot?.proposedTotalMinor).toBe(
      amendment.pricingSnapshot?.currentTotalMinor,
    );

    const releasedStart = new Date(shortenedEnd.getTime() + 120 * 60_000);
    expect(await searchRange('LIST', releasedStart, originalEnd)).toContain(vehicleId);
    expect(await searchRange('MAP', releasedStart, originalEnd)).toContain(vehicleId);
    const releasedQuote = await quote(unrelatedRenter, releasedStart, originalEnd).expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${unrelatedRenter.token}`)
      .set('Idempotency-Key', `shortened-tail-${randomUUID()}`)
      .send({ quoteId: releasedQuote.body.data.id })
      .expect(201);
  });

  it('cancels from the applied CURRENT authority without rewriting amendment history', async () => {
    const proposedStart = new Date(rentalStart.getTime() + 30 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedPickupAt: proposedStart.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `cancel-after-apply-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accept-before-cancel-${randomUUID()}`).expect(201);
    await applyZeroDeltaBookingAmendment(database.client, amendmentId);

    const cancellation = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/cancellation-preview`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ reasonCode: 'CHANGE_OF_PLANS' })
      .expect(201);
    const executed = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/cancellation`)
      .set('Authorization', `Bearer ${renter.token}`)
      .set('Idempotency-Key', `cancel-applied-${randomUUID()}`)
      .send({
        previewToken: cancellation.body.data.previewToken,
        reasonCode: 'CHANGE_OF_PLANS',
      });
    expect(executed.status, JSON.stringify(executed.body)).toBe(201);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ status: BookingAmendmentStatus.APPLIED });
    expect(
      await database.client.bookingCancellationSettlement.findUniqueOrThrow({
        where: { bookingId },
      }),
    ).toMatchObject({ scheduledPickupAt: proposedStart });
  });

  it('uses the first APPLIED change as CURRENT for a second application', async () => {
    const firstStart = new Date(rentalStart.getTime() + 30 * 60_000);
    const firstPreview = await preview(renter.token, {
      proposedPickupAt: firstStart.toISOString(),
    }).expect(201);
    const first = await submit(
      renter.token,
      firstPreview.body.data.previewToken,
      `sequential-first-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(
      owner.token,
      first.body.data.amendmentId,
      `accept-first-${randomUUID()}`,
    ).expect(201);
    await applyZeroDeltaBookingAmendment(database.client, first.body.data.amendmentId);

    const secondStart = new Date(firstStart.getTime() + 30 * 60_000);
    const secondPreview = await preview(renter.token, {
      proposedPickupAt: secondStart.toISOString(),
    }).expect(201);
    expect(secondPreview.body.data.current.rentalStart).toBe(firstStart.toISOString());
    const second = await submit(
      renter.token,
      secondPreview.body.data.previewToken,
      `sequential-second-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(
      owner.token,
      second.body.data.amendmentId,
      `accept-second-${randomUUID()}`,
    ).expect(201);
    await applyZeroDeltaBookingAmendment(database.client, second.body.data.amendmentId);
    expect(
      await database.client.bookingAmendment.count({
        where: { bookingId, status: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(2);
    expect(
      (await database.client.vehicleOccupancy.findUniqueOrThrow({ where: { bookingId } }))
        .occupiedStart,
    ).toEqual(secondStart);
  });

  it('durably reconciles accepted zero-delta work and excludes payment-pending rows', async () => {
    const reviewed = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `reconcile-zero-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(
      owner.token,
      submitted.body.data.amendmentId,
      `reconcile-accept-${randomUUID()}`,
    )
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING),
      );
    const reconciled = (await reconcileZeroDeltaBookingAmendments(database.client, 500)).applied;
    expect(reconciled).toBeGreaterThanOrEqual(1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: submitted.body.data.amendmentId },
      }),
    ).toMatchObject({ status: BookingAmendmentStatus.APPLIED });
    await createBookingFixture();
    const paymentPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const payment = await submit(
      renter.token,
      paymentPreview.body.data.previewToken,
      `reconcile-payment-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(owner.token, payment.body.data.amendmentId, `payment-accept-${randomUUID()}`)
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING),
      );
    await reconcileZeroDeltaBookingAmendments(database.client, 1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: payment.body.data.amendmentId },
      }),
    ).toMatchObject({ status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING });
    await expect(
      applyZeroDeltaBookingAmendment(database.client, payment.body.data.amendmentId),
    ).rejects.toMatchObject({ code: 'AMENDMENT_NOT_APPLICABLE' });
  }, 30_000);

  it('rolls back zero-delta application and excludes refund processing', async () => {
    const reviewed = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `rollback-zero-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accept-rollback-${randomUUID()}`).expect(201);
    const before = await raceConservationSnapshot();
    await expect(
      applyZeroDeltaBookingAmendment(database.client, amendmentId, {
        failurePoint: 'BEFORE_FINALIZE',
      }),
    ).rejects.toThrow();
    expect(await raceConservationSnapshot()).toEqual(before);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ appliedAt: null, status: 'OWNER_ACCEPTED_PROCESSING' });

    await createBookingFixture();
    const refundPreview = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const refund = await submit(
      renter.token,
      refundPreview.body.data.previewToken,
      `refund-deferred-${randomUUID()}`,
    ).expect(201);
    await ownerAccept(
      owner.token,
      refund.body.data.amendmentId,
      `accept-refund-${randomUUID()}`,
    ).expect(201);
    await expect(
      applyZeroDeltaBookingAmendment(database.client, refund.body.data.amendmentId),
    ).rejects.toMatchObject({ code: 'AMENDMENT_FINANCIAL_INVALID' });
  });

  it('accepts additional payment without execution and rebinds hold expiry exactly once', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    expect(BigInt(reviewed.body.data.financial.additionalPaymentMinor)).toBeGreaterThan(0n);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `payment-submit-${randomUUID()}`,
    ).expect(201);
    const beforeBooking = await database.client.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    const beforePayments = await database.client.payment.count({ where: { bookingId } });
    const key = `payment-accept-${randomUUID()}`;
    const accepted = await ownerAccept(owner.token, submitted.body.data.amendmentId, key).expect(
      201,
    );
    const firstDeadline = accepted.body.data.paymentDeadlineAt;
    expect(accepted.body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING);
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } } },
      where: { id: submitted.body.data.amendmentId },
    });
    expect(persisted.holds).toHaveLength(1);
    expect(persisted.holds[0]?.expiresAt).toEqual(persisted.paymentDeadlineAt);
    expect(persisted.holds[0]?.occupancy.expiresAt).toEqual(persisted.paymentDeadlineAt);
    expect(persisted.holds[0]?.status).toBe('ACTIVE');
    expect(persisted.holds[0]?.occupancy.active).toBe(true);
    await renterAmendmentDetail(renter.token, submitted.body.data.amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          bookingAlreadyApplied: false,
          financial: { expectedRefundMinor: '0' },
          paymentDeadlineAt: firstDeadline,
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
        });
        expect(BigInt(body.data.financial.additionalPaymentMinor)).toBeGreaterThan(0n);
        expect(body.data.financial).not.toHaveProperty('proposedOwnerEarningsMinor');
      });
    await ownerAccept(owner.token, submitted.body.data.amendmentId, key)
      .expect(201)
      .expect(({ body }) => expect(body.data.paymentDeadlineAt).toBe(firstDeadline));
    expect(await database.client.payment.count({ where: { bookingId } })).toBe(beforePayments);
    expect(await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } })).toEqual(
      beforeBooking,
    );
  });

  it('authorizes and captures one immutable amendment payment while leaving it unapplied', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `payable-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `payable-accept-${randomUUID()}`).expect(201);
    const before = await database.client.booking.findUniqueOrThrow({
      include: {
        commissionSnapshot: true,
        ownerEarning: true,
        payments: { include: { operations: true }, where: { purpose: PaymentPurpose.RENTAL } },
        occupancy: true,
      },
      where: { id: bookingId },
    });
    const authorize = vi.spyOn(paymentProvider, 'authorize');
    const capture = vi.spyOn(paymentProvider, 'capture');
    await payAmendment(owner.token, amendmentId, `owner-cannot-pay-${randomUUID()}`).expect(403);
    await payAmendment(
      unrelatedRenter.token,
      amendmentId,
      `unrelated-cannot-pay-${randomUUID()}`,
    ).expect(404);
    const [first, concurrent] = await Promise.all([
      payAmendment(renter.token, amendmentId, `payable-first-${randomUUID()}`),
      payAmendment(renter.token, amendmentId, `payable-concurrent-${randomUUID()}`),
    ]);
    expect([first.status, concurrent.status].every((status) => status === 201)).toBe(true);
    const retry = await payAmendment(
      renter.token,
      amendmentId,
      `payable-new-key-${randomUUID()}`,
    ).expect(201);
    expect(retry.body.data).toMatchObject({
      amendmentId,
      amendmentState: 'PAYMENT_RECEIVED_AWAITING_APPLICATION',
      capturedAmountMinor: Number(reviewed.body.data.financial.additionalPaymentMinor),
      eligibleForApplication: true,
      status: PaymentStatus.CAPTURED,
    });
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]?.[0]).toMatchObject({
      amountMinor: BigInt(reviewed.body.data.financial.additionalPaymentMinor),
      currency: reviewed.body.data.financial.currency,
    });
    expect(capture.mock.calls[0]?.[0]).toMatchObject({
      amountMinor: BigInt(reviewed.body.data.financial.additionalPaymentMinor),
      currency: reviewed.body.data.financial.currency,
    });
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        holds: { include: { occupancy: true } },
        settlement: true,
        statusHistory: true,
      },
      where: { id: amendmentId },
    });
    const amendmentPayment = await database.client.payment.findMany({
      include: { operations: true },
      where: { id: persisted.settlement?.additionalPaymentId ?? undefined },
    });
    expect(amendmentPayment).toHaveLength(1);
    expect(amendmentPayment[0]).toMatchObject({
      amountMinor: BigInt(reviewed.body.data.financial.additionalPaymentMinor),
      currency: reviewed.body.data.financial.currency,
      purpose: PaymentPurpose.ADDITIONAL_CHARGE,
      status: PaymentStatus.CAPTURED,
    });
    expect(amendmentPayment[0]!.operations).toHaveLength(2);
    expect(amendmentPayment[0]!.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: PaymentOperationStatus.SUCCEEDED,
          type: PaymentOperationType.AUTHORIZE,
        }),
        expect.objectContaining({
          status: PaymentOperationStatus.SUCCEEDED,
          type: PaymentOperationType.CAPTURE,
        }),
      ]),
    );
    expect(persisted).toMatchObject({
      appliedAt: null,
      paymentInitiatedAt: expect.any(Date),
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
    });
    expect(persisted.holds.every((hold) => hold.status === 'ACTIVE')).toBe(true);
    expect(persisted.holds.every((hold) => hold.occupancy.active)).toBe(true);
    expect(
      persisted.statusHistory.some(
        (history) => history.toStatus === BookingAmendmentStatus.APPLIED,
      ),
    ).toBe(false);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
    ).toBe(0);
    const recognition = await database.client.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      where: {
        sourceId: amendmentPayment[0]!.id,
        sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
        type: 'CAPTURE_RECOGNITION',
      },
    });
    expect(recognition).toHaveLength(1);
    expect(recognition[0]!.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);
    expect(recognition[0]!.entries.map((entry) => [entry.account.type, entry.amountMinor])).toEqual(
      expect.arrayContaining([
        ['PAYMENT_PROVIDER_RECEIVABLE', amendmentPayment[0]!.amountMinor],
        ['CUSTOMER_FUNDS_HELD', -amendmentPayment[0]!.amountMinor],
      ]),
    );
    expect(await isBookingAmendmentReadyForPaidApplication(database.client, amendmentId)).toBe(
      true,
    );
    await renterAmendmentDetail(renter.token, amendmentId)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.paymentState).toBe('PAYMENT_RECEIVED_AWAITING_APPLICATION'),
      );
    await ownerAmendmentDetail(owner.token, amendmentId)
      .expect(200)
      .expect(({ body }) =>
        expect(body.data.paymentState).toBe('PAYMENT_RECEIVED_AWAITING_APPLICATION'),
      );
    const after = await database.client.booking.findUniqueOrThrow({
      include: {
        commissionSnapshot: true,
        ownerEarning: true,
        payments: { include: { operations: true }, where: { purpose: PaymentPurpose.RENTAL } },
        occupancy: true,
      },
      where: { id: bookingId },
    });
    expect(after).toEqual(before);
    expect(
      await database.client.refund.count({ where: { paymentId: amendmentPayment[0]!.id } }),
    ).toBe(0);
    authorize.mockRestore();
    capture.mockRestore();
  });

  it('atomically applies a captured amendment, rolls back every local failure point, and converges on replay', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `paid-apply-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `paid-apply-accept-${randomUUID()}`).expect(201);
    await payAmendment(renter.token, amendmentId, `paid-apply-payment-${randomUUID()}`).expect(201);

    const before = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        booking: { include: { ownerEarning: true, payments: { include: { operations: true } } } },
        holds: { include: { occupancy: true } },
        pricingSnapshot: true,
        settlement: true,
      },
      where: { id: amendmentId },
    });
    const amendmentPaymentId = before.settlement!.additionalPaymentId!;
    const originalPayment = before.booking.payments.find(
      (payment) => payment.purpose === PaymentPurpose.RENTAL,
    )!;
    const capturedPayment = before.booking.payments.find(
      (payment) => payment.id === amendmentPaymentId,
    )!;
    const recognitionId = before.settlement!.ledgerTransactionId!;
    const baseline = async () => ({
      amendment: await database.client.bookingAmendment.findUniqueOrThrow({
        select: { appliedAt: true, status: true },
        where: { id: amendmentId },
      }),
      applicationLedger: await database.client.ledgerTransaction.count({
        where: {
          sourceId: amendmentId,
          sourceType: 'BOOKING_AMENDMENT',
          type: LedgerTransactionType.CAPTURE_ALLOCATION,
        },
      }),
      earning: await database.client.ownerEarning.findUniqueOrThrow({
        where: { bookingId },
      }),
      history: await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
      hold: await database.client.bookingAmendmentHold.findMany({
        include: { occupancy: true },
        where: { amendmentId },
      }),
      occupancy: await database.client.vehicleOccupancy.findUniqueOrThrow({
        where: { bookingId },
      }),
      outbox: await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
      settlement: await database.client.bookingAmendmentSettlement.findUniqueOrThrow({
        where: { amendmentId },
      }),
    });
    const capturedBaseline = await baseline();
    for (const failurePoint of [
      'AFTER_OCCUPANCY_CONVERSION',
      'AFTER_BOOKING_MUTATION',
      'AFTER_OWNER_EARNINGS',
      'AFTER_FINANCIAL_APPLICATION',
      'AFTER_SETTLEMENT_FINALIZATION',
      'AFTER_APPLIED_HISTORY_OUTBOX',
    ] as const) {
      await expect(
        applyPaidBookingAmendment(database.client, amendmentId, { failurePoint }),
      ).rejects.toMatchObject({ code: 'APPLICATION_FAILURE_INJECTED' });
      expect(await baseline()).toEqual(capturedBaseline);
      expect(
        await database.client.payment.findUniqueOrThrow({ where: { id: amendmentPaymentId } }),
      ).toMatchObject({ id: amendmentPaymentId, status: PaymentStatus.CAPTURED });
    }

    const authorize = vi.spyOn(paymentProvider, 'authorize');
    const capture = vi.spyOn(paymentProvider, 'capture');
    const [first, concurrent] = await Promise.all([
      applyPaidBookingAmendment(database.client, amendmentId),
      applyPaidBookingAmendment(raceObserver, amendmentId),
    ]);
    const retry = await applyPaidBookingAmendment(database.client, amendmentId);
    const workerRetry = await reconcilePaidBookingAmendments(database.client);
    expect(concurrent).toEqual(first);
    expect(retry).toEqual(first);
    expect(workerRetry.failed).toBeGreaterThanOrEqual(0);
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(1);
    expect(authorize).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();

    const applied = await database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        holds: { include: { occupancy: true } },
        settlement: true,
      },
      where: { id: amendmentId },
    });
    expect(applied).toMatchObject({ appliedAt: expect.any(Date), status: 'APPLIED' });
    expect(applied.settlement).toMatchObject({
      additionalPaymentId: amendmentPaymentId,
      completedAt: expect.any(Date),
      ledgerTransactionId: recognitionId,
      status: 'COMPLETED',
    });
    expect(applied.holds.every((hold) => hold.status === 'CONVERTED')).toBe(true);
    expect(applied.holds.every((hold) => !hold.occupancy.active)).toBe(true);
    const canonicalOccupancy = await database.client.vehicleOccupancy.findUniqueOrThrow({
      where: { bookingId },
    });
    expect(canonicalOccupancy.occupiedEnd).toEqual(new Date(proposedEnd.getTime() + 120 * 60_000));

    const allocation = await database.client.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      where: {
        sourceId: amendmentId,
        sourceType: 'BOOKING_AMENDMENT',
        type: LedgerTransactionType.CAPTURE_ALLOCATION,
      },
    });
    expect(allocation).toHaveLength(1);
    expect(allocation[0]!.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);
    expect(allocation[0]!.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: expect.objectContaining({ type: FinancialAccountType.CUSTOMER_FUNDS_HELD }),
          amountMinor: capturedPayment.amountMinor,
        }),
      ]),
    );
    const allocatedOwner = allocation[0]!.entries
      .filter((entry) => entry.account.type === FinancialAccountType.OWNER_PAYABLE)
      .reduce((sum, entry) => sum - entry.amountMinor, 0n);
    const allocatedCommission = allocation[0]!.entries
      .filter((entry) => entry.account.type === FinancialAccountType.PLATFORM_COMMISSION_REVENUE)
      .reduce((sum, entry) => sum - entry.amountMinor, 0n);
    expect(allocatedOwner + allocatedCommission).toBe(capturedPayment.amountMinor);
    expect(allocatedOwner).toBe(before.pricingSnapshot!.ownerEarningsDeltaMinor);
    expect(allocatedCommission).toBe(
      before.pricingSnapshot!.proposedCommissionMinor -
        before.pricingSnapshot!.currentCommissionMinor,
    );
    expect(
      await database.client.ownerEarning.findUniqueOrThrow({ where: { bookingId } }),
    ).toMatchObject({
      adjustmentAmountMinor:
        before.booking.ownerEarning!.adjustmentAmountMinor +
        before.pricingSnapshot!.ownerEarningsDeltaMinor,
    });
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: amendmentPaymentId,
          sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
          type: LedgerTransactionType.CAPTURE_RECOGNITION,
        },
      }),
    ).toBe(1);
    expect(
      await database.client.payment.findUniqueOrThrow({
        include: { operations: true },
        where: { id: originalPayment.id },
      }),
    ).toEqual(originalPayment);
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: bookingId, eventType: 'BOOKING_AMENDMENT_APPLIED' },
      }),
    ).toBe(1);
    expect(await database.client.refund.count({ where: { paymentId: amendmentPaymentId } })).toBe(
      0,
    );
    await renterAmendmentDetail(renter.token, amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({ bookingAlreadyApplied: true, status: 'APPLIED' });
        expect(body.data.paymentState).not.toBe('PAYMENT_RECEIVED_AWAITING_APPLICATION');
      });
    const next = await preview(renter.token, {
      proposedReturnAt: new Date(proposedEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    expect(next.body.data.current.rentalEnd).toBe(proposedEnd.toISOString());
    authorize.mockRestore();
    capture.mockRestore();
  }, 60_000);

  it.each(['APPLICATION_FIRST', 'CANCELLATION_FIRST'] as const)(
    'serializes paid application against cancellation when %s is queued first',
    async (winner) => {
      const { amendmentId } = await createCapturedPaidAmendment(
        new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
      );
      const cancellation = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/cancellation-preview`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({ reasonCode: 'CHANGE_OF_PLANS' })
        .expect(201);
      const application = () =>
        applyPaidBookingAmendment(database.client, amendmentId).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ error, ok: false as const }),
        );
      const cancellationExecution = () =>
        request(app.getHttpServer())
          .post(`/api/v1/bookings/${reference}/cancellation`)
          .set('Authorization', `Bearer ${renter.token}`)
          .set('Idempotency-Key', `paid-apply-cancel-${winner}-${randomUUID()}`)
          .send({
            previewToken: cancellation.body.data.previewToken,
            reasonCode: 'CHANGE_OF_PLANS',
          });
      const [first, second] =
        winner === 'APPLICATION_FIRST'
          ? await raceBehindBookingTableLock(application, cancellationExecution)
          : await raceBehindBookingTableLock(cancellationExecution, application);
      const applicationResult = winner === 'APPLICATION_FIRST' ? first : second;
      const cancellationResult = winner === 'APPLICATION_FIRST' ? second : first;
      expect(applicationResult.ok).toBe(true);
      expect([201, 409]).toContain(cancellationResult.status);
      const [booking, amendment] = await Promise.all([
        database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
        database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
      ]);
      expect(amendment.status).toBe(BookingAmendmentStatus.APPLIED);
      expect(booking.status).toBe(
        cancellationResult.status === 201 ? BookingStatus.CANCELLED : BookingStatus.CONFIRMED,
      );
      expect(
        await database.client.ledgerTransaction.count({
          where: {
            sourceId: amendmentId,
            sourceType: 'BOOKING_AMENDMENT',
            type: LedgerTransactionType.CAPTURE_ALLOCATION,
          },
        }),
      ).toBe(1);
    },
    60_000,
  );

  it.each(['APPLICATION_FIRST', 'PICKUP_FIRST'] as const)(
    'serializes paid application against pickup when %s is queued first',
    async (winner) => {
      await createBookingFixture(BookingStatus.READY_FOR_PICKUP, false, undefined, true);
      const reportedPhysicalHandoverAt = new Date();
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${reference}/rental/pickup/evidence-waiver`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          acknowledged: true,
          acknowledgementVersion: 'HANDOVER_EVIDENCE_WAIVER_V1',
          reportedPhysicalHandoverAt: reportedPhysicalHandoverAt.toISOString(),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/rental/pickup/handover-report/respond`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({ decision: 'CONFIRMED' })
        .expect(201);
      const challenge = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({})
        .expect(201);
      const { amendmentId } = await createCapturedPaidAmendment(
        new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
      );
      const application = () =>
        applyPaidBookingAmendment(database.client, amendmentId).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ error, ok: false as const }),
        );
      const pickup = () =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ code: challenge.body.data.code });
      const [first, second] =
        winner === 'APPLICATION_FIRST'
          ? await raceBehindBookingTableLock(application, pickup)
          : await raceBehindBookingTableLock(pickup, application);
      const applicationResult = winner === 'APPLICATION_FIRST' ? first : second;
      const pickupResult = winner === 'APPLICATION_FIRST' ? second : first;
      expect(applicationResult.ok).toBe(true);
      expect([201, 409]).toContain(pickupResult.status);
      const [booking, amendment] = await Promise.all([
        database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
        database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
      ]);
      expect(amendment.status).toBe(BookingAmendmentStatus.APPLIED);
      expect(booking.status).toBe(
        pickupResult.status === 201 ? BookingStatus.ACTIVE : BookingStatus.READY_FOR_PICKUP,
      );
      expect(
        await database.client.ledgerTransaction.count({
          where: {
            sourceId: amendmentId,
            sourceType: 'BOOKING_AMENDMENT',
            type: LedgerTransactionType.CAPTURE_ALLOCATION,
          },
        }),
      ).toBe(1);
    },
    60_000,
  );

  it('recovers captured unapplied work after restart and isolates a corrupt paid record', async () => {
    const corrupt = await createCapturedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    await database.client.bookingAmendmentSettlement.update({
      data: { ledgerTransactionId: null },
      where: { amendmentId: corrupt.amendmentId },
    });

    await createBookingFixture();
    const valid = await createCapturedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    const authorize = vi.spyOn(paymentProvider, 'authorize');
    const capture = vi.spyOn(paymentProvider, 'capture');
    const firstPass = await reconcilePaidBookingAmendments(database.client);
    expect(firstPass.applied).toBeGreaterThanOrEqual(1);
    expect(firstPass.failed).toBeGreaterThanOrEqual(1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: valid.amendmentId },
      }),
    ).toMatchObject({ appliedAt: expect.any(Date), status: BookingAmendmentStatus.APPLIED });
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: corrupt.amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
    });

    await reconcilePaidBookingAmendments(database.client);
    expect(authorize).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(
      await database.client.bookingAmendmentStatusHistory.count({
        where: { amendmentId: valid.amendmentId, toStatus: BookingAmendmentStatus.APPLIED },
      }),
    ).toBe(1);
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: valid.amendmentId,
          sourceType: 'BOOKING_AMENDMENT',
          type: LedgerTransactionType.CAPTURE_ALLOCATION,
        },
      }),
    ).toBe(1);
    authorize.mockRestore();
    capture.mockRestore();
  }, 60_000);

  it('rejects new amendment payment initiation at the persisted deadline', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `deadline-payment-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `deadline-accept-${randomUUID()}`).expect(201);
    await database.client.bookingAmendment.update({
      data: { paymentDeadlineAt: new Date() },
      where: { id: amendmentId },
    });
    await payAmendment(renter.token, amendmentId, `deadline-reject-${randomUUID()}`).expect(409);
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { settlement: true },
      where: { id: amendmentId },
    });
    expect(persisted.paymentInitiatedAt).toBeNull();
    expect(persisted.settlement?.additionalPaymentId).toBeNull();
    await database.client.bookingAmendment.update({
      data: { paymentDeadlineAt: new Date(Date.now() + 60 * 60_000) },
      where: { id: amendmentId },
    });
  });

  it('terminalizes an unpaid amendment once, releases only its hold, and preserves the booking', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `timeout-payment-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `timeout-accept-${randomUUID()}`).expect(201);
    const bookingBefore = await database.client.booking.findUniqueOrThrow({
      include: { occupancy: true, payments: true },
      where: { id: bookingId },
    });
    const controlledAcceptedAt = new Date('2000-01-01T00:00:00.000Z');
    const controlledDeadlineAt = new Date('2000-01-01T00:10:00.000Z');
    await database.client.bookingAmendment.update({
      data: {
        acceptedAt: controlledAcceptedAt,
        paymentDeadlineAt: controlledDeadlineAt,
      },
      where: { id: amendmentId },
    });
    const evaluatedAt = new Date(controlledDeadlineAt.getTime() + 1);
    expect(
      await expireDueBookingAmendmentPayments(database.client, evaluatedAt, 1),
    ).toBeGreaterThan(0);
    await expireDueBookingAmendmentPayments(database.client, evaluatedAt, 1);
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, statusHistory: true },
      where: { id: amendmentId },
    });
    expect(amendment).toMatchObject({
      appliedAt: null,
      failureCode: 'RENTER_PAYMENT_DEADLINE_EXPIRED',
      status: BookingAmendmentStatus.FAILED,
    });
    expect(amendment.holds).toEqual([
      expect.objectContaining({
        releaseReason: 'RENTER_PAYMENT_DEADLINE_EXPIRED',
        status: 'EXPIRED',
        occupancy: expect.objectContaining({ active: false }),
      }),
    ]);
    expect(
      amendment.statusHistory.filter(
        ({ reasonCode }) => reasonCode === 'RENTER_PAYMENT_DEADLINE_EXPIRED',
      ),
    ).toHaveLength(1);
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: amendmentId,
          eventType: 'BOOKING_AMENDMENT_TERMINATED',
        },
      }),
    ).toBe(1);
    expect(
      await database.client.booking.findUniqueOrThrow({
        include: { occupancy: true, payments: true },
        where: { id: bookingId },
      }),
    ).toEqual(bookingBefore);
  });

  it('retains a timely UNKNOWN payment and exposes bounded escalated discovery without a retry charge', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `unknown-payment-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `unknown-accept-${randomUUID()}`).expect(201);
    const authorize = vi.spyOn(paymentProvider, 'authorize').mockResolvedValueOnce({
      externalPaymentId: `unknown-${randomUUID()}`,
      kind: 'UNKNOWN',
      providerState: 'PROVIDER_UNKNOWN',
    });
    const first = await payAmendment(
      renter.token,
      amendmentId,
      `unknown-initiate-${randomUUID()}`,
    ).expect(201);
    expect(first.body.data.amendmentState).toBe('PAYMENT_VERIFYING');
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, settlement: true },
      where: { id: amendmentId },
    });
    const paymentId = amendment.settlement!.additionalPaymentId!;
    const payment = await database.client.payment.findUniqueOrThrow({
      include: { operations: true },
      where: { id: paymentId },
    });
    expect(payment).toMatchObject({
      reconciliationRequired: true,
      status: PaymentStatus.AUTHORIZING,
      unknownExpiresAt: expect.any(Date),
    });
    expect(payment.operations).toEqual([
      expect.objectContaining({ status: PaymentOperationStatus.UNKNOWN }),
    ]);
    const afterAllDeadlines = new Date(
      Math.max(amendment.paymentDeadlineAt!.getTime(), payment.unknownExpiresAt!.getTime()) + 1,
    );
    await expireDueBookingAmendmentPayments(database.client, afterAllDeadlines, 1_000);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING });
    const escalated = await findEscalatedUnknownAmendmentPayments(
      database.client,
      afterAllDeadlines,
      1_000,
    );
    expect(escalated.map(({ id }) => id)).toContain(paymentId);
    const retry = await payAmendment(
      renter.token,
      amendmentId,
      `unknown-retry-${randomUUID()}`,
    ).expect(201);
    expect(retry.body.data.amendmentState).toBe('PAYMENT_VERIFYING');
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } } },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      holds: [
        expect.objectContaining({
          status: 'ACTIVE',
          occupancy: expect.objectContaining({ active: true }),
        }),
      ],
    });
    authorize.mockRestore();
  });

  it('serializes timely first payment initiation ahead of a queued timeout', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `payment-timeout-race-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `payment-timeout-accept-${randomUUID()}`).expect(
      201,
    );
    const accepted = await database.client.bookingAmendment.findUniqueOrThrow({
      where: { id: amendmentId },
    });
    const timeout = () =>
      expireDueBookingAmendmentPayments(
        database.client,
        new Date(accepted.paymentDeadlineAt!.getTime() + 1),
      );
    const payment = () =>
      payAmendment(renter.token, amendmentId, `payment-timeout-pay-${randomUUID()}`);
    const [paymentResponse] = await raceBehindAmendmentTableLock(payment, timeout);
    expect(paymentResponse.status).toBe(201);
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, settlement: true },
      where: { id: amendmentId },
    });
    expect(persisted.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING);
    expect(persisted.holds[0]?.occupancy.active).toBe(true);
  });

  it.each(['UNKNOWN', 'CAPTURED'] as const)(
    'prevents timeout while timely provider work resolves to %s',
    async (providerOutcome) => {
      const reviewed = await preview(renter.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
      }).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `provider-timeout-race-${providerOutcome}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId as string;
      await ownerAccept(owner.token, amendmentId, `provider-timeout-accept-${randomUUID()}`).expect(
        201,
      );
      let releaseProvider!: () => void;
      let signalProvider!: () => void;
      const providerCalled = new Promise<void>((resolve) => (signalProvider = resolve));
      const providerReleased = new Promise<void>((resolve) => (releaseProvider = resolve));
      const authorize = vi.spyOn(paymentProvider, 'authorize').mockImplementationOnce(async () => {
        signalProvider();
        await providerReleased;
        return providerOutcome === 'UNKNOWN'
          ? {
              externalPaymentId: `race-unknown-${randomUUID()}`,
              kind: 'UNKNOWN',
              providerState: 'PROVIDER_UNKNOWN',
            }
          : {
              externalPaymentId: `race-authorized-${randomUUID()}`,
              kind: 'SUCCEEDED',
              providerState: 'AUTHORIZED',
            };
      });
      const paymentPromise = payAmendment(
        renter.token,
        amendmentId,
        `provider-timeout-pay-${randomUUID()}`,
      ).then((response) => response);
      await providerCalled;
      const accepted = await database.client.bookingAmendment.findUniqueOrThrow({
        where: { id: amendmentId },
      });
      expect(
        await expireDueBookingAmendmentPayments(
          database.client,
          new Date(accepted.paymentDeadlineAt!.getTime() + 1),
        ),
      ).toBeGreaterThanOrEqual(0);
      releaseProvider();
      expect((await paymentPromise).status).toBe(201);
      const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } }, settlement: true },
        where: { id: amendmentId },
      });
      const payment = await database.client.payment.findUniqueOrThrow({
        where: { id: persisted.settlement!.additionalPaymentId! },
      });
      expect(persisted.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING);
      expect(persisted.holds[0]).toMatchObject({
        status: 'ACTIVE',
        occupancy: expect.objectContaining({ active: true }),
      });
      expect(payment.status).toBe(
        providerOutcome === 'UNKNOWN' ? PaymentStatus.AUTHORIZING : PaymentStatus.CAPTURED,
      );
      authorize.mockRestore();
    },
    30_000,
  );

  it('recovers a provider-captured amendment payment after local finalization failure', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `recover-payment-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `recover-accept-${randomUUID()}`).expect(201);
    await database.client.financialAccount.updateMany({
      data: { active: false },
      where: {
        currency: reviewed.body.data.financial.currency,
        type: { in: ['PAYMENT_PROVIDER_RECEIVABLE', 'CUSTOMER_FUNDS_HELD'] },
      },
    });
    try {
      await payAmendment(renter.token, amendmentId, `recover-initiate-${randomUUID()}`).expect(500);
    } finally {
      await database.client.financialAccount.updateMany({
        data: { active: true },
        where: {
          currency: reviewed.body.data.financial.currency,
          type: { in: ['PAYMENT_PROVIDER_RECEIVABLE', 'CUSTOMER_FUNDS_HELD'] },
        },
      });
    }
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { settlement: true },
      where: { id: amendmentId },
    });
    const paymentId = amendment.settlement!.additionalPaymentId!;
    const captureOperation = await database.client.paymentOperation.findFirstOrThrow({
      where: { paymentId, type: PaymentOperationType.CAPTURE },
    });
    expect(captureOperation.status).toBe(PaymentOperationStatus.PROCESSING);
    expect(
      await database.client.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ).toMatchObject({ capturedAt: null, status: PaymentStatus.CAPTURING });
    await paymentsService.reconcilePayment(paymentId, { correlationId: `recover:${amendmentId}` });
    expect(
      await database.client.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    ).toMatchObject({
      capturedAmountMinor: BigInt(reviewed.body.data.financial.additionalPaymentMinor),
      reconciliationRequired: false,
      status: PaymentStatus.CAPTURED,
    });
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: paymentId,
          sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT',
          type: 'CAPTURE_RECOGNITION',
        },
      }),
    ).toBe(1);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: true },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      holds: [expect.objectContaining({ status: 'ACTIVE' })],
    });
  });

  it('accepts and declines legitimate zero-hold amendments without inventing inventory', async () => {
    const processingPreview = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const processing = await submit(
      renter.token,
      processingPreview.body.data.previewToken,
      `zero-hold-processing-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: processing.body.data.amendmentId },
      }),
    ).toBe(0);
    await ownerAccept(
      owner.token,
      processing.body.data.amendmentId,
      `zero-hold-processing-accept-${randomUUID()}`,
    )
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING),
      );

    await createBookingFixture();
    const additionalPaymentPreview = await preview(renter.token, {
      proposedDeliveryDestination: {
        city: 'Makati City',
        country: 'PH',
        latitude: 14.5547,
        longitude: 121.0244,
        province: 'Metro Manila',
      },
      proposedStartMethod: 'OWNER_DELIVERY',
    }).expect(201);
    expect(
      BigInt(additionalPaymentPreview.body.data.financial.additionalPaymentMinor),
    ).toBeGreaterThan(0n);
    const additionalPayment = await submit(
      renter.token,
      additionalPaymentPreview.body.data.previewToken,
      `zero-hold-payment-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: additionalPayment.body.data.amendmentId },
      }),
    ).toBe(0);
    await ownerAccept(
      owner.token,
      additionalPayment.body.data.amendmentId,
      `zero-hold-payment-accept-${randomUUID()}`,
    )
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING),
      );

    await createBookingFixture(BookingStatus.CONFIRMED, true);
    const paymentPreview = await preview(renter.token, {
      proposedDeliveryDestination: null,
      proposedStartMethod: 'RENTER_PICKUP',
    }).expect(201);
    expect(BigInt(paymentPreview.body.data.financial.additionalPaymentMinor)).toBe(0n);
    expect(BigInt(paymentPreview.body.data.financial.expectedRefundMinor)).toBeGreaterThan(0n);
    const refundable = await submit(
      renter.token,
      paymentPreview.body.data.previewToken,
      `zero-hold-refund-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: refundable.body.data.amendmentId },
      }),
    ).toBe(0);
    await ownerAccept(
      owner.token,
      refundable.body.data.amendmentId,
      `zero-hold-refund-accept-${randomUUID()}`,
    )
      .expect(201)
      .expect(({ body }) =>
        expect(body.data.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING),
      );

    await createBookingFixture();
    const declinePreview = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const declined = await submit(
      renter.token,
      declinePreview.body.data.previewToken,
      `zero-hold-decline-${randomUUID()}`,
    ).expect(201);
    expect(
      await database.client.bookingAmendmentHold.count({
        where: { amendmentId: declined.body.data.amendmentId },
      }),
    ).toBe(0);
    await ownerDecline(
      owner.token,
      declined.body.data.amendmentId,
      `zero-hold-decline-decision-${randomUUID()}`,
      'OWNER_SCHEDULE_CONFLICT',
    ).expect(201);
  });

  it('fails closed when required submitted hold authority is no longer active', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const missingHold = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `missing-hold-${randomUUID()}`,
    ).expect(201);
    await database.client.$queryRaw(Prisma.sql`
      SELECT "release_booking_amendment_holds"(
        ${missingHold.body.data.amendmentId}::uuid,
        'RELEASED'::"BookingAmendmentHoldStatus",
        'TEST_MISSING_HOLD_AUTHORITY'
      )
    `);
    await ownerAccept(
      owner.token,
      missingHold.body.data.amendmentId,
      `missing-hold-accept-${randomUUID()}`,
    )
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BOOKING_INVALID_STATE'));
  });

  it.each([
    ['before', -1, BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING],
    ['exactly', 0, BookingAmendmentStatus.EXPIRED],
    ['after', 1, BookingAmendmentStatus.EXPIRED],
  ] as const)(
    'uses deterministic Owner decision semantics %s expiresAt',
    async (_label, offsetMilliseconds, expectedStatus) => {
      const reviewed = await preview(renter.token, {
        proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
      }).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `deadline-${offsetMilliseconds}-${randomUUID()}`,
      ).expect(201);
      const deadline = new Date(Date.now() + 60_000);
      await setOwnerDeadline(submitted.body.data.amendmentId, deadline);
      const decision = amendmentDecisions.accept(
        owner.userId,
        reference,
        submitted.body.data.amendmentId,
        `deadline-decision-${offsetMilliseconds}-${randomUUID()}`,
        {},
        new Date(deadline.getTime() + offsetMilliseconds),
      );
      if (expectedStatus === BookingAmendmentStatus.EXPIRED)
        await expect(decision).rejects.toThrow();
      else await expect(decision).resolves.toMatchObject({ status: expectedStatus });
      expect(
        await database.client.bookingAmendment.findUniqueOrThrow({
          where: { id: submitted.body.data.amendmentId },
        }),
      ).toMatchObject({ status: expectedStatus });
    },
  );

  it.each([
    BookingAmendmentStatus.PENDING_OWNER,
    BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
    BookingAmendmentStatus.DECLINED,
    BookingAmendmentStatus.WITHDRAWN,
    BookingAmendmentStatus.EXPIRED,
  ])('keeps Owner detail reviewable but actionable only when pending for %s', async (status) => {
    const reviewed = await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `owner-projection-${status}-${randomUUID()}`,
    ).expect(201);
    const paymentDeadlineAt =
      status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
        ? new Date(Date.now() + 10 * 60_000)
        : null;
    const acceptedAt =
      status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING ? new Date() : null;
    await database.client.bookingAmendment.update({
      data: { acceptedAt, paymentDeadlineAt, status },
      where: { id: submitted.body.data.amendmentId },
    });
    await ownerAmendmentDetail(owner.token, submitted.body.data.amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          actionable: status === BookingAmendmentStatus.PENDING_OWNER,
          paymentDeadlineAt: paymentDeadlineAt?.toISOString() ?? null,
          status,
        });
        expect(body.data.current).toBeDefined();
        expect(body.data.proposed).toBeDefined();
        expect(body.data.financial).toMatchObject({
          currentOwnerEarningsMinor: expect.any(String),
          ownerEarningsDeltaMinor: expect.any(String),
          proposedOwnerEarningsMinor: expect.any(String),
        });
      });
  });

  it('keeps processing holds active beyond the old Owner deadline', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `processing-hold-submit-${randomUUID()}`,
    ).expect(201);
    await database.client.bookingAmendmentSettlement.update({
      data: {
        direction: 'NONE',
        financialDeltaMinor: 0n,
        proposedTotalMinor: reviewed.body.data.current.totalMinor,
      },
      where: { amendmentId: submitted.body.data.amendmentId },
    });
    await ownerAccept(
      owner.token,
      submitted.body.data.amendmentId,
      `processing-hold-accept-${randomUUID()}`,
    ).expect(201);
    const past = new Date(Date.now() - 60_000);
    const hold = await database.client.bookingAmendmentHold.findFirstOrThrow({
      where: { amendmentId: submitted.body.data.amendmentId },
    });
    await database.client.vehicleOccupancy.update({
      data: { expiresAt: past },
      where: { id: hold.occupancyId },
    });
    await database.client.bookingAmendmentHold.update({
      data: { expiresAt: past },
      where: { id: hold.id },
    });
    await database.client.bookingAmendment.update({
      data: { expiresAt: past },
      where: { id: submitted.body.data.amendmentId },
    });
    await expireAmendments();
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } } },
      where: { id: submitted.body.data.amendmentId },
    });
    expect(persisted.status).toBe(BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING);
    expect(persisted.holds[0]).toMatchObject({ status: 'ACTIVE' });
    expect(persisted.holds[0]?.occupancy.active).toBe(true);
  });

  it('declines atomically, releases amendment-only inventory, and replays without penalty', async () => {
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `decline-submit-${randomUUID()}`,
    ).expect(201);
    const key = `decline-${randomUUID()}`;
    const first = await ownerDecline(
      owner.token,
      submitted.body.data.amendmentId,
      key,
      'OWNER_SCHEDULE_CONFLICT',
    ).expect(201);
    await ownerDecline(owner.token, submitted.body.data.amendmentId, key, 'OWNER_SCHEDULE_CONFLICT')
      .expect(201)
      .expect(({ body }) => expect(body.data).toEqual(first.body.data));
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, statusHistory: true },
      where: { id: submitted.body.data.amendmentId },
    });
    expect(persisted.status).toBe(BookingAmendmentStatus.DECLINED);
    expect(persisted.holds[0]).toMatchObject({ status: 'RELEASED' });
    expect(persisted.holds[0]?.occupancy.active).toBe(false);
    expect(persisted.statusHistory.filter((item) => item.toStatus === 'DECLINED')).toHaveLength(1);
    expect(
      await database.client.ownerFinancialObligation.count({ where: { ownerProfileId } }),
    ).toBe(0);
    await renterAmendmentDetail(renter.token, submitted.body.data.amendmentId)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          bookingAlreadyApplied: false,
          paymentDeadlineAt: null,
          status: BookingAmendmentStatus.DECLINED,
        });
        expect(body.data).not.toHaveProperty('reasonCode');
      });
    await renterAmendmentDetail(unrelatedRenter.token, submitted.body.data.amendmentId).expect(404);
  });

  it('allows only one terminal Owner decision when accept and decline race', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `decision-race-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId;

    const [accepted, declined] = await Promise.all([
      ownerAccept(owner.token, amendmentId, `decision-race-accept-${randomUUID()}`),
      ownerDecline(
        owner.token,
        amendmentId,
        `decision-race-decline-${randomUUID()}`,
        'OWNER_SCHEDULE_CONFLICT',
      ),
    ]);

    expect([accepted.status, declined.status].sort()).toEqual([201, 409]);
    const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, statusHistory: true },
      where: { id: amendmentId },
    });
    expect([
      BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      BookingAmendmentStatus.DECLINED,
    ]).toContain(persisted.status);
    expect(
      persisted.statusHistory.filter(({ toStatus }) =>
        ['OWNER_ACCEPTED_PAYMENT_PENDING', 'DECLINED'].includes(toStatus),
      ),
    ).toHaveLength(1);
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: bookingId,
          eventType: { in: ['BOOKING_AMENDMENT_ACCEPTED', 'BOOKING_AMENDMENT_DECLINED'] },
        },
      }),
    ).toBe(1);
    expect(persisted.holds).toHaveLength(1);
    expect(persisted.holds[0]?.status).toBe(
      persisted.status === BookingAmendmentStatus.DECLINED ? 'RELEASED' : 'ACTIVE',
    );
    expect(persisted.holds[0]?.occupancy.active).toBe(
      persisted.status !== BookingAmendmentStatus.DECLINED,
    );
  });

  it.each([
    ['payment Accept', 'accept', 'PAYMENT'],
    ['processing Accept', 'accept', 'PROCESSING'],
    ['Decline', 'decline', 'PAYMENT'],
  ] as const)(
    'allows only one winner when Owner %s races renter withdrawal',
    async (_label, decision, outcome) => {
      const proposal =
        outcome === 'PROCESSING'
          ? {
              proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
              proposedReturnAt: new Date(rentalEnd.getTime() + 30 * 60_000).toISOString(),
            }
          : { proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString() };
      const reviewed = await preview(renter.token, proposal).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `${decision}-withdraw-race-submit-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId;
      const [decided, withdrawn] = await raceBehindAmendmentTableLock(
        () =>
          decision === 'accept'
            ? ownerAccept(owner.token, amendmentId, `${decision}-withdraw-race-${randomUUID()}`)
            : ownerDecline(
                owner.token,
                amendmentId,
                `${decision}-withdraw-race-${randomUUID()}`,
                'OWNER_SCHEDULE_CONFLICT',
              ),
        () => withdraw(renter.token, amendmentId),
      );

      expect([decided.status, withdrawn.status].sort()).toEqual([201, 409]);
      const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } }, statusHistory: true },
        where: { id: amendmentId },
      });
      expect([
        BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
        BookingAmendmentStatus.DECLINED,
        BookingAmendmentStatus.WITHDRAWN,
      ]).toContain(persisted.status);
      expect(
        persisted.statusHistory.filter(({ toStatus }) =>
          [
            'OWNER_ACCEPTED_PROCESSING',
            'OWNER_ACCEPTED_PAYMENT_PENDING',
            'DECLINED',
            'WITHDRAWN',
          ].includes(toStatus),
        ),
      ).toHaveLength(1);
      const holdsRemain =
        persisted.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING ||
        persisted.status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING;
      expect(persisted.holds[0]?.status).toBe(holdsRemain ? 'ACTIVE' : 'RELEASED');
      expect(persisted.holds[0]?.occupancy.active).toBe(holdsRemain);
    },
  );

  it.each([
    ['additional payment', 'ADDITIONAL_PAYMENT'],
    ['processing', 'PROCESSING'],
  ] as const)(
    'serializes %s Accept against natural expiry',
    async (_label, outcome) => {
      const proposedReturnAt = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
      const proposal =
        outcome === 'PROCESSING'
          ? {
              proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
              proposedReturnAt: new Date(rentalEnd.getTime() + 30 * 60_000).toISOString(),
            }
          : { proposedReturnAt };
      const reviewed = await preview(renter.token, proposal).expect(201);
      if (outcome === 'ADDITIONAL_PAYMENT')
        expect(BigInt(reviewed.body.data.financial.additionalPaymentMinor)).toBeGreaterThan(0n);
      else {
        expect(BigInt(reviewed.body.data.financial.additionalPaymentMinor)).toBe(0n);
        expect(BigInt(reviewed.body.data.financial.expectedRefundMinor)).toBe(0n);
      }
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `accept-expiry-${outcome}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId;
      const deadline = new Date(Date.now() + 2_000);
      await setOwnerDeadline(amendmentId, deadline);
      const original = await raceConservationSnapshot();

      const [accepted, expired] = await raceAcceptAgainstExpiry(amendmentId, deadline);
      expect([201, 409]).toContain(accepted.status);
      expect(expired).toBeGreaterThanOrEqual(0);
      expect(accepted.status).not.toBe(500);
      const persisted = await raceAmendment(amendmentId);
      const acceptedStatus =
        outcome === 'ADDITIONAL_PAYMENT'
          ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
          : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING;
      expect([acceptedStatus, BookingAmendmentStatus.EXPIRED]).toContain(persisted.status);
      expect(accepted.status === 201).toBe(persisted.status === acceptedStatus);
      await assertRaceWinner(persisted, persisted.status);
      if (persisted.status === acceptedStatus) {
        expect(persisted.acceptedAt).not.toBeNull();
        expect(persisted.paymentDeadlineAt === null).toBe(outcome === 'PROCESSING');
        expect(persisted.holds.every((hold) => hold.status === 'ACTIVE')).toBe(true);
        expect(persisted.holds.every((hold) => hold.occupancy.active)).toBe(true);
        if (outcome === 'ADDITIONAL_PAYMENT')
          expect(
            persisted.holds.every(
              (hold) =>
                hold.expiresAt.getTime() === persisted.paymentDeadlineAt?.getTime() &&
                hold.occupancy.expiresAt?.getTime() === persisted.paymentDeadlineAt?.getTime(),
            ),
          ).toBe(true);
        await expireAmendments();
        expect((await raceAmendment(amendmentId)).status).toBe(acceptedStatus);
      } else {
        expect(persisted.holds.every((hold) => hold.status === 'EXPIRED')).toBe(true);
        expect(persisted.holds.every((hold) => !hold.occupancy.active)).toBe(true);
        await ownerAccept(owner.token, amendmentId, `post-expiry-${randomUUID()}`).expect(409);
      }
      expect(await raceConservationSnapshot()).toEqual(original);
    },
    15_000,
  );

  it('serializes Decline against natural expiry', async () => {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `decline-expiry-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId;
    const deadline = new Date(Date.now() + 2_000);
    await setOwnerDeadline(amendmentId, deadline);
    const original = await raceConservationSnapshot();
    const [declined, expired] = await raceDecisionAgainstExpiry(
      () =>
        ownerDecline(
          owner.token,
          amendmentId,
          `decline-expiry-${randomUUID()}`,
          'OWNER_SCHEDULE_CONFLICT',
        ),
      deadline,
    );
    expect([201, 409]).toContain(declined.status);
    expect(expired).toBeGreaterThanOrEqual(0);
    expect(declined.status).not.toBe(500);
    const persisted = await raceAmendment(amendmentId);
    expect([BookingAmendmentStatus.DECLINED, BookingAmendmentStatus.EXPIRED]).toContain(
      persisted.status,
    );
    expect(declined.status === 201).toBe(persisted.status === BookingAmendmentStatus.DECLINED);
    await assertRaceWinner(persisted, persisted.status);
    expect(persisted.holds.every((hold) => hold.status !== 'ACTIVE')).toBe(true);
    expect(persisted.holds.every((hold) => !hold.occupancy.active)).toBe(true);
    expect(persisted.holds.every((hold) => hold.releasedAt !== null)).toBe(true);
    expect(await raceConservationSnapshot()).toEqual(original);
  }, 15_000);

  it.each([
    ['additional payment', 'ADDITIONAL_PAYMENT'],
    ['processing', 'PROCESSING'],
  ] as const)(
    'serializes %s Accept against Decline',
    async (_label, outcome) => {
      const proposal =
        outcome === 'PROCESSING'
          ? {
              proposedPickupAt: new Date(rentalStart.getTime() + 30 * 60_000).toISOString(),
              proposedReturnAt: new Date(rentalEnd.getTime() + 30 * 60_000).toISOString(),
            }
          : { proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString() };
      const reviewed = await preview(renter.token, proposal).expect(201);
      const submitted = await submit(
        renter.token,
        reviewed.body.data.previewToken,
        `accept-decline-${outcome}-${randomUUID()}`,
      ).expect(201);
      const amendmentId = submitted.body.data.amendmentId;
      const original = await raceConservationSnapshot();
      const [accepted, declined] = await raceBehindAmendmentTableLock(
        () => ownerAccept(owner.token, amendmentId, `accept-race-${randomUUID()}`),
        () =>
          ownerDecline(
            owner.token,
            amendmentId,
            `decline-race-${randomUUID()}`,
            'OWNER_SCHEDULE_CONFLICT',
          ),
      );
      expect([accepted.status, declined.status].sort()).toEqual([201, 409]);
      const persisted = await raceAmendment(amendmentId);
      const acceptedStatus =
        outcome === 'ADDITIONAL_PAYMENT'
          ? BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING
          : BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING;
      expect([acceptedStatus, BookingAmendmentStatus.DECLINED]).toContain(persisted.status);
      await assertRaceWinner(persisted, persisted.status);
      const holdsRemain = persisted.status === acceptedStatus;
      expect(
        persisted.holds.every((hold) => hold.status === (holdsRemain ? 'ACTIVE' : 'RELEASED')),
      ).toBe(true);
      expect(persisted.holds.every((hold) => hold.occupancy.active === holdsRemain)).toBe(true);
      expect(persisted.paymentDeadlineAt === null).toBe(
        persisted.status !== BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      );
      expect(await raceConservationSnapshot()).toEqual(original);
    },
    15_000,
  );

  it('previews, submits, charges, and atomically applies a real ACTIVE extension', async () => {
    await activateCurrentBooking();
    const oldEnd = rentalEnd;
    const proposedEnd = new Date(oldEnd.getTime() + 24 * 60 * 60_000);
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    expect(reviewed.body.data).toMatchObject({
      current: { rentalEnd: oldEnd.toISOString(), rentalStart: rentalStart.toISOString() },
      proposed: { chargeableDays: 3, rentalEnd: proposedEnd.toISOString() },
      warnings: expect.arrayContaining(['ADDITIONAL_PAYMENT_REQUIRED']),
    });
    expect(BigInt(reviewed.body.data.financial.expectedRefundMinor)).toBe(0n);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `active-paid-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    const pending = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } } },
      where: { id: amendmentId },
    });
    expect(pending.scope).toBe('ACTIVE_EXTENSION');
    expect(pending.holds).toEqual([
      expect.objectContaining({
        protectedStart: new Date(oldEnd.getTime() + 120 * 60_000),
        status: 'ACTIVE',
        occupancy: expect.objectContaining({ active: true, type: 'AMENDMENT_HOLD' }),
      }),
    ]);
    await ownerAccept(owner.token, amendmentId, `active-paid-accept-${randomUUID()}`).expect(201);
    await paymentsService.payBookingAmendment(renter.userId, reference, amendmentId, {
      correlationId: `active-paid-capture-${randomUUID()}`,
    });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd: oldEnd, status: BookingStatus.ACTIVE });

    const applied = await applyPaidBookingAmendment(database.client, amendmentId);
    const retry = await applyPaidBookingAmendment(database.client, amendmentId);
    expect(retry).toEqual(applied);
    const booking = await database.client.booking.findUniqueOrThrow({
      include: { occupancy: true, ownerEarning: true },
      where: { id: bookingId },
    });
    expect(booking).toMatchObject({
      actualPickupAt: expect.any(Date),
      rentalEnd: proposedEnd,
      rentalStart,
      status: BookingStatus.ACTIVE,
      occupancy: expect.objectContaining({
        active: true,
        occupiedEnd: new Date(proposedEnd.getTime() + 120 * 60_000),
      }),
    });
    expect(booking.ownerEarning!.adjustmentAmountMinor).toBeGreaterThan(0n);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } }, settlement: true },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: expect.any(Date),
      status: BookingAmendmentStatus.APPLIED,
      settlement: { status: 'COMPLETED' },
      holds: [
        expect.objectContaining({
          status: 'CONVERTED',
          occupancy: expect.objectContaining({ active: false }),
        }),
      ],
    });
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: amendmentId, type: LedgerTransactionType.CAPTURE_ALLOCATION },
      }),
    ).toBe(1);
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-applied-return-${randomUUID()}`,
    });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd: proposedEnd, status: BookingStatus.RETURN_PENDING });
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
  }, 60_000);

  it('applies a ZERO_DELTA ACTIVE extension without provider movement and supports a sequential preview', async () => {
    const originalEnd = rentalEnd;
    rentalEnd = new Date(originalEnd.getTime() - 60 * 60_000);
    await database.client.$transaction([
      database.client.booking.update({ data: { rentalEnd }, where: { id: bookingId } }),
      database.client.vehicleOccupancy.update({
        data: { occupiedEnd: new Date(rentalEnd.getTime() + 120 * 60_000) },
        where: { bookingId },
      }),
    ]);
    await activateCurrentBooking();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: originalEnd.toISOString(),
    }).expect(201);
    expect(reviewed.body.data.financial).toMatchObject({
      additionalPaymentMinor: '0',
      expectedRefundMinor: '0',
    });
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `active-zero-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `active-zero-accept-${randomUUID()}`).expect(201);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({
      scope: 'ACTIVE_EXTENSION',
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
    });
    const providerPaymentsBefore = await database.client.payment.count({ where: { bookingId } });
    await applyZeroDeltaBookingAmendment(database.client, amendmentId);
    expect(await database.client.payment.count({ where: { bookingId } })).toBe(
      providerPaymentsBefore,
    );
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd: originalEnd, status: BookingStatus.ACTIVE });
    const sequentialEnd = new Date(originalEnd.getTime() + 24 * 60 * 60_000);
    const sequential = await preview(renter.token, {
      proposedReturnAt: sequentialEnd.toISOString(),
    }).expect(201);
    expect(sequential.body.data.current.rentalEnd).toBe(originalEnd.toISOString());
    expect(sequential.body.data.proposed.rentalEnd).toBe(sequentialEnd.toISOString());
  }, 60_000);

  it('rejects ACTIVE shortening and pickup or fulfillment rewrites', async () => {
    await activateCurrentBooking();
    await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() - 60_000).toISOString(),
    }).expect(422);
    await preview(renter.token, {
      proposedPickupAt: new Date(rentalStart.getTime() + 60_000).toISOString(),
      proposedReturnAt: new Date(rentalEnd.getTime() + 60_000).toISOString(),
    }).expect(422);
    await preview(renter.token, {
      proposedEndMethod: 'OWNER_COLLECTION',
      proposedReturnAt: new Date(rentalEnd.getTime() + 60_000).toISOString(),
    }).expect(422);
  });

  it('rolls back a captured ACTIVE application and retries exactly once', async () => {
    await activateCurrentBooking();
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const { amendmentId } = await createCapturedPaidAmendment(proposedEnd);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({
      scope: 'ACTIVE_EXTENSION',
      status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
    });
    await expect(
      applyPaidBookingAmendment(database.client, amendmentId, {
        failurePoint: 'AFTER_FINANCIAL_APPLICATION',
      }),
    ).rejects.toMatchObject({ code: 'APPLICATION_FAILURE_INJECTED' });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd, status: BookingStatus.ACTIVE });
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } } },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      holds: [
        expect.objectContaining({
          status: 'ACTIVE',
          occupancy: expect.objectContaining({ active: true }),
        }),
      ],
    });
    await applyPaidBookingAmendment(database.client, amendmentId);
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd: proposedEnd, status: BookingStatus.ACTIVE });
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: amendmentId, type: LedgerTransactionType.CAPTURE_ALLOCATION },
      }),
    ).toBe(1);
  }, 60_000);

  it('serializes real ACTIVE application ahead of return and preserves the extended authority', async () => {
    await activateCurrentBooking();
    const proposedEnd = new Date(rentalEnd.getTime() + 24 * 60 * 60_000);
    const { amendmentId } = await createCapturedPaidAmendment(proposedEnd);
    const [application, returning] = await raceBehindBookingTableLock(
      () => applyPaidBookingAmendment(database.client, amendmentId),
      () =>
        rentalsService.initiateReturn(renter.userId, reference, {
          correlationId: `active-application-first-${randomUUID()}`,
        }),
    );
    expect(application).toMatchObject({ rentalEnd: proposedEnd, status: 'APPLIED' });
    expect(returning).toBeDefined();
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd: proposedEnd, status: BookingStatus.RETURN_PENDING });
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ appliedAt: expect.any(Date), status: BookingAmendmentStatus.APPLIED });
    expect(await database.client.refund.count({ where: { payment: { bookingId } } })).toBe(0);
  }, 60_000);

  it('rejects an ACTIVE extension whose net-new buffered interval conflicts with canonical inventory', async () => {
    await activateCurrentBooking();
    const blocker = await database.client.vehicleOccupancy.create({
      data: {
        active: true,
        occupiedEnd: new Date(rentalEnd.getTime() + 8 * 60 * 60_000),
        occupiedStart: new Date(rentalEnd.getTime() + 4 * 60 * 60_000),
        type: VehicleOccupancyType.OWNER_BLOCK,
        vehicleId,
      },
    });
    await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 6 * 60 * 60_000).toISOString(),
    }).expect(409);
    await database.client.vehicleOccupancy.delete({ where: { id: blocker.id } });
  });

  it('makes a return-first PENDING_OWNER ACTIVE extension permanently non-actionable', async () => {
    await activateCurrentBooking();
    const reviewed = await preview(renter.token, {
      proposedReturnAt: new Date(rentalEnd.getTime() + 24 * 60 * 60_000).toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `active-return-before-owner-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-return-before-owner-${amendmentId}`,
    });
    await ownerAccept(owner.token, amendmentId, `active-late-owner-${randomUUID()}`).expect(409);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({
        include: { holds: { include: { occupancy: true } } },
        where: { id: amendmentId },
      }),
    ).toMatchObject({
      appliedAt: null,
      reasonCode: 'ACTIVE_EXTENSION_RETURN_BEFORE_CAPTURE',
      status: BookingAmendmentStatus.FAILED,
      holds: [
        expect.objectContaining({
          status: 'RELEASED',
          occupancy: expect.objectContaining({ active: false }),
        }),
      ],
    });
  }, 60_000);

  it('serializes captured ACTIVE-extension recovery before return and settles it exactly once', async () => {
    const { amendmentId } = await createCapturedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    await promoteFixtureToActiveExtension(amendmentId);
    const before = await recoveryConservationSnapshot(amendmentId);
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-return-capture-first:${amendmentId}`,
    });
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-return-capture-first-retry:${amendmentId}`,
    });
    const recovering = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, settlement: true, statusHistory: true },
      where: { id: amendmentId },
    });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd, status: BookingStatus.RETURN_PENDING });
    expect(recovering).toMatchObject({
      appliedAt: null,
      reasonCode: 'ACTIVE_EXTENSION_CAPTURE_RECOVERY',
      scope: 'ACTIVE_EXTENSION',
      status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    });
    expect(recovering.holds).toEqual([
      expect.objectContaining({
        releaseReason: 'ACTIVE_EXTENSION_CAPTURE_RECOVERY',
        releasedAt: expect.any(Date),
        status: 'RELEASED',
        occupancy: expect.objectContaining({ active: false }),
      }),
    ]);
    expect(
      recovering.statusHistory.filter(
        ({ toStatus }) => toStatus === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
      ),
    ).toHaveLength(1);
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: bookingId,
          eventType: 'BOOKING_AMENDMENT_ACTIVE_EXTENSION_RECOVERY_PENDING',
        },
      }),
    ).toBe(1);

    const fake = paymentProvider as FakePaymentProvider;
    fake.setOutcome('succeed');
    const first = await executeBookingAmendmentRefund(
      database.client,
      paymentProvider,
      amendmentId,
      { unknownGraceMinutes: 60 },
    );
    expect(first.outcome).toBe('COMPLETED');
    expect(await findRecoverableBookingAmendmentRefunds(database.client)).not.toContain(
      amendmentId,
    );
    const after = await recoveryConservationSnapshot(amendmentId);
    expect(after.payment).toMatchObject({
      refundedAmountMinor: after.payment.capturedAmountMinor,
      status: PaymentStatus.REFUNDED,
    });
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({ status: RefundStatus.COMPLETED });
    expect(after.ownerEarning).toEqual(before.ownerEarning);
    expect(after.commissionSnapshot).toEqual(before.commissionSnapshot);
    expect(after.captureAllocations).toBe(0);
    expect(after.payoutItems).toBe(0);
    expect(after.recoveryObligations).toBe(1);
    expect(after.refundSettlements).toBe(1);
    expect(after.ledgerBalance).toEqual({
      CUSTOMER_FUNDS_HELD: 0n,
      PAYMENT_PROVIDER_RECEIVABLE: 0n,
      REFUND_PAYABLE: 0n,
    });
  }, 60_000);

  it('serializes return before provider capture and recovers the late capture without applying', async () => {
    const amendmentId = await createAcceptedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    await promoteFixtureToActiveExtension(amendmentId);
    const inFlight = await createInFlightAmendmentPayment(amendmentId);
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-extension-return-first:${amendmentId}`,
    });
    await database.client.$transaction((transaction) =>
      finalizeBookingAmendmentPaymentCapture(transaction, {
        correlationId: `late-capture:${amendmentId}`,
        externalOperationId: `capture-${randomUUID()}`,
        operationId: inFlight.operationId,
        paymentId: inFlight.paymentId,
        providerState: 'CAPTURED',
      }),
    );
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { holds: { include: { occupancy: true } }, settlement: true },
      where: { id: amendmentId },
    });
    const payment = await database.client.payment.findUniqueOrThrow({
      where: { id: amendment.settlement!.additionalPaymentId! },
    });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd, status: BookingStatus.RETURN_PENDING });
    expect(amendment).toMatchObject({
      appliedAt: null,
      reasonCode: 'ACTIVE_EXTENSION_CAPTURE_RECOVERY',
      status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    });
    expect(amendment.holds[0]).toMatchObject({
      releasedAt: expect.any(Date),
      status: 'RELEASED',
      occupancy: expect.objectContaining({ active: false }),
    });
    expect(payment.status).toBe(PaymentStatus.CAPTURED);
    expect(await isBookingAmendmentReadyForPaidApplication(database.client, amendmentId)).toBe(
      false,
    );
    await expect(applyPaidBookingAmendment(database.client, amendmentId)).rejects.toMatchObject({
      code: 'AMENDMENT_NOT_APPLICABLE',
    });
  }, 60_000);

  it('serializes ACTIVE-extension application eligibility ahead of return without fabricating application', async () => {
    const { amendmentId } = await createCapturedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    await promoteFixtureToActiveExtension(amendmentId);
    let releaseEligibility!: () => void;
    let signalEligibility!: (eligible: boolean) => void;
    const eligibilityObserved = new Promise<boolean>((resolve) => (signalEligibility = resolve));
    const eligibilityReleased = new Promise<void>((resolve) => (releaseEligibility = resolve));
    const eligibility = raceLocker.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${amendmentId}::uuid FOR UPDATE`,
      );
      signalEligibility(
        await isBookingAmendmentReadyForPaidApplication(transaction as never, amendmentId),
      );
      await eligibilityReleased;
    });
    expect(await eligibilityObserved).toBe(true);
    const returning = rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-extension-eligibility-first:${amendmentId}`,
    });
    await waitForBlockedDatabaseOperations(1);
    expect(
      await raceObserver.booking.findUniqueOrThrow({
        select: { status: true },
        where: { id: bookingId },
      }),
    ).toMatchObject({ status: BookingStatus.ACTIVE });
    releaseEligibility();
    await Promise.all([eligibility, returning]);
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({
      appliedAt: null,
      status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
    });
  }, 60_000);

  it.each(['unknown', 'decline'] as const)(
    'persists ACTIVE-extension recovery refund provider %s without operational application',
    async (outcome) => {
      const { amendmentId } = await createCapturedPaidAmendment(
        new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
      );
      await promoteFixtureToActiveExtension(amendmentId);
      await rentalsService.initiateReturn(renter.userId, reference, {
        correlationId: `active-extension-${outcome}:${amendmentId}`,
      });
      const fake = paymentProvider as FakePaymentProvider;
      fake.setOutcome(outcome);
      const result = await executeBookingAmendmentRefund(
        database.client,
        paymentProvider,
        amendmentId,
        { unknownGraceMinutes: 60 },
      );
      expect(result.outcome).toBe(outcome === 'unknown' ? 'UNKNOWN' : 'DEFINITIVE_FAILURE');
      const persisted = await database.client.bookingAmendment.findUniqueOrThrow({
        include: { settlement: { include: { refund: { include: { operation: true } } } } },
        where: { id: amendmentId },
      });
      expect(persisted).toMatchObject({
        appliedAt: null,
        status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
        settlement: {
          reconciliationRequired: true,
          status: 'RECONCILIATION_REQUIRED',
          refund: {
            status: outcome === 'unknown' ? RefundStatus.PROCESSING : RefundStatus.FAILED,
            operation: {
              status:
                outcome === 'unknown'
                  ? PaymentOperationStatus.UNKNOWN
                  : PaymentOperationStatus.FAILED,
            },
          },
        },
      });
      expect(
        await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
      ).toMatchObject({ status: BookingStatus.RETURN_PENDING });
      expect(
        await database.client.ledgerTransaction.count({
          where: { sourceId: amendmentId, type: LedgerTransactionType.CAPTURE_ALLOCATION },
        }),
      ).toBe(0);
      fake.setOutcome('succeed');
    },
    60_000,
  );

  it('manually resolves ACTIVE-extension UNKNOWN evidence idempotently without reviving extension', async () => {
    const { amendmentId } = await createCapturedPaidAmendment(
      new Date(rentalEnd.getTime() + 24 * 60 * 60_000),
    );
    await promoteFixtureToActiveExtension(amendmentId);
    await rentalsService.initiateReturn(renter.userId, reference, {
      correlationId: `active-extension-manual:${amendmentId}`,
    });
    const fake = paymentProvider as FakePaymentProvider;
    fake.setOutcome('unknown');
    await executeBookingAmendmentRefund(database.client, paymentProvider, amendmentId, {
      unknownGraceMinutes: 60,
    });
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { settlement: { include: { refund: true } } },
      where: { id: amendmentId },
    });
    const settlement = amendment.settlement!;
    const refund = settlement.refund!;
    const evidence = {
      actorType: BookingActorType.ADMIN,
      actorUserId: owner.userId,
      amendmentId,
      amendmentSettlementId: settlement.id,
      currency: settlement.currency,
      evidenceAt: new Date(),
      evidenceType: AmendmentRefundEvidenceType.PROVIDER_SUPPORT_CONFIRMATION,
      externalReference: `manual-active-extension-${amendmentId}`,
      idempotencyKey: `manual-active-extension-${amendmentId}`,
      originalPaymentId: refund.paymentId,
      outcome: AmendmentRefundEvidenceOutcome.SUCCEEDED,
      provider: PaymentProviderCode.FAKE,
      refundId: refund.id,
      resolutionNote: 'Provider confirmed the extension refund.',
      resolvedAmountMinor: refund.amountMinor,
    } as const;
    const first = await resolveAmendmentRefundManually(database.client, evidence);
    const retry = await resolveAmendmentRefundManually(database.client, evidence);
    expect(retry).toEqual(first);
    await expect(
      resolveAmendmentRefundManually(database.client, {
        ...evidence,
        externalReference: `${evidence.externalReference}-conflict`,
      }),
    ).rejects.toThrow('AMENDMENT_REFUND_EVIDENCE_IDEMPOTENCY_CONFLICT');
    expect(
      await database.client.bookingAmendment.findUniqueOrThrow({ where: { id: amendmentId } }),
    ).toMatchObject({ appliedAt: null, status: BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING });
    expect(
      await database.client.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    ).toMatchObject({ rentalEnd, status: BookingStatus.RETURN_PENDING });
    fake.setOutcome('succeed');
  }, 60_000);

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

  function payAmendment(token: string, amendmentReference: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments/${amendmentReference}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({});
  }

  function refundAmendment(token: string, amendmentReference: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/amendments/${amendmentReference}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
  }

  async function createCapturedPaidAmendment(proposedEnd: Date) {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `captured-paid-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `captured-paid-accept-${randomUUID()}`).expect(201);
    await paymentsService.payBookingAmendment(renter.userId, reference, amendmentId, {
      correlationId: `captured-paid-payment-${randomUUID()}`,
    });
    return { amendmentId, proposedEnd, reviewed };
  }

  async function createAcceptedPaidAmendment(proposedEnd: Date) {
    const reviewed = await preview(renter.token, {
      proposedReturnAt: proposedEnd.toISOString(),
    }).expect(201);
    const submitted = await submit(
      renter.token,
      reviewed.body.data.previewToken,
      `accepted-paid-submit-${randomUUID()}`,
    ).expect(201);
    const amendmentId = submitted.body.data.amendmentId as string;
    await ownerAccept(owner.token, amendmentId, `accepted-paid-accept-${randomUUID()}`).expect(201);
    return amendmentId;
  }

  async function promoteFixtureToActiveExtension(amendmentId: string) {
    await database.client.$transaction(async (transaction) => {
      await transaction.booking.update({
        data: { status: BookingStatus.READY_FOR_PICKUP },
        where: { id: bookingId },
      });
      await transaction.booking.update({
        data: { actualPickupAt: new Date(), status: BookingStatus.ACTIVE },
        where: { id: bookingId },
      });
      await transaction.bookingAmendment.update({
        data: { scope: 'ACTIVE_EXTENSION' },
        where: { id: amendmentId },
      });
    });
  }

  async function activateCurrentBooking() {
    await database.client.booking.update({
      data: { status: BookingStatus.READY_FOR_PICKUP },
      where: { id: bookingId },
    });
    await database.client.booking.update({
      data: { actualPickupAt: new Date(), status: BookingStatus.ACTIVE },
      where: { id: bookingId },
    });
  }

  async function recoveryConservationSnapshot(amendmentId: string) {
    const amendment = await database.client.bookingAmendment.findUniqueOrThrow({
      include: { settlement: true },
      where: { id: amendmentId },
    });
    const payment = await database.client.payment.findUniqueOrThrow({
      where: { id: amendment.settlement!.additionalPaymentId! },
    });
    const ledger = await database.client.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      where: {
        OR: [
          { sourceId: payment.id, sourceType: 'AMENDMENT_ADDITIONAL_PAYMENT' },
          { sourceId: amendmentId, sourceType: 'ACTIVE_EXTENSION_CAPTURE_RECOVERY_OBLIGATION' },
          { sourceId: amendment.settlement!.id, sourceType: 'BOOKING_AMENDMENT_REFUND' },
        ],
      },
    });
    const balance = (type: FinancialAccountType) =>
      ledger
        .flatMap(({ entries }) => entries)
        .filter(({ account }) => account.type === type)
        .reduce((sum, { amountMinor }) => sum + amountMinor, 0n);
    return {
      captureAllocations: await database.client.ledgerTransaction.count({
        where: { sourceId: amendmentId, type: LedgerTransactionType.CAPTURE_ALLOCATION },
      }),
      commissionSnapshot: await database.client.commissionSnapshot.findUniqueOrThrow({
        where: { paymentId },
      }),
      ledgerBalance: {
        CUSTOMER_FUNDS_HELD: balance(FinancialAccountType.CUSTOMER_FUNDS_HELD),
        PAYMENT_PROVIDER_RECEIVABLE: balance(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
        REFUND_PAYABLE: balance(FinancialAccountType.REFUND_PAYABLE),
      },
      ownerEarning: await database.client.ownerEarning.findUniqueOrThrow({
        where: { paymentId },
      }),
      payment,
      payoutItems: await database.client.payoutItem.count({
        where: { ownerEarning: { bookingId } },
      }),
      recoveryObligations: ledger.filter(
        ({ sourceType }) => sourceType === 'ACTIVE_EXTENSION_CAPTURE_RECOVERY_OBLIGATION',
      ).length,
      refunds: await database.client.refund.findMany({ where: { paymentId: payment.id } }),
      refundSettlements: ledger.filter(
        ({ sourceType }) => sourceType === 'BOOKING_AMENDMENT_REFUND',
      ).length,
    };
  }

  async function createInFlightAmendmentPayment(amendmentId: string) {
    return database.client.$transaction(async (transaction) => {
      const amendment = await transaction.bookingAmendment.findUniqueOrThrow({
        include: { settlement: true },
        where: { id: amendmentId },
      });
      const settlement = amendment.settlement!;
      const payment = await transaction.payment.create({
        data: {
          amountMinor: settlement.financialDeltaMinor,
          authorizedAmountMinor: settlement.financialDeltaMinor,
          authorizedAt: new Date(),
          bookingId,
          currency: settlement.currency,
          externalPaymentId: `in-flight-${randomUUID()}`,
          provider: PaymentProviderCode.FAKE,
          providerRequestReference: randomUUID(),
          purpose: PaymentPurpose.ADDITIONAL_CHARGE,
          status: PaymentStatus.CAPTURING,
        },
      });
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          attemptCount: 1,
          currency: payment.currency,
          idempotencyKey: `active-extension-late-capture:${amendmentId}`,
          paymentId: payment.id,
          providerRequestReference: randomUUID(),
          startedAt: new Date(),
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.CAPTURE,
        },
      });
      await transaction.bookingAmendment.update({
        data: { paymentInitiatedAt: new Date() },
        where: { id: amendmentId },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: { additionalPaymentId: payment.id, status: 'PROCESSING' },
        where: { amendmentId },
      });
      return { operationId: operation.id, paymentId: payment.id };
    });
  }

  function renterAmendmentDetail(token: string, amendmentReference: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/amendments/${amendmentReference}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function ownerAmendments(token: string) {
    return request(app.getHttpServer())
      .get('/api/v1/owner/bookings/amendments/actionable')
      .set('Authorization', `Bearer ${token}`);
  }

  function ownerAmendmentDetail(token: string, amendmentReference: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/owner/bookings/${reference}/amendments/${amendmentReference}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function ownerAccept(token: string, amendmentReference: string, idempotencyKey: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/amendments/${amendmentReference}/accept`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({});
  }

  function ownerDecline(
    token: string,
    amendmentReference: string,
    idempotencyKey: string,
    reasonCode: string,
  ) {
    return request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/amendments/${amendmentReference}/decline`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ reasonCode });
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

  function withoutExpiringFileGrants<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (key, item) =>
        ['contentPath', 'expiresAt', 'grant'].includes(key) ? undefined : item,
      ),
    ) as T;
  }

  async function setOwnerDeadline(amendmentId: string, deadline: Date) {
    const holds = await database.client.bookingAmendmentHold.findMany({
      where: { amendmentId, status: 'ACTIVE' },
    });
    await database.client.$transaction(async (transaction) => {
      await transaction.bookingAmendment.update({
        data: { expiresAt: deadline },
        where: { id: amendmentId },
      });
      for (const hold of holds) {
        await transaction.vehicleOccupancy.update({
          data: { expiresAt: deadline },
          where: { id: hold.occupancyId },
        });
        await transaction.bookingAmendmentHold.update({
          data: { expiresAt: deadline },
          where: { id: hold.id },
        });
      }
    });
  }

  async function raceAcceptAgainstExpiry(amendmentId: string, deadline: Date) {
    return raceDecisionAgainstExpiry(
      () => ownerAccept(owner.token, amendmentId, `accept-expiry-race-${randomUUID()}`),
      deadline,
    );
  }

  async function raceDecisionAgainstExpiry<T>(decision: () => Promise<T>, deadline: Date) {
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const released = new Promise<void>((resolve) => (releaseLock = resolve));
    const locker = raceLocker.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(
          'LOCK TABLE "booking_amendments" IN ACCESS EXCLUSIVE MODE',
        );
        signalLocked();
        await released;
      },
      { timeout: 20_000 },
    );
    await locked;
    const decisionResult = Promise.resolve(decision());
    let expiryResult!: Promise<number>;
    try {
      await waitForBlockedAmendmentOperations(1);
      await raceObserver.$queryRaw(Prisma.sql`
        SELECT clock_timestamp() AS "waitedAt"
        FROM pg_sleep(
          GREATEST(EXTRACT(EPOCH FROM (${deadline}::timestamptz - clock_timestamp())), 0)
        )
      `);
      expiryResult = expireAmendments();
      await waitForBlockedAmendmentOperations(1);
    } finally {
      releaseLock();
      await locker;
    }
    return Promise.all([decisionResult, expiryResult] as const);
  }

  async function raceBehindAmendmentTableLock<T, U>(
    left: () => Promise<T>,
    right: () => Promise<U>,
  ) {
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const released = new Promise<void>((resolve) => (releaseLock = resolve));
    const locker = raceLocker.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(
          'LOCK TABLE "booking_amendments" IN ACCESS EXCLUSIVE MODE',
        );
        signalLocked();
        await released;
      },
      { timeout: 20_000 },
    );
    await locked;
    const leftResult = Promise.resolve(left());
    const rightResult = Promise.resolve(right());
    try {
      await waitForBlockedAmendmentOperations(1);
    } finally {
      releaseLock();
      await locker;
    }
    return Promise.all([leftResult, rightResult] as const);
  }

  async function raceBehindBookingTableLock<T, U>(left: () => Promise<T>, right: () => Promise<U>) {
    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));
    const released = new Promise<void>((resolve) => (releaseLock = resolve));
    const locker = raceLocker.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(Prisma.sql`
          SELECT "id" FROM "bookings" WHERE "id" = ${bookingId}::uuid FOR UPDATE
        `);
        signalLocked();
        await released;
      },
      { timeout: 20_000 },
    );
    await locked;
    const leftResult = Promise.resolve(left());
    try {
      await waitForBlockedDatabaseOperations(1);
      const rightResult = Promise.resolve(right());
      await waitForBlockedDatabaseOperations(2);
      releaseLock();
      await locker;
      return Promise.all([leftResult, rightResult] as const);
    } finally {
      releaseLock();
      await locker;
    }
  }

  async function waitForBlockedDatabaseOperations(expected: number) {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const rows = await raceObserver.$queryRaw<Array<{ blocked: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "blocked"
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
      `);
      if (Number(rows[0]?.blocked ?? 0n) >= expected) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${expected} blocked database operation(s).`);
  }

  async function waitForBlockedAmendmentOperations(expected: number) {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const rows = await raceObserver.$queryRaw<Array<{ blocked: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "blocked"
        FROM pg_locks
        WHERE relation = 'booking_amendments'::regclass
          AND granted = false
      `);
      if (Number(rows[0]?.blocked ?? 0n) >= expected) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${expected} blocked amendment operation(s).`);
  }

  function raceAmendment(amendmentId: string) {
    return database.client.bookingAmendment.findUniqueOrThrow({
      include: {
        holds: { include: { occupancy: true } },
        statusHistory: { orderBy: { occurredAt: 'asc' } },
      },
      where: { id: amendmentId },
    });
  }

  async function assertRaceWinner(
    amendment: Awaited<ReturnType<typeof raceAmendment>>,
    status: BookingAmendmentStatus,
  ) {
    const winningStatuses = new Set([
      BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING,
      BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
      BookingAmendmentStatus.DECLINED,
      BookingAmendmentStatus.EXPIRED,
    ]);
    expect(amendment.statusHistory.filter((row) => winningStatuses.has(row.toStatus))).toHaveLength(
      1,
    );
    const expectedEvent =
      status === BookingAmendmentStatus.DECLINED
        ? 'BOOKING_AMENDMENT_DECLINED'
        : status === BookingAmendmentStatus.EXPIRED
          ? 'BOOKING_AMENDMENT_TERMINATED'
          : 'BOOKING_AMENDMENT_ACCEPTED';
    expect(
      await database.client.outboxEvent.count({
        where: {
          aggregateId: { in: [bookingId, amendment.id] },
          eventType: {
            in: [
              'BOOKING_AMENDMENT_ACCEPTED',
              'BOOKING_AMENDMENT_DECLINED',
              'BOOKING_AMENDMENT_TERMINATED',
            ],
          },
        },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: { in: [bookingId, amendment.id] }, eventType: expectedEvent },
      }),
    ).toBe(1);
  }

  async function raceConservationSnapshot() {
    const [booking, originalOccupancy, payment, ownerEarning, commissionSnapshot, counts] =
      await Promise.all([
        database.client.booking.findUniqueOrThrow({
          include: { fulfillmentSnapshot: true, pricingSnapshot: true },
          where: { id: bookingId },
        }),
        database.client.vehicleOccupancy.findFirstOrThrow({
          where: { active: true, bookingId, type: VehicleOccupancyType.BOOKING },
        }),
        database.client.payment.findUniqueOrThrow({ where: { id: paymentId } }),
        database.client.ownerEarning.findUniqueOrThrow({ where: { paymentId } }),
        database.client.commissionSnapshot.findUniqueOrThrow({ where: { paymentId } }),
        Promise.all([
          database.client.payment.count({ where: { bookingId } }),
          database.client.paymentOperation.count({ where: { paymentId } }),
          database.client.refund.count({ where: { paymentId } }),
          database.client.ledgerTransaction.count({
            where: { sourceId: { in: [bookingId, paymentId] } },
          }),
          database.client.ownerFinancialObligation.count({ where: { ownerProfileId } }),
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
      originalOccupancy,
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
    return {
      roles,
      sessionId,
      token: await tokens.signAccessToken(userId, sessionId, roles),
      userId,
    };
  }
});

function future(days: number, hour: number): Date {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + days);
  value.setUTCHours(hour, 0, 0, 0);
  return value;
}
