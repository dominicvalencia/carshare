import { resolve } from 'node:path';
import { config as loadEnvironment } from 'dotenv';
import { Queue, Worker } from 'bullmq';
import { parseWorkerEnvironment } from '@carrental/config';
import { createDatabaseClient, Prisma } from '@carrental/database';
import { createLogger } from '@carrental/logger';
import { parseRedisConnection } from './redis-connection';
import { reconcilePayments, workerPaymentProvider } from './payment-reconciliation';
import {
  alertLongRunningPayouts,
  reconcilePayouts,
  retryPayoutWebhookBacklog,
  submitApprovedPayouts,
  workerPayoutProvider,
} from './payout-reconciliation';
import {
  consumeDomainEvent,
  deliverPendingNotifications,
  reconcilePushReceipts,
  workerPushProvider,
} from './notification-delivery';

loadEnvironment({ path: resolve(__dirname, '../../../.env'), quiet: true });

const LIFECYCLE_QUEUE = 'booking-lifecycle';
const DOMAIN_EVENTS_QUEUE = 'domain-events';

async function bootstrap(): Promise<void> {
  const environment = parseWorkerEnvironment(process.env);
  const logger = createLogger({
    environment: environment.APP_ENV,
    level: environment.LOG_LEVEL,
    service: 'workers',
  });
  const connection = parseRedisConnection(environment.REDIS_URL);
  const database = createDatabaseClient(environment.DATABASE_URL);
  const paymentProvider = workerPaymentProvider(environment);
  const payoutProvider = workerPayoutProvider(environment);
  const pushProvider = workerPushProvider(environment);
  await database.$connect();

  const lifecycleQueue = new Queue(LIFECYCLE_QUEUE, { connection });
  const domainEventsQueue = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
  await lifecycleQueue.upsertJobScheduler(
    'booking-expiration-sweep',
    { every: 15_000 },
    { data: {}, name: 'expire-stale-bookings' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'notification-delivery-sweep',
    { every: environment.NOTIFICATION_DELIVERY_INTERVAL_SECONDS * 1000 },
    { data: {}, name: 'deliver-notifications' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'push-receipt-sweep',
    { every: Math.max(30, environment.NOTIFICATION_DELIVERY_INTERVAL_SECONDS) * 1000 },
    { data: {}, name: 'reconcile-push-receipts' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'payout-reconciliation-sweep',
    { every: environment.PAYOUT_RECONCILE_INTERVAL_SECONDS * 1000 },
    { data: {}, name: 'reconcile-payouts' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'outbox-dispatch-sweep',
    { every: 5_000 },
    { data: {}, name: 'dispatch-outbox' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'payment-reconciliation-sweep',
    { every: environment.PAYMENT_RECONCILE_INTERVAL_SECONDS * 1000 },
    { data: {}, name: 'reconcile-payments' },
  );
  await lifecycleQueue.upsertJobScheduler(
    'rental-operations-sweep',
    { every: environment.RENTAL_OPERATIONS_SWEEP_SECONDS * 1000 },
    { data: {}, name: 'advance-rental-operations' },
  );

  const worker = new Worker(
    LIFECYCLE_QUEUE,
    async (job) => {
      if (job.name === 'expire-stale-bookings') {
        const rows = await database.$queryRaw<Array<{ expired: number }>>(
          Prisma.sql`SELECT "expire_stale_bookings"() AS "expired"`,
        );
        logger.info({ expired: rows[0]?.expired ?? 0 }, 'Booking expiration sweep completed');
        return;
      }
      if (job.name === 'dispatch-outbox') {
        const dispatched = await database.$transaction(async (transaction) => {
          const events = await transaction.$queryRaw<
            Array<{ id: string; eventType: string; payload: Prisma.JsonValue }>
          >(Prisma.sql`
            SELECT "id", "event_type" AS "eventType", "payload"
            FROM "outbox_events"
            WHERE "status" IN ('PENDING', 'FAILED') AND "available_at" <= clock_timestamp()
            ORDER BY "occurred_at"
            LIMIT 100
            FOR UPDATE SKIP LOCKED
          `);
          for (const event of events) {
            try {
              await domainEventsQueue.add(event.eventType, event.payload, {
                jobId: event.id,
                removeOnComplete: 1000,
                removeOnFail: false,
              });
              await transaction.outboxEvent.update({
                data: {
                  attemptCount: { increment: 1 },
                  lastError: null,
                  processedAt: new Date(),
                  status: 'PUBLISHED',
                },
                where: { id: event.id },
              });
            } catch (error) {
              await transaction.outboxEvent.update({
                data: {
                  attemptCount: { increment: 1 },
                  lastError:
                    error instanceof Error ? error.message.slice(0, 1000) : 'Dispatch failed',
                  status: 'FAILED',
                },
                where: { id: event.id },
              });
            }
          }
          return events.length;
        });
        if (dispatched) logger.info({ dispatched }, 'Transactional outbox dispatch completed');
      }
      if (job.name === 'reconcile-payments') {
        const reconciled = await reconcilePayments(database, paymentProvider, environment);
        if (reconciled) logger.info({ reconciled }, 'Payment reconciliation sweep completed');
      }
      if (job.name === 'reconcile-payouts') {
        const alerts = await alertLongRunningPayouts(database, environment);
        const submitted = await submitApprovedPayouts(database, payoutProvider, environment);
        const webhookRetries = await retryPayoutWebhookBacklog(database, payoutProvider);
        const reconciled = await reconcilePayouts(database, payoutProvider, environment);
        if (alerts || submitted || webhookRetries || reconciled)
          logger.info(
            { alerts, reconciled, submitted, webhookRetries },
            'Payout operations sweep completed',
          );
      }
      if (job.name === 'advance-rental-operations') {
        const rows = await database.$queryRaw<
          Array<{
            claimNotifications: number;
            completed: number;
            earningsAvailable: number;
            notifications: number;
            ready: number;
          }>
        >(Prisma.sql`
          SELECT
            "open_due_pickup_windows"(
              ${environment.PICKUP_WINDOW_EARLY_MINUTES},
              ${environment.PICKUP_WINDOW_GRACE_MINUTES}
            ) AS "ready",
            "emit_rental_operational_notifications"() AS "notifications",
            "emit_claim_financial_notifications"() AS "claimNotifications",
            "complete_due_returned_bookings"() AS "completed",
            "release_due_owner_earnings"() AS "earningsAvailable"
        `);
        const result = rows[0] ?? {
          claimNotifications: 0,
          completed: 0,
          earningsAvailable: 0,
          notifications: 0,
          ready: 0,
        };
        if (
          result.ready ||
          result.notifications ||
          result.claimNotifications ||
          result.completed ||
          result.earningsAvailable
        ) {
          logger.info(result, 'Rental operations sweep completed');
        }
      }
      if (job.name === 'deliver-notifications') {
        const delivered = await deliverPendingNotifications(database, pushProvider);
        if (delivered) logger.info({ delivered }, 'Notification delivery sweep completed');
      }
      if (job.name === 'reconcile-push-receipts') {
        const reconciled = await reconcilePushReceipts(
          database,
          pushProvider,
          environment.PUSH_RECEIPT_DELAY_SECONDS,
        );
        if (reconciled) logger.info({ reconciled }, 'Push receipt sweep completed');
      }
    },
    { connection, concurrency: 2 },
  );
  worker.on('failed', (job, error) =>
    logger.error({ err: error, jobId: job?.id, jobName: job?.name }, 'Worker job failed'),
  );
  const domainWorker = new Worker(
    DOMAIN_EVENTS_QUEUE,
    async (job) => consumeDomainEvent(database, job.name, job.data, String(job.id ?? '')),
    { connection, concurrency: 8 },
  );
  domainWorker.on('failed', (job, error) =>
    logger.error(
      { err: error, jobId: job?.id, jobName: job?.name },
      'Domain event consumer failed',
    ),
  );
  await domainWorker.waitUntilReady();
  await worker.waitUntilReady();
  logger.info(
    'Booking lifecycle, rental operations, payment and payout reconciliation, and outbox workers started',
  );

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'Worker shutdown requested');
    await worker.close();
    await domainWorker.close();
    await lifecycleQueue.close();
    await domainEventsQueue.close();
    await database.$disconnect();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

void bootstrap().catch((error: unknown) => {
  const logger = createLogger({
    environment: process.env.APP_ENV ?? 'local',
    level: process.env.LOG_LEVEL ?? 'error',
    service: 'workers-bootstrap',
  });
  logger.fatal({ err: error }, 'Worker bootstrap failed');
  process.exitCode = 1;
});
