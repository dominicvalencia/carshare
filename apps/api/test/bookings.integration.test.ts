import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import {
  AddressMatchAssessment,
  FileAssetStatus,
  GeographicAreaLevel,
  InspectionPerspective,
  OwnerProfileStatus,
  Prisma,
  RoleCode,
  VerificationStatus,
  VerificationType,
} from '@carrental/database';
import type { FileClassification } from '@carrental/database';
import type { FakePaymentProvider } from '@carrental/payments';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { BookingsService } from '../src/bookings/bookings.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { attachAdminIdentity } from './admin-fixture';
import { PAYMENT_PROVIDER } from '../src/payments/payment-provider.factory';
import { PaymentsService } from '../src/payments/payments.service';

interface Actor {
  readonly userId: string;
  readonly token: string;
}

describe.sequential('Phase 5 booking concurrency integration', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let bookingsService: BookingsService;
  let paymentsService: PaymentsService;
  let fakePayments: FakePaymentProvider;
  let owner: Actor;
  let ownerProfileId = '';
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const start = future(20, 9);
  const end = future(21, 9);

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
    bookingsService = app.get(BookingsService);
    paymentsService = app.get(PaymentsService);
    fakePayments = app.get(PAYMENT_PROVIDER);
    owner = await createActor('owner', [RoleCode.RENTER, RoleCode.OWNER]);
    const profile = await database.client.ownerProfile.create({
      data: {
        legalName: 'Concurrency Owner Private Name',
        status: OwnerProfileStatus.VERIFIED,
        userId: owner.userId,
        verifiedAt: new Date(),
      },
    });
    ownerProfileId = profile.id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('keeps quotes informational but gates booking until secure renter verification approval', async () => {
    const renter = await createActor('verification-gate', [RoleCode.RENTER], false);
    const admin = await createActor('verification-admin', [RoleCode.ADMIN]);
    const vehicle = await createVehicle('VerificationGate');
    const quoteId = await createQuote(renter.userId, vehicle.id, vehicle.policyId, start, end);
    const rejected = await hold(renter.token, quoteId, `verification-blocked-${unique}`).expect(
      403,
    );
    expect(rejected.body.error.code).toBe('RENTER_VERIFICATION_REQUIRED');
    expect(rejected.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issue: 'APPROVED_IDENTITY_REQUIRED' }),
        expect.objectContaining({ issue: 'APPROVED_VALID_DRIVER_LICENSE_REQUIRED' }),
      ]),
    );
    expect(await database.client.booking.count({ where: { renterUserId: renter.userId } })).toBe(0);
    expect(
      await database.client.vehicleOccupancy.count({
        where: { booking: { renterUserId: renter.userId } },
      }),
    ).toBe(0);

    const barangay = await database.client.geographicArea.findFirstOrThrow({
      where: {
        active: true,
        level: GeographicAreaLevel.BARANGAY,
        provinceCode: { not: null },
      },
    });
    const city = await database.client.geographicArea.findUniqueOrThrow({
      where: { code: barangay.cityMunicipalityCode! },
    });
    const province = await database.client.geographicArea.findUniqueOrThrow({
      where: { code: city.provinceCode! },
    });
    const incompatibleProvince = await database.client.geographicArea.findFirstOrThrow({
      where: {
        active: true,
        code: { not: province.code },
        level: GeographicAreaLevel.PROVINCE,
        regionCode: city.regionCode,
      },
    });
    const renterRecord = await database.client.user.findUniqueOrThrow({
      where: { id: renter.userId },
    });

    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        dateOfBirth: '2992-04-12',
        legalFirstName: 'Pilot',
        legalLastName: 'Renter',
        stage: 'PERSONAL_INFORMATION',
      })
      .expect(422);
    const licenseNumber = `N01-${randomUUID().slice(0, 8)}`;
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        dateOfBirth: '1992-04-12',
        legalFirstName: 'Pilot',
        legalLastName: 'Renter',
        stage: 'PERSONAL_INFORMATION',
      })
      .expect(201);
    const otherBarangay = await database.client.geographicArea.findFirstOrThrow({
      where: {
        active: true,
        cityMunicipalityCode: { not: city.code },
        level: GeographicAreaLevel.BARANGAY,
      },
    });
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        addressLine1: '1 Pilot Street',
        addressScopeCode: incompatibleProvince.code,
        barangayCode: barangay.code,
        cityMunicipalityCode: city.code,
        postalCode: '1100',
        provinceCode: incompatibleProvince.code,
        regionCode: city.regionCode,
        stage: 'RESIDENTIAL_ADDRESS',
      })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_PSGC_HIERARCHY'));
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        addressLine1: '1 Pilot Street',
        addressScopeCode: province.code,
        barangayCode: otherBarangay.code,
        cityMunicipalityCode: city.code,
        postalCode: '1100',
        provinceCode: province.code,
        regionCode: city.regionCode,
        stage: 'RESIDENTIAL_ADDRESS',
      })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_PSGC_HIERARCHY'));
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        addressLine1: '1 Pilot Street',
        addressScopeCode: province.code,
        barangayCode: barangay.code,
        cityMunicipalityCode: city.code,
        postalCode: '1100',
        provinceCode: province.code,
        regionCode: city.regionCode,
        stage: 'RESIDENTIAL_ADDRESS',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.regionCode).toBe(city.regionCode);
        expect(body.data.provinceCode).toBe(province.code);
        expect(body.data.cityMunicipalityCode).toBe(city.code);
        expect(body.data.barangayCode).toBe(barangay.code);
      });
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        driverLicenseClass: 'C1',
        driverLicenseExpiry: '2020-01-01',
        driverLicenseNumber: `N01-${randomUUID().slice(0, 8)}`,
        stage: 'DRIVER_INFORMATION',
      })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        driverLicenseClass: 'C1',
        driverLicenseExpiry: future(365, 0).toISOString().slice(0, 10),
        driverLicenseNumber: licenseNumber,
        stage: 'DRIVER_INFORMATION',
      })
      .expect(201);
    const duplicateLicenseRenter = await createActor('duplicate-license', [RoleCode.RENTER], false);
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${duplicateLicenseRenter.token}`)
      .send({
        driverLicenseClass: 'C1',
        driverLicenseExpiry: future(365, 0).toISOString().slice(0, 10),
        driverLicenseNumber: licenseNumber.toLowerCase().replace('-', ' '),
        stage: 'DRIVER_INFORMATION',
      })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        emergencyContactMobile: `0${renterRecord.mobileNumber!.slice(3)}`,
        emergencyContactName: 'Pilot Renter',
        emergencyContactRelation: 'SIBLING',
        stage: 'EMERGENCY_CONTACT',
      })
      .expect(422);
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        emergencyContactMobile: '+639171234567',
        emergencyContactName: 'Pilot Contact',
        emergencyContactRelation: 'SIBLING',
        stage: 'EMERGENCY_CONTACT',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/renter-verification')
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.profile.renterVerificationDraftStep).toBe(4);
        expect(body.data.profile.addressScopeCode).toBe(province.code);
        expect(body.data.profile.barangayCode).toBe(barangay.code);
        expect(body.data.profile.driverLicenseNumberHash).toBeUndefined();
        expect(body.data.profile.driverLicenseLastFour).toBe(licenseNumber.slice(-4).toUpperCase());
      });
    const definitions = await database.client.renterDocumentDefinition.findMany({
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    const documentIds: string[] = [];
    for (const definition of definitions) {
      const fileAssetId = await file('SENSITIVE', 'image/jpeg', renter.userId);
      documentIds.push(fileAssetId);
      await request(app.getHttpServer())
        .post('/api/v1/renter-verification/documents')
        .set('Authorization', `Bearer ${renter.token}`)
        .send({ definitionCode: definition.code, fileAssetId })
        .expect(201);
    }
    const submission = await request(app.getHttpServer())
      .post('/api/v1/renter-verification/submission')
      .set('Authorization', `Bearer ${renter.token}`);
    expect(submission.status, JSON.stringify(submission.body)).toBe(201);
    const identityId = submission.body.data.verifications.find(
      ({ type }: { type: string }) => type === 'IDENTITY',
    ).id as string;

    await request(app.getHttpServer())
      .get(`/api/v1/files/${documentIds[0]}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/files/${documentIds[0]}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/renter-verifications/${identityId}/review`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/renter-verifications/${identityId}/address-assessment`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ assessment: AddressMatchAssessment.MATCH })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/renter-verifications/${identityId}/approval`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('RENTER_REVIEW_NOTES_REQUIRED'));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/renter-verifications/${identityId}/address-assessment`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        assessment: AddressMatchAssessment.MATCH,
        notes: 'Identity, address, and driving evidence reviewed and found consistent.',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/renter-verifications/${identityId}/approval`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);

    const approved = await hold(renter.token, quoteId, `verification-approved-${unique}`).expect(
      201,
    );
    expect(approved.body.data.status).toBe('HOLD');
    await request(app.getHttpServer())
      .post('/api/v1/renter-verification/profile')
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        addressLine1: '2 Updated Pilot Street',
        addressScopeCode: province.code,
        barangayCode: barangay.code,
        cityMunicipalityCode: city.code,
        postalCode: '1100',
        provinceCode: province.code,
        regionCode: city.regionCode,
        stage: 'RESIDENTIAL_ADDRESS',
      })
      .expect(201);
    const invalidated = await request(app.getHttpServer())
      .get('/api/v1/renter-verification')
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    expect(invalidated.body.data.eligibility.eligible).toBe(false);
    expect(
      invalidated.body.data.verifications.every(
        ({ status }: { status: string }) => status === 'DRAFT',
      ),
    ).toBe(true);
    expect(
      invalidated.body.data.verifications.find(({ type }: { type: string }) => type === 'IDENTITY')
        .addressAssessment,
    ).toBeNull();
  }, 60_000);

  it('allows exactly one of 100 simultaneous renters to hold the same occupied period', async () => {
    const vehicle = await createVehicle('HundredRenterRace');
    const renters = await Promise.all(
      Array.from({ length: 100 }, (_, index) => createActor(`race-${index}`, [RoleCode.RENTER])),
    );
    const quotes = await Promise.all(
      renters.map((renter) => createQuote(renter.userId, vehicle.id, vehicle.policyId, start, end)),
    );
    const responses = await Promise.allSettled(
      renters.map((renter, index) =>
        bookingsService.createHold(renter.userId, quotes[index]!, `race-${unique}-${index}`, {
          correlationId: `race-${index}`,
        }),
      ),
    );
    const winners = responses.filter(
      (
        result,
      ): result is PromiseFulfilledResult<Awaited<ReturnType<BookingsService['createHold']>>> =>
        result.status === 'fulfilled',
    );
    const conflicts = responses.filter(
      (result) => result.status === 'rejected' && result.reason?.code === 'BOOKING_CONFLICT',
    );
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(99);

    const raceBooking = await database.client.booking.findFirstOrThrow({
      where: { vehicleId: vehicle.id },
    });
    const [bookingCount, occupancyCount, pricingCount, policyCount, lineCount, outboxCount] =
      await Promise.all([
        database.client.booking.count({ where: { vehicleId: vehicle.id } }),
        database.client.vehicleOccupancy.count({
          where: { active: true, type: 'BOOKING_RESERVATION', vehicleId: vehicle.id },
        }),
        database.client.bookingPricingSnapshot.count({
          where: { booking: { vehicleId: vehicle.id } },
        }),
        database.client.bookingPolicySnapshot.count({
          where: { booking: { vehicleId: vehicle.id } },
        }),
        database.client.bookingPricingSnapshotLine.count({
          where: { snapshot: { booking: { vehicleId: vehicle.id } } },
        }),
        database.client.outboxEvent.count({
          where: { aggregateId: raceBooking.id, eventType: 'BOOKING_HOLD_CREATED' },
        }),
      ]);
    expect({
      bookingCount,
      lineCount,
      occupancyCount,
      outboxCount,
      policyCount,
      pricingCount,
    }).toEqual({
      bookingCount: 1,
      lineCount: 1,
      occupancyCount: 1,
      outboxCount: 1,
      policyCount: 1,
      pricingCount: 1,
    });

    const winnerReference = winners[0]!.value.publicReference;
    const winnerBooking = await database.client.booking.findUniqueOrThrow({
      include: { policySnapshot: true, pricingSnapshot: true },
      where: { publicReference: winnerReference },
    });
    expect(winnerBooking.pricingSnapshot?.totalMinor).toBe(250_000);
    expect(winnerBooking.pricingSnapshot?.includedMileageKm).toBe(150);
    expect(winnerBooking.policySnapshot?.policyVersionId).toBe(vehicle.policyId);

    const boundaryStart = new Date(new Date(end).getTime() + 2 * 60 * 60 * 1000);
    const boundaryEnd = new Date(boundaryStart.getTime() + 24 * 60 * 60 * 1000);
    const boundaryQuote = await createQuote(
      renters[1]!.userId,
      vehicle.id,
      vehicle.policyId,
      boundaryStart,
      boundaryEnd,
    );
    await hold(renters[1]!.token, boundaryQuote, `boundary-${unique}`).expect(201);

    await database.client.vehiclePolicyVersion.create({
      data: policyData(vehicle.id, 2, 400_000),
    });
    const unchanged = await database.client.bookingPolicySnapshot.findUniqueOrThrow({
      where: { bookingId: winnerBooking.id },
    });
    expect(unchanged.policyVersionId).toBe(vehicle.policyId);
    await expect(
      database.client.bookingPolicySnapshot.update({
        data: { turnaroundMinutes: 240 },
        where: { bookingId: winnerBooking.id },
      }),
    ).rejects.toThrow();

    const fulfillmentSnapshot = await database.client.bookingFulfillmentSnapshot.findUniqueOrThrow({
      where: { bookingId: winnerBooking.id },
    });
    expect(fulfillmentSnapshot).toMatchObject({
      deliveryDistanceMeters: null,
      deliveryFeeMinor: 0,
      endMethod: 'RENTER_RETURN',
      sourcePolicyVersionId: vehicle.policyId,
      startMethod: 'RENTER_PICKUP',
    });
    await expect(
      database.client.bookingFulfillmentSnapshot.update({
        data: { deliveryFeeMinor: 1 },
        where: { bookingId: winnerBooking.id },
      }),
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicle.id}/operational-status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'MAINTENANCE' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/archive`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);

    const ownerQuote = await createQuote(
      owner.userId,
      vehicle.id,
      vehicle.policyId,
      future(30, 9),
      future(31, 9),
    );
    await hold(owner.token, ownerQuote, `owner-own-${unique}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('OWNER_CANNOT_BOOK_OWN_VEHICLE'));
  }, 120_000);

  it('quotes and snapshots all four authoritative fulfillment combinations', async () => {
    const renter = await createActor('b3-fulfillment', [RoleCode.RENTER]);
    const vehicle = await createVehicle('B3Fulfillment');
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        ...policyData(vehicle.id, 2, 250_000),
        collectionFeeMinor: 20_000,
        deliveryFeeMinor: 30_000,
        fulfillmentMinimumNoticeMinutes: 0,
        fulfillmentServiceRadiusMeters: 25_000,
        supportsOwnerCollection: true,
        supportsOwnerDelivery: true,
      },
    });
    const destination = {
      addressLine1: '100 Synthetic Certification Street',
      city: 'Lucena City',
      country: 'PH',
      latitude: 13.942,
      longitude: 121.624,
      province: 'Quezon',
    };
    const combinations = [
      ['RENTER_PICKUP', 'RENTER_RETURN', 250_000, []],
      ['RENTER_PICKUP', 'OWNER_COLLECTION', 270_000, ['OWNER_COLLECTION']],
      ['OWNER_DELIVERY', 'RENTER_RETURN', 280_000, ['OWNER_DELIVERY']],
      ['OWNER_DELIVERY', 'OWNER_COLLECTION', 300_000, ['OWNER_DELIVERY', 'OWNER_COLLECTION']],
    ] as const;
    let bookingReference = '';
    for (const [startMethod, endMethod, totalMinor, serviceLines] of combinations) {
      const rentalStart = future(
        40 +
          combinations.indexOf(
            combinations.find((item) => item[0] === startMethod && item[1] === endMethod)!,
          ),
        9,
      );
      const rentalEnd = new Date(rentalStart.getTime() + 24 * 60 * 60 * 1000);
      const quoted = await request(app.getHttpServer())
        .post(`/api/v1/vehicles/${vehicle.id}/quotes`)
        .set('Authorization', `Bearer ${renter.token}`)
        .send({
          ...(endMethod === 'OWNER_COLLECTION'
            ? startMethod === 'OWNER_DELIVERY'
              ? { collectionSameAsDelivery: true }
              : { collectionDestination: destination }
            : {}),
          ...(startMethod === 'OWNER_DELIVERY' ? { deliveryDestination: destination } : {}),
          end: rentalEnd.toISOString(),
          endMethod,
          start: rentalStart.toISOString(),
          startMethod,
        })
        .expect(201);
      expect(quoted.body.data).toMatchObject({
        fulfillment: { endMethod, startMethod },
        totalMinor,
      });
      expect(
        quoted.body.data.lines
          .filter((line: { code: string }) => line.code.startsWith('OWNER_'))
          .map((line: { code: string }) => line.code),
      ).toEqual(serviceLines);
      const persisted = await database.client.pricingQuoteFulfillment.findUniqueOrThrow({
        where: { quoteId: quoted.body.data.id },
      });
      expect(persisted.sourcePolicyVersionId).toBe(policy.id);
      if (startMethod === 'OWNER_DELIVERY' && endMethod === 'OWNER_COLLECTION') {
        const held = await hold(renter.token, quoted.body.data.id, `b3-four-way-${unique}`).expect(
          201,
        );
        bookingReference = held.body.data.publicReference;
      }
    }
    const booking = await database.client.booking.findUniqueOrThrow({
      include: { fulfillmentSnapshot: true, pricingSnapshot: true },
      where: { publicReference: bookingReference },
    });
    expect(booking.fulfillmentSnapshot).toMatchObject({
      collectionFeeMinor: 20_000,
      deliveryFeeMinor: 30_000,
      endMethod: 'OWNER_COLLECTION',
      sourcePolicyVersionId: policy.id,
      startMethod: 'OWNER_DELIVERY',
    });
    expect(booking.pricingSnapshot?.discountedRentalSubtotalMinor).toBe(250_000);
    expect(booking.pricingSnapshot?.totalMinor).toBe(300_000);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingReference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingReference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    const captured = await database.client.booking.findUniqueOrThrow({
      include: { ownerEarning: true, payments: true },
      where: { publicReference: bookingReference },
    });
    expect(captured.payments[0]?.capturedAmountMinor).toBe(300_000n);
    expect(captured.ownerEarning).toMatchObject({
      collectionEarningMinor: 20_000n,
      deliveryEarningMinor: 30_000n,
      grossRentalAmountMinor: 250_000n,
      netEarningAmountMinor: 212_500n,
    });
    const allocation = await database.client.ledgerTransaction.findFirstOrThrow({
      include: { entries: { include: { account: true } } },
      where: { sourceId: captured.payments[0]!.id, type: 'CAPTURE_ALLOCATION' },
    });
    expect(allocation.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);
    expect(
      allocation.entries.find((entry) => entry.account.type === 'OWNER_PAYABLE')?.amountMinor,
    ).toBe(-262_500n);

    const travelNow = new Date();
    await database.client.booking.update({
      data: {
        pickupWindowEnd: new Date(travelNow.getTime() + 30 * 60_000),
        pickupWindowStart: new Date(travelNow.getTime() - 60_000),
        rentalEnd: new Date(travelNow.getTime() + 60 * 60_000),
        rentalStart: new Date(travelNow.getTime() + 5 * 60_000),
      },
      where: { id: booking.id },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ phase: 'START', status: 'PREPARING' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'START', status: 'ON_THE_WAY' })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_HANDOVER_TRAVEL_TRANSITION'));
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'START', status: 'PREPARING' })
      .expect(201);
    const concurrentOnWay = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ phase: 'START', status: 'ON_THE_WAY' }),
      ),
    );
    expect(concurrentOnWay.every(({ status }) => status === 201)).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'START', status: 'ARRIVED' })
      .expect(201);
    expect(
      await database.client.bookingHandoverTravelEvent.count({
        where: { bookingId: booking.id, phase: 'START' },
      }),
    ).toBe(3);
    const immutableTravelEvent = await database.client.bookingHandoverTravelEvent.findFirstOrThrow({
      where: { bookingId: booking.id, phase: 'START' },
    });
    await expect(
      database.client.bookingHandoverTravelEvent.update({
        data: { occurredAt: new Date() },
        where: { id: immutableTravelEvent.id },
      }),
    ).rejects.toThrow();
    await expect(
      database.client.bookingHandoverTravelEvent.delete({
        where: { id: immutableTravelEvent.id },
      }),
    ).rejects.toThrow();
    expect(
      (await database.client.booking.findUniqueOrThrow({ where: { id: booking.id } })).status,
    ).toBe('CONFIRMED');

    await database.client.booking.update({
      data: { status: 'READY_FOR_PICKUP' },
      where: { id: booking.id },
    });
    await database.client.booking.update({
      data: {
        actualPickupAt: travelNow,
        rentalEnd: new Date(travelNow.getTime() + 60 * 60_000),
        status: 'ACTIVE',
      },
      where: { id: booking.id },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'RETURN', status: 'PREPARING' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'RETURN', status: 'ON_THE_WAY' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingReference}/rental/return/start`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'RETURN', status: 'ON_THE_WAY' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${bookingReference}/rental/handover/travel`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ phase: 'RETURN', status: 'ARRIVED' })
      .expect(201);
    const travelDetail = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingReference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    expect(travelDetail.body.data.handoverTravel).toMatchObject({
      returnStatus: 'ARRIVED',
      startStatus: 'ARRIVED',
    });
    expect(travelDetail.body.data.fulfillment).toMatchObject({
      endMethod: 'OWNER_COLLECTION',
      legacyCompatibility: false,
      startMethod: 'OWNER_DELIVERY',
    });
    expect(
      await database.client.bookingFulfillmentSnapshot.findUniqueOrThrow({
        where: { bookingId: booking.id },
      }),
    ).toMatchObject({ endMethod: 'OWNER_COLLECTION', startMethod: 'OWNER_DELIVERY' });
  }, 60_000);

  it('converges retries, expires holds, and atomically captures accepted authorized requests', async () => {
    const renterA = await createActor('idempotent-a', [RoleCode.RENTER]);
    const renterB = await createActor('idempotent-b', [RoleCode.RENTER]);
    const vehicle = await createVehicle('IdempotencyAndExpiry');
    const quoteA = await createQuote(renterA.userId, vehicle.id, vehicle.policyId, start, end);
    const key = `same-key-${unique}`;
    const retries = await Promise.all(
      Array.from({ length: 20 }, () => hold(renterA.token, quoteA, key)),
    );
    expect(new Set(retries.map(({ body }) => body.data?.publicReference))).toHaveLength(1);
    expect(retries.every(({ status }) => status === 201)).toBe(true);
    expect(await database.client.booking.count({ where: { quoteId: quoteA } })).toBe(1);

    const held = await database.client.booking.findUniqueOrThrow({ where: { quoteId: quoteA } });
    await database.client.$transaction([
      database.client.booking.update({
        data: { holdExpiresAt: new Date(Date.now() - 60_000) },
        where: { id: held.id },
      }),
      database.client.vehicleOccupancy.update({
        data: { expiresAt: new Date(Date.now() - 60_000) },
        where: { bookingId: held.id },
      }),
    ]);
    const quoteB = await createQuote(renterB.userId, vehicle.id, vehicle.policyId, start, end);
    const replacement = await hold(renterB.token, quoteB, `after-expiry-${unique}`).expect(201);
    expect(
      (await database.client.booking.findUniqueOrThrow({ where: { id: held.id } })).status,
    ).toBe('EXPIRED');
    expect(
      (await database.client.vehicleOccupancy.findUniqueOrThrow({ where: { bookingId: held.id } }))
        .active,
    ).toBe(false);

    const cancellationResponse = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${replacement.body.data.publicReference}/cancel`)
      .set('Authorization', `Bearer ${renterB.token}`)
      .send({ reason: 'Testing explicit release behavior' });
    expect(cancellationResponse.status, JSON.stringify(cancellationResponse.body)).toBe(201);
    const replacementBooking = await database.client.booking.findUniqueOrThrow({
      where: { publicReference: replacement.body.data.publicReference },
    });
    expect(
      (
        await database.client.vehicleOccupancy.findFirstOrThrow({
          where: { bookingId: replacementBooking.id },
        })
      ).active,
    ).toBe(false);

    const requestVehicle = await createVehicle('OwnerRequestMechanics');
    const quote = await createQuote(
      renterA.userId,
      requestVehicle.id,
      requestVehicle.policyId,
      future(40, 9),
      future(41, 9),
    );
    const created = await hold(renterA.token, quote, `owner-request-${unique}`).expect(201);
    const reference = created.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renterA.token}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('AWAITING_PAYMENT'));
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renterA.token}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('AUTHORIZED'));
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201)
      .expect(({ body }) => expect(body.data.status).toBe('CONFIRMED'));
    const captured = await database.client.booking.findUniqueOrThrow({
      include: {
        commissionSnapshot: true,
        ownerEarning: true,
        payments: true,
      },
      where: { publicReference: reference },
    });
    expect(captured.payments[0]?.status).toBe('CAPTURED');
    expect(captured.commissionSnapshot?.rateBasisPoints).toBe(1500);
    expect(captured.ownerEarning?.status).toBe('PENDING');
    expect(captured.ownerEarning?.netEarningAmountMinor).toBe(212_500n);
    const ledger = await database.client.ledgerTransaction.findMany({
      include: { entries: true },
      where: { sourceId: captured.payments[0]!.id },
    });
    expect(ledger).toHaveLength(2);
    expect(
      ledger.every(
        ({ entries }) => entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) === 0n,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: captured.payments[0]!.id },
      }),
    ).toBe(2);

    const providerPaymentId = captured.payments[0]!.externalPaymentId!;
    const webhook = {
      paymentId: providerPaymentId,
      status: 'CAPTURED',
      updatedAt: new Date().toISOString(),
    };
    await request(app.getHttpServer()).post('/api/v1/webhooks/maya').send(webhook).expect(201);
    await request(app.getHttpServer()).post('/api/v1/webhooks/maya').send(webhook).expect(201);
    expect(await database.client.paymentWebhookEvent.count({ where: { providerPaymentId } })).toBe(
      1,
    );
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: captured.payments[0]!.id },
      }),
    ).toBe(2);

    await expect(
      database.client.ledgerTransaction.update({
        data: { description: 'mutation' },
        where: { id: ledger[0]!.id },
      }),
    ).rejects.toThrow();
    await expect(
      database.client.commissionSnapshot.update({
        data: { rateBasisPoints: 1 },
        where: { bookingId: captured.id },
      }),
    ).rejects.toThrow();
    const account = await database.client.financialAccount.findFirstOrThrow({
      where: { currency: 'PHP' },
    });
    await expect(
      database.client.$transaction(async (transaction) => {
        await transaction.ledgerTransaction.create({
          data: {
            currency: 'PHP',
            description: 'Intentionally unbalanced integration assertion',
            entries: { create: { accountId: account.id, amountMinor: 100n, currency: 'PHP' } },
            sourceId: randomUUID(),
            sourceType: 'INTEGRATION_ASSERTION',
            type: 'ADJUSTMENT',
          },
        });
      }),
    ).rejects.toThrow();

    const refundAttempts = await Promise.allSettled([
      database.client.refund.create({
        data: {
          amountMinor: 200_000n,
          currency: 'PHP',
          paymentId: captured.payments[0]!.id,
          reason: 'Concurrent refund assertion A',
        },
      }),
      database.client.refund.create({
        data: {
          amountMinor: 200_000n,
          currency: 'PHP',
          paymentId: captured.payments[0]!.id,
          reason: 'Concurrent refund assertion B',
        },
      }),
    ]);
    expect(refundAttempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(refundAttempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);

    const rejectedVehicle = await createVehicle('AuthorizedThenRejected');
    const rejectedQuote = await createQuote(
      renterA.userId,
      rejectedVehicle.id,
      rejectedVehicle.policyId,
      future(45, 9),
      future(46, 9),
    );
    const rejectedHold = await hold(renterA.token, rejectedQuote, `owner-reject-${unique}`).expect(
      201,
    );
    const rejectedReference = rejectedHold.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${rejectedReference}/continue`)
      .set('Authorization', `Bearer ${renterA.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${rejectedReference}/payment/authorize`)
      .set('Authorization', `Bearer ${renterA.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${rejectedReference}/reject`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ reason: 'Cannot accommodate' })
      .expect(201);
    const rejectedBooking = await database.client.booking.findUniqueOrThrow({
      include: { occupancy: true, payments: true },
      where: { publicReference: rejectedReference },
    });
    expect(rejectedBooking.status).toBe('CANCELLED');
    expect(rejectedBooking.occupancy?.active).toBe(false);
    expect(rejectedBooking.payments[0]?.status).toBe('VOIDED');
  }, 120_000);

  it('reconciles lost capture and void responses exactly once under concurrent owner accepts', async () => {
    const renter = await createActor('unknown-capture', [RoleCode.RENTER]);
    const vehicle = await createVehicle('UnknownCaptureReconciliation');
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      future(55, 9),
      future(56, 9),
    );
    const created = await hold(renter.token, quote, `unknown-capture-${unique}`).expect(201);
    const reference = created.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const authorized = await database.client.payment.findFirstOrThrow({
      where: { booking: { publicReference: reference }, purpose: 'RENTAL' },
    });
    fakePayments.setOutcome('unknown');
    try {
      const accepts = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(app.getHttpServer())
            .post(`/api/v1/owner/bookings/${reference}/accept`)
            .set('Authorization', `Bearer ${owner.token}`),
        ),
      );
      expect(accepts.filter(({ status }) => status === 201)).toHaveLength(1);
      expect(accepts.filter(({ status }) => status === 409)).toHaveLength(19);
      expect(
        (await database.client.booking.findUniqueOrThrow({ where: { publicReference: reference } }))
          .status,
      ).toBe('CAPTURE_PENDING');
      expect(
        await database.client.paymentOperation.count({
          where: { paymentId: authorized.id, type: 'CAPTURE' },
        }),
      ).toBe(1);
      expect(
        await database.client.ledgerTransaction.count({ where: { sourceId: authorized.id } }),
      ).toBe(0);

      fakePayments.setState({
        authorizedAmountMinor: authorized.amountMinor,
        capturedAmountMinor: authorized.amountMinor,
        externalPaymentId: authorized.externalPaymentId!,
        providerState: 'CAPTURED',
        state: 'CAPTURED',
      });
      await Promise.all(
        Array.from({ length: 10 }, () =>
          paymentsService.reconcilePayment(authorized.id, {
            correlationId: `unknown-capture-${randomUUID()}`,
          }),
        ),
      );
      const settled = await database.client.booking.findUniqueOrThrow({
        include: { commissionSnapshot: true, ownerEarning: true, payments: true },
        where: { publicReference: reference },
      });
      expect(settled.status).toBe('CONFIRMED');
      expect(settled.payments[0]?.status).toBe('CAPTURED');
      expect(settled.commissionSnapshot).not.toBeNull();
      expect(settled.ownerEarning?.status).toBe('PENDING');
      expect(
        await database.client.ledgerTransaction.count({ where: { sourceId: authorized.id } }),
      ).toBe(2);

      const voidVehicle = await createVehicle('UnknownVoidReconciliation');
      const voidQuote = await createQuote(
        renter.userId,
        voidVehicle.id,
        voidVehicle.policyId,
        future(57, 9),
        future(58, 9),
      );
      const voidCreated = await hold(renter.token, voidQuote, `unknown-void-${unique}`).expect(201);
      const voidReference = voidCreated.body.data.publicReference as string;
      fakePayments.setOutcome('succeed');
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${voidReference}/continue`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${voidReference}/payment/authorize`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      const voidPayment = await database.client.payment.findFirstOrThrow({
        where: { booking: { publicReference: voidReference }, purpose: 'RENTAL' },
      });
      fakePayments.setOutcome('unknown');
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${voidReference}/reject`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ reason: 'Temporary void provider failure assertion' })
        .expect(201);
      expect(
        (await database.client.payment.findUniqueOrThrow({ where: { id: voidPayment.id } })).status,
      ).toBe('VOID_PENDING');
      fakePayments.setState({
        externalPaymentId: voidPayment.externalPaymentId!,
        providerState: 'VOIDED',
        state: 'VOIDED',
      });
      await paymentsService.reconcilePayment(voidPayment.id, {
        correlationId: `unknown-void-${randomUUID()}`,
      });
      expect(
        (await database.client.payment.findUniqueOrThrow({ where: { id: voidPayment.id } })).status,
      ).toBe('VOIDED');
    } finally {
      fakePayments.setOutcome('succeed');
    }
  }, 120_000);

  it('runs pickup, return, evidence authorization, claims, and completion exactly once', async () => {
    const renter = await createActor('rental-operations', [RoleCode.RENTER]);
    const otherRenter = await createActor('other-rental-evidence', [RoleCode.RENTER]);
    const otherOwner = await createActor('other-owner-evidence', [RoleCode.OWNER]);
    const financeAdmin = await createActor('finance-no-operations', [RoleCode.FINANCE_ADMIN]);
    const operationsAdmin = await createActor('operations-admin', [RoleCode.ADMIN]);
    const vehicle = await createVehicle('OperationalLifecycle');
    const rentalStart = new Date(Date.now() + 5 * 60_000);
    const rentalEnd = new Date(rentalStart.getTime() + 3 * 24 * 60 * 60 * 1000);
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      rentalStart,
      rentalEnd,
    );
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${renter.token}`)
      .set('Idempotency-Key', `client-workflow-${unique}`)
      .send({ quoteId: quote, handoverWorkflowVersion: 2 })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
    const held = await hold(renter.token, quote, `operations-${unique}`).expect(201);
    const reference = held.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('READY_FOR_PICKUP'));

    const lateBooking = await database.client.booking.findUniqueOrThrow({
      where: { publicReference: reference },
    });
    expect(lateBooking.handoverWorkflowVersion).toBe(1);
    await expect(
      database.client.booking.update({
        where: { id: lateBooking.id },
        data: { handoverWorkflowVersion: null },
      }),
    ).rejects.toThrow('immutable');
    const overdueBoundary = new Date(Date.now() - 60_000);
    await database.client.booking.update({
      where: { id: lateBooking.id },
      data: { pickupWindowEnd: overdueBoundary },
    });
    const complianceBlocker = async () => {
      const [result] = await database.client.$queryRaw<{ blocker: string | null }[]>(
        Prisma.sql`SELECT "booking_workflow_compliance_blocker"(${lateBooking.id}::uuid) AS blocker`,
      );
      return result?.blocker;
    };
    expect(await complianceBlocker()).toBe('OWNER_INSPECTION_REQUIRED');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await database.client.$queryRaw(
        Prisma.sql`SELECT "emit_rental_operational_notifications"(120)`,
      );
    }
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: lateBooking.id, eventType: 'PICKUP_HANDOVER_OVERDUE' },
      }),
    ).toBe(1);

    const pickupFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .put(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection/draft/media`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...pickupFiles[0], replace: true })
      .expect(200);
    const pickupDraft = await request(app.getHttpServer())
      .get(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection/draft`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(pickupDraft.body.data.media).toEqual([
      expect.objectContaining({ fileAssetId: pickupFiles[0]?.fileAssetId }),
    ]);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        conditionDisclosureState: 'NO_KNOWN_ISSUES',
        fuelBasisPoints: 10000,
        media: pickupFiles,
        odometerMeters: '20000000',
      })
      .expect(201);
    expect(await complianceBlocker()).toBe('RENTER_REVIEW_REQUIRED');
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_INSPECTION_REVIEW_REQUIRED'));
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/inspection/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'DISAGREED' })
      .expect(422)
      .expect(({ body }) =>
        expect(body.error.code).toBe('PICKUP_INSPECTION_REVIEW_REASON_REQUIRED'),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/inspection/review`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'AGREED' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/inspection/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'DISAGREED', reason: 'Small undisclosed scratch near the passenger door.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_INSPECTION_DISAGREED'));
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/discrepancy/respond`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        responseType: 'ACKNOWLEDGE_CONDITION',
        responseText: 'I acknowledge this scratch was present before the rental.',
        acknowledgedCondition: {
          category: 'SCRATCH',
          vehicleArea: 'PASSENGER_SIDE',
          classification: 'COSMETIC',
          description: 'Small scratch near passenger-side front door.',
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/discrepancy/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        decision: 'STILL_DISAGREES',
        reason: 'The acknowledged condition still requires CarShare Operations review.',
      })
      .expect(201);
    const originalReview = await database.client.inspectionConfirmation.findFirstOrThrow({
      where: {
        inspection: { booking: { publicReference: reference }, type: 'PICKUP' },
        role: 'RENTER',
      },
    });
    expect(originalReview.decision).toBe('DISAGREED');

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/discrepancy/respond`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        responseType: 'ACKNOWLEDGE_CONDITION',
        responseText: 'I acknowledge this scratch was present before the rental.',
        acknowledgedCondition: {
          category: 'SCRATCH',
          vehicleArea: 'PASSENGER_SIDE',
          classification: 'COSMETIC',
          description: 'Small scratch near passenger-side front door.',
        },
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/discrepancy/respond`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        responseType: 'ACKNOWLEDGE_CONDITION',
        responseText: 'I added clearer context and confirm this is documented pre-rental damage.',
        acknowledgedCondition: {
          category: 'SCRATCH',
          vehicleArea: 'PASSENGER_SIDE',
          classification: 'COSMETIC',
          description: 'Documented cosmetic scratch near the passenger-side front door.',
        },
      })
      .expect(201);
    const secondRoundDetail = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    const responseHistory = secondRoundDetail.body.data.inspections
      .find(({ type }: { type: string }) => type === 'PICKUP')
      .confirmations.find(({ role }: { role: string }) => role === 'RENTER').discrepancyResponses;
    expect(responseHistory).toHaveLength(2);
    expect(responseHistory.map(({ roundNumber }: { roundNumber: number }) => roundNumber)).toEqual([
      1, 2,
    ]);
    expect(responseHistory[1].previousResponseId).toBe(responseHistory[0].id);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/discrepancy/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'ACCEPTED' })
      .expect(201);
    const pickupIncident = await database.client.rentalIncident.findFirstOrThrow({
      include: { disputes: true, pickupDiscrepancyResponses: { orderBy: { roundNumber: 'asc' } } },
      where: {
        booking: { publicReference: reference },
        pickupDiscrepancyResponses: { some: {} },
      },
    });
    expect(pickupIncident.pickupDiscrepancyResponses).toHaveLength(2);
    expect(pickupIncident.disputes).toHaveLength(0);
    expect(await complianceBlocker()).toBe('PICKUP_VERIFICATION_REQUIRED');

    const expiredPickupCode = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const firstWrongCode = expiredPickupCode.body.data.code === '999999' ? '000000' : '999999';
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: firstWrongCode })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_CODE_INVALID'));
    await database.client.inspectionVerificationChallenge.updateMany({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { booking: { publicReference: reference }, supersededAt: null },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: expiredPickupCode.body.data.code })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_CODE_EXPIRED'));
    const attemptCode = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const exhaustedWrongCode = attemptCode.body.data.code === '888888' ? '000000' : '888888';
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ code: exhaustedWrongCode })
        .expect(attempt === 5 ? 429 : 400);
    }
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: attemptCode.body.data.code })
      .expect(429);
    const pickupCode = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const code = pickupCode.body.data.code as string;
    const activations = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ code }),
      ),
    );
    expect(activations.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(activations.filter(({ status }) => status === 400)).toHaveLength(9);
    const activeBooking = await database.client.booking.findUniqueOrThrow({
      include: { ownerEarning: true },
      where: { publicReference: reference },
    });
    expect(activeBooking.status).toBe('ACTIVE');
    expect(activeBooking.actualPickupAt).not.toBeNull();
    expect(activeBooking.actualPickupAt!.getTime()).toBeGreaterThan(overdueBoundary.getTime());
    expect(activeBooking.rentalStart).toEqual(rentalStart);
    expect(activeBooking.rentalEnd).toEqual(rentalEnd);
    expect(await complianceBlocker()).toBe('RENTER_RETURN_INSPECTION_REQUIRED');
    expect(activeBooking.ownerEarning?.status).toBe('PENDING');
    expect(
      await database.client.bookingStatusHistory.count({
        where: { bookingId: activeBooking.id, toStatus: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: activeBooking.id, eventType: 'RENTAL_STARTED' },
      }),
    ).toBe(1);

    const evidenceId = pickupFiles[0]!.fileAssetId;
    for (const token of [renter.token, owner.token, operationsAdmin.token]) {
      await request(app.getHttpServer())
        .get(`/api/v1/files/${evidenceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
    for (const token of [otherRenter.token, otherOwner.token, financeAdmin.token]) {
      await request(app.getHttpServer())
        .get(`/api/v1/files/${evidenceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
    await request(app.getHttpServer()).get(`/api/v1/files/${evidenceId}`).expect(401);

    // Test-only late-return setup; the application must never reschedule the contract this way.
    const lateReturnEnd = new Date(Date.now() - 3 * 60 * 60_000);
    await database.client.booking.update({
      where: { id: activeBooking.id },
      data: {
        rentalEnd: lateReturnEnd,
        rentalStart: new Date(lateReturnEnd.getTime() - 3 * 24 * 60 * 60_000),
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.workflowCompliance.return.overdue).toBe(true));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await database.client.$queryRaw(
        Prisma.sql`SELECT "emit_rental_operational_notifications"(120)`,
      );
    }
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: lateBooking.id, eventType: 'RETURN_CONFIRMATION_OVERDUE' },
      }),
    ).toBe(1);

    const returnStarts = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/rental/return/start`)
        .set('Authorization', `Bearer ${renter.token}`),
      request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${reference}/rental/return/start`)
        .set('Authorization', `Bearer ${owner.token}`),
    ]);
    expect(returnStarts.every(({ status }) => status === 201)).toBe(true);
    const returnFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg', renter.userId),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/return/inspection`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ fuelBasisPoints: 8500, media: returnFiles, odometerMeters: '20520000' })
      .expect(201);
    expect(
      (await database.client.booking.findUniqueOrThrow({ where: { publicReference: reference } }))
        .status,
    ).toBe('RETURN_PENDING');
    await assertOwnerReturnInspectionDenied(reference, {
      fuelBasisPoints: 8500,
      odometerMeters: '20520000',
    });
    const confirmations = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${reference}/rental/return/confirm`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ decision: 'AGREED' }),
      ),
    );
    expect(confirmations.every(({ status }) => status === 201)).toBe(true);
    const returnedBooking = await database.client.booking.findUniqueOrThrow({
      include: { ownerEarning: true, usageSummary: true },
      where: { publicReference: reference },
    });
    expect(returnedBooking.status).toBe('RETURNED');
    expect(returnedBooking.rentalEnd).toEqual(lateReturnEnd);
    expect(returnedBooking.actualReturnAt!.getTime()).toBeGreaterThan(lateReturnEnd.getTime());
    expect(await complianceBlocker()).toBeNull();
    expect(returnedBooking.claimDeadlineAt?.getTime()).toBeGreaterThan(Date.now());
    expect(returnedBooking.ownerEarning?.status).toBe('PENDING');
    expect(returnedBooking.usageSummary).toMatchObject({
      distanceTravelledKm: 520,
      excessDistanceKm: 70,
      includedDistanceKm: 450,
    });
    expect(
      await database.client.bookingUsageSummary.count({ where: { bookingId: activeBooking.id } }),
    ).toBe(1);
    await expect(
      database.client.bookingUsageSummary.update({
        data: { excessDistanceKm: 71 },
        where: { bookingId: activeBooking.id },
      }),
    ).rejects.toThrow();
    await expect(
      database.client.inspection.update({
        data: { notes: 'Attempted evidence rewrite' },
        where: {
          id: (
            await database.client.inspection.findFirstOrThrow({
              where: { bookingId: activeBooking.id, type: 'PICKUP' },
            })
          ).id,
        },
      }),
    ).rejects.toThrow();

    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'FUEL_DEFICIENCY',
        description: 'Measured fuel deficiency requires administrator review.',
      })
      .expect(201);
    await database.client.booking.update({
      data: { claimDeadlineAt: new Date(Date.now() - 1_000) },
      where: { id: activeBooking.id },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`);
    expect(
      (await database.client.booking.findUniqueOrThrow({ where: { id: activeBooking.id } })).status,
    ).toBe('RETURNED');
    expect(
      (
        await database.client.ownerEarning.findUniqueOrThrow({
          where: { bookingId: activeBooking.id },
        })
      ).status,
    ).toBe('HELD');

    const claim = await database.client.postReturnClaim.findFirstOrThrow({
      where: { bookingId: activeBooking.id },
    });
    await database.client.postReturnClaim.update({
      data: { status: 'UNDER_ADMIN_REVIEW' },
      where: { id: claim.id },
    });
    await database.client.postReturnClaim.update({
      data: { resolvedAt: new Date(), status: 'RESOLVED' },
      where: { id: claim.id },
    });
    await database.client.earningHold.updateMany({
      data: {
        releasedAt: new Date(),
        resolution: 'Phase 7 compatibility test rejection',
        status: 'RELEASED',
      },
      where: { claimId: claim.id, status: 'ACTIVE' },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`);
    const completed = await database.client.booking.findUniqueOrThrow({
      include: { ownerEarning: true },
      where: { id: activeBooking.id },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.ownerEarning?.status).toBe('PENDING');
    expect(completed.ownerEarning!.availableAt!.getTime()).toBeGreaterThan(Date.now());
    // Test-only schedule advance; compliance must not bypass the existing waiting period.
    await database.client.ownerEarning.update({
      where: { bookingId: activeBooking.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "release_due_owner_earnings"()`);
    expect(
      (
        await database.client.ownerEarning.findUniqueOrThrow({
          where: { bookingId: activeBooking.id },
        })
      ).status,
    ).toBe('AVAILABLE');
  }, 120_000);

  it('settles an unresolved pre-custody cancellation exactly once', async () => {
    const renter = await createActor('handover-cancellation', [RoleCode.RENTER]);
    const vehicle = await createVehicle('HandoverCancellation');
    const rentalStart = new Date(Date.now() + 5 * 60_000);
    const rentalEnd = new Date(rentalStart.getTime() + 24 * 60 * 60 * 1000);
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      rentalStart,
      rentalEnd,
    );
    const held = await hold(renter.token, quote, `handover-cancel-${unique}`).expect(201);
    const reference = held.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    const media = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        conditionDisclosureState: 'NO_KNOWN_ISSUES',
        fuelBasisPoints: 10_000,
        media,
        odometerMeters: '100000',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/inspection/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'DISAGREED', reason: 'Synthetic pre-custody condition disagreement.' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/discrepancy/respond`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        responseText: 'Synthetic owner response for cancellation coverage.',
        responseType: 'CLARIFY_EXISTING_EVIDENCE',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/discrepancy/review`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'STILL_DISAGREES', reason: 'Synthetic disagreement remains unresolved.' })
      .expect(201);
    const preview = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/handover-cancellation/quote`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    expect(
      BigInt(preview.body.data.refundAmountMinor) +
        BigInt(preview.body.data.commissionRetainedMinor),
    ).toBe(BigInt(preview.body.data.capturedAmountMinor));
    const cancelRequest = () =>
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${reference}/handover-cancellation`)
        .set('Authorization', `Bearer ${renter.token}`)
        .set('Idempotency-Key', `handover-cancel-${reference}`)
        .send({ reasonCode: 'OWNER_RENTER_COULD_NOT_AGREE' });
    await cancelRequest().expect(201);
    await cancelRequest().expect(201);
    const cancelled = await database.client.booking.findUniqueOrThrow({
      include: { cancellationSettlement: true, pickupChallenges: true },
      where: { publicReference: reference },
    });
    expect(cancelled).toMatchObject({ actualPickupAt: null, status: 'CANCELLED' });
    const [cancellationCompliance] = await database.client.$queryRaw<{ blocker: string | null }[]>(
      Prisma.sql`SELECT "booking_workflow_compliance_blocker"(${cancelled.id}::uuid) AS blocker`,
    );
    expect(cancellationCompliance?.blocker).toBeNull();
    expect(cancelled.cancellationSettlement?.refundAmountMinor).toBe(
      BigInt(preview.body.data.refundAmountMinor),
    );
    expect(
      await database.client.bookingCancellation.count({ where: { bookingId: cancelled.id } }),
    ).toBe(1);
    expect(
      await database.client.refund.count({ where: { payment: { bookingId: cancelled.id } } }),
    ).toBe(1);
    const reversal = await database.client.ledgerTransaction.findMany({
      include: { entries: true },
      where: {
        sourceId: cancelled.cancellationSettlement!.id,
        sourceType: 'BOOKING_CANCELLATION_SETTLEMENT',
      },
    });
    expect(reversal).toHaveLength(1);
    expect(reversal[0]!.entries.reduce((total, entry) => total + entry.amountMinor, 0n)).toBe(0n);
    const earning = await database.client.ownerEarning.findUniqueOrThrow({
      where: { bookingId: cancelled.id },
    });
    expect(earning.netEarningAmountMinor + earning.adjustmentAmountMinor).toBe(
      cancelled.cancellationSettlement!.deliveryRetainedMinor,
    );
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: cancelled.id, eventType: 'RENTER_PRE_CUSTODY_HANDOVER_CANCELLED' },
      }),
    ).toBe(1);
    expect(
      await database.client.vehicleOccupancy.count({
        where: { active: true, bookingId: cancelled.id },
      }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(409);
  }, 120_000);

  it('keeps overdue handovers non-authoritative until a reasoned admin resolution', async () => {
    const renter = await createActor('admin-handover-renter', [RoleCode.RENTER]);
    const operationsAdmin = await createActor('admin-handover-operator', [RoleCode.ADMIN]);
    const vehicle = await createVehicle('AdminHandoverFallback');
    const rentalStart = new Date(Date.now() + 5 * 60_000);
    const rentalEnd = new Date(rentalStart.getTime() + 2 * 24 * 60 * 60 * 1000);
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      rentalStart,
      rentalEnd,
    );
    const held = await hold(renter.token, quote, `admin-handover-${unique}`).expect(201);
    const reference = held.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    const pickupFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        conditionDisclosureState: 'NO_KNOWN_ISSUES',
        fuelBasisPoints: 10_000,
        media: pickupFiles,
        odometerMeters: '41000000',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/incidents`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        category: 'OWNER_ISSUE',
        description: 'Vehicle received but the owner did not complete confirmation.',
        severity: 'HIGH',
      })
      .expect(201);
    expect(
      (await database.client.booking.findUniqueOrThrow({ where: { publicReference: reference } }))
        .status,
    ).toBe('READY_FOR_PICKUP');
    await request(app.getHttpServer())
      .post(`/api/v1/admin/rentals/${reference}/handover-resolution`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        action: 'CONFIRM_PICKUP',
        reason: 'A renter must not have administrative intervention authority.',
      })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/rentals/${reference}/handover-resolution`)
      .set('Authorization', `Bearer ${operationsAdmin.token}`)
      .send({ action: 'CONFIRM_PICKUP' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/rentals/${reference}/handover-resolution`)
      .set('Authorization', `Bearer ${operationsAdmin.token}`)
      .send({
        action: 'CONFIRM_PICKUP',
        occurredAt: new Date(0).toISOString(),
        reason: 'This invalid timestamp must be rejected before authoritative transition.',
      })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_PARTICIPANT_OTP_REQUIRED'));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/rentals/${reference}/handover-resolution`)
      .set('Authorization', `Bearer ${operationsAdmin.token}`)
      .send({
        action: 'CONFIRM_PICKUP',
        reason: 'Inspection and participant reports establish physical custody transfer.',
      })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('PICKUP_PARTICIPANT_OTP_REQUIRED'));
    const stillPickupReady = await database.client.booking.findUniqueOrThrow({
      where: { publicReference: reference },
    });
    expect(stillPickupReady.status).toBe('READY_FOR_PICKUP');
    expect(stillPickupReady.actualPickupAt).toBeNull();
    expect(
      await database.client.bookingStatusHistory.count({
        where: { bookingId: stillPickupReady.id, reasonCode: 'ADMIN_PICKUP_CONFIRMED' },
      }),
    ).toBe(0);
  }, 120_000);

  it('completes the Phase 12 pilot happy path through public and participant APIs', async () => {
    const renter = await createActor('phase12-pilot-renter', [RoleCode.RENTER]);
    const outsider = await createActor('phase12-pilot-outsider', [RoleCode.RENTER]);
    const vehicle = await createVehicle('PilotHappyPath');
    const rentalStart = new Date(Date.now() + 5 * 60_000);
    const rentalEnd = new Date(rentalStart.getTime() + 3 * 24 * 60 * 60 * 1000);

    const discovery = await request(app.getHttpServer())
      .get('/api/v1/vehicles/search')
      .query({
        end: rentalEnd.toISOString(),
        latitude: '13.9414',
        longitude: '121.6230',
        make: `PhaseFive-${unique}`,
        radius: '10',
        sort: 'NEWEST',
        start: rentalStart.toISOString(),
      })
      .expect(200);
    expect(
      discovery.body.data.items.some(
        (item: { vehicleId: string }) => item.vehicleId === vehicle.id,
      ),
    ).toBe(true);

    const quote = await request(app.getHttpServer())
      .post(`/api/v1/vehicles/${vehicle.id}/quotes`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ end: rentalEnd.toISOString(), start: rentalStart.toISOString() })
      .expect(201);
    expect(quote.body.data).toMatchObject({
      chargeableDays: 3,
      currency: 'PHP',
      includedMileageKm: 450,
      totalMinor: 750_000,
    });

    const held = await hold(renter.token, quote.body.data.id, `phase12-pilot-${unique}`).expect(
      201,
    );
    const reference = held.body.data.publicReference as string;
    expect(held.body.data.vehicle.coverPhoto.contentPath).toContain('/api/v1/file-access/');
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/reviews`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ categoryRatings: { condition: 5 }, rating: 5, type: 'VEHICLE' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const requestedBooking = await database.client.booking.findUniqueOrThrow({
      where: { publicReference: reference },
    });
    const ownerRequestedEvent = await database.client.outboxEvent.findFirst({
      where: {
        aggregateId: requestedBooking.id,
        eventType: 'BOOKING_OWNER_REQUESTED',
      },
    });
    expect(ownerRequestedEvent?.payload).toMatchObject({
      bookingId: requestedBooking.id,
      ownerUserId: owner.userId,
    });
    const ownerQueue = await request(app.getHttpServer())
      .get('/api/v1/owner/bookings/requests')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      ownerQueue.body.data.some(
        (item: { publicReference: string; status: string }) =>
          item.publicReference === reference && item.status === 'AWAITING_OWNER',
      ),
    ).toBe(true);
    await database.client.ownerProfile.update({
      data: { status: OwnerProfileStatus.DRAFT, verifiedAt: null },
      where: { id: ownerProfileId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('OWNER_VERIFICATION_REQUIRED'));
    await database.client.ownerProfile.update({
      data: { status: OwnerProfileStatus.VERIFIED, verifiedAt: new Date() },
      where: { id: ownerProfileId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);

    const pickupFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        conditionDisclosureState: 'NO_KNOWN_ISSUES',
        fuelBasisPoints: 10_000,
        media: pickupFiles,
        odometerMeters: '30000000',
      })
      .expect(201);
    await acceptPickupInspection(reference, renter.token);
    const pickupCode = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: pickupCode.body.data.code })
      .expect(201);

    const booking = await database.client.booking.findUniqueOrThrow({
      include: { conversation: true },
      where: { publicReference: reference },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${booking.conversation!.id}/messages`)
      .set('Authorization', `Bearer ${renter.token}`)
      .set('Idempotency-Key', `phase12-message-${unique}`)
      .send({ body: 'I have arrived at the agreed pickup area.' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/return/start`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const returnFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg', renter.userId),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/return/inspection`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ fuelBasisPoints: 10_000, media: returnFiles, odometerMeters: '30400000' })
      .expect(201);
    await assertOwnerReturnInspectionDenied(reference, {
      fuelBasisPoints: 10_000,
      odometerMeters: '30400000',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/return/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'AGREED' })
      .expect(201);

    await database.client.booking.update({
      data: { claimDeadlineAt: new Date(Date.now() - 1_000) },
      where: { id: booking.id },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`);
    const completed = await database.client.booking.findUniqueOrThrow({
      include: {
        commissionSnapshot: true,
        ownerEarning: true,
        payments: true,
        pricingSnapshot: true,
        usageSummary: true,
      },
      where: { id: booking.id },
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.payments.find(({ purpose }) => purpose === 'RENTAL')?.status).toBe('CAPTURED');
    expect(completed.commissionSnapshot).not.toBeNull();
    expect(completed.ownerEarning?.status).toBe('PENDING');
    expect(completed.usageSummary).toMatchObject({
      distanceTravelledKm: 400,
      excessDistanceKm: 0,
      includedDistanceKm: 450,
    });
    expect(completed.pricingSnapshot?.totalMinor).toBe(750_000);

    await database.client.ownerEarning.update({
      data: { availableAt: new Date(Date.now() - 1_000) },
      where: { bookingId: booking.id },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "release_due_owner_earnings"()`);
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { bookingId: booking.id } }))
        .status,
    ).toBe('AVAILABLE');

    const eligibility = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/review-eligibility`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    expect(eligibility.body.data.eligible).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/reviews`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({
        categoryRatings: { accuracy: 5, cleanliness: 5, condition: 5 },
        rating: 5,
        text: 'A smooth pilot rental from booking through return.',
        type: 'VEHICLE',
      })
      .expect(201);

    const financialTransactions = await database.client.ledgerTransaction.findMany({
      include: { entries: true },
      where: { sourceId: { in: completed.payments.map(({ id }) => id) } },
    });
    expect(financialTransactions.length).toBeGreaterThan(0);
    expect(
      financialTransactions.every(
        ({ entries }) => entries.reduce((sum, entry) => sum + entry.amountMinor, 0n) === 0n,
      ),
    ).toBe(true);
  }, 120_000);

  it('serializes a claim submission racing automatic completion', async () => {
    const renter = await createActor('claim-race-renter', [RoleCode.RENTER]);
    const vehicle = await createVehicle('ClaimCompletionRace');
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      future(80, 9),
      future(81, 9),
    );
    const bookingId = randomUUID();
    const reference = `RACE-${randomUUID().slice(0, 12)}`;
    await database.client.booking.create({
      data: {
        actualReturnAt: new Date(),
        claimDeadlineAt: new Date(Date.now() + 150),
        id: bookingId,
        ownerProfileId,
        ownerUserId: owner.userId,
        publicReference: reference,
        quoteId: quote,
        rentalEnd: future(81, 9),
        rentalStart: future(80, 9),
        renterUserId: renter.userId,
        status: 'RETURNED',
        vehicleId: vehicle.id,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const [claimResult] = await Promise.allSettled([
      database.client.postReturnClaim.create({
        data: {
          bookingId,
          category: 'OTHER',
          description: 'Boundary claim',
          id: randomUUID(),
          submittedByUserId: owner.userId,
        },
      }),
      database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`),
    ]);
    let final = await database.client.booking.findUniqueOrThrow({
      include: { postReturnClaims: true },
      where: { id: bookingId },
    });
    if (claimResult.status === 'fulfilled') {
      expect(final.status).toBe('RETURNED');
      expect(final.postReturnClaims).toHaveLength(1);
    } else {
      if (final.status === 'RETURNED') {
        await database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`);
        final = await database.client.booking.findUniqueOrThrow({
          include: { postReturnClaims: true },
          where: { id: bookingId },
        });
      }
      expect(final.status).toBe('COMPLETED');
      expect(final.postReturnClaims).toHaveLength(0);
    }
  }, 60_000);

  it('runs the EV lifecycle with SOC-only evidence and stores measured deficiency', async () => {
    const renter = await createActor('ev-rental-operations', [RoleCode.RENTER]);
    const vehicle = await createVehicle('ElectricOperationalLifecycle');
    await database.client.vehicle.update({
      data: { fuelType: 'ELECTRIC', powertrain: 'BATTERY_ELECTRIC' },
      where: { id: vehicle.id },
    });
    const evPolicy = await database.client.vehiclePolicyVersion.create({
      data: {
        availabilityPolicy: 'EVERY_DAY',
        createdByUserId: owner.userId,
        dailyRateMinor: 250_000,
        evReturnPolicy: 'SAME_TO_SAME',
        evTolerancePercent: 5,
        excessKilometerRateMinor: 1_000,
        includedKilometersPerDay: 150,
        maximumRentalDays: 30,
        mileagePolicy: 'LIMITED',
        minimumRentalDays: 1,
        turnaroundMinutes: 120,
        vehicleId: vehicle.id,
        version: 2,
      },
    });
    const rentalStart = new Date(Date.now() + 5 * 60_000);
    const rentalEnd = new Date(rentalStart.getTime() + 24 * 60 * 60 * 1000);
    const quote = await createQuote(renter.userId, vehicle.id, evPolicy.id, rentalStart, rentalEnd);
    const held = await hold(renter.token, quote, `ev-operations-${unique}`).expect(201);
    const reference = held.body.data.publicReference as string;
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/continue`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/payment/authorize`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/accept`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${reference}/rental`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(200);
    const pickupFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ media: pickupFiles, odometerMeters: '1000000' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('INSPECTION_MEASUREMENT_REQUIRED'));
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        batterySocBasisPoints: 8000,
        conditionDisclosureState: 'NO_KNOWN_ISSUES',
        media: pickupFiles,
        odometerMeters: '1000000',
      })
      .expect(201);
    await acceptPickupInspection(reference, renter.token);
    const pickupCode = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/confirm`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/pickup/verify`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ code: pickupCode.body.data.code })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/return/start`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);
    const returnFiles = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg', renter.userId),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/return/inspection`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ batterySocBasisPoints: 6000, media: returnFiles, odometerMeters: '1200000' })
      .expect(201);
    await assertOwnerReturnInspectionDenied(reference, {
      batterySocBasisPoints: 6000,
      odometerMeters: '1200000',
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/return/confirm`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ decision: 'AGREED' })
      .expect(201);
    const completedReturn = await database.client.booking.findUniqueOrThrow({
      include: { usageSummary: true },
      where: { publicReference: reference },
    });
    expect(completedReturn.status).toBe('RETURNED');
    expect(completedReturn.usageSummary).toMatchObject({
      fuelDeficiencyBasisPoints: null,
      requiredSocBasisPoints: 7500,
      socDeficiencyBasisPoints: 1500,
    });
  }, 120_000);

  it('serializes owner-block and booking races through the same exclusion constraint', async () => {
    const renter = await createActor('block-race', [RoleCode.RENTER]);
    const vehicle = await createVehicle('OwnerBlockRace');
    const periodStart = future(50, 9);
    const periodEnd = future(51, 9);
    const quote = await createQuote(
      renter.userId,
      vehicle.id,
      vehicle.policyId,
      periodStart,
      periodEnd,
    );
    const [bookingResult, blockResult] = await Promise.all([
      hold(renter.token, quote, `block-race-${unique}`),
      request(app.getHttpServer())
        .post(`/api/v1/owner/vehicles/${vehicle.id}/blocked-periods`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          endsAt: periodEnd.toISOString(),
          reason: 'PERSONAL_USE',
          startsAt: periodStart.toISOString(),
        }),
    ]);
    const successes = [bookingResult.status, blockResult.status].filter((status) => status < 300);
    expect(successes).toHaveLength(1);
    expect(
      await database.client.vehicleOccupancy.count({
        where: { active: true, vehicleId: vehicle.id },
      }),
    ).toBe(1);
    if (bookingResult.status === 201) {
      expect(blockResult.status).toBe(409);
      expect(blockResult.body.error.code).toBe('BLOCKED_PERIOD_OVERLAP');
    } else {
      expect(bookingResult.status).toBe(409);
      expect(bookingResult.body.error.code).toBe('BOOKING_CONFLICT');
    }

    const blockedFirst = await createVehicle('BlockThenBooking');
    const blockedStart = future(60, 9);
    const blockedEnd = future(61, 9);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${blockedFirst.id}/blocked-periods`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        endsAt: blockedEnd.toISOString(),
        reason: 'PERSONAL_USE',
        startsAt: blockedStart.toISOString(),
      })
      .expect(201);
    const blockedQuote = await createQuote(
      renter.userId,
      blockedFirst.id,
      blockedFirst.policyId,
      blockedStart,
      blockedEnd,
    );
    await hold(renter.token, blockedQuote, `block-first-${unique}`)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BOOKING_CONFLICT'));

    const bookedFirst = await createVehicle('BookingThenBlock');
    const bookedStart = future(70, 9);
    const bookedEnd = future(71, 9);
    const bookedQuote = await createQuote(
      renter.userId,
      bookedFirst.id,
      bookedFirst.policyId,
      bookedStart,
      bookedEnd,
    );
    await hold(renter.token, bookedQuote, `booking-first-${unique}`).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${bookedFirst.id}/blocked-periods`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        endsAt: bookedEnd.toISOString(),
        reason: 'PERSONAL_USE',
        startsAt: bookedStart.toISOString(),
      })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('BLOCKED_PERIOD_OVERLAP'));
  }, 60_000);

  it('persists private vehicle known issues with owner isolation and non-destructive resolution', async () => {
    const vehicle = await createVehicle('KnownIssues');
    const otherOwner = await createActor('known-issue-other-owner', [RoleCode.OWNER]);
    await database.client.ownerProfile.create({
      data: {
        legalName: 'Other Owner',
        status: OwnerProfileStatus.VERIFIED,
        userId: otherOwner.userId,
      },
    });
    const first = await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'SCRATCH',
        classification: 'COSMETIC',
        description: 'Existing passenger-side scratch.',
        vehicleArea: 'PASSENGER_SIDE',
      })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'WHEEL_OR_RIM',
        classification: 'COSMETIC',
        description: 'Existing rim scuff.',
        vehicleArea: 'WHEEL_OR_TIRE',
      })
      .expect(201);
    expect(first.body.data.status).toBe('ACTIVE');
    expect(second.body.data.status).toBe('ACTIVE');

    await request(app.getHttpServer())
      .get(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${otherOwner.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${otherOwner.token}`)
      .send({
        category: 'DENT',
        classification: 'COSMETIC',
        description: 'Unauthorized issue.',
        vehicleArea: 'OTHER',
      })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/known-issues/${first.body.data.id}/resolution`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.status).toBe('RESOLVED');
        expect(body.data.resolvedAt).toBeTruthy();
        expect(body.data.resolvedByUserId).toBe(owner.userId);
      });
    const list = await request(app.getHttpServer())
      .get(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(
      list.body.data.filter(({ status }: { status: string }) => status === 'ACTIVE'),
    ).toHaveLength(1);
    expect(
      list.body.data.filter(({ status }: { status: string }) => status === 'RESOLVED'),
    ).toHaveLength(1);

    const publicVehicle = await request(app.getHttpServer())
      .get(`/api/v1/vehicles/${vehicle.id}`)
      .expect(200);
    expect(JSON.stringify(publicVehicle.body)).not.toContain('knownIssues');
    expect(JSON.stringify(publicVehicle.body)).not.toContain('Existing rim scuff.');

    await request(app.getHttpServer())
      .post(`/api/v1/owner/vehicles/${vehicle.id}/known-issues`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'WARNING_LIGHT',
        classification: 'SAFETY_CRITICAL',
        description: 'Safety warning remains active.',
        vehicleArea: 'DASHBOARD',
      })
      .expect(201);
    expect(
      (await database.client.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } }))
        .operationalStatus,
    ).toBe('MAINTENANCE');
    await request(app.getHttpServer())
      .patch(`/api/v1/owner/vehicles/${vehicle.id}/operational-status`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ status: 'AVAILABLE' })
      .expect(409);
  }, 60_000);

  for (const [waiveStart, waiveReturn] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    it(`Migration 51 preserves custody and financial authority (${waiveStart ? 'WAIVED' : 'VERIFIED'}/${waiveReturn ? 'WAIVED' : 'VERIFIED'})`, async () => {
      const renter = await createActor(`waiver-renter-${waiveStart}-${waiveReturn}`, [
        RoleCode.RENTER,
      ]);
      const outsider = await createActor(`waiver-outsider-${waiveStart}-${waiveReturn}`, [
        RoleCode.RENTER,
        RoleCode.OWNER,
      ]);
      const vehicle = await createVehicle('waiver-' + waiveStart + '-' + waiveReturn);
      const scheduled = new Date(Date.now() + 5 * 60000);
      let quoteId = await createQuote(
        renter.userId,
        vehicle.id,
        vehicle.policyId,
        scheduled,
        new Date(scheduled.getTime() + 86400000),
      );
      if (waiveStart && waiveReturn) {
        await database.client.vehiclePolicyVersion.create({
          data: {
            ...policyData(vehicle.id, 2, 250000),
            supportsOwnerDelivery: true,
            supportsOwnerCollection: true,
            deliveryFeeMinor: 30000,
            collectionFeeMinor: 20000,
            fulfillmentServiceRadiusMeters: 25000,
            fulfillmentMinimumNoticeMinutes: 0,
          },
        });
        const quoted = await request(app.getHttpServer())
          .post(`/api/v1/vehicles/${vehicle.id}/quotes`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({
            start: scheduled.toISOString(),
            end: new Date(scheduled.getTime() + 86400000).toISOString(),
            startMethod: 'OWNER_DELIVERY',
            endMethod: 'OWNER_COLLECTION',
            collectionSameAsDelivery: true,
            deliveryDestination: {
              addressLine1: '100 Synthetic Certification Street',
              city: 'Lucena City',
              province: 'Quezon',
              country: 'PH',
              latitude: 13.942,
              longitude: 121.624,
            },
          })
          .expect(201);
        quoteId = quoted.body.data.id;
      }
      const held = await hold(renter.token, quoteId, 'waiver-' + quoteId).expect(201);
      const ref = held.body.data.publicReference as string;
      const booking = await database.client.booking.findUniqueOrThrow({
        where: { publicReference: ref },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${ref}/continue`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${ref}/payment/authorize`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${ref}/accept`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .get(`/api/v1/owner/bookings/${ref}/rental`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      const acknowledgement = {
        acknowledged: true,
        acknowledgementVersion: 'HANDOVER_EVIDENCE_WAIVER_V1',
      };
      let reportedPickupAt = new Date();
      let reportedReturnAt = new Date();
      const waive = (token: string, phase: 'pickup' | 'return') =>
        request(app.getHttpServer())
          .post(
            `/api/v1/${phase === 'pickup' ? 'owner/' : ''}bookings/${ref}/rental/${phase}/evidence-waiver`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({
            ...acknowledgement,
            reportedPhysicalHandoverAt:
              phase === 'pickup' ? reportedPickupAt.toISOString() : reportedReturnAt.toISOString(),
          });
      const waiveOwnerReturn = (token: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/return/evidence-waiver`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            ...acknowledgement,
            reportedPhysicalHandoverAt: reportedReturnAt.toISOString(),
          });
      const travel = (phase: 'START' | 'RETURN', status: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/handover/travel`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ phase, status });
      const blocker = async () =>
        (
          await database.client.$queryRaw<{ blocker: string | null }[]>(
            Prisma.sql`SELECT booking_workflow_compliance_blocker(${booking.id}::uuid) AS blocker`,
          )
        )[0]!.blocker;
      expect(await blocker()).toBe('OWNER_INSPECTION_REQUIRED');
      await waive(renter.token, 'pickup').expect(403);
      await waive(outsider.token, 'pickup').expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${ref}/rental/pickup/evidence-waiver`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ ...acknowledgement, acknowledged: false })
        .expect(400);
      if (waiveStart) {
        if (waiveReturn) {
          await waive(owner.token, 'pickup').expect(409);
          await travel('START', 'PREPARING').expect(201);
          await travel('START', 'ON_THE_WAY').expect(201);
          await travel('START', 'ARRIVED').expect(201);
          reportedPickupAt = new Date();
        }
        await database.client.booking.update({
          where: { id: booking.id },
          data: { operationalHold: true },
        });
        await waive(owner.token, 'pickup').expect(409);
        await database.client.booking.update({
          where: { id: booking.id },
          data: { operationalHold: false },
        });
        await database.client.vehicle.update({
          where: { id: vehicle.id },
          data: { operationalStatus: 'MAINTENANCE' },
        });
        await waive(owner.token, 'pickup').expect(409);
        await database.client.vehicle.update({
          where: { id: vehicle.id },
          data: { operationalStatus: 'AVAILABLE' },
        });
        await waive(owner.token, 'pickup').expect(201);
        await waive(owner.token, 'pickup').expect(201);
        expect(await blocker()).toBe('PICKUP_HANDOVER_TIME_CONFIRMATION_REQUIRED');
        await request(app.getHttpServer())
          .post(`/api/v1/bookings/${ref}/rental/pickup/handover-report/respond`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ decision: 'CONFIRMED' })
          .expect(403);
        await request(app.getHttpServer())
          .post(`/api/v1/bookings/${ref}/rental/pickup/handover-report/respond`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({ decision: 'CONFIRMED' })
          .expect(201);
        expect(await blocker()).toBe('PICKUP_VERIFICATION_REQUIRED');
        expect(await database.client.inspection.count({ where: { bookingId: booking.id } })).toBe(
          0,
        );
        const w = await database.client.bookingHandoverEvidenceWaiver.findFirstOrThrow({
          where: { bookingId: booking.id, phase: 'START' },
        });
        await expect(
          database.client.bookingHandoverEvidenceWaiver.update({
            where: { id: w.id },
            data: { acknowledgementVersion: 'changed' },
          }),
        ).rejects.toThrow();
        await expect(
          database.client.bookingHandoverEvidenceWaiver.delete({ where: { id: w.id } }),
        ).rejects.toThrow();
      } else {
        const media = await Promise.all(
          Object.values(InspectionPerspective)
            .filter((p) => p !== 'ADDITIONAL')
            .map(async (perspective) => ({
              perspective,
              fileAssetId: await file('SENSITIVE', 'image/jpeg'),
            })),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/pickup/inspection`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            media,
            odometerMeters: '100000',
            fuelBasisPoints: 10000,
            conditionDisclosureState: 'NO_KNOWN_ISSUES',
          })
          .expect(201);
        await waive(owner.token, 'pickup').expect(409);
        await acceptPickupInspection(ref, renter.token);
      }
      const before = await database.client.booking.findUniqueOrThrow({ where: { id: booking.id } });
      expect(before.actualPickupAt).toBeNull();
      expect(before.status).toBe('READY_FOR_PICKUP');
      const challenge = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${ref}/rental/pickup/confirm`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${ref}/rental/pickup/verify`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ code: challenge.body.data.code })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${ref}/rental/pickup/verify`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ code: challenge.body.data.code })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${ref}/rental/return/start`)
        .set('Authorization', `Bearer ${renter.token}`)
        .expect(201);
      await waive(owner.token, 'return').expect(403);
      await waive(outsider.token, 'return').expect(403);
      if (waiveReturn) {
        if (waiveStart) {
          await waive(renter.token, 'return').expect(409);
          // Test-only schedule advancement exercises overdue Owner Collection recovery without
          // manufacturing travel events. Production waiver never reschedules a contract.
          await database.client.booking.update({
            where: { id: booking.id },
            data: {
              rentalStart: new Date(Date.now() - 5 * 60 * 60000),
              rentalEnd: new Date(Date.now() - 4 * 60 * 60000),
            },
          });
        }
        reportedReturnAt = new Date();
        if (waiveStart) {
          await waive(renter.token, 'return').expect(403);
          await waiveOwnerReturn(owner.token).expect(201);
          await waiveOwnerReturn(owner.token).expect(201);
        } else {
          await waive(renter.token, 'return').expect(201);
          await waive(renter.token, 'return').expect(201);
        }
        expect(await blocker()).toBe('OWNER_RETURN_RECEIPT_REQUIRED');
        const pending = await database.client.booking.findUniqueOrThrow({
          where: { id: booking.id },
        });
        expect(pending.actualReturnAt).toBeNull();
        expect(pending.status).toBe('RETURN_PENDING');
        await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/return/receipt`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({ vehicleReceived: true })
          .expect(403);
        await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/return/receipt`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ vehicleReceived: true })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/return/receipt`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ vehicleReceived: true })
          .expect(201);
      } else {
        const media = await Promise.all(
          Object.values(InspectionPerspective)
            .filter((p) => p !== 'ADDITIONAL')
            .map(async (perspective) => ({
              perspective,
              fileAssetId: await file('SENSITIVE', 'image/jpeg', renter.userId),
            })),
        );
        await request(app.getHttpServer())
          .post(`/api/v1/bookings/${ref}/rental/return/inspection`)
          .set('Authorization', `Bearer ${renter.token}`)
          .send({ media, odometerMeters: '110000', fuelBasisPoints: 10000 })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/rental/return/confirm`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ decision: 'AGREED' })
          .expect(201);
      }
      const returned = await database.client.booking.findUniqueOrThrow({
        where: { id: booking.id },
      });
      expect(returned.status).toBe('RETURNED');
      expect(returned.actualPickupAt).not.toBeNull();
      expect(returned.actualReturnAt).not.toBeNull();
      expect(await blocker()).toBeNull();
      if (waiveStart || waiveReturn) {
        // Reduced inspection evidence is context, not an automatic claim denial or charge.
        const claim = await request(app.getHttpServer())
          .post(`/api/v1/owner/bookings/${ref}/claims`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            category: 'DAMAGE',
            description: 'Additional evidence requires support review, not presumed fault.',
            evidence: [{ fileAssetId: await file('SENSITIVE', 'image/jpeg', owner.userId) }],
          })
          .expect(201);
        expect(claim.body.data.booking.handoverEvidenceWaivers.length).toBeGreaterThan(0);
        await request(app.getHttpServer())
          .post(`/api/v1/owner/claims/${claim.body.data.id}/withdraw`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ reason: 'QA withdrawal after reduced-evidence context verification.' })
          .expect(201);
      }
      for (const phase of ['START', 'RETURN'] as const) {
        const waived = phase === 'START' ? waiveStart : waiveReturn;
        expect(
          await database.client.bookingHandoverEvidenceWaiver.count({
            where: { bookingId: booking.id, phase },
          }),
        ).toBe(waived ? 1 : 0);
        expect(
          await database.client.outboxEvent.count({
            where: {
              aggregateId: booking.id,
              eventType:
                phase === 'START'
                  ? 'START_INSPECTION_EVIDENCE_WAIVED'
                  : waiveStart && waiveReturn
                    ? 'OWNER_RETURN_INSPECTION_EVIDENCE_WAIVED'
                    : 'RETURN_INSPECTION_EVIDENCE_WAIVED',
            },
          }),
        ).toBe(waived ? 1 : 0);
      }
      await database.client.booking.update({
        where: { id: booking.id },
        data: { operationalHold: true },
      });
      expect(await blocker()).toBe('OPERATIONS_HOLD');
      await database.client.booking.update({
        where: { id: booking.id },
        data: { operationalHold: false, claimDeadlineAt: new Date(Date.now() - 1000) },
      });
      await database.client.$queryRaw`SELECT complete_due_returned_bookings()`;
      expect(
        (await database.client.booking.findUniqueOrThrow({ where: { id: booking.id } })).status,
      ).toBe('COMPLETED');
      await database.client.$queryRaw`SELECT release_due_owner_earnings()`;
      expect(
        (await database.client.ownerEarning.findUniqueOrThrow({ where: { bookingId: booking.id } }))
          .status,
      ).toBe('PENDING');
      await database.client.ownerEarning.update({
        where: { bookingId: booking.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      await database.client.$queryRaw`SELECT release_due_owner_earnings()`;
      expect(
        (await database.client.ownerEarning.findUniqueOrThrow({ where: { bookingId: booking.id } }))
          .status,
      ).toBe('AVAILABLE');
    }, 60000);
  }

  function hold(token: string, quoteId: string, key: string) {
    return request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ quoteId });
  }

  async function createActor(
    label: string,
    roles: readonly RoleCode[],
    renterVerified = true,
  ): Promise<Actor> {
    const roleRows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    await database.client.user.create({
      data: {
        email: `${label}-${unique}@example.test`,
        emailVerifiedAt: new Date(),
        id: userId,
        mobileNumber: `+63917${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
        mobileVerifiedAt: new Date(),
        normalizedEmail: `${label}-${unique}@example.test`,
        profile: {
          create: {
            displayName: `Test ${label}`,
            driverLicenseExpiry: future(365, 0),
            firstName: 'Test',
            lastName: label,
          },
        },
        roles: { create: roleRows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: {
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            id: sessionId,
            platform: 'WEB',
          },
        },
      },
    });
    await attachAdminIdentity(
      database.client,
      userId,
      `${label}-${unique}@example.test`,
      `Test ${label}`,
      roles,
    );
    if (roles.includes(RoleCode.RENTER) && renterVerified) {
      await database.client.verification.createMany({
        data: [VerificationType.IDENTITY, VerificationType.DRIVER_LICENSE].map((type) => ({
          expiresAt: future(365, 0),
          reviewedAt: new Date(),
          status: VerificationStatus.APPROVED,
          type,
          userId,
        })),
      });
    }
    return { token: await tokens.signAccessToken(userId, sessionId, roles), userId };
  }

  async function createVehicle(model: string) {
    const category = await database.client.vehicleCategory.findFirstOrThrow({
      where: { active: true },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        approvedAt: new Date(),
        categoryId: category.id,
        description: 'Concurrency test vehicle',
        fuelType: 'GASOLINE',
        make: `PhaseFive-${unique}`,
        model,
        modelYear: 2026,
        ownerProfileId,
        ownerUserId: owner.userId,
        powertrain: 'ICE',
        seatCount: 5,
        status: 'APPROVED',
        transmission: 'AUTOMATIC',
      },
    });
    await database.client.vehicleLocation.create({
      data: {
        city: 'Lucena City',
        latitude: '13.941400',
        longitude: '121.623000',
        province: 'Quezon',
        timezone: 'Asia/Manila',
        vehicleId: vehicle.id,
      },
    });
    const photo = await file('PUBLIC', 'image/jpeg');
    await database.client.vehiclePhoto.create({
      data: {
        displayOrder: 0,
        fileAssetId: photo,
        isCover: true,
        perspective: 'FRONT',
        vehicleId: vehicle.id,
      },
    });
    const definitions = await database.client.vehicleDocumentDefinition.findMany({
      where: { active: true, jurisdiction: 'PH', required: true },
    });
    for (const definition of definitions) {
      await database.client.vehicleDocument.create({
        data: {
          definitionId: definition.id,
          expiresAt: future(365, 0),
          fileAssetId: await file('SENSITIVE', 'application/pdf'),
          status: VerificationStatus.VERIFIED,
          vehicleId: vehicle.id,
        },
      });
    }
    const policy = await database.client.vehiclePolicyVersion.create({
      data: policyData(vehicle.id, 1, 250_000),
    });
    return { id: vehicle.id, policyId: policy.id };
  }

  function policyData(vehicleId: string, version: number, dailyRateMinor: number) {
    return {
      availabilityPolicy: 'EVERY_DAY' as const,
      createdByUserId: owner.userId,
      dailyRateMinor,
      excessKilometerRateMinor: 1_000,
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

  async function createQuote(
    renterUserId: string,
    vehicleId: string,
    policyVersionId: string,
    rentalStart: Date,
    rentalEnd: Date,
  ): Promise<string> {
    const days = Math.ceil((rentalEnd.getTime() - rentalStart.getTime()) / 86_400_000);
    const amount = 250_000 * days;
    const quote = await database.client.pricingQuote.create({
      data: {
        baseRentalAmountMinor: amount,
        chargeableDays: days,
        currency: 'PHP',
        excessKilometerRateMinor: 1_000,
        expiresAt: new Date(Date.now() + 15 * 60_000),
        fuelReturnPolicy: 'SAME_TO_SAME',
        includedMileageKm: 150 * days,
        lines: {
          create: {
            amountMinor: amount,
            code: 'RENTAL_BASE',
            description: `${days} chargeable day(s)`,
            quantity: days,
            unitAmountMinor: 250_000,
          },
        },
        policyVersionId,
        pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
        rentalEnd,
        rentalStart,
        renterUserId,
        subtotalMinor: amount,
        discountedRentalSubtotalMinor: amount,
        totalMinor: amount,
        turnaroundMinutes: 120,
        unlimitedMileage: false,
        vehicleId,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    return quote.id;
  }

  async function file(
    classification: FileClassification,
    mimeType: string,
    uploadedById = owner.userId,
  ): Promise<string> {
    const asset = await database.client.fileAsset.create({
      data: {
        checksum: randomUUID().replaceAll('-', '').padEnd(64, 'a'),
        classification,
        mimeType,
        objectKey: `${unique}/${randomUUID()}`,
        originalName: 'test-file',
        size: 1n,
        status: FileAssetStatus.READY,
        uploadedById,
      },
    });
    return asset.id;
  }

  async function assertOwnerReturnInspectionDenied(
    reference: string,
    measurements: {
      readonly odometerMeters: string;
      readonly fuelBasisPoints?: number;
      readonly batterySocBasisPoints?: number;
    },
  ): Promise<void> {
    const media = await Promise.all(
      Object.values(InspectionPerspective)
        .filter((perspective) => perspective !== InspectionPerspective.ADDITIONAL)
        .map(async (perspective) => ({
          fileAssetId: await file('SENSITIVE', 'image/jpeg'),
          perspective,
        })),
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${reference}/rental/return/inspection`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ ...measurements, media })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('RETURN_INSPECTION_RENTER_ONLY'));
  }

  async function acceptPickupInspection(reference: string, renterToken: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${reference}/rental/pickup/inspection/review`)
      .set('Authorization', `Bearer ${renterToken}`)
      .send({ decision: 'AGREED' })
      .expect(201);
  }
});

function future(days: number, hour: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hour - 8, 0, 0, 0);
  return date;
}
