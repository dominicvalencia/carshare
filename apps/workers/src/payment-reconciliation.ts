import { randomUUID } from 'node:crypto';
import type { WorkerEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingStatus,
  PaymentFailureCategory,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentPurpose,
  PaymentStatus,
  PaymentWebhookStatus,
  Prisma,
  type PrismaClient,
} from '@carrental/database';
import {
  FakePaymentProvider,
  MayaPaymentProvider,
  type PaymentProvider,
  type ProviderOperationResult,
} from '@carrental/payments';

type ReconciliationPayment = Prisma.PaymentGetPayload<{ include: { operations: true } }>;

export function workerPaymentProvider(environment: WorkerEnvironment): PaymentProvider {
  if (environment.PAYMENT_PROVIDER === 'fake') return new FakePaymentProvider();
  return new MayaPaymentProvider({
    authCaptureEnabled: environment.MAYA_AUTH_CAPTURE_ENABLED,
    baseUrl:
      environment.MAYA_ENVIRONMENT === 'production'
        ? 'https://pg.maya.ph'
        : 'https://pg-sandbox.paymaya.com',
    cancelUrl: environment.MAYA_CANCEL_URL,
    failureUrl: environment.MAYA_FAILURE_URL,
    publicKey: environment.MAYA_PUBLIC_KEY!,
    secretKey: environment.MAYA_SECRET_KEY!,
    successUrl: environment.MAYA_SUCCESS_URL,
    voidRefundEnabled: environment.MAYA_VOID_REFUND_ENABLED,
    webhookAllowedIps:
      environment.MAYA_ENVIRONMENT === 'production'
        ? ['18.138.50.235', '3.1.207.200']
        : ['13.229.160.234', '3.1.199.75'],
  });
}

export async function reconcilePayments(
  database: PrismaClient,
  provider: PaymentProvider,
  environment: WorkerEnvironment,
): Promise<number> {
  const payments = await database.payment.findMany({
    include: { operations: { orderBy: { createdAt: 'desc' } } },
    take: 50,
    where: {
      OR: [
        { status: { in: [PaymentStatus.CAPTURING, PaymentStatus.VOID_PENDING] } },
        {
          reconciliationRequired: true,
          OR: [{ reconcileAfter: null }, { reconcileAfter: { lte: new Date() } }],
        },
      ],
    },
  });
  for (const payment of payments) {
    const correlationId = `reconcile:${randomUUID()}`;
    if (payment.status === PaymentStatus.CAPTURING) {
      const operation = payment.operations.find(
        (item) => item.type === PaymentOperationType.CAPTURE,
      );
      if (operation)
        await executeOrRetrieve(database, provider, payment, operation, correlationId, environment);
      continue;
    }
    if (payment.status === PaymentStatus.VOID_PENDING) {
      const operation = payment.operations.find((item) => item.type === PaymentOperationType.VOID);
      if (operation)
        await executeOrRetrieve(database, provider, payment, operation, correlationId, environment);
      continue;
    }
    await retrieveAndApply(database, provider, payment, undefined, correlationId, environment);
  }
  await processWebhookBacklog(database, provider, environment);
  return payments.length;
}

async function executeOrRetrieve(
  database: PrismaClient,
  provider: PaymentProvider,
  payment: ReconciliationPayment,
  operation: {
    id: string;
    type: PaymentOperationType;
    status: PaymentOperationStatus;
    amountMinor: bigint;
    currency: string;
    idempotencyKey: string;
    providerRequestReference: string;
  },
  correlationId: string,
  environment: WorkerEnvironment,
) {
  if (!payment.externalPaymentId) return defer(database, payment.id);
  if (operation.status !== PaymentOperationStatus.PENDING) {
    return retrieveAndApply(database, provider, payment, operation.id, correlationId, environment);
  }
  const claimed = await database.paymentOperation.updateMany({
    data: {
      attemptCount: { increment: 1 },
      startedAt: new Date(),
      status: PaymentOperationStatus.PROCESSING,
    },
    where: { id: operation.id, status: PaymentOperationStatus.PENDING },
  });
  if (!claimed.count) return;
  const input = {
    amountMinor: operation.amountMinor,
    currency: operation.currency,
    externalPaymentId: payment.externalPaymentId,
    idempotencyKey: operation.idempotencyKey,
    requestReference: operation.providerRequestReference,
  };
  let result: ProviderOperationResult;
  try {
    result =
      operation.type === PaymentOperationType.CAPTURE
        ? await provider.capture(input)
        : await provider.voidAuthorization(input);
  } catch (error) {
    await markUnknown(database, payment.id, operation.id, error);
    return;
  }
  if (result.kind === 'SUCCEEDED') {
    if (operation.type === PaymentOperationType.CAPTURE) {
      await finalizeCapture(
        database,
        payment.id,
        operation.id,
        result.providerState ?? 'CAPTURED',
        result.externalOperationId,
        correlationId,
      );
    } else {
      await finalizeVoid(
        database,
        payment.id,
        operation.id,
        result.providerState ?? 'VOIDED',
        result.externalOperationId,
      );
    }
  } else if (result.kind === 'DECLINED' && operation.type === PaymentOperationType.CAPTURE) {
    await definitiveCaptureFailure(
      database,
      payment.id,
      operation.id,
      correlationId,
      result.failureCode,
    );
  } else {
    await markUnknown(database, payment.id, operation.id, undefined, result);
  }
}

