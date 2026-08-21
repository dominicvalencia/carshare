import { createDecipheriv, randomUUID } from 'node:crypto';
import type { WorkerEnvironment } from '@carrental/config';
import {
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  PayoutAccountStatus,
  PayoutFailureCategory,
  PayoutOperationStatus,
  PayoutOperationType,
  PayoutProviderCode,
  PayoutStatus,
  PayoutWebhookStatus,
  Prisma,
  type PrismaClient,
} from '@carrental/database';
import {
  FakePayoutProvider,
  type PayoutProvider,
  type PayoutProviderStatus,
  XenditPayoutProvider,
} from '@carrental/payouts';

const INCLUDE = {
  items: true,
  payoutAccount: true,
} satisfies Prisma.PayoutInclude;
type WorkerPayout = Prisma.PayoutGetPayload<{ include: typeof INCLUDE }>;

export function workerPayoutProvider(environment: WorkerEnvironment): PayoutProvider {
  return environment.PAYOUT_PROVIDER === 'fake'
    ? new FakePayoutProvider()
    : new XenditPayoutProvider({
        callbackToken: environment.XENDIT_WEBHOOK_TOKEN!,
        secretKey: environment.XENDIT_SECRET_KEY!,
      });
}

export async function submitApprovedPayouts(
  database: PrismaClient,
  provider: PayoutProvider,
  environment: WorkerEnvironment,
): Promise<number> {
  if (!environment.PAYOUT_AUTO_SUBMIT) return 0;
  const approved = await database.payout.findMany({
    select: { id: true },
    take: 25,
    where: { status: PayoutStatus.APPROVED },
  });
  let submitted = 0;
  for (const item of approved) {
    const claimed = await database.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "payouts" WHERE "id" = ${item.id}::uuid FOR UPDATE`,
      );
      const payout = await transaction.payout.findUnique({ where: { id: item.id } });
      if (!payout || payout.status !== PayoutStatus.APPROVED) return false;
      const ready = await transaction.ownerPayoutAccount.count({
        where: { id: payout.payoutAccountId, status: PayoutAccountStatus.ACTIVE },
      });
      if (!ready) return false;
      await transaction.payoutOperation.upsert({
        create: {
          attemptCount: 1,
          correlationId: `payout-worker:${randomUUID()}`,
          idempotencyKey: `payout:${payout.id}:submit:v1`,
          payoutId: payout.id,
          providerRequestReference: payout.publicReference,
          startedAt: new Date(),
          status: PayoutOperationStatus.PROCESSING,
          type: PayoutOperationType.SUBMIT,
        },
        update: {},
        where: { idempotencyKey: `payout:${payout.id}:submit:v1` },
      });
      await transaction.payout.update({
        data: {
          reconcileAfter: new Date(),
          reconciliationRequired: true,
          status: PayoutStatus.SUBMITTING,
        },
        where: { id: payout.id },
      });
      return true;
    });
    if (claimed) submitted += 1;
  }
  await reconcilePayouts(database, provider, environment);
  return submitted;
}

export async function reconcilePayouts(
  database: PrismaClient,
  provider: PayoutProvider,
  environment: WorkerEnvironment,
): Promise<number> {
  const payouts = await database.payout.findMany({
    include: INCLUDE,
    take: 50,
    where: {
      reconciliationRequired: true,
      status: { in: [PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING] },
      OR: [{ reconcileAfter: null }, { reconcileAfter: { lte: new Date() } }],
    },
  });
  for (const payout of payouts) {
    let status: PayoutProviderStatus;
    try {
      status = payout.providerPayoutId
        ? await provider.retrievePayout(payout.providerPayoutId)
        : await provider.createPayout(providerInput(payout, environment));
    } catch (error) {
      await database.payout.update({
        data: {
          reconcileAfter: new Date(
            Date.now() + environment.PAYOUT_RECONCILE_INTERVAL_SECONDS * 1000,
          ),
          safeFailureMessage:
            error instanceof Error ? error.message.slice(0, 500) : 'Provider result unknown.',
        },
        where: { id: payout.id },
      });
      continue;
    }
    await applyStatus(database, payout.id, status);
  }
  return payouts.length;
}

export async function retryPayoutWebhookBacklog(
  database: PrismaClient,
  provider: PayoutProvider,
): Promise<number> {
  const events = await database.payoutWebhookEvent.findMany({
    orderBy: { receivedAt: 'asc' },
    take: 50,
    where: { status: PayoutWebhookStatus.FAILED },
  });
  for (const event of events) {
    try {
      const payout = await database.payout.findFirst({
        select: { id: true },
        where: {
          provider: payoutProviderCode(provider),
          providerPayoutId: event.providerPayoutId,
        },
      });
      if (!payout) {
        await database.payoutWebhookEvent.update({
          data: {
            attemptCount: { increment: 1 },
            failureReason: 'Payout is not mapped yet; reconciliation remains queued.',
          },
          where: { id: event.id },
        });
        continue;
      }
      const status = await provider.retrievePayout(event.providerPayoutId);
      await applyStatus(database, payout.id, status);
      await database.payoutWebhookEvent.update({
        data: {
          attemptCount: { increment: 1 },
          failureReason: null,
          payoutId: payout.id,
          processedAt: new Date(),
          status: PayoutWebhookStatus.PROCESSED,
        },
        where: { id: event.id },
      });
    } catch (error) {
      await database.payoutWebhookEvent.update({
        data: {
          attemptCount: { increment: 1 },
          failureReason:
            error instanceof Error ? error.message.slice(0, 500) : 'Webhook retry failed.',
        },
        where: { id: event.id },
      });
    }
  }
  return events.length;
}

export async function alertLongRunningPayouts(
  database: PrismaClient,
  environment: WorkerEnvironment,
): Promise<number> {
  const now = Date.now();
  const payouts = await database.payout.findMany({
    select: { id: true, ownerProfileId: true, publicReference: true, status: true },
    take: 100,
    where: {
      OR: [
        {
          status: PayoutStatus.SUBMITTING,
          updatedAt: {
            lte: new Date(now - environment.PAYOUT_SUBMITTING_STALE_SECONDS * 1000),
          },
        },
        {
          status: PayoutStatus.PROCESSING,
          updatedAt: {
            lte: new Date(now - environment.PAYOUT_PROCESSING_STALE_SECONDS * 1000),
          },
        },
      ],
    },
  });
  let alerts = 0;
  for (const payout of payouts) {
    const existing = await database.outboxEvent.count({
      where: { aggregateId: payout.id, eventType: 'PAYOUT_LONG_RUNNING_ALERT' },
    });
    if (existing) continue;
    await database.$transaction([
      database.payout.update({
        data: { reconcileAfter: new Date(), reconciliationRequired: true },
        where: { id: payout.id },
      }),
      database.outboxEvent.create({
        data: {
          aggregateId: payout.id,
          aggregateType: 'PAYOUT',
          eventType: 'PAYOUT_LONG_RUNNING_ALERT',
          payload: {
            ownerProfileId: payout.ownerProfileId,
            payoutId: payout.id,
            publicReference: payout.publicReference,
            status: payout.status,
          },
        },
      }),
    ]);
    alerts += 1;
  }
  return alerts;
}

async function applyStatus(database: PrismaClient, payoutId: string, status: PayoutProviderStatus) {
  await database.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "payouts" WHERE "id" = ${payoutId}::uuid FOR UPDATE`,
    );
    const payout = await transaction.payout.findUnique({
      include: INCLUDE,
      where: { id: payoutId },
    });
    if (!payout) return;
    if (status.amountMinor !== 0n && status.amountMinor !== payout.amountMinor)
      throw new Error('Provider payout amount mismatch.');
    if (status.state === 'REVERSED') {
      await reversed(transaction, payout, status);
      return;
    }
    if (![PayoutStatus.SUBMITTING, PayoutStatus.PROCESSING].includes(payout.status as never))
      return;
    if (status.state === 'FAILED') {
      await fail(transaction, payout, status);
      return;
    }
    await submitLedger(transaction, payout, status);
    if (status.state === 'SUCCEEDED') await paid(transaction, payout, status);
    else
      await transaction.payout.update({
        data: {
          lastProviderRetrievedAt: new Date(),
          providerPayoutId: status.externalPayoutId,
          providerState: status.providerState,
          reconcileAfter: new Date(Date.now() + 30_000),
          status: PayoutStatus.PROCESSING,
        },
        where: { id: payout.id },
      });
  });
}

