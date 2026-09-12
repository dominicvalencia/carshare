import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingStatus,
  CommissionScope,
  FinancialAccountType,
  LedgerTransactionType,
  OwnerEarningStatus,
  PaymentFailureCategory,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentProviderCode,
  PaymentPurpose,
  PaymentStatus,
  PaymentWebhookStatus,
  Prisma,
  SecurityDepositStatus,
} from '@carrental/database';
import {
  type PaymentProvider,
  PaymentProviderError,
  type ProviderOperationResult,
  type ProviderPaymentStatus,
} from '@carrental/payments';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from '../security/security-context';
import { RenterEligibilityService } from '../renter-verification/renter-eligibility.service';
import { PAYMENT_PROVIDER } from './payment-provider.factory';

const PAYMENT_INCLUDE = {
  operations: { orderBy: { createdAt: 'asc' as const } },
  refunds: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PaymentInclude;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

export function reconcileCaptureComponents(input: {
  readonly rentalComponentMinor: bigint;
  readonly deliveryComponentMinor: bigint;
  readonly collectionComponentMinor: bigint;
  readonly capturedTotalMinor: bigint;
  readonly pricingTotalMinor: bigint;
}) {
  const accountedTotalMinor =
    input.rentalComponentMinor + input.deliveryComponentMinor + input.collectionComponentMinor;
  if (
    accountedTotalMinor !== input.capturedTotalMinor ||
    accountedTotalMinor !== input.pricingTotalMinor
  )
    throw new Error('Captured total does not reconcile to rental and fulfillment components.');
  return { ...input, accountedTotalMinor };
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly renterEligibility: RenterEligibilityService,
  ) {}

  async authorizeRental(userId: string, reference: string, request: RequestMetadata) {
    const prepared = await this.database.client.$transaction(async (transaction) => {
      await this.renterEligibility.assertEligible(userId, transaction);
      const booking = await transaction.booking.findFirst({
        include: { pricingSnapshot: true, renter: { select: { email: true } } },
        where: {
          renterUserId: userId,
          ...this.bookingIdentity(reference),
        },
      });
      if (!booking) this.notFound();
      await this.lockBooking(transaction, booking.id);
      if (booking.status !== BookingStatus.AWAITING_PAYMENT) {
        const existing = await transaction.payment.findFirst({
          include: PAYMENT_INCLUDE,
          where: { bookingId: booking.id, purpose: PaymentPurpose.RENTAL },
        });
        if (existing) return { booking, operation: null, payment: existing, existing: true };
        this.invalidState('The booking is not awaiting payment authorization.');
      }
      if (!booking.pricingSnapshot) this.invalidState('The booking pricing snapshot is missing.');
      if (booking.holdExpiresAt && booking.holdExpiresAt <= new Date()) {
        this.invalidState('The booking hold has expired.');
      }
      const existing = await transaction.payment.findFirst({
        include: PAYMENT_INCLUDE,
        where: { bookingId: booking.id, purpose: PaymentPurpose.RENTAL },
      });
      if (existing) return { booking, operation: null, payment: existing, existing: true };

      const providerRequestReference = randomUUID();
      const payment = await transaction.payment.create({
        data: {
          amountMinor: BigInt(booking.pricingSnapshot.totalMinor),
          bookingId: booking.id,
          currency: booking.pricingSnapshot.currency,
          provider: this.providerCode(),
          providerRequestReference,
          purpose: PaymentPurpose.RENTAL,
          status: PaymentStatus.AUTHORIZING,
        },
      });
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          attemptCount: 1,
          currency: payment.currency,
          idempotencyKey: `booking:${booking.id}:authorize:v1`,
          paymentId: payment.id,
          providerRequestReference,
          startedAt: new Date(),
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.AUTHORIZE,
        },
      });
      await transaction.securityDepositAuthorization.upsert({
        create: {
          bookingId: booking.id,
          currency: booking.pricingSnapshot.currency,
          status: SecurityDepositStatus.NOT_REQUIRED,
        },
        update: {},
        where: { bookingId: booking.id },
      });
      return {
        booking,
        operation,
        payment: { ...payment, operations: [], refunds: [] },
        existing: false,
      };
    });

    if (prepared.existing || !prepared.operation) return this.paymentProjection(prepared.payment);
    let result: ProviderOperationResult;
    try {
      result = await this.provider.authorize({
        amountMinor: prepared.payment.amountMinor,
        ...(prepared.booking.renter.email ? { customerEmail: prepared.booking.renter.email } : {}),
        currency: prepared.payment.currency,
        description: `Vehicle rental ${prepared.booking.publicReference}`,
        idempotencyKey: prepared.operation.idempotencyKey,
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch (error) {
      await this.recordUnknown(prepared.payment.id, prepared.operation.id, error);
      return this.getPayment(userId, reference);
    }

    if (result.kind === 'SUCCEEDED') {
      await this.finalizeAuthorization(prepared.payment.id, prepared.operation.id, result, request);
    } else if (result.kind === 'ACTION_REQUIRED') {
      await this.database.client.$transaction(async (transaction) => {
        await transaction.payment.update({
          data: {
            customerActionUrl: result.customerActionUrl ?? null,
            externalPaymentId: result.externalPaymentId ?? null,
            providerState: result.providerState ?? null,
            reconcileAfter: new Date(Date.now() + 15_000),
            reconciliationRequired: true,
          },
          where: { id: prepared.payment.id },
        });
        await transaction.paymentOperation.update({
          data: {
            completedAt: new Date(),
            safeProviderMetadata: this.safeJson(result.safeMetadata),
            status: PaymentOperationStatus.SUCCEEDED,
          },
          where: { id: prepared.operation.id },
        });
      });
    } else if (result.kind === 'DECLINED') {
      await this.failAuthorization(prepared.payment.id, prepared.operation.id, result, request);
    } else {
      await this.recordUnknown(prepared.payment.id, prepared.operation.id, undefined, result);
    }
    return this.getPayment(userId, reference);
  }

  async getPayment(userId: string, reference: string) {
    const payment = await this.database.client.payment.findFirst({
      include: PAYMENT_INCLUDE,
      where: {
        purpose: PaymentPurpose.RENTAL,
        booking: { renterUserId: userId, ...this.bookingIdentity(reference) },
      },
    });
    if (!payment) this.notFound();
    return this.paymentProjection(payment);
  }

  async processPendingForBooking(reference: string, request: RequestMetadata): Promise<void> {
    const payment = await this.database.client.payment.findFirst({
      include: PAYMENT_INCLUDE,
      where: {
        booking: this.bookingIdentity(reference),
        purpose: PaymentPurpose.RENTAL,
      },
    });
    if (!payment) return;
    if (payment.status === PaymentStatus.CAPTURING) {
      await this.executePendingOperation(payment, PaymentOperationType.CAPTURE, request);
    } else if (payment.status === PaymentStatus.VOID_PENDING) {
      await this.executePendingOperation(payment, PaymentOperationType.VOID, request);
    }
  }

  async reconcileDue(limit = 50): Promise<number> {
    const due = await this.database.client.payment.findMany({
      select: { id: true },
      take: limit,
      where: {
        reconciliationRequired: true,
        OR: [{ reconcileAfter: null }, { reconcileAfter: { lte: new Date() } }],
      },
    });
    for (const payment of due)
      await this.reconcilePayment(payment.id, { correlationId: randomUUID() });
    return due.length;
  }

  async reconcilePayment(paymentId: string, request: RequestMetadata): Promise<void> {
    const payment = await this.database.client.payment.findUnique({
      include: PAYMENT_INCLUDE,
      where: { id: paymentId },
    });
    if (!payment?.externalPaymentId) return;
    let status: ProviderPaymentStatus;
    try {
      status = await this.provider.retrievePayment(payment.externalPaymentId);
    } catch {
      await this.deferReconciliation(payment.id);
      return;
    }
    const unresolved: readonly PaymentOperationStatus[] = [
      PaymentOperationStatus.PROCESSING,
      PaymentOperationStatus.UNKNOWN,
      PaymentOperationStatus.PENDING,
    ];
    const operation = [...payment.operations]
      .reverse()
      .find((candidate) => unresolved.includes(candidate.status));
    if (status.state === 'AUTHORIZED' && payment.status === PaymentStatus.AUTHORIZING) {
      const authorization = payment.operations.find(
        (item) => item.type === PaymentOperationType.AUTHORIZE,
      );
      if (authorization) {
        await this.finalizeAuthorization(
          payment.id,
          authorization.id,
          {
            externalPaymentId: status.externalPaymentId,
            kind: 'SUCCEEDED',
            providerState: status.providerState,
          },
          request,
        );
      }
      return;
    }
    if (status.state === 'CAPTURED') {
      await this.finalizeCapture(payment.id, operation?.id, status.providerState, request);
      return;
    }
    if (status.state === 'VOIDED') {
      await this.finalizeVoid(payment.id, operation?.id, status.providerState);
      return;
    }
    if (status.state === 'FAILED' && payment.status === PaymentStatus.AUTHORIZING) {
      const authorization = payment.operations.find(
        (item) => item.type === PaymentOperationType.AUTHORIZE,
      );
      if (authorization) {
        await this.failAuthorization(
          payment.id,
          authorization.id,
          {
            kind: 'DECLINED',
            providerState: status.providerState,
          },
          request,
        );
      }
      return;
    }
    await this.deferReconciliation(payment.id);
  }

  async receiveWebhook(payload: unknown, rawBody: Buffer, sourceIp: string | undefined) {
    let verified;
    try {
      verified = await this.provider.verifyWebhook({
        payload,
        rawBody,
        ...(sourceIp ? { sourceIp } : {}),
      });
    } catch (error) {
      throw new ApplicationException(
        PaymentErrorCode.WEBHOOK_INVALID,
        error instanceof Error ? error.message : 'Invalid payment webhook.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const payment = await this.database.client.payment.findUnique({
      select: { id: true },
      where: {
        provider_externalPaymentId: {
          externalPaymentId: verified.providerPaymentId,
          provider: this.providerCode(),
        },
      },
    });
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const event = await this.database.client.paymentWebhookEvent.upsert({
      create: {
        eventType: verified.eventType,
        externalEventId: verified.externalEventId,
        payloadDigest: digest,
        paymentId: payment?.id ?? null,
        provider: this.providerCode(),
        providerPaymentId: verified.providerPaymentId,
        redactedPayload: verified.redactedPayload as Prisma.InputJsonValue,
        sourceIp: sourceIp ?? null,
      },
      update: {},
      where: {
        provider_externalEventId: {
          externalEventId: verified.externalEventId,
          provider: this.providerCode(),
        },
      },
    });
    if (event.status === PaymentWebhookStatus.RECEIVED && payment) {
      await this.database.client.paymentWebhookEvent.update({
        data: { attemptCount: { increment: 1 }, status: PaymentWebhookStatus.PROCESSING },
        where: { id: event.id },
      });
      try {
        await this.reconcilePayment(payment.id, { correlationId: `webhook:${event.id}` });
        await this.database.client.paymentWebhookEvent.update({
          data: { processedAt: new Date(), status: PaymentWebhookStatus.PROCESSED },
          where: { id: event.id },
        });
      } catch (error) {
        await this.database.client.paymentWebhookEvent.update({
          data: {
            failureReason:
              error instanceof Error ? error.message.slice(0, 500) : 'Processing failed',
            status: PaymentWebhookStatus.FAILED,
          },
          where: { id: event.id },
        });
      }
    }
    return { accepted: true, duplicate: event.status !== PaymentWebhookStatus.RECEIVED };
  }

  async ownerEarnings(ownerUserId: string) {
    const earnings = await this.database.client.ownerEarning.findMany({
      include: {
        booking: {
          select: {
            publicReference: true,
            rentalEnd: true,
            rentalStart: true,
            vehicle: { select: { make: true, model: true } },
          },
        },
        additionalCharges: true,
        holds: { orderBy: { createdAt: 'asc' } },
        payoutItems: {
          include: { payout: { select: { id: true, status: true } } },
          where: { activeAllocation: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { ownerProfile: { userId: ownerUserId } },
    });
    const projected = earnings.map((earning) => {
      const total =
        earning.netEarningAmountMinor +
        earning.deliveryEarningMinor +
        earning.collectionEarningMinor +
        earning.additionalCompensationMinor +
        earning.adjustmentAmountMinor;
      const held = earning.holds
        .filter((hold) => hold.status === 'ACTIVE')
        .reduce((sum, hold) => sum + hold.amountMinor, 0n);
      const activePayout = earning.payoutItems[0]?.payout;
      return {
        additionalCompensationMinor: this.minor(earning.additionalCompensationMinor),
        adjustmentAmountMinor: this.minor(earning.adjustmentAmountMinor),
        availableAt: earning.availableAt,
        booking: earning.booking,
        commissionAmountMinor: this.minor(earning.commissionAmountMinor),
        collectionEarningMinor: this.minor(earning.collectionEarningMinor),
        createdAt: earning.createdAt,
        currency: earning.currency,
        deliveryEarningMinor: this.minor(earning.deliveryEarningMinor),
        grossRentalAmountMinor: this.minor(earning.grossRentalAmountMinor),
        heldAmountMinor: this.minor(held),
        holds: earning.holds.map((hold) => ({
          ...hold,
          amountMinor: this.minor(hold.amountMinor),
        })),
        netEarningAmountMinor: this.minor(earning.netEarningAmountMinor),
        projectedTotalMinor: this.minor(total),
        payout: activePayout ?? null,
        status:
          activePayout && earning.status !== OwnerEarningStatus.PAID
            ? 'PROCESSING_PAYOUT'
            : earning.status,
      };
    });
    return {
      notice: 'Available earnings will be included in your next eligible payout.',
      summary: {
        availableMinor: projected
          .filter((item) => item.status === 'AVAILABLE')
          .reduce((sum, item) => sum + item.projectedTotalMinor, 0),
        heldMinor: projected.reduce((sum, item) => sum + item.heldAmountMinor, 0),
        pendingMinor: projected
          .filter((item) => item.status === 'PENDING' || item.status === 'HELD')
          .reduce((sum, item) => sum + item.projectedTotalMinor - item.heldAmountMinor, 0),
      },
      items: projected,
    };
  }

  async adminFinancialDetail(reference: string) {
    const booking = await this.database.client.booking.findFirst({
      include: {
        commissionSnapshot: true,
        ownerEarning: { include: { additionalCharges: true, holds: true } },
        payments: { include: PAYMENT_INCLUDE },
        statusHistory: { orderBy: { occurredAt: 'asc' } },
      },
      where: this.bookingIdentity(reference),
    });
    if (!booking) this.notFound();
    const ledger = await this.database.client.ledgerTransaction.findMany({
      include: { entries: { include: { account: true } } },
      orderBy: { postedAt: 'asc' },
      where: { sourceId: { in: booking.payments.map((payment) => payment.id) } },
    });
    return {
      bookingId: booking.id,
      commission: booking.commissionSnapshot
        ? this.snapshotProjection(booking.commissionSnapshot)
        : null,
      earning: booking.ownerEarning ? this.earningProjection(booking.ownerEarning) : null,
      ledger: ledger.map((transaction) => ({
        ...transaction,
        entries: transaction.entries.map((entry) => ({
          account: { code: entry.account.code, type: entry.account.type },
          amountMinor: this.minor(entry.amountMinor),
          currency: entry.currency,
          id: entry.id,
          memo: entry.memo,
        })),
      })),
      payments: booking.payments.map((payment) => this.paymentProjection(payment)),
    };
  }

  private async executePendingOperation(
    payment: PaymentRecord,
    type: PaymentOperationType,
    request: RequestMetadata,
  ) {
    const operation = [...payment.operations].reverse().find((item) => item.type === type);
    if (!operation || !payment.externalPaymentId) {
      await this.deferReconciliation(payment.id);
      return;
    }
    const claimed = await this.database.client.paymentOperation.updateMany({
      data: {
        attemptCount: { increment: 1 },
        startedAt: new Date(),
        status: PaymentOperationStatus.PROCESSING,
      },
      where: {
        id: operation.id,
        status: { in: [PaymentOperationStatus.PENDING, PaymentOperationStatus.UNKNOWN] },
      },
    });
    if (!claimed.count) return;
    let result: ProviderOperationResult;
    try {
      const input = {
        amountMinor: operation.amountMinor,
        currency: operation.currency,
        externalPaymentId: payment.externalPaymentId,
        idempotencyKey: operation.idempotencyKey,
        requestReference: operation.providerRequestReference,
      };
      result =
        type === PaymentOperationType.CAPTURE
          ? await this.provider.capture(input)
          : await this.provider.voidAuthorization(input);
    } catch (error) {
      await this.recordUnknown(payment.id, operation.id, error);
      return;
    }
    if (result.kind === 'SUCCEEDED') {
      if (type === PaymentOperationType.CAPTURE) {
        await this.finalizeCapture(
          payment.id,
          operation.id,
          result.providerState ?? 'CAPTURED',
          request,
          result.externalOperationId,
        );
      } else {
        await this.finalizeVoid(
          payment.id,
          operation.id,
          result.providerState ?? 'VOIDED',
          result.externalOperationId,
        );
      }
    } else if (result.kind === 'DECLINED') {
      if (type === PaymentOperationType.CAPTURE) {
        await this.failCapture(payment.id, operation.id, result, request);
      } else {
        await this.recordUnknown(payment.id, operation.id, undefined, result);
      }
    } else {
      await this.recordUnknown(payment.id, operation.id, undefined, result);
    }
  }

  private async finalizeAuthorization(
    paymentId: string,
    operationId: string,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await this.lockPayment(transaction, paymentId);
      const booking = await this.lockBooking(transaction, payment.bookingId);
      if (payment.status === PaymentStatus.AUTHORIZED || payment.status === PaymentStatus.CAPTURED)
        return;
      const externalPaymentId = result.externalPaymentId ?? payment.externalPaymentId;
      if (!externalPaymentId)
        throw new Error('Provider authorization did not return a payment identity.');
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          failureCategory: null,
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: operationId },
      });
      if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        await transaction.payment.update({
          data: {
            authorizedAmountMinor: payment.amountMinor,
            authorizedAt: new Date(),
            customerActionUrl: null,
            externalPaymentId,
            providerState: result.providerState ?? 'AUTHORIZED',
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
        await this.ensureOperation(transaction, payment, PaymentOperationType.CAPTURE);
        return;
      }
      if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.EXPIRED) {
        await transaction.payment.update({
          data: {
            authorizedAmountMinor: payment.amountMinor,
            authorizedAt: new Date(),
            externalPaymentId,
            providerState: result.providerState ?? null,
            status: PaymentStatus.VOID_PENDING,
          },
          where: { id: payment.id },
        });
        await this.ensureOperation(transaction, payment, PaymentOperationType.VOID);
        return;
      }
      if (booking.status !== BookingStatus.AWAITING_PAYMENT) return;
      const renterEligibility = await this.renterEligibility.evaluate(
        booking.renterUserId,
        transaction,
      );
      if (!renterEligibility.eligible) {
        await transaction.payment.update({
          data: {
            authorizedAmountMinor: payment.amountMinor,
            authorizedAt: new Date(),
            externalPaymentId,
            providerState: result.providerState ?? 'AUTHORIZED',
            status: PaymentStatus.VOID_PENDING,
          },
          where: { id: payment.id },
        });
        await this.ensureOperation(transaction, payment, PaymentOperationType.VOID);
        await transaction.booking.update({
          data: { status: BookingStatus.CANCELLED },
          where: { id: booking.id },
        });
        await transaction.vehicleOccupancy.updateMany({
          data: {
            active: false,
            releaseReason: 'RENTER_VERIFICATION_REQUIRED',
            releasedAt: new Date(),
          },
          where: { active: true, bookingId: booking.id },
        });
        await this.history(
          transaction,
          booking.id,
          booking.status,
          BookingStatus.CANCELLED,
          'RENTER_VERIFICATION_REQUIRED',
          request,
        );
        await this.outbox(transaction, booking.id, 'BOOKING_CANCELLED', {
          bookingId: booking.id,
          reasonCode: 'RENTER_VERIFICATION_REQUIRED',
        });
        return;
      }
      const deadline = new Date(
        Date.now() +
          this.configuration.getOrThrow('OWNER_RESPONSE_TTL_MINUTES', { infer: true }) * 60_000,
      );
      await transaction.payment.update({
        data: {
          authorizedAmountMinor: payment.amountMinor,
          authorizedAt: new Date(),
          customerActionUrl: null,
          externalPaymentId,
          providerState: result.providerState ?? 'AUTHORIZED',
          reconcileAfter: null,
          reconciliationRequired: false,
          status: PaymentStatus.AUTHORIZED,
          unknownExpiresAt: null,
        },
        where: { id: payment.id },
      });
      await transaction.booking.update({
        data: { ownerResponseDeadlineAt: deadline, status: BookingStatus.AWAITING_OWNER },
        where: { id: booking.id },
      });
      await transaction.vehicleOccupancy.updateMany({
        data: { expiresAt: deadline },
        where: { active: true, bookingId: booking.id },
      });
      await this.history(
        transaction,
        booking.id,
        booking.status,
        BookingStatus.AWAITING_OWNER,
        'PAYMENT_AUTHORIZED_OWNER_REQUESTED',
        request,
      );
      await this.outbox(transaction, booking.id, 'PAYMENT_AUTHORIZED', {
        bookingId: booking.id,
        paymentId: payment.id,
      });
      await this.outbox(transaction, booking.id, 'BOOKING_OWNER_REQUESTED', {
        bookingId: booking.id,
        ownerUserId: booking.ownerUserId,
      });
    });
  }

  private async finalizeCapture(
    paymentId: string,
    operationId: string | undefined,
    providerState: string,
    request: RequestMetadata,
    externalOperationId?: string,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await this.lockPayment(transaction, paymentId);
      if (payment.status === PaymentStatus.CAPTURED) return;
      if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        await transaction.$executeRaw(
          Prisma.sql`SELECT "finalize_additional_charge_payment"(${payment.id}::uuid, ${operationId ?? null}::uuid, ${providerState}, ${externalOperationId ?? null}, ${request.correlationId ?? null})`,
        );
        return;
      }
      const booking = await transaction.booking.findUniqueOrThrow({
        include: {
          fulfillmentSnapshot: true,
          pricingSnapshot: true,
          vehicle: { select: { categoryId: true } },
        },
        where: { id: payment.bookingId },
      });
      if (booking.status !== BookingStatus.CAPTURE_PENDING) {
        throw new Error(
          'Captured provider payment cannot be applied to the current booking state.',
        );
      }
      if (!booking.pricingSnapshot) throw new Error('Booking pricing snapshot is missing.');
      const rule = await this.selectCommissionRule(
        transaction,
        booking.ownerProfileId,
        booking.vehicle.categoryId,
      );
      const rentalComponent = BigInt(booking.pricingSnapshot.discountedRentalSubtotalMinor);
      const deliveryComponent = BigInt(booking.fulfillmentSnapshot?.deliveryFeeMinor ?? 0);
      const collectionComponent = BigInt(booking.fulfillmentSnapshot?.collectionFeeMinor ?? 0);
      const { accountedTotalMinor: capturedTotal } = reconcileCaptureComponents({
        capturedTotalMinor: payment.amountMinor,
        collectionComponentMinor: collectionComponent,
        deliveryComponentMinor: deliveryComponent,
        pricingTotalMinor: BigInt(booking.pricingSnapshot.totalMinor),
        rentalComponentMinor: rentalComponent,
      });
      const gross = rentalComponent;
      let commission = (gross * BigInt(rule.rateBasisPoints)) / 10_000n + rule.fixedAmountMinor;
      if (rule.minimumAmountMinor !== null && commission < rule.minimumAmountMinor)
        commission = rule.minimumAmountMinor;
      if (rule.maximumAmountMinor !== null && commission > rule.maximumAmountMinor)
        commission = rule.maximumAmountMinor;
      if (commission > gross) commission = gross;
      const net = gross - commission;
      const accounts = await transaction.financialAccount.findMany({
        where: { active: true, currency: payment.currency },
      });
      const account = (type: FinancialAccountType) => {
        const found = accounts.find((item) => item.type === type);
        if (!found) throw new Error(`Financial account ${type} is missing.`);
        return found.id;
      };
      if (operationId) {
        await transaction.paymentOperation.update({
          data: {
            completedAt: new Date(),
            externalOperationId: externalOperationId ?? null,
            failureCategory: null,
            status: PaymentOperationStatus.SUCCEEDED,
          },
          where: { id: operationId },
        });
      }
      await transaction.payment.update({
        data: {
          capturedAmountMinor: payment.amountMinor,
          capturedAt: new Date(),
          providerState,
          reconcileAfter: null,
          reconciliationRequired: false,
          status: PaymentStatus.CAPTURED,
          unknownExpiresAt: null,
        },
        where: { id: payment.id },
      });
      await transaction.booking.update({
        data: { status: BookingStatus.CONFIRMED },
        where: { id: booking.id },
      });
      await transaction.commissionSnapshot.create({
        data: {
          bookingId: booking.id,
          calculatedCommissionMinor: commission,
          calculationVersion: rule.calculationVersion,
          commissionableBaseMinor: gross,
          currency: payment.currency,
          fixedAmountMinor: rule.fixedAmountMinor,
          maximumAmountMinor: rule.maximumAmountMinor,
          minimumAmountMinor: rule.minimumAmountMinor,
          paymentId: payment.id,
          rateBasisPoints: rule.rateBasisPoints,
          ruleId: rule.id,
          ruleVersion: rule.version,
          scope: rule.scope,
        },
      });
      await transaction.ownerEarning.create({
        data: {
          bookingId: booking.id,
          commissionAmountMinor: commission,
          collectionEarningMinor: collectionComponent,
          currency: payment.currency,
          deliveryEarningMinor: deliveryComponent,
          grossRentalAmountMinor: gross,
          netEarningAmountMinor: net,
          ownerProfileId: booking.ownerProfileId,
          paymentId: payment.id,
          status: OwnerEarningStatus.PENDING,
        },
      });
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: payment.currency,
          description: 'Rental payment capture recognized',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
                amountMinor: capturedTotal,
                currency: payment.currency,
                memo: 'Provider receivable',
              },
              {
                accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                amountMinor: -capturedTotal,
                currency: payment.currency,
                memo: 'Customer funds held',
              },
            ],
          },
          sourceId: payment.id,
          sourceType: 'PAYMENT',
          type: LedgerTransactionType.CAPTURE_RECOGNITION,
        },
      });
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: payment.currency,
          description: 'Captured rental allocated to owner and platform',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.CUSTOMER_FUNDS_HELD),
                amountMinor: capturedTotal,
                currency: payment.currency,
                memo: 'Allocate held customer funds',
              },
              {
                accountId: account(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: -(net + deliveryComponent + collectionComponent),
                currency: payment.currency,
                memo: 'Pending owner earning',
              },
              {
                accountId: account(FinancialAccountType.PLATFORM_COMMISSION_REVENUE),
                amountMinor: -commission,
                currency: payment.currency,
                memo: 'Platform commission',
              },
            ],
          },
          sourceId: payment.id,
          sourceType: 'PAYMENT',
          type: LedgerTransactionType.CAPTURE_ALLOCATION,
        },
      });
      await this.history(
        transaction,
        booking.id,
        booking.status,
        BookingStatus.CONFIRMED,
        'PAYMENT_CAPTURED_BOOKING_CONFIRMED',
        request,
      );
      await this.outbox(transaction, booking.id, 'PAYMENT_CAPTURED', {
        bookingId: booking.id,
        paymentId: payment.id,
      });
      await this.outbox(transaction, booking.id, 'OWNER_EARNING_PENDING', {
        bookingId: booking.id,
        paymentId: payment.id,
      });
    });
  }

  private async finalizeVoid(
    paymentId: string,
    operationId: string | undefined,
    providerState: string,
    externalOperationId?: string,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await this.lockPayment(transaction, paymentId);
      if (payment.status === PaymentStatus.VOIDED) return;
      if (operationId) {
        await transaction.paymentOperation.update({
          data: {
            completedAt: new Date(),
            externalOperationId: externalOperationId ?? null,
            failureCategory: null,
            status: PaymentOperationStatus.SUCCEEDED,
          },
          where: { id: operationId },
        });
      }
      await transaction.payment.update({
        data: {
          providerState,
          reconcileAfter: null,
          reconciliationRequired: false,
          status: PaymentStatus.VOIDED,
          voidedAt: new Date(),
        },
        where: { id: payment.id },
      });
      await this.outbox(transaction, payment.bookingId, 'PAYMENT_AUTHORIZATION_VOIDED', {
        bookingId: payment.bookingId,
        paymentId: payment.id,
      });
    });
  }

  private async failAuthorization(
    paymentId: string,
    operationId: string,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await this.lockPayment(transaction, paymentId);
      const booking = await this.lockBooking(transaction, payment.bookingId);
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          failureCategory: PaymentFailureCategory.DEFINITIVE,
          failureCode: result.failureCode ?? 'DECLINED',
          failureMessage: result.failureMessage ?? null,
          status: PaymentOperationStatus.FAILED,
        },
        where: { id: operationId },
      });
      await transaction.payment.update({
        data: { providerState: result.providerState ?? null, status: PaymentStatus.FAILED },
        where: { id: payment.id },
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
      if (booking.status === BookingStatus.AWAITING_PAYMENT) {
        await transaction.booking.update({
          data: { status: BookingStatus.CANCELLED },
          where: { id: booking.id },
        });
        await transaction.vehicleOccupancy.updateMany({
          data: {
            active: false,
            releaseReason: 'PAYMENT_AUTHORIZATION_FAILED',
            releasedAt: new Date(),
          },
          where: { active: true, bookingId: booking.id },
        });
        await this.history(
          transaction,
          booking.id,
          booking.status,
          BookingStatus.CANCELLED,
          'PAYMENT_AUTHORIZATION_FAILED',
          request,
        );
      }
    });
  }

  private async failCapture(
    paymentId: string,
    operationId: string,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      const payment = await this.lockPayment(transaction, paymentId);
      const booking = await this.lockBooking(transaction, payment.bookingId);
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          failureCategory: PaymentFailureCategory.DEFINITIVE,
          failureCode: result.failureCode ?? 'CAPTURE_DECLINED',
          status: PaymentOperationStatus.FAILED,
        },
        where: { id: operationId },
      });
      await transaction.payment.update({
        data: { status: PaymentStatus.VOID_PENDING },
        where: { id: payment.id },
      });
      await this.ensureOperation(transaction, payment, PaymentOperationType.VOID);
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
        await this.history(
          transaction,
          booking.id,
          booking.status,
          BookingStatus.CANCELLED,
          'PAYMENT_CAPTURE_FAILED',
          request,
        );
      }
    });
  }

  private async recordUnknown(
    paymentId: string,
    operationId: string,
    error?: unknown,
    result?: ProviderOperationResult,
  ) {
    const failureCategory =
      error instanceof PaymentProviderError
        ? error.category === 'CONFIGURATION'
          ? PaymentFailureCategory.CONFIGURATION
          : PaymentFailureCategory.PROVIDER_UNAVAILABLE
        : PaymentFailureCategory.UNKNOWN;
    const grace = this.configuration.getOrThrow('PAYMENT_UNKNOWN_GRACE_MINUTES', { infer: true });
    await this.database.client.$transaction([
      this.database.client.paymentOperation.update({
        data: {
          failureCategory,
          failureCode: result?.failureCode ?? null,
          failureMessage:
            error instanceof Error ? error.message.slice(0, 500) : (result?.failureMessage ?? null),
          nextAttemptAt: new Date(Date.now() + 15_000),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: operationId },
      }),
      this.database.client.payment.update({
        data: {
          ...(result?.externalPaymentId ? { externalPaymentId: result.externalPaymentId } : {}),
          providerState: result?.providerState ?? null,
          reconcileAfter: new Date(Date.now() + 15_000),
          reconciliationRequired: true,
          unknownExpiresAt: new Date(Date.now() + grace * 60_000),
        },
        where: { id: paymentId },
      }),
    ]);
  }

  private async deferReconciliation(paymentId: string) {
    await this.database.client.payment.update({
      data: { reconcileAfter: new Date(Date.now() + 15_000), reconciliationRequired: true },
      where: { id: paymentId },
    });
  }

  private async ensureOperation(
    transaction: Prisma.TransactionClient,
    payment: {
      id: string;
      amountMinor: bigint;
      currency: string;
      bookingId: string;
      purpose: PaymentPurpose;
      additionalChargeId: string | null;
    },
    type: PaymentOperationType,
  ) {
    const label = type.toLowerCase();
    const prefix =
      payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE
        ? `additional-charge:${payment.additionalChargeId}`
        : `booking:${payment.bookingId}`;
    return transaction.paymentOperation.upsert({
      create: {
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        idempotencyKey: `${prefix}:${label}:v1`,
        paymentId: payment.id,
        providerRequestReference: randomUUID(),
        status: PaymentOperationStatus.PENDING,
        type,
      },
      update: {},
      where: { idempotencyKey: `${prefix}:${label}:v1` },
    });
  }

  private async selectCommissionRule(
    transaction: Prisma.TransactionClient,
    ownerProfileId: string,
    categoryId: string | null,
  ) {
    const active = {
      effectiveFrom: { lte: new Date() },
      OR: [{ disabledAt: null }, { disabledAt: { gt: new Date() } }],
    };
    const owner = await transaction.commissionRule.findFirst({
      orderBy: { version: 'desc' },
      where: { ...active, ownerProfileId, scope: CommissionScope.OWNER },
    });
    if (owner) return owner;
    if (categoryId) {
      const category = await transaction.commissionRule.findFirst({
        orderBy: { version: 'desc' },
        where: {
          ...active,
          scope: CommissionScope.VEHICLE_CATEGORY,
          vehicleCategoryId: categoryId,
        },
      });
      if (category) return category;
    }
    const platform = await transaction.commissionRule.findFirst({
      orderBy: { version: 'desc' },
      where: { ...active, scope: CommissionScope.PLATFORM_DEFAULT },
    });
    if (!platform) throw new Error('An active platform commission rule is required.');
    return platform;
  }

  private async lockBooking(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
    if (!rows.length) this.notFound();
    return transaction.booking.findUniqueOrThrow({ where: { id } });
  }

  private async lockPayment(transaction: Prisma.TransactionClient, id: string) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
    if (!rows.length) this.notFound();
    return transaction.payment.findUniqueOrThrow({ where: { id } });
  }

  private history(
    transaction: Prisma.TransactionClient,
    bookingId: string,
    fromStatus: BookingStatus,
    toStatus: BookingStatus,
    reasonCode: string,
    request: RequestMetadata,
  ) {
    return transaction.bookingStatusHistory.create({
      data: {
        actorType: BookingActorType.SYSTEM,
        bookingId,
        correlationId: request.correlationId ?? null,
        fromStatus,
        reasonCode,
        toStatus,
      },
    });
  }

  private outbox(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    eventType: string,
    payload: Prisma.InputJsonObject,
  ) {
    return transaction.outboxEvent.create({
      data: { aggregateId, aggregateType: 'BOOKING', eventType, payload },
    });
  }

  private providerCode(): PaymentProviderCode {
    return this.provider.code === 'MAYA' ? PaymentProviderCode.MAYA : PaymentProviderCode.FAKE;
  }

  private bookingIdentity(reference: string): Prisma.BookingWhereInput {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      reference,
    )
      ? { OR: [{ id: reference }, { publicReference: reference }] }
      : { publicReference: reference };
  }

  private paymentProjection(payment: PaymentRecord) {
    return {
      amountMinor: this.minor(payment.amountMinor),
      authorizedAmountMinor: this.minor(payment.authorizedAmountMinor),
      capturedAmountMinor: this.minor(payment.capturedAmountMinor),
      currency: payment.currency,
      customerActionUrl: payment.customerActionUrl,
      paymentId: payment.id,
      provider: payment.provider,
      providerState: payment.providerState,
      reconciliationRequired: payment.reconciliationRequired,
      refundedAmountMinor: this.minor(payment.refundedAmountMinor),
      status: payment.status,
    };
  }

  private snapshotProjection(snapshot: {
    calculatedCommissionMinor: bigint;
    commissionableBaseMinor: bigint;
    fixedAmountMinor: bigint;
    minimumAmountMinor: bigint | null;
    maximumAmountMinor: bigint | null;
    [key: string]: unknown;
  }) {
    return {
      ...snapshot,
      calculatedCommissionMinor: this.minor(snapshot.calculatedCommissionMinor),
      commissionableBaseMinor: this.minor(snapshot.commissionableBaseMinor),
      fixedAmountMinor: this.minor(snapshot.fixedAmountMinor),
      maximumAmountMinor:
        snapshot.maximumAmountMinor === null ? null : this.minor(snapshot.maximumAmountMinor),
      minimumAmountMinor:
        snapshot.minimumAmountMinor === null ? null : this.minor(snapshot.minimumAmountMinor),
    };
  }

  private earningProjection(earning: {
    additionalCompensationMinor: bigint;
    adjustmentAmountMinor: bigint;
    commissionAmountMinor: bigint;
    grossRentalAmountMinor: bigint;
    netEarningAmountMinor: bigint;
    [key: string]: unknown;
  }) {
    return {
      ...earning,
      additionalCompensationMinor: this.minor(earning.additionalCompensationMinor),
      adjustmentAmountMinor: this.minor(earning.adjustmentAmountMinor),
      commissionAmountMinor: this.minor(earning.commissionAmountMinor),
      grossRentalAmountMinor: this.minor(earning.grossRentalAmountMinor),
      netEarningAmountMinor: this.minor(earning.netEarningAmountMinor),
    };
  }

  private minor(value: bigint): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number))
      throw new Error('Monetary value exceeds API safe integer range.');
    return number;
  }

  private safeJson(
    value: Readonly<Record<string, string | number | boolean | null>> | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value ? (value as Prisma.InputJsonValue) : Prisma.JsonNull;
  }

  private notFound(): never {
    throw new ApplicationException(
      PaymentErrorCode.PAYMENT_NOT_FOUND,
      'Payment or booking was not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private invalidState(message: string): never {
    throw new ApplicationException(
      PaymentErrorCode.PAYMENT_INVALID_STATE,
      message,
      HttpStatus.CONFLICT,
    );
  }
}