async function retrieveAndApply(
  database: PrismaClient,
  provider: PaymentProvider,
  payment: {
    id: string;
    externalPaymentId: string | null;
    purpose: PaymentPurpose;
    status: PaymentStatus;
  },
  operationId: string | undefined,
  correlationId: string,
  environment: WorkerEnvironment,
) {
  if (!payment.externalPaymentId) return defer(database, payment.id);
  try {
    const truth = await provider.retrievePayment(payment.externalPaymentId);
    if (truth.state === 'AUTHORIZED' && payment.status === PaymentStatus.AUTHORIZING) {
      if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        await prepareAdditionalChargeCapture(
          database,
          payment.id,
          truth.externalPaymentId,
          truth.providerState,
        );
      } else {
        await database.$executeRaw(
          Prisma.sql`SELECT "finalize_payment_authorization"(${payment.id}::uuid, ${truth.externalPaymentId}, ${truth.providerState}, ${environment.OWNER_RESPONSE_TTL_MINUTES}, ${correlationId})`,
        );
      }
    } else if (truth.state === 'CAPTURED') {
      await finalizeCapture(
        database,
        payment.id,
        operationId,
        truth.providerState,
        undefined,
        correlationId,
      );
    } else if (truth.state === 'VOIDED') {
      await finalizeVoid(database, payment.id, operationId, truth.providerState, undefined);
    } else {
      await defer(database, payment.id);
    }
  } catch {
    await defer(database, payment.id);
  }
}

async function finalizeCapture(
  database: PrismaClient,
  paymentId: string,
  operationId: string | undefined,
  providerState: string,
  externalOperationId: string | undefined,
  correlationId: string,
) {
  const payment = await database.payment.findUniqueOrThrow({
    select: { purpose: true },
    where: { id: paymentId },
  });
  if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
    await database.$executeRaw(
      Prisma.sql`SELECT "finalize_additional_charge_payment"(${paymentId}::uuid, ${operationId ?? null}::uuid, ${providerState}, ${externalOperationId ?? null}, ${correlationId})`,
    );
  } else {
    await database.$executeRaw(
      Prisma.sql`SELECT "finalize_payment_capture"(${paymentId}::uuid, ${operationId ?? null}::uuid, ${providerState}, ${externalOperationId ?? null}, ${correlationId})`,
    );
  }
}

async function prepareAdditionalChargeCapture(
  database: PrismaClient,
  paymentId: string,
  externalPaymentId: string,
  providerState: string,
) {
  await database.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUniqueOrThrow({
      include: { operations: true },
      where: { id: paymentId },
    });
    if (payment.status !== PaymentStatus.AUTHORIZING) return;
    const authorization = payment.operations.find(
      (item) => item.type === PaymentOperationType.AUTHORIZE,
    );
    if (authorization) {
      await transaction.paymentOperation.update({
        data: { completedAt: new Date(), status: PaymentOperationStatus.SUCCEEDED },
        where: { id: authorization.id },
      });
    }
    await transaction.payment.update({
      data: {
        authorizedAmountMinor: payment.amountMinor,
        authorizedAt: new Date(),
        externalPaymentId,
        providerState,
        reconciliationRequired: false,
        status: PaymentStatus.CAPTURING,
      },
      where: { id: payment.id },
    });
    if (payment.additionalChargeId) {
      await transaction.additionalCharge.update({
        data: { status: 'PROCESSING' },
        where: { id: payment.additionalChargeId },
      });
    }
    await transaction.paymentOperation.upsert({
      create: {
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        idempotencyKey: `additional-charge:${payment.additionalChargeId}:capture:v1`,
        paymentId: payment.id,
        providerRequestReference: randomUUID(),
        status: PaymentOperationStatus.PENDING,
        type: PaymentOperationType.CAPTURE,
      },
      update: {},
      where: { idempotencyKey: `additional-charge:${payment.additionalChargeId}:capture:v1` },
    });
  });
}