async function submitLedger(
  transaction: Prisma.TransactionClient,
  payout: WorkerPayout,
  status: PayoutProviderStatus,
) {
  const accounts = await accountResolver(transaction, payout.currency);
  await transaction.ledgerTransaction.upsert({
    create: {
      currency: payout.currency,
      description: 'Owner payable transferred to payout provider clearing',
      entries: {
        create: [
          {
            accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
            amountMinor: payout.amountMinor,
            currency: payout.currency,
          },
          {
            accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
            amountMinor: -payout.amountMinor,
            currency: payout.currency,
          },
        ],
      },
      sourceId: payout.id,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_SUBMISSION,
    },
    update: {},
    where: {
      sourceType_sourceId_type_currency: {
        currency: payout.currency,
        sourceId: payout.id,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_SUBMISSION,
      },
    },
  });
  await transaction.payoutOperation.updateMany({
    data: {
      completedAt: new Date(),
      providerOperationReference: status.externalPayoutId,
      status: PayoutOperationStatus.SUCCEEDED,
    },
    where: { idempotencyKey: `payout:${payout.id}:submit:v1` },
  });
  await transaction.payout.update({
    data: {
      providerPayoutId: status.externalPayoutId,
      providerState: status.providerState,
      status: PayoutStatus.PROCESSING,
      submittedAt: payout.submittedAt ?? new Date(),
    },
    where: { id: payout.id },
  });
  await eventOnce(transaction, payout.id, 'PAYOUT_PROCESSING', {
    amountMinor: payout.amountMinor.toString(),
    ownerProfileId: payout.ownerProfileId,
    payoutId: payout.id,
  });
}

