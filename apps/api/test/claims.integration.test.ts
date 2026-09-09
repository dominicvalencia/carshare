import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import { OwnerProfileStatus, Prisma, RoleCode } from '@carrental/database';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { attachAdminIdentity } from './admin-fixture';

interface Actor {
  readonly token: string;
  readonly userId: string;
}

describe.sequential('Phase 8 claims and earning financial safety', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let owner: Actor;
  let renter: Actor;
  let admin: Actor;
  let ownerProfileId = '';
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    owner = await createActor('owner', [RoleCode.OWNER, RoleCode.RENTER]);
    renter = await createActor('renter', [RoleCode.RENTER]);
    admin = await createActor('admin', [RoleCode.SUPER_ADMIN]);
    ownerProfileId = (
      await database.client.ownerProfile.create({
        data: {
          legalName: 'Phase Eight Test Owner',
          status: OwnerProfileStatus.VERIFIED,
          userId: owner.userId,
          verifiedAt: new Date(),
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('calculates, adjudicates, and collects one mileage charge under concurrent triggers', async () => {
    const booking = await returnedBooking('MileageConcurrency', { excessKm: 70 });
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${booking.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'EXCESS_MILEAGE',
        description: 'Return inspection measured seventy whole excess kilometres.',
      })
      .expect(201);
    const claimId = submitted.body.data.id as string;
    const calculation = await database.client.claimCalculation.findFirstOrThrow({
      where: { claimId },
    });
    expect(calculation).toMatchObject({
      amountMinor: 70_000n,
      formulaVersion: 'EXCESS_MILEAGE_WHOLE_KM_V1',
      quantity: 70,
      unitRateMinor: 1_000n,
    });
    const held = await database.client.earningHold.findFirstOrThrow({ where: { claimId } });
    expect(held).toMatchObject({ amountMinor: 77_000n, mode: 'PARTIAL', status: 'ACTIVE' });

    await request(app.getHttpServer())
      .post(`/api/v1/claims/${claimId}/respond`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'ACKNOWLEDGED' })
      .expect(201);

    const approvals = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/admin/claims/${claimId}/adjudicate`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({
            outcome: 'APPROVED',
            reason: 'The immutable usage and pricing snapshots support the formula.',
          }),
      ),
    );
    expect(approvals.filter(({ status }) => status === 201)).toHaveLength(1);
    expect(await database.client.claimAdjudication.count({ where: { claimId } })).toBe(1);
    const charge = await database.client.additionalCharge.findUniqueOrThrow({
      where: { claimId },
    });
    expect(charge).toMatchObject({
      approvedAmountMinor: 70_000n,
      ownerCompensationMinor: 70_000n,
      platformShareMinor: 0n,
      status: 'PAYMENT_PENDING',
    });

    const paymentAttempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/additional-charges/${charge.id}/payment`)
          .set('Authorization', `Bearer ${renter.token}`),
      ),
    );
    expect(paymentAttempts.map(({ body, status }) => ({ body, status }))).toEqual(
      Array.from({ length: 10 }, () => expect.objectContaining({ status: 201 })),
    );
    const paid = await database.client.additionalCharge.findUniqueOrThrow({
      include: { payment: { include: { operations: true } } },
      where: { id: charge.id },
    });
    expect(paid.status).toBe('PAID');
    expect(paid.payment?.status).toBe('CAPTURED');
    expect(paid.payment?.operations).toHaveLength(2);
    expect(await database.client.payment.count({ where: { additionalChargeId: charge.id } })).toBe(
      1,
    );
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: paid.payment!.id },
      }),
    ).toBe(2);
    expect(
      (await database.client.postReturnClaim.findUniqueOrThrow({ where: { id: claimId } })).status,
    ).toBe('RESOLVED');
    expect(
      (
        await database.client.ownerEarning.findUniqueOrThrow({
          where: { bookingId: booking.id },
        })
      ).additionalCompensationMinor,
    ).toBe(70_000n);
  }, 60_000);

  it('keeps damage evidence reviewed, disputes separate, and rejects missing evidence', async () => {
    const booking = await returnedBooking('DamageEvidence', { excessKm: 0 });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${booking.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ category: 'DAMAGE', description: 'A specific damaged area was reported.' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('CLAIM_EVIDENCE_REQUIRED'));

    const formula = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${booking.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ category: 'LATE_RETURN', description: 'No late duration actually exists.' })
      .expect(422);
    expect(formula.body.error.code).toBe('CLAIM_FORMULA_NOT_APPLICABLE');
  });

  it('preserves versioned late/fuel/EV facts, rejects unlimited mileage, and records no-response', async () => {
    const unlimited = await returnedBooking('UnlimitedMileage', {
      excessKm: 70,
      unlimitedMileage: true,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${unlimited.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ category: 'EXCESS_MILEAGE', description: 'Attempted unlimited mileage claim.' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('CLAIM_FORMULA_NOT_APPLICABLE'));

    const late = await returnedBooking('LateFormula', { excessKm: 0, lateDurationSeconds: 7_200 });
    const lateClaim = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${late.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ category: 'LATE_RETURN', description: 'Return was two measured hours late.' })
      .expect(201);
    const lateCalculation = await database.client.claimCalculation.findFirstOrThrow({
      where: { claimId: lateClaim.body.data.id as string },
    });
    expect(lateCalculation).toMatchObject({
      amountMinor: 13_890n,
      formulaVersion: 'LATE_HOURLY_DAILY_CAP_V1',
      quantity: 2,
      roundingRule: 'CEIL_TO_HOUR_DAILY_RATE_CAP',
    });

    const fuel = await returnedBooking('FuelDeficiency', {
      excessKm: 0,
      fuelDeficiencyBasisPoints: 1_500,
    });
    const fuelClaim = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${fuel.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ category: 'FUEL_DEFICIENCY', description: 'Measured fuel deficiency at return.' })
      .expect(201);
    expect(
      await database.client.claimCalculation.findFirstOrThrow({
        where: { claimId: fuelClaim.body.data.id as string },
      }),
    ).toMatchObject({
      amountMinor: 0n,
      formulaVersion: 'FUEL_ADMIN_PLATFORM_VALUATION_V1',
      quantity: 1_500,
      roundingRule: 'ADMIN_PLATFORM_VALUATION_WITH_POLICY_CAP',
    });

    const ev = await returnedBooking('EvDeficiency', {
      excessKm: 0,
      powertrain: 'BATTERY_ELECTRIC',
      socDeficiencyBasisPoints: 2_000,
    });
    const evClaim = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${ev.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'EV_BATTERY_DEFICIENCY',
        description: 'Measured SOC deficiency at return.',
      })
      .expect(201);
    const evClaimId = evClaim.body.data.id as string;
    expect(
      await database.client.claimCalculation.findFirstOrThrow({ where: { claimId: evClaimId } }),
    ).toMatchObject({
      amountMinor: 0n,
      formulaVersion: 'EV_ADMIN_PLATFORM_VALUATION_V1',
      quantity: 2_000,
    });
    await database.client.postReturnClaim.update({
      data: { responseDeadlineAt: new Date(Date.now() - 1_000) },
      where: { id: evClaimId },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "emit_claim_financial_notifications"()`);
    expect(
      await database.client.claimResponse.findUniqueOrThrow({ where: { claimId: evClaimId } }),
    ).toMatchObject({ decision: 'NO_RESPONSE', renterUserId: renter.userId });
    expect(
      (await database.client.postReturnClaim.findUniqueOrThrow({ where: { id: evClaimId } }))
        .status,
    ).toBe('UNDER_ADMIN_REVIEW');
  }, 60_000);

  it('partially approves a disputed damage claim and refunds it exactly once', async () => {
    const booking = await returnedBooking('DamageDisputeRefund', { excessKm: 0 });
    await database.client.inspection.createMany({
      data: [
        {
          bookingId: booking.id,
          finalizedAt: new Date(),
          fuelBasisPoints: 10_000,
          odometerMeters: 1_000_000n,
          status: 'FINALIZED',
          submittedByUserId: owner.userId,
          type: 'PICKUP',
        },
        {
          bookingId: booking.id,
          finalizedAt: new Date(),
          fuelBasisPoints: 10_000,
          odometerMeters: 1_450_000n,
          status: 'FINALIZED',
          submittedByUserId: owner.userId,
          type: 'RETURN',
        },
      ],
    });
    const evidence = await database.client.fileAsset.create({
      data: {
        checksum: 'a'.repeat(64),
        classification: 'PRIVATE',
        mimeType: 'image/jpeg',
        objectKey: `claims/${unique}/${randomUUID()}.jpg`,
        originalName: 'return-damage.jpg',
        size: 25_000n,
        status: 'READY',
        uploadedById: owner.userId,
      },
    });
    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/owner/bookings/${booking.reference}/claims`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        category: 'DAMAGE',
        description: 'Specific new damage on the left rear door after return.',
        evidence: [{ evidenceType: 'PHOTO', fileAssetId: evidence.id }],
      })
      .expect(201);
    const claimId = submitted.body.data.id as string;
    await request(app.getHttpServer())
      .get('/api/v1/admin/claims?severity=HIGH&minimumAgeHours=0&category=DAMAGE')
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: claimId, severity: 'HIGH' })]),
        );
      });
    await request(app.getHttpServer())
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/claims/${claimId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.claim.severity).toBe('HIGH'));
    await request(app.getHttpServer())
      .post(`/api/v1/claims/${claimId}/respond`)
      .set('Authorization', `Bearer ${renter.token}`)
      .send({ decision: 'DISPUTED', explanation: 'The pickup image already shows this mark.' })
      .expect(201);
    expect(await database.client.dispute.count({ where: { claimId, status: 'OPEN' } })).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/claims/${claimId}/adjudicate`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        approvedAmountMinor: 100_000,
        outcome: 'PARTIALLY_APPROVED',
        reason: 'The evidence supports only the documented portion of the repair estimate.',
      })
      .expect(201);
    const charge = await database.client.additionalCharge.findUniqueOrThrow({
      where: { claimId },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/additional-charges/${charge.id}/payment`)
      .set('Authorization', `Bearer ${renter.token}`)
      .expect(201);

    const refundAttempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/admin/additional-charges/${charge.id}/refund`)
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ amountMinor: 25_000, reason: 'Post-resolution evidence reduced the liability.' }),
      ),
    );
    expect(refundAttempts.some(({ status }) => status === 201)).toBe(true);
    expect(refundAttempts.every(({ status }) => status === 201 || status === 409)).toBe(true);
    const refunded = await database.client.additionalCharge.findUniqueOrThrow({
      include: { ownerEarning: true, payment: { include: { refunds: true } } },
      where: { id: charge.id },
    });
    expect(refunded).toMatchObject({
      refundedAmountMinor: 25_000n,
      status: 'PARTIALLY_REFUNDED',
    });
    expect(refunded.payment?.refunds).toHaveLength(1);
    expect(refunded.ownerEarning.additionalCompensationMinor).toBe(100_000n);
    expect(refunded.ownerEarning.adjustmentAmountMinor).toBe(-25_000n);
    expect(
      await database.client.ledgerTransaction.count({
        where: {
          sourceId: { in: refunded.payment!.refunds.map(({ id }) => id) },
          sourceType: 'ADDITIONAL_CHARGE_REFUND',
        },
      }),
    ).toBe(1);
    await expect(
      database.client.postReturnClaimEvidence.update({
        data: { note: 'Attempted mutation' },
        where: { fileAssetId: evidence.id },
      }),
    ).rejects.toThrow();
  }, 60_000);

  it('serializes earning release against a new hold and never creates a payout', async () => {
    const booking = await returnedBooking('EarningReleaseRace', { excessKm: 0 });
    await database.client.booking.update({
      data: { claimDeadlineAt: new Date(Date.now() - 1_000) },
      where: { id: booking.id },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "complete_due_returned_bookings"()`);
    const earning = await database.client.ownerEarning.findUniqueOrThrow({
      where: { bookingId: booking.id },
    });
    expect(earning.availableAt).not.toBeNull();
    await database.client.ownerEarning.update({
      data: { availableAt: new Date(Date.now() - 1_000) },
      where: { id: earning.id },
    });
    await Promise.allSettled([
      database.client.$queryRaw(Prisma.sql`SELECT "release_due_owner_earnings"()`),
      database.client.earningHold.create({
        data: {
          amountMinor: earning.netEarningAmountMinor,
          createdByUserId: admin.userId,
          currency: earning.currency,
          mode: 'FULL',
          ownerEarningId: earning.id,
          rationale: 'Concurrent administrative reconciliation hold.',
          reason: 'ADMIN_REVIEW',
        },
      }),
    ]);
    const raced = await database.client.ownerEarning.findUniqueOrThrow({
      include: { holds: true },
      where: { id: earning.id },
    });
    expect(raced.holds.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(raced.status).toBe('HELD');

    await database.client.earningHold.updateMany({
      data: { releasedAt: new Date(), resolution: 'Reconciled', status: 'RELEASED' },
      where: { ownerEarningId: earning.id, status: 'ACTIVE' },
    });
    await database.client.ownerEarning.update({
      data: { status: 'PENDING' },
      where: { id: earning.id },
    });
    await database.client.$queryRaw(Prisma.sql`SELECT "release_due_owner_earnings"()`);
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
    ).toBe('AVAILABLE');
    expect('payout' in database.client).toBe(true);
  });

  async function createActor(label: string, roles: readonly RoleCode[]): Promise<Actor> {
    const roleRows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    await database.client.user.create({
      data: {
        email: `${label}-${unique}@example.test`,
        id: userId,
        normalizedEmail: `${label}-${unique}@example.test`,
        profile: { create: { displayName: `Phase 8 ${label}` } },
        roles: { create: roleRows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: {
            expiresAt: new Date(Date.now() + 86_400_000),
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
      `Phase 8 ${label}`,
      roles,
    );
    return { token: await tokens.signAccessToken(userId, sessionId, roles), userId };
  }

  async function returnedBooking(
    model: string,
    input: {
      excessKm: number;
      fuelDeficiencyBasisPoints?: number;
      lateDurationSeconds?: number;
      powertrain?: 'BATTERY_ELECTRIC' | 'ICE';
      socDeficiencyBasisPoints?: number;
      unlimitedMileage?: boolean;
    },
  ) {
    const category = await database.client.vehicleCategory.findFirstOrThrow({
      where: { active: true },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        approvedAt: new Date(),
        categoryId: category.id,
        description: 'Phase 8 test vehicle',
        fuelType: input.powertrain === 'BATTERY_ELECTRIC' ? 'ELECTRIC' : 'GASOLINE',
        make: `Claims-${unique}`,
        model,
        modelYear: 2026,
        ownerProfileId,
        ownerUserId: owner.userId,
        powertrain: input.powertrain ?? 'ICE',
        seatCount: 5,
        status: 'APPROVED',
        transmission: 'AUTOMATIC',
      },
    });
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        availabilityPolicy: 'EVERY_DAY',
        createdByUserId: owner.userId,
        dailyRateMinor: 250_000,
        excessKilometerRateMinor: input.unlimitedMileage ? null : 1_000,
        evRequiredPercentage: input.powertrain === 'BATTERY_ELECTRIC' ? 80 : null,
        evReturnPolicy: input.powertrain === 'BATTERY_ELECTRIC' ? 'MINIMUM_PERCENTAGE' : null,
        evTolerancePercent: input.powertrain === 'BATTERY_ELECTRIC' ? 5 : null,
        fuelReturnPolicy: input.powertrain === 'BATTERY_ELECTRIC' ? null : 'SAME_TO_SAME',
        fuelTolerancePercent: input.powertrain === 'BATTERY_ELECTRIC' ? null : 5,
        includedKilometersPerDay: input.unlimitedMileage ? null : 150,
        maximumRentalDays: 30,
        mileagePolicy: input.unlimitedMileage ? 'UNLIMITED' : 'LIMITED',
        minimumRentalDays: 1,
        turnaroundMinutes: 120,
        vehicleId: vehicle.id,
        version: 1,
      },
    });
    const rentalStart = new Date(Date.now() - 4 * 86_400_000);
    const rentalEnd = new Date(Date.now() - 86_400_000);
    const quote = await database.client.pricingQuote.create({
      data: {
        baseRentalAmountMinor: 500_000,
        chargeableDays: 3,
        currency: 'PHP',
        excessKilometerRateMinor: input.unlimitedMileage ? null : 1_000,
        expiresAt: new Date(Date.now() + 60_000),
        fuelReturnPolicy: input.powertrain === 'BATTERY_ELECTRIC' ? null : 'SAME_TO_SAME',
        includedMileageKm: input.unlimitedMileage ? null : 450,
        policyVersionId: policy.id,
        pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        subtotalMinor: 500_000,
        discountedRentalSubtotalMinor: 500_000,
        totalMinor: 500_000,
        turnaroundMinutes: 120,
        unlimitedMileage: input.unlimitedMileage ?? false,
        vehicleId: vehicle.id,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    const booking = await database.client.booking.create({
      data: {
        actualReturnAt: new Date(),
        claimDeadlineAt: new Date(Date.now() + 3_600_000),
        ownerProfileId,
        ownerUserId: owner.userId,
        publicReference: `P8-${randomUUID().slice(0, 12)}`,
        quoteId: quote.id,
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        status: 'RETURNED',
        vehicleId: vehicle.id,
      },
    });
    await database.client.bookingPricingSnapshot.create({
      data: {
        baseRentalAmountMinor: 500_000,
        bookingId: booking.id,
        chargeableDays: 3,
        currency: 'PHP',
        excessKilometerRateMinor: input.unlimitedMileage ? null : 1_000,
        includedMileageKm: input.unlimitedMileage ? null : 450,
        policyVersionId: policy.id,
        pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
        quoteId: quote.id,
        rentalEnd,
        rentalStart,
        subtotalMinor: 500_000,
        discountedRentalSubtotalMinor: 500_000,
        totalMinor: 500_000,
        unlimitedMileage: input.unlimitedMileage ?? false,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    await database.client.bookingPolicySnapshot.create({
      data: {
        availabilityPolicy: 'EVERY_DAY',
        bookingId: booking.id,
        claimWindowHours: 24,
        excessKilometerRateMinor: input.unlimitedMileage ? null : 1_000,
        friday: true,
        evRequiredPercentage: input.powertrain === 'BATTERY_ELECTRIC' ? 80 : null,
        evReturnPolicy: input.powertrain === 'BATTERY_ELECTRIC' ? 'MINIMUM_PERCENTAGE' : null,
        evTolerancePercent: input.powertrain === 'BATTERY_ELECTRIC' ? 5 : null,
        fuelReturnPolicy: input.powertrain === 'BATTERY_ELECTRIC' ? null : 'SAME_TO_SAME',
        fuelTolerancePercent: input.powertrain === 'BATTERY_ELECTRIC' ? null : 5,
        includedKilometersPerDay: input.unlimitedMileage ? null : 150,
        mileagePolicy: input.unlimitedMileage ? 'UNLIMITED' : 'LIMITED',
        monday: true,
        policyVersionId: policy.id,
        saturday: true,
        sunday: true,
        thursday: true,
        tuesday: true,
        turnaroundMinutes: 120,
        wednesday: true,
      },
    });
    await database.client.bookingUsageSummary.create({
      data: {
        actualReturnAt: new Date(),
        bookingId: booking.id,
        distanceTravelledKm: 450 + input.excessKm,
        distanceTravelledMeters: BigInt((450 + input.excessKm) * 1000),
        excessDistanceKm: input.excessKm,
        fuelDeficiencyBasisPoints: input.fuelDeficiencyBasisPoints ?? 0,
        includedDistanceKm: input.unlimitedMileage ? null : 450,
        lateDurationSeconds: input.lateDurationSeconds ?? 0,
        pickupFuelBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? null : 10_000,
        pickupOdometerMeters: 1_000_000n,
        pickupSocBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? 8_000 : null,
        requiredFuelBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? null : 10_000,
        requiredSocBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? 8_000 : null,
        returnFuelBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? null : 10_000,
        returnOdometerMeters: BigInt(1_000_000 + (450 + input.excessKm) * 1000),
        returnSocBasisPoints: input.powertrain === 'BATTERY_ELECTRIC' ? 6_000 : null,
        scheduledReturnAt: rentalEnd,
        socDeficiencyBasisPoints: input.socDeficiencyBasisPoints ?? null,
      },
    });
    const payment = await database.client.payment.create({
      data: {
        amountMinor: 500_000n,
        authorizedAmountMinor: 500_000n,
        bookingId: booking.id,
        capturedAmountMinor: 500_000n,
        capturedAt: new Date(),
        currency: 'PHP',
        externalPaymentId: `base-${randomUUID()}`,
        provider: 'FAKE',
        providerRequestReference: randomUUID(),
        providerState: 'CAPTURED',
        purpose: 'RENTAL',
        status: 'CAPTURED',
      },
    });
    await database.client.ownerEarning.create({
      data: {
        bookingId: booking.id,
        commissionAmountMinor: 75_000n,
        currency: 'PHP',
        grossRentalAmountMinor: 500_000n,
        netEarningAmountMinor: 425_000n,
        ownerProfileId,
        paymentId: payment.id,
        status: 'PENDING',
      },
    });
    return { id: booking.id, reference: booking.publicReference };
  }
});