async function finalizeVoid(
  database: PrismaClient,
  paymentId: string,
  operationId: string | undefined,
  providerState: string,
  externalOperationId: string | undefined,
) {
  await database.$executeRaw(
    Prisma.sql`SELECT "finalize_payment_void"(${paymentId}::uuid, ${operationId ?? null}::uuid, ${providerState}, ${externalOperationId ?? null})`,
  );
}

async function definitiveCaptureFailure(
  database: PrismaClient,
  paymentId: string,
  operationId: string,
  correlationId: string,
  failureCode?: string,
) {
  await database.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const booking = await transaction.booking.findUniqueOrThrow({
      where: { id: payment.bookingId },
    });
    await transaction.paymentOperation.update({
      data: {
        completedAt: new Date(),
        failureCategory: PaymentFailureCategory.DEFINITIVE,
        failureCode: failureCode ?? 'CAPTURE_DECLINED',
        status: PaymentOperationStatus.FAILED,
      },
      where: { id: operationId },
    });
    await transaction.payment.update({
      data: { status: PaymentStatus.AUTHORIZED },
      where: { id: paymentId },
    });
    if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
      if (payment.additionalChargeId) {
        await transaction.additionalCharge.update({
          data: { status: 'PAYMENT_FAILED' },
          where: { id: payment.additionalChargeId },
        });
      }
      return;
    }
    if (booking.status === BookingStatus.CAPTURE_PENDING) {
      await transaction.booking.update({
        data: { status: BookingStatus.CANCELLED },
        where: { id: booking.id },
      });
      await transaction.vehicleOccupancy.updateMany({
        data: { active: false, releaseReason: 'PAYMENT_CAPTURE_FAILED', releasedAt: new Date() },
        where: { active: true, bookingId: booking.id },
      });
      await transaction.bookingStatusHistory.create({
        data: {
          actorType: BookingActorType.WORKER,
          bookingId: booking.id,
          correlationId,
          fromStatus: booking.status,
          reasonCode: 'PAYMENT_CAPTURE_FAILED',
          toStatus: BookingStatus.CANCELLED,
        },
      });
    }
  });
}

async function markUnknown(
  database: PrismaClient,
  paymentId: string,
  operationId: string,
  error?: unknown,
  result?: ProviderOperationResult,
) {
  await database.$transaction([
    database.paymentOperation.update({
      data: {
        failureCategory: PaymentFailureCategory.UNKNOWN,
        failureCode: result?.failureCode ?? null,
        failureMessage: error instanceof Error ? error.message.slice(0, 500) : null,
        nextAttemptAt: new Date(Date.now() + 15_000),
        status: PaymentOperationStatus.UNKNOWN,
      },
      where: { id: operationId },
    }),
    database.payment.update({
      data: { reconcileAfter: new Date(Date.now() + 15_000), reconciliationRequired: true },
      where: { id: paymentId },
    }),
  ]);
}

function defer(database: PrismaClient, paymentId: string) {
  return database.payment.update({
    data: { reconcileAfter: new Date(Date.now() + 15_000), reconciliationRequired: true },
    where: { id: paymentId },
  });
}

async function processWebhookBacklog(
  database: PrismaClient,
  provider: PaymentProvider,
  environment: WorkerEnvironment,
) {
  const events = await database.paymentWebhookEvent.findMany({
    take: 50,
    where: {
      paymentId: { not: null },
      status: { in: [PaymentWebhookStatus.RECEIVED, PaymentWebhookStatus.FAILED] },
    },
  });
  for (const event of events) {
    if (!event.paymentId) continue;
    await database.paymentWebhookEvent.update({
      data: { attemptCount: { increment: 1 }, status: PaymentWebhookStatus.PROCESSING },
      where: { id: event.id },
    });
    const payment = await database.payment.findUnique({ where: { id: event.paymentId } });
    if (!payment) continue;
    try {
      await retrieveAndApply(
        database,
        provider,
        payment,
        undefined,
        `webhook:${event.id}`,
        environment,
      );
      await database.paymentWebhookEvent.update({
        data: {
          failureReason: null,
          processedAt: new Date(),
          status: PaymentWebhookStatus.PROCESSED,
        },
        where: { id: event.id },
      });
    } catch (error) {
      await database.paymentWebhookEvent.update({
        data: {
          failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Processing failed',
          status: PaymentWebhookStatus.FAILED,
        },
        where: { id: event.id },
      });
    }
  }
}