async function paid(
  transaction: Prisma.TransactionClient,
  payout: WorkerPayout,
  status: PayoutProviderStatus,
) {
  const already = await transaction.ledgerTransaction.count({
    where: {
      sourceId: payout.id,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_SETTLEMENT,
    },
  });
  if (already) return;
  const accounts = await accountResolver(transaction, payout.currency);
  await transaction.ledgerTransaction.create({
    data: {
      currency: payout.currency,
      description: 'Payout provider confirmed owner settlement',
      entries: {
        create: [
          {
            accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
            amountMinor: payout.amountMinor,
            currency: payout.currency,
          },
          {
            accountId: accounts(FinancialAccountType.PAYOUT_CASH),
            amountMinor: -payout.amountMinor,
            currency: payout.currency,
          },
        ],
      },
      sourceId: payout.id,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_SETTLEMENT,
    },
  });
  await transaction.ownerEarning.updateMany({
    data: { status: OwnerEarningStatus.PAID },
    where: {
      id: {
        in: payout.items.filter((item) => item.activeAllocation).map((item) => item.ownerEarningId),
      },
    },
  });
  await transaction.payout.update({
    data: {
      lastProviderRetrievedAt: new Date(),
      paidAt: status.authoritativeAt ?? new Date(),
      providerState: status.providerState,
      reconcileAfter: null,
      reconciliationRequired: false,
      status: PayoutStatus.PAID,
    },
    where: { id: payout.id },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateId: payout.id,
      aggregateType: 'PAYOUT',
      eventType: 'PAYOUT_PAID',
      payload: {
        amountMinor: payout.amountMinor.toString(),
        ownerProfileId: payout.ownerProfileId,
        payoutId: payout.id,
      },
    },
  });
}

async function reversed(
  transaction: Prisma.TransactionClient,
  payout: WorkerPayout,
  status: PayoutProviderStatus,
) {
  if (payout.status === PayoutStatus.REVERSED) return;
  if (payout.status !== PayoutStatus.PAID)
    throw new Error('Cannot reverse a payout that has not reached PAID.');
  const accounts = await accountResolver(transaction, payout.currency);
  await transaction.ledgerTransaction.upsert({
    create: {
      currency: payout.currency,
      description: 'Provider reversed previously successful payout',
      entries: {
        create: [
          {
            accountId: accounts(FinancialAccountType.PAYOUT_CASH),
            amountMinor: payout.amountMinor,
            currency: payout.currency,
          },
          {
            accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
            amountMinor: -payout.amountMinor,
            currency: payout.currency,
          },
        ],
      },
      sourceId: payout.id,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_REVERSAL,
    },
    update: {},
    where: {
      sourceType_sourceId_type_currency: {
        currency: payout.currency,
        sourceId: payout.id,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_REVERSAL,
      },
    },
  });
  const earningIds = payout.items.map((item) => item.ownerEarningId);
  await transaction.payoutItem.updateMany({
    data: { activeAllocation: false, releasedAt: new Date() },
    where: { activeAllocation: true, payoutId: payout.id },
  });
  await transaction.ownerEarning.updateMany({
    data: { status: OwnerEarningStatus.AVAILABLE },
    where: { id: { in: earningIds } },
  });
  await transaction.payout.update({
    data: {
      providerState: status.providerState,
      reconcileAfter: null,
      reconciliationRequired: false,
      reversedAt: status.authoritativeAt ?? new Date(),
      status: PayoutStatus.REVERSED,
    },
    where: { id: payout.id },
  });
  await eventOnce(transaction, payout.id, 'PAYOUT_REVERSED', {
    ownerProfileId: payout.ownerProfileId,
    payoutId: payout.id,
  });
}

