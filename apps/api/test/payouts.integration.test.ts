import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '@carrental/api-contracts';
import { OwnerProfileStatus, RoleCode, Prisma } from '@carrental/database';
import { PayoutEligibilityService } from '../src/payouts/payout-eligibility.service';
import { PayoutsService } from '../src/payouts/payouts.service';
import { type FakePayoutProvider } from '@carrental/payouts';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { attachAdminIdentity } from './admin-fixture';
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

  it('preserves legacy eligibility and fails closed for incomplete B4 and unknown versions', async () => {
    const actor = await createOwner('workflow-safety');
    await addAccount(actor, '09171234567', 'PH_GCASH', 'E_WALLET');
    const legacy = await createAvailableEarning(actor, 'Legacy');
    const b4 = await createAvailableEarning(actor, 'B4Incomplete', 1);
    const future = await createAvailableEarning(actor, 'FutureWorkflow', 2);
    for (const earning of [legacy, future]) {
      const booking = await database.client.booking.findUniqueOrThrow({
        where: { id: earning.bookingId },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/owner/bookings/${booking.publicReference}/rental/pickup/evidence-waiver`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ acknowledged: true, acknowledgementVersion: 'HANDOVER_EVIDENCE_WAIVER_V1' })
        .expect(409);
      await expect(
        database.client.bookingHandoverEvidenceWaiver.create({
          data: {
            bookingId: booking.id,
            phase: 'START',
            waivedByUserId: actor.userId,
            acknowledgementVersion: 'HANDOVER_EVIDENCE_WAIVER_V1',
          },
        }),
      ).rejects.toThrow();
    }
    for (const earning of [legacy, b4, future])
      await database.client.ownerEarning.update({
        where: { id: earning.id },
        data: { status: 'PENDING' },
      });
    await database.client.$queryRaw(Prisma.sql`SELECT "release_due_owner_earnings"()`);
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { id: legacy.id } })).status,
    ).toBe('AVAILABLE');
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { id: b4.id } })).status,
    ).toBe('PENDING');
    expect(
      (await database.client.ownerEarning.findUniqueOrThrow({ where: { id: future.id } })).status,
    ).toBe('PENDING');
    // Even a stale AVAILABLE row must not bypass selection/allocation authority.
    await database.client.ownerEarning.update({
      where: { id: b4.id },
      data: { status: 'AVAILABLE' },
    });
    const diagnostics = await app
      .get(PayoutEligibilityService)
      .earningDiagnostics(actor.ownerProfileId);
    expect(diagnostics.find((item) => item.earning.id === legacy.id)?.eligible).toBe(true);
    expect(diagnostics.find((item) => item.earning.id === b4.id)?.blockers).toContain(
      'OWNER_INSPECTION_REQUIRED',
    );
    expect(diagnostics.find((item) => item.earning.id === future.id)?.blockers).toContain(
      'UNSUPPORTED_HANDOVER_WORKFLOW',
    );
    const selected = await request(app.getHttpServer())
      .post('/api/v1/admin/payouts')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ownerProfileId: actor.ownerProfileId })
      .expect(201);
    const payoutId = selected.body.data.id as string;
    const items = await database.client.payoutItem.findMany({ where: { payoutId } });
    expect(items.map((item) => item.ownerEarningId)).toEqual([legacy.id]);
    await expect(
      database.client.payoutItem.create({
        data: {
          payoutId,
          ownerEarningId: b4.id,
          amountMinor: b4.netEarningAmountMinor,
          currency: 'PHP',
        },
      }),
    ).rejects.toThrow('workflow incomplete');
  });

  it('preserves full fulfillment earnings and the maximum-selection bound', async () => {
    const actor = await createOwner('fulfillment-allocation');
    await addAccount(actor, '09171234567', 'PH_GCASH', 'E_WALLET');
    await createAvailableEarning(actor, 'FulfillmentAllocation', null, {
      deliveryEarningMinor: 5000n,
      collectionEarningMinor: 3000n,
    });
    const eligibility = app.get(PayoutEligibilityService);
    expect(
      await database.client.$queryRaw(
        eligibility.eligibleSelectionSql(actor.ownerProfileId, 90000n),
      ),
    ).toEqual([]);
    const selected = await request(app.getHttpServer())
      .post('/api/v1/admin/payouts')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ ownerProfileId: actor.ownerProfileId })
      .expect(201);
    const item = await database.client.payoutItem.findFirstOrThrow({
      where: { payoutId: selected.body.data.id },
    });
    expect(item.amountMinor).toBe(93000n);
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

  it('recovers an Owner penalty across a zero-net and later partial-net payout', async () => {
    const actor = await createOwner('penalty-recovery');
    await addAccount(actor, '09170001111', 'PH_GCASH', 'E_WALLET');
    const source = await createAvailableEarning(actor, 'PenaltySource', null, undefined, {
      commissionAmountMinor: 150_000n,
      grossRentalAmountMinor: 1_000_000n,
      netEarningAmountMinor: 850_000n,
    });
    await database.client.ownerEarning.update({
      data: { status: 'PAID' },
      where: { id: source.id },
    });
    const obligation = await createPenaltyObligation(actor, source, 150_000n);
    const firstEarning = await createAvailableEarning(actor, 'RecoveryOne', null, undefined, {
      commissionAmountMinor: 15_000n,
      grossRentalAmountMinor: 115_000n,
      netEarningAmountMinor: 100_000n,
    });
    const first = await createAndApprove(actor.ownerProfileId);
    const calls = provider.createCallCount;
    const zero = await app.get(PayoutsService).submit(admin.userId, first, {
      correlationId: `test-zero-${randomUUID()}`,
    });
    expect(provider.createCallCount).toBe(calls);
    expect(zero).toMatchObject({
      amountMinor: 0,
      cancellationPenaltyRecoveryMinor: 100_000,
      grossEligibleEarningsMinor: 100_000,
      outstandingCancellationPenaltyMinor: 50_000,
      status: 'PAID',
    });
    const zeroPayout = await database.client.payout.findUniqueOrThrow({
      include: { adjustments: true, items: true },
      where: { id: first },
    });
    expect(zeroPayout).toMatchObject({ amountMinor: 0n, providerPayoutId: null, status: 'PAID' });
    expect(zeroPayout.items).toEqual([
      expect.objectContaining({ amountMinor: 100_000n, ownerEarningId: firstEarning.id }),
    ]);
    expect(zeroPayout.adjustments).toEqual([
      expect.objectContaining({ signedAmountMinor: -100_000n, status: 'APPLIED' }),
    ]);
    const zeroRecovery = await database.client.ownerObligationRecovery.findMany({
      where: { obligationId: obligation.id, payoutId: first },
    });
    expect(zeroRecovery).toEqual([expect.objectContaining({ amountMinor: 100_000n })]);
    const zeroLedger = await database.client.ledgerTransaction.findUniqueOrThrow({
      include: { entries: true },
      where: { id: zeroPayout.adjustments[0]!.ledgerTransactionId! },
    });
    expect(zeroLedger.type).toBe('OWNER_PENALTY_RECOVERY');
    expect(zeroLedger.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n)).toBe(0n);
    expect(
      await database.client.ownerFinancialObligation.findUniqueOrThrow({
        where: { id: obligation.id },
      }),
    ).toMatchObject({ remainingAmountMinor: 50_000n, status: 'PARTIALLY_RECOVERED' });
    await app.get(PayoutsService).submit(admin.userId, first, {
      correlationId: `test-zero-retry-${randomUUID()}`,
    });
    expect(provider.createCallCount).toBe(calls);
    expect(
      await database.client.ownerObligationRecovery.count({
        where: { obligationId: obligation.id },
      }),
    ).toBe(1);

    const secondEarning = await createAvailableEarning(actor, 'RecoveryTwo', null, undefined, {
      commissionAmountMinor: 70_000n,
      grossRentalAmountMinor: 470_000n,
      netEarningAmountMinor: 400_000n,
    });
    const second = await createAndApprove(actor.ownerProfileId);
    const submitted = await app.get(PayoutsService).submit(admin.userId, second, {
      correlationId: `test-partial-${randomUUID()}`,
    });
    expect(submitted).toMatchObject({
      amountMinor: 350_000,
      cancellationPenaltyRecoveryMinor: 50_000,
      grossEligibleEarningsMinor: 400_000,
      outstandingCancellationPenaltyMinor: 50_000,
    });
    expect(provider.createCallCount).toBe(calls + 1);
    const processing = await database.client.payout.findUniqueOrThrow({ where: { id: second } });
    await expect(provider.retrievePayout(processing.providerPayoutId!)).resolves.toMatchObject({
      amountMinor: 350_000n,
    });
    expect(
      await database.client.payoutItem.findFirstOrThrow({ where: { payoutId: second } }),
    ).toMatchObject({ amountMinor: 400_000n, ownerEarningId: secondEarning.id });
    await app.get(PayoutsService).submit(admin.userId, second, {
      correlationId: `test-partial-retry-${randomUUID()}`,
    });
    expect(provider.createCallCount).toBe(calls + 1);
    provider.settle(processing.providerPayoutId!);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${second}/reconcile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(
      await database.client.ownerFinancialObligation.findUniqueOrThrow({
        where: { id: obligation.id },
      }),
    ).toMatchObject({
      remainingAmountMinor: 0n,
      recoveredAmountMinor: 150_000n,
      status: 'SATISFIED',
    });
    expect(
      await database.client.ownerObligationRecovery.count({
        where: { obligationId: obligation.id },
      }),
    ).toBe(2);
    expect(
      await database.client.ownerObligationRecovery.aggregate({
        _sum: { amountMinor: true },
        where: { obligationId: obligation.id },
      }),
    ).toMatchObject({ _sum: { amountMinor: 150_000n } });

    const directActor = await createOwner('penalty-direct-partial');
    await addAccount(directActor, '09170002222', 'PH_GCASH', 'E_WALLET');
    const directSource = await createAvailableEarning(
      directActor,
      'DirectPenaltySource',
      null,
      undefined,
      {
        commissionAmountMinor: 150_000n,
        grossRentalAmountMinor: 1_000_000n,
        netEarningAmountMinor: 850_000n,
      },
    );
    await database.client.ownerEarning.update({
      data: { status: 'PAID' },
      where: { id: directSource.id },
    });
    const directObligation = await createPenaltyObligation(directActor, directSource, 150_000n);
    await createAvailableEarning(directActor, 'DirectRecovery', null, undefined, {
      commissionAmountMinor: 70_000n,
      grossRentalAmountMinor: 470_000n,
      netEarningAmountMinor: 400_000n,
    });
    const directPayoutId = await createAndApprove(directActor.ownerProfileId);
    const directSubmitted = await app.get(PayoutsService).submit(admin.userId, directPayoutId, {
      correlationId: `test-direct-partial-${randomUUID()}`,
    });
    expect(directSubmitted).toMatchObject({
      amountMinor: 250_000,
      cancellationPenaltyRecoveryMinor: 150_000,
      grossEligibleEarningsMinor: 400_000,
      outstandingCancellationPenaltyMinor: 150_000,
    });
    const directProcessing = await database.client.payout.findUniqueOrThrow({
      where: { id: directPayoutId },
    });
    await expect(
      provider.retrievePayout(directProcessing.providerPayoutId!),
    ).resolves.toMatchObject({ amountMinor: 250_000n });
    provider.settle(directProcessing.providerPayoutId!);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${directPayoutId}/reconcile`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(201);
    expect(
      await database.client.ownerFinancialObligation.findUniqueOrThrow({
        where: { id: directObligation.id },
      }),
    ).toMatchObject({ remainingAmountMinor: 0n, status: 'SATISFIED' });
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
    await attachAdminIdentity(database.client, userId, email, `Phase 9 ${label}`, roles);
    return { token: await tokens.signAccessToken(userId, sessionId, roles), userId };
  }

  async function createAvailableEarning(
    actor: OwnerActor,
    model: string,
    handoverWorkflowVersion: number | null = null,
    fulfillmentEarnings: { deliveryEarningMinor: bigint; collectionEarningMinor: bigint } = {
      deliveryEarningMinor: 0n,
      collectionEarningMinor: 0n,
    },
    financials: {
      commissionAmountMinor: bigint;
      grossRentalAmountMinor: bigint;
      netEarningAmountMinor: bigint;
    } = {
      commissionAmountMinor: 15_000n,
      grossRentalAmountMinor: 100_000n,
      netEarningAmountMinor: 85_000n,
    },
  ) {
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
        dailyRateMinor: Number(financials.grossRentalAmountMinor),
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
        baseRentalAmountMinor: Number(financials.grossRentalAmountMinor),
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
        subtotalMinor: Number(financials.grossRentalAmountMinor),
        discountedRentalSubtotalMinor: Number(financials.grossRentalAmountMinor),
        totalMinor: Number(financials.grossRentalAmountMinor),
        turnaroundMinutes: 120,
        unlimitedMileage: false,
        vehicleId: vehicle.id,
        vehicleTimezone: 'Asia/Manila',
      },
    });
    const booking = await database.client.booking.create({
      data: {
        handoverWorkflowVersion,
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
        amountMinor: financials.grossRentalAmountMinor,
        authorizedAmountMinor: financials.grossRentalAmountMinor,
        bookingId: booking.id,
        capturedAmountMinor: financials.grossRentalAmountMinor,
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
        ...fulfillmentEarnings,
        availableAt: new Date(Date.now() - 1_000),
        bookingId: booking.id,
        commissionAmountMinor: financials.commissionAmountMinor,
        currency: 'PHP',
        grossRentalAmountMinor: financials.grossRentalAmountMinor,
        netEarningAmountMinor: financials.netEarningAmountMinor,
        ownerProfileId: actor.ownerProfileId,
        paymentId: payment.id,
        status: 'AVAILABLE',
      },
    });
  }

  async function createPenaltyObligation(
    actor: OwnerActor,
    earning: Awaited<ReturnType<typeof createAvailableEarning>>,
    amountMinor: bigint,
  ) {
    const booking = await database.client.booking.findUniqueOrThrow({
      include: { payments: true },
      where: { id: earning.bookingId },
    });
    const payment = booking.payments[0]!;
    const rule = await database.client.commissionRule.findFirstOrThrow({
      orderBy: { effectiveFrom: 'asc' },
    });
    const snapshot = await database.client.commissionSnapshot.create({
      data: {
        bookingId: booking.id,
        paymentId: payment.id,
        ruleId: rule.id,
        ruleVersion: rule.version,
        scope: rule.scope,
        rateBasisPoints: 1500,
        fixedAmountMinor: 0n,
        commissionableBaseMinor: payment.capturedAmountMinor,
        calculatedCommissionMinor: amountMinor,
        currency: 'PHP',
        calculationVersion: 'COMMISSION_BPS_V1',
      },
    });
    const cancellation = await database.client.bookingCancellation.create({
      data: {
        actorType: 'USER',
        actorUserId: actor.userId,
        bookingId: booking.id,
        reasonCode: 'VEHICLE_UNAVAILABLE',
      },
    });
    const settlement = await database.client.bookingCancellationSettlement.create({
      data: {
        actorType: 'OWNER',
        bookingCancellationId: cancellation.id,
        bookingId: booking.id,
        calculationVersion: 'CONFIRMED_BOOKING_CANCELLATION_V1',
        capturedAmountMinor: payment.capturedAmountMinor,
        collectionFeeMinor: 0n,
        collectionRefundedMinor: 0n,
        commissionRetainedMinor: amountMinor,
        commissionSnapshotId: snapshot.id,
        currency: 'PHP',
        deliveryCompleted: false,
        deliveryCompletionBasis: 'NOT_APPLICABLE',
        deliveryFeeMinor: 0n,
        deliveryRefundedMinor: 0n,
        deliveryRetainedMinor: 0n,
        fulfillmentTreatment: {},
        paymentId: payment.id,
        previewVersion: 'CONFIRMED_BOOKING_CANCELLATION_V1',
        refundAmountMinor: payment.capturedAmountMinor - amountMinor,
        rentalComponentMinor: payment.capturedAmountMinor,
      },
    });
    return database.client.ownerFinancialObligation.create({
      data: {
        cancellationSettlementId: settlement.id,
        commissionSnapshotId: snapshot.id,
        currency: 'PHP',
        effectiveAt: new Date(),
        originalAmountMinor: amountMinor,
        ownerProfileId: actor.ownerProfileId,
        policyVersion: 'DOON_RENTER_CANCELLATION_V1',
        reasonCode: 'VEHICLE_UNAVAILABLE',
        remainingAmountMinor: amountMinor,
        sourceCancellationId: cancellation.id,
        type: 'CANCELLATION_PENALTY',
      },
    });
  }
});
