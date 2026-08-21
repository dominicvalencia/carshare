import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import { OwnerProfileStatus, RoleCode } from '@carrental/database';
import { type FakePayoutProvider } from '@carrental/payouts';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { PAYOUT_PROVIDER } from '../src/payouts/payout-provider.factory';

interface Actor {
  readonly token: string;
  readonly userId: string;
}

interface OwnerActor extends Actor {
  readonly ownerProfileId: string;
}

describe.sequential('Phase 9 owner payout settlement', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let tokens: TokenService;
  let provider: FakePayoutProvider;
  let admin: Actor;
  let renter: Actor;
  let support: Actor;
  let owner: OwnerActor;
  let secondOwner: OwnerActor;
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
    provider = app.get(PAYOUT_PROVIDER);
    admin = await createActor('admin', [RoleCode.SUPER_ADMIN]);
    renter = await createActor('renter', [RoleCode.RENTER]);
    support = await createActor('support', [RoleCode.SUPPORT]);
    owner = await createOwner('owner');
    secondOwner = await createOwner('owner-two');
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('protects destinations and settles exactly once under create, submit, and webhook races', async () => {
    const fullIdentifier = '09171234567';
    const accountResponse = await addAccount(owner, fullIdentifier, 'PH_GCASH', 'E_WALLET');
    const serialized = JSON.stringify(accountResponse.body.data);
    expect(serialized).not.toContain(fullIdentifier);
    expect(serialized).not.toContain('encryptedAccountIdentifier');
    expect(accountResponse.body.data.maskedAccountIdentifier).toMatch(/4567$/);

    const earning = await createAvailableEarning(owner, 'Concurrency');
    const creates = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/admin/payouts')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ ownerProfileId: owner.ownerProfileId }),
      ),
    );
    expect(creates.filter(({ status }) => status === 201)).toHaveLength(1);
    const payoutId = creates.find(({ status }) => status === 201)!.body.data.id as string;
    expect(
      await database.client.payoutItem.count({
        where: { activeAllocation: true, ownerEarningId: earning.id },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ note: 'Reviewed eligible earning and masked destination.' })
      .expect(201);

    const callsBefore = provider.createCallCount;
    const submits = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/admin/payouts/${payoutId}/submit`)
          .set('Authorization', `Bearer ${admin.token}`),
      ),
    );
    expect(submits.every(({ status }) => status === 201)).toBe(true);
    expect(provider.createCallCount - callsBefore).toBe(1);
    const processing = await database.client.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(processing.status).toBe('PROCESSING');
    expect(processing.providerPayoutId).toBeTruthy();
    provider.settle(processing.providerPayoutId!);

    const webhook = {
      event: 'fake_payout.succeeded',
      payout_id: processing.providerPayoutId,
      status: 'SUCCEEDED',
    };
    const [reconciliation, ...webhooks] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payoutId}/reconcile`)
        .set('Authorization', `Bearer ${admin.token}`),
      ...Array.from({ length: 10 }, () =>
        request(app.getHttpServer()).post('/api/v1/webhooks/xendit/payouts').send(webhook),
      ),
    ]);
    expect(reconciliation.status).toBe(201);
    expect(
      webhooks.map(({ body, status }) => ({
        code: body.error?.code,
        message: body.error?.message,
        status,
      })),
    ).toEqual(
      Array.from({ length: 10 }, () => ({ code: undefined, message: undefined, status: 201 })),
    );
    expect(
      (await database.client.payout.findUniqueOrThrow({ where: { id: payoutId } })).status,
    ).toBe('PAID');
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { id: earning.id } })).status,
    ).toBe('PAID');
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: payoutId, type: 'PAYOUT_SETTLEMENT' },
      }),
    ).toBe(1);
    const ledger = await database.client.ledgerTransaction.findMany({
      include: { entries: true },
      where: { sourceId: payoutId },
    });
    expect(ledger).toHaveLength(2);
    expect(
      ledger.every(
        (entry) => entry.entries.reduce((sum, line) => sum + line.amountMinor, 0n) === 0n,
      ),
    ).toBe(true);

    await request(app.getHttpServer())
      .get(`/api/v1/owner/payouts/${payoutId}`)
      .set('Authorization', `Bearer ${secondOwner.token}`)
      .expect(404);
  }, 60_000);

  it('reconciles an accepted payout after response loss without a second transfer', async () => {
    const account = await addAccount(owner, 'lost-response-123456', 'PH_BPI', 'BANK_ACCOUNT');
    await request(app.getHttpServer())
      .post(`/api/v1/owner/payout-accounts/${account.body.data.id}/default`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    await createAvailableEarning(owner, 'LostResponse');
    const created = await createAndApprove(owner.ownerProfileId);
    const callsBefore = provider.createCallCount;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${created}/submit`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(
      (await database.client.payout.findUniqueOrThrow({ where: { id: created } })).status,
    ).toBe('SUBMITTING');
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${created}/reconcile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    const recovered = await database.client.payout.findUniqueOrThrow({ where: { id: created } });
    expect(recovered.status).toBe('PROCESSING');
    expect(provider.createCallCount - callsBefore).toBe(1);
    provider.settle(recovered.providerPayoutId!);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${created}/reconcile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(
      (await database.client.payout.findUniqueOrThrow({ where: { id: created } })).status,
    ).toBe('PAID');
    expect(
      await database.client.ledgerTransaction.count({
        where: { sourceId: created, type: 'PAYOUT_SETTLEMENT' },
      }),
    ).toBe(1);
  }, 60_000);

  it('fails an invalid destination safely and releases the immutable earning allocation', async () => {
    const account = await addAccount(owner, 'fail-on-create-123456', 'PH_BPI', 'BANK_ACCOUNT');
    await request(app.getHttpServer())
      .post(`/api/v1/owner/payout-accounts/${account.body.data.id}/default`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    const earning = await createAvailableEarning(owner, 'InvalidDestination');
    const payoutId = await createAndApprove(owner.ownerProfileId);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/submit`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(
      await database.client.payout.findUniqueOrThrow({ where: { id: payoutId } }),
    ).toMatchObject({
      failureCategory: 'INVALID_DESTINATION',
      status: 'FAILED',
    });
    expect(
      await database.client.ownerPayoutAccount.findUniqueOrThrow({
        where: { id: account.body.data.id },
      }),
    ).toMatchObject({
      isDefault: false,
      status: 'REQUIRES_ACTION',
    });
    expect(
      await database.client.ownerEarning.findUniqueOrThrow({ where: { id: earning.id } }),
    ).toMatchObject({
      status: 'AVAILABLE',
    });
    expect(
      await database.client.payoutItem.findFirstOrThrow({ where: { payoutId } }),
    ).toMatchObject({
      activeAllocation: false,
    });
    expect(
      await database.client.outboxEvent.count({
        where: { aggregateId: payoutId, eventType: 'PAYOUT_FAILED' },
      }),
    ).toBe(1);
  }, 60_000);

  it('creates a batch with one isolated payout per owner', async () => {
    const restored = await addAccount(owner, '09176660123', 'PH_GCASH', 'E_WALLET');
    await request(app.getHttpServer())
      .post(`/api/v1/owner/payout-accounts/${restored.body.data.id}/default`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(201);
    const failing = await addAccount(
      secondOwner,
      'fail-on-create-batch-5550123',
      'PH_GCASH',
      'E_WALLET',
    );
    await request(app.getHttpServer())
      .post(`/api/v1/owner/payout-accounts/${failing.body.data.id}/default`)
      .set('Authorization', `Bearer ${secondOwner.token}`)
      .expect(201);
    await createAvailableEarning(owner, 'BatchOwnerOne');
    await createAvailableEarning(secondOwner, 'BatchOwnerTwo');
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/payout-batches')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        note: 'Pilot batch with owner-isolated settlement.',
        ownerProfileIds: [owner.ownerProfileId, secondOwner.ownerProfileId],
      })
      .expect(201);
    expect(response.body.data.payouts).toHaveLength(2);
    const rows = await database.client.payout.findMany({
      include: { items: { include: { ownerEarning: true } } },
      where: { batchId: response.body.data.batch.id },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.every((payout) =>
        payout.items.every((item) => item.ownerEarning.ownerProfileId === payout.ownerProfileId),
      ),
    ).toBe(true);
    for (const payout of rows) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payout.id}/approve`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ note: 'Batch payout reviewed independently.' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/admin/payouts/${payout.id}/submit`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(201);
    }
    const isolated = await database.client.payout.findMany({
      where: { batchId: response.body.data.batch.id },
    });
    expect(isolated.find((payout) => payout.ownerProfileId === owner.ownerProfileId)?.status).toBe(
      'PROCESSING',
    );
    expect(
      isolated.find((payout) => payout.ownerProfileId === secondOwner.ownerProfileId)?.status,
    ).toBe('FAILED');
  }, 60_000);

  it('denies payout operations to support and keeps owner account scope isolated', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/payouts')
      .set('Authorization', `Bearer ${support.token}`)
      .expect(403);
    const ownerAccounts = await request(app.getHttpServer())
      .get('/api/v1/owner/payout-accounts')
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    const secondAccounts = await request(app.getHttpServer())
      .get('/api/v1/owner/payout-accounts')
      .set('Authorization', `Bearer ${secondOwner.token}`)
      .expect(200);
    expect(
      ownerAccounts.body.data.items.some((account: { id: string }) =>
        secondAccounts.body.data.items.some((other: { id: string }) => other.id === account.id),
      ),
    ).toBe(false);
    expect(JSON.stringify(ownerAccounts.body.data)).not.toContain('encryptedAccountIdentifier');
  });

  async function createAndApprove(ownerProfileId: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/payouts')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ownerProfileId })
      .expect(201);
    const payoutId = created.body.data.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${payoutId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ note: 'Finance review completed.' })
      .expect(201);
    return payoutId;
  }

  async function addAccount(
    actor: OwnerActor,
    identifier: string,
    destinationChannel: string,
    type: 'BANK_ACCOUNT' | 'E_WALLET',
  ) {
    return request(app.getHttpServer())
      .post('/api/v1/owner/payout-accounts')
      .set('Authorization', `Bearer ${actor.token}`)
      .send({
        accountHolderName: `Phase Nine ${actor.ownerProfileId.slice(0, 8)}`,
        accountIdentifier: identifier,
        destinationChannel,
        type,
      })
      .expect(201);
  }

  async function createOwner(label: string): Promise<OwnerActor> {
    const actor = await createActor(label, [RoleCode.OWNER, RoleCode.RENTER]);
    const profile = await database.client.ownerProfile.create({
      data: {
        legalName: `Phase Nine ${label}`,
        payoutEligibility: {
          create: {
            lastEvaluatedAt: new Date(),
            reason: 'Deterministic Phase 9 integration fixture.',
            status: 'ELIGIBLE',
          },
        },
        status: OwnerProfileStatus.VERIFIED,
        userId: actor.userId,
        verifiedAt: new Date(),
      },
    });
    return { ...actor, ownerProfileId: profile.id };
  }

  async function createActor(label: string, roles: readonly RoleCode[]): Promise<Actor> {
    const roleRows = await database.client.role.findMany({ where: { code: { in: [...roles] } } });
    const userId = randomUUID();
    const sessionId = randomUUID();
    const email = `${label}-${unique}-${randomUUID().slice(0, 6)}@example.test`;
    await database.client.user.create({
      data: {
        email,
        id: userId,
        normalizedEmail: email,
        profile: { create: { displayName: `Phase 9 ${label}` } },
        roles: { create: roleRows.map(({ id }) => ({ roleId: id })) },
        sessions: {
          create: { expiresAt: new Date(Date.now() + 86_400_000), id: sessionId, platform: 'WEB' },
        },
      },
    });
    return { token: await tokens.signAccessToken(userId, sessionId, roles), userId };
  }

  async function createAvailableEarning(actor: OwnerActor, model: string) {
    const category = await database.client.vehicleCategory.findFirstOrThrow({
      where: { active: true },
    });
    const vehicle = await database.client.vehicle.create({
      data: {
        approvedAt: new Date(),
        categoryId: category.id,
        fuelType: 'GASOLINE',
        make: `Payout-${unique}`,
        model,
        modelYear: 2026,
        ownerProfileId: actor.ownerProfileId,
        ownerUserId: actor.userId,
        powertrain: 'ICE',
        seatCount: 5,
        status: 'APPROVED',
        transmission: 'AUTOMATIC',
      },
    });
    const policy = await database.client.vehiclePolicyVersion.create({
      data: {
        createdByUserId: actor.userId,
        dailyRateMinor: 100_000,
        fuelReturnPolicy: 'SAME_TO_SAME',
        fuelTolerancePercent: 5,
        includedKilometersPerDay: 150,
        maximumRentalDays: 30,
        mileagePolicy: 'LIMITED',
        minimumRentalDays: 1,
        turnaroundMinutes: 120,
        vehicleId: vehicle.id,
        version: 1,
      },
    });
    const rentalStart = new Date(Date.now() - 3 * 86_400_000);
    const rentalEnd = new Date(Date.now() - 2 * 86_400_000);
    const quote = await database.client.pricingQuote.create({
      data: {
        chargeableDays: 1,
        currency: 'PHP',
        excessKilometerRateMinor: 1_000,
        expiresAt: new Date(Date.now() + 60_000),
        fuelReturnPolicy: 'SAME_TO_SAME',
        includedMileageKm: 150,
        policyVersionId: policy.id,
        pricingEngineVersion: 'PHP_DAILY_24H_CEILING_V1',
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        subtotalMinor: 100_000,
        totalMinor: 100_000,
        turnaroundMinutes: 120,
        unlimitedMileage: false,
        vehicleId: vehicle.id,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    const booking = await database.client.booking.create({
      data: {
        ownerProfileId: actor.ownerProfileId,
        ownerUserId: actor.userId,
        publicReference: `P9-${randomUUID().slice(0, 12)}`,
        quoteId: quote.id,
        rentalEnd,
        rentalStart,
        renterUserId: renter.userId,
        status: 'COMPLETED',
        vehicleId: vehicle.id,
      },
    });
    const payment = await database.client.payment.create({
      data: {
        amountMinor: 100_000n,
        authorizedAmountMinor: 100_000n,
        bookingId: booking.id,
        capturedAmountMinor: 100_000n,
        capturedAt: new Date(),
        currency: 'PHP',
        externalPaymentId: `p9-${randomUUID()}`,
        provider: 'FAKE',
        providerRequestReference: randomUUID(),
        providerState: 'CAPTURED',
        purpose: 'RENTAL',
        status: 'CAPTURED',
      },
    });
    return database.client.ownerEarning.create({
      data: {
        availableAt: new Date(Date.now() - 1_000),
        bookingId: booking.id,
        commissionAmountMinor: 15_000n,
        currency: 'PHP',
        grossRentalAmountMinor: 100_000n,
        netEarningAmountMinor: 85_000n,
        ownerProfileId: actor.ownerProfileId,
        paymentId: payment.id,
        status: 'AVAILABLE',
      },
    });
  }
});