async function fail(
  transaction: Prisma.TransactionClient,
  payout: WorkerPayout,
  status: PayoutProviderStatus,
) {
  const submitted = await transaction.ledgerTransaction.count({
    where: {
      sourceId: payout.id,
      sourceType: 'PAYOUT',
      type: LedgerTransactionType.PAYOUT_SUBMISSION,
    },
  });
  if (submitted) {
    const reversed = await transaction.ledgerTransaction.count({
      where: {
        sourceId: payout.id,
        sourceType: 'PAYOUT',
        type: LedgerTransactionType.PAYOUT_FAILURE_REVERSAL,
      },
    });
    if (!reversed) {
      const accounts = await accountResolver(transaction, payout.currency);
      await transaction.ledgerTransaction.create({
        data: {
          currency: payout.currency,
          description: 'Failed payout restored owner payable',
          entries: {
            create: [
              {
                accountId: accounts(FinancialAccountType.PAYOUT_PROVIDER_CLEARING),
                amountMinor: payout.amountMinor,
                currency: payout.currency,
              },
              {
                accountId: accounts(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: -payout.amountMinor,
                currency: payout.currency,
              },
            ],
          },
          sourceId: payout.id,
          sourceType: 'PAYOUT',
          type: LedgerTransactionType.PAYOUT_FAILURE_REVERSAL,
        },
      });
    }
  }
  const earningIds = payout.items
    .filter((item) => item.activeAllocation)
    .map((item) => item.ownerEarningId);
  await transaction.payoutItem.updateMany({
    data: { activeAllocation: false, releasedAt: new Date() },
    where: { activeAllocation: true, payoutId: payout.id },
  });
  await transaction.ownerEarning.updateMany({
    data: { status: OwnerEarningStatus.AVAILABLE },
    where: { id: { in: earningIds } },
  });
  const failure = failureCategory(status.failureCategory);
  await transaction.payout.update({
    data: {
      failedAt: status.authoritativeAt ?? new Date(),
      failureCategory: failure,
      providerPayoutId: status.externalPayoutId,
      providerState: status.providerState,
      reconcileAfter: null,
      reconciliationRequired: false,
      safeFailureCode: status.safeFailureCode ?? null,
      status: PayoutStatus.FAILED,
    },
    where: { id: payout.id },
  });
  if (failure === PayoutFailureCategory.INVALID_DESTINATION)
    await transaction.ownerPayoutAccount.update({
      data: { isDefault: false, status: PayoutAccountStatus.REQUIRES_ACTION },
      where: { id: payout.payoutAccountId },
    });
  await eventOnce(transaction, payout.id, 'PAYOUT_FAILED', {
    category: failure,
    ownerProfileId: payout.ownerProfileId,
    payoutId: payout.id,
  });
  if (failure === PayoutFailureCategory.INVALID_DESTINATION)
    await eventOnce(transaction, payout.payoutAccountId, 'PAYOUT_ACCOUNT_REQUIRES_ACTION', {
      accountId: payout.payoutAccountId,
      ownerProfileId: payout.ownerProfileId,
    });
}

async function eventOnce(
  transaction: Prisma.TransactionClient,
  aggregateId: string,
  eventType: string,
  payload: Prisma.InputJsonObject,
) {
  const existing = await transaction.outboxEvent.count({ where: { aggregateId, eventType } });
  if (!existing)
    await transaction.outboxEvent.create({
      data: { aggregateId, aggregateType: 'PAYOUT', eventType, payload },
    });
}

async function accountResolver(transaction: Prisma.TransactionClient, currency: string) {
  const accounts = await transaction.financialAccount.findMany({
    where: { active: true, currency },
  });
  return (type: FinancialAccountType) => {
    const account = accounts.find((item) => item.type === type);
    if (!account) throw new Error(`Financial account ${type} is missing.`);
    return account.id;
  };
}

function providerInput(payout: WorkerPayout, environment: WorkerEnvironment) {
  const key = Buffer.from(environment.PAYOUT_DATA_ENCRYPTION_KEY_BASE64, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payout.payoutAccount.encryptionIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(payout.payoutAccount.encryptionAuthTag, 'base64'));
  const identifier = Buffer.concat([
    decipher.update(Buffer.from(payout.payoutAccount.encryptedAccountIdentifier, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return {
    accountHolderName: payout.destinationAccountHolder,
    accountIdentifier: identifier,
    amountMinor: payout.amountMinor,
    country: 'PH' as const,
    currency: 'PHP' as const,
    description: `Car rental owner payout ${payout.publicReference}`,
    destinationChannel: payout.destinationChannel,
    idempotencyKey: `payout:${payout.id}:submit:v1`,
    referenceId: payout.publicReference,
    type: payout.destinationType,
  };
}

function failureCategory(value?: string): PayoutFailureCategory {
  return Object.values(PayoutFailureCategory).includes(value as PayoutFailureCategory)
    ? (value as PayoutFailureCategory)
    : PayoutFailureCategory.UNKNOWN;
}

export function payoutProviderCode(provider: PayoutProvider): PayoutProviderCode {
  return provider.code === 'XENDIT' ? PayoutProviderCode.XENDIT : PayoutProviderCode.FAKE;
}
