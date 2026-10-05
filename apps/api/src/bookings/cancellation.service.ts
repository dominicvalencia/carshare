import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingAmendmentStatus,
  BookingStatus,
  CancellationActorType,
  CancellationReasonCode,
  FinancialAccountType,
  HandoverPhase,
  HandoverTravelStatus,
  LedgerTransactionType,
  OwnerEarningStatus,
  OwnerFinancialObligationStatus,
  OwnerFinancialObligationType,
  PaymentFailureCategory,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@carrental/database';
import type { PaymentProvider, ProviderOperationResult } from '@carrental/payments';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.factory';
import type { RequestMetadata } from '../security/security-context';
import type { ExecuteCancellationDto } from './bookings.dto';
import { hasBlockingAcceptedBookingAmendment } from './booking-amendment-lifecycle-guard';
import {
  CANCELLATION_POLICY_VERSION,
  evaluateConfirmedCancellation,
  type ConfirmedCancellationPolicyResult,
} from './cancellation-policy';

const PREVIEW_VERSION = 'CANCELLATION_PREVIEW_V1';
const PREVIEW_TTL_MS = 5 * 60 * 1000;

const CANCELLATION_INCLUDE = {
  amendments: {
    include: { fulfillmentSnapshot: true, pricingSnapshot: true, settlement: true },
    orderBy: [{ appliedAt: 'desc' as const }, { id: 'desc' as const }],
    where: {
      status: {
        in: [
          BookingAmendmentStatus.APPLIED,
          BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
          BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING,
        ],
      },
    },
  },
  cancellationSettlement: { include: { refund: true, ownerFinancialObligations: true } },
  commissionSnapshot: true,
  fulfillmentSnapshot: true,
  handoverTravelEvents: true,
  ownerEarning: true,
  payments: {
    include: { operations: true, refunds: true },
    orderBy: { createdAt: 'desc' as const },
    where: { purpose: PaymentPurpose.RENTAL },
  },
  pickupChallenges: true,
  pricingSnapshot: true,
  securityDeposit: { include: { payment: { include: { operations: true } } } },
} satisfies Prisma.BookingInclude;

type CancellationBooking = Prisma.BookingGetPayload<{ include: typeof CANCELLATION_INCLUDE }>;

function cancellationAuthority(booking: CancellationBooking) {
  const applied = booking.amendments.find(
    (amendment) => amendment.status === BookingAmendmentStatus.APPLIED,
  );
  const pricing = applied?.pricingSnapshot;
  const fulfillment = applied?.fulfillmentSnapshot;
  const evidence = jsonRecord(fulfillment?.serviceabilitySnapshot);
  return {
    collectionFeeMinor:
      fulfillment && applied.proposedEndMethod === 'OWNER_COLLECTION'
        ? (bigintFromJson(evidence?.proposedCollectionFeeMinor) ?? 0n)
        : fulfillment
          ? 0n
          : BigInt(booking.fulfillmentSnapshot!.collectionFeeMinor),
    commissionMinor:
      pricing?.proposedCommissionMinor ?? booking.commissionSnapshot!.calculatedCommissionMinor,
    deliveryFeeMinor:
      fulfillment && applied.proposedStartMethod === 'OWNER_DELIVERY'
        ? (bigintFromJson(evidence?.proposedDeliveryFeeMinor) ?? 0n)
        : fulfillment
          ? 0n
          : BigInt(booking.fulfillmentSnapshot!.deliveryFeeMinor),
    rentalComponentMinor:
      pricing?.proposedRentalSubtotalMinor ?? booking.commissionSnapshot!.commissionableBaseMinor,
    rentalStart: applied?.proposedRentalStart ?? booking.rentalStart,
  };
}

function survivingAmendmentRefundObligation(booking: CancellationBooking): bigint {
  const recoveries = booking.amendments.filter(
    (amendment) =>
      (amendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING ||
        amendment.status === BookingAmendmentStatus.FINANCIAL_RECOVERY_PENDING) &&
      amendment.settlement?.direction === BookingAmendmentFinancialDirection.REFUND &&
      amendment.settlement.financialDeltaMinor < 0n,
  );
  if (recoveries.length > 1) throw new Error('AMBIGUOUS_SURVIVING_AMENDMENT_REFUND_OBLIGATION');
  const recovery = recoveries[0];
  return recovery?.settlement ? -recovery.settlement.financialDeltaMinor : 0n;
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : null;
}

function bigintFromJson(value: Prisma.JsonValue | undefined) {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  return null;
}

interface PreviewClaims {
  actor: CancellationActorType;
  bookingId: string;
  expiresAt: string;
  paymentId: string;
  policyCode: string;
  reasonCode: CancellationReasonCode;
  totalRefundMinor: string;
  version: typeof PREVIEW_VERSION;
}

interface PreparedRefund {
  operation: { id: string };
  payment: { capturedAmountMinor: bigint; id: string };
  refund: { amountMinor: bigint; id: string };
  settlement: { currency: string; id: string; refundAmountMinor: bigint };
}

@Injectable()
export class CancellationService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  previewRenter(userId: string, reference: string, reasonCode: CancellationReasonCode) {
    return this.preview(userId, reference, CancellationActorType.RENTER, reasonCode);
  }

  previewOwner(userId: string, reference: string, reasonCode: CancellationReasonCode) {
    return this.preview(userId, reference, CancellationActorType.OWNER, reasonCode);
  }

  executeRenter(
    userId: string,
    reference: string,
    input: ExecuteCancellationDto,
    idempotencyKey: string,
    request: RequestMetadata,
  ) {
    return this.execute(
      userId,
      reference,
      CancellationActorType.RENTER,
      input,
      idempotencyKey,
      request,
    );
  }

  executeOwner(
    userId: string,
    reference: string,
    input: ExecuteCancellationDto,
    idempotencyKey: string,
    request: RequestMetadata,
  ) {
    return this.execute(
      userId,
      reference,
      CancellationActorType.OWNER,
      input,
      idempotencyKey,
      request,
    );
  }

  private async preview(
    userId: string,
    reference: string,
    actor: CancellationActorType,
    reasonCode: CancellationReasonCode,
  ) {
    const booking = await this.findAuthorized(this.database.client, userId, reference, actor);
    if (!booking) this.notFound();
    const evaluatedAt = new Date();
    const { amendmentRefundObligationOffsetMinor, blockers, payment, result } = this.evaluate(
      booking,
      actor,
      evaluatedAt,
    );
    const authority = cancellationAuthority(booking);
    const expiresAt = new Date(evaluatedAt.getTime() + PREVIEW_TTL_MS);
    const claims: PreviewClaims = {
      actor,
      bookingId: booking.id,
      expiresAt: expiresAt.toISOString(),
      paymentId: payment.id,
      policyCode: result.policyCode,
      reasonCode,
      totalRefundMinor: result.totalRefundMinor.toString(),
      version: PREVIEW_VERSION,
    };
    return this.serialize({
      actor,
      applicableDeadlineAt: result.applicableDeadlineAt,
      authorizedAmountMinor: payment.authorizedAmountMinor,
      blockers,
      cancellationFeeMinor: result.cancellationFeeMinor,
      capturedAmountMinor: payment.capturedAmountMinor,
      collectionTreatment: {
        refundedMinor: result.collectionRefundedMinor,
        treatment: 'UNPERFORMED_REFUNDED',
      },
      confirmedAt: payment.capturedAt,
      currency: payment.currency,
      deliveryTreatment: {
        refundedMinor: result.deliveryRefundedMinor,
        retainedMinor: result.deliveryRetainedMinor,
        treatment:
          result.deliveryRetainedMinor > 0n ? 'COMPLETED_RETAINED' : 'UNPERFORMED_REFUNDED',
      },
      eligible: blockers.length === 0,
      evaluatedAt,
      expiresAt,
      nonRefundableRentalMinor: result.nonRefundableRentalMinor,
      ownerEarningOutcome:
        result.ownerEarningForfeitedMinor > 0n
          ? 'FORFEITED_OR_REVERSED'
          : 'RETAINED_SUBJECT_TO_HOLDS',
      ownerPenaltyMinor: result.ownerPenaltyMinor,
      policyCode: result.policyCode,
      policyVersion: result.policyVersion,
      previewToken: this.sign(claims),
      previewVersion: PREVIEW_VERSION,
      refundableRentalMinor: result.refundableRentalMinor,
      responsibility: result.responsibility,
      scheduledPickupAt: authority.rentalStart,
      totalRefundMinor: result.totalRefundMinor,
      amendmentRefundObligationOffsetMinor,
    });
  }

  private async execute(
    userId: string,
    reference: string,
    actor: CancellationActorType,
    input: ExecuteCancellationDto,
    idempotencyKey: string,
    request: RequestMetadata,
  ) {
    if (!this.provider.capabilities.supportsRefund)
      this.conflict('CANCELLATION_REFUND_UNAVAILABLE', 'Provider refunds are not enabled.');
    const claims = this.verify(input.previewToken);
    if (
      claims.actor !== actor ||
      claims.reasonCode !== input.reasonCode ||
      new Date(claims.expiresAt) <= new Date()
    )
      this.conflict('CANCELLATION_PREVIEW_STALE', 'Cancellation preview is stale.');

    const prepared = await this.database.client.$transaction(async (transaction) => {
      const found = await this.findAuthorized(transaction, userId, reference, actor);
      if (!found) this.notFound();
      await this.lockBooking(transaction, found.id);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: CANCELLATION_INCLUDE,
        where: { id: found.id },
      });
      if (booking.cancellationSettlement)
        return { existing: booking.cancellationSettlement } as const;
      if (await hasBlockingAcceptedBookingAmendment(transaction, booking.id))
        this.conflict(
          'BOOKING_INVALID_STATE',
          'Cancellation is unavailable while an accepted booking change is processing.',
        );
      const evaluatedAt = new Date();
      const { amendmentRefundObligationOffsetMinor, blockers, payment, result } = this.evaluate(
        booking,
        actor,
        evaluatedAt,
      );
      const authority = cancellationAuthority(booking);
      if (blockers.length > 0)
        this.conflict('CANCELLATION_BLOCKED', `Cancellation is blocked: ${blockers.join(', ')}.`);
      if (
        claims.bookingId !== booking.id ||
        claims.paymentId !== payment.id ||
        claims.policyCode !== result.policyCode ||
        claims.totalRefundMinor !== result.totalRefundMinor.toString()
      )
        this.conflict('CANCELLATION_PREVIEW_STALE', 'Cancellation policy changed; preview again.');
      await this.lockPayment(transaction, payment.id);
      const operation =
        result.totalRefundMinor > 0n
          ? await transaction.paymentOperation.create({
              data: {
                amountMinor: result.totalRefundMinor,
                attemptCount: 1,
                currency: payment.currency,
                idempotencyKey: `booking-cancellation:${booking.id}:refund:v1`,
                paymentId: payment.id,
                providerRequestReference: randomUUID(),
                startedAt: evaluatedAt,
                status: PaymentOperationStatus.PROCESSING,
                type: PaymentOperationType.REFUND,
              },
            })
          : null;
      const refund = operation
        ? await transaction.refund.create({
            data: {
              amountMinor: result.totalRefundMinor,
              currency: payment.currency,
              operationId: operation.id,
              paymentId: payment.id,
              reason: `Confirmed booking cancellation: ${input.reasonCode}`,
              status: RefundStatus.PROCESSING,
            },
          })
        : null;
      const cancellation = await transaction.bookingCancellation.create({
        data: {
          actorType:
            actor === CancellationActorType.ADMIN ? BookingActorType.ADMIN : BookingActorType.USER,
          actorUserId: userId,
          bookingId: booking.id,
          correlationId: request.correlationId ?? idempotencyKey,
          reasonCode: input.reasonCode,
          reasonText: input.detail?.trim() ?? null,
        },
      });
      const settlement = await transaction.bookingCancellationSettlement.create({
        data: {
          actorType: actor,
          applicableDeadlineAt: result.applicableDeadlineAt,
          amendmentRefundObligationOffsetMinor,
          bookingCancellationId: cancellation.id,
          bookingId: booking.id,
          calculationVersion: CANCELLATION_POLICY_VERSION,
          cancellationFeeMinor: result.cancellationFeeMinor,
          capturedAmountMinor: payment.capturedAmountMinor,
          collectionFeeMinor: authority.collectionFeeMinor,
          collectionRefundedMinor: result.collectionRefundedMinor,
          commissionRetainedMinor: result.commissionRetainedMinor,
          commissionSnapshotId: booking.commissionSnapshot!.id,
          confirmedAt: payment.capturedAt,
          correlationId: request.correlationId ?? idempotencyKey,
          currency: payment.currency,
          deliveryCompleted: result.deliveryRetainedMinor > 0n,
          deliveryCompletionBasis:
            result.deliveryRetainedMinor > 0n
              ? 'OWNER_DELIVERY_START_ARRIVED'
              : 'NO_COMPLETED_SERVICE_EVIDENCE',
          deliveryFeeMinor: authority.deliveryFeeMinor,
          deliveryRefundedMinor: result.deliveryRefundedMinor,
          deliveryRetainedMinor: result.deliveryRetainedMinor,
          evaluatedAt,
          fulfillmentTreatment: {
            amendmentRefundObligationOffsetMinor: amendmentRefundObligationOffsetMinor.toString(),
            collection: 'UNPERFORMED_REFUNDED',
            delivery:
              result.deliveryRetainedMinor > 0n ? 'COMPLETED_RETAINED' : 'UNPERFORMED_REFUNDED',
          },
          nonRefundableRentalMinor: result.nonRefundableRentalMinor,
          ownerEarningForfeitedMinor: result.ownerEarningForfeitedMinor,
          paymentDisposition: result.paymentDisposition,
          paymentId: payment.id,
          policyCode: result.policyCode,
          policyVersion: result.policyVersion,
          previewVersion: PREVIEW_VERSION,
          refundableRentalMinor: result.refundableRentalMinor,
          refundAmountMinor: result.totalRefundMinor,
          refundId: refund?.id ?? null,
          rentalComponentMinor: authority.rentalComponentMinor,
          responsibility: result.responsibility,
          scheduledPickupAt: authority.rentalStart,
          structuredReason: input.reasonCode,
        },
      });
      if (result.ownerEarningForfeitedMinor > 0n && booking.ownerEarning)
        await transaction.ownerEarning.update({
          data: {
            adjustmentAmountMinor:
              -booking.ownerEarning.netEarningAmountMinor -
              booking.ownerEarning.deliveryEarningMinor -
              booking.ownerEarning.collectionEarningMinor,
            lastFinancialResolutionAt: evaluatedAt,
            status: OwnerEarningStatus.REVERSED,
          },
          where: { id: booking.ownerEarning.id },
        });
      const obligation =
        actor === CancellationActorType.OWNER && result.ownerPenaltyMinor > 0n
          ? await this.createOwnerObligation(
              transaction,
              booking,
              cancellation.id,
              settlement.id,
              result,
              input.reasonCode,
              request.correlationId ?? idempotencyKey,
              evaluatedAt,
            )
          : null;
      await transaction.booking.update({
        data: { status: BookingStatus.CANCELLED },
        where: { id: booking.id },
      });
      const depositPayment = booking.securityDeposit?.payment;
      if (depositPayment?.status === PaymentStatus.AUTHORIZED) {
        await transaction.payment.update({
          data: { status: PaymentStatus.VOID_PENDING },
          where: { id: depositPayment.id },
        });
        if (!depositPayment.operations.some((item) => item.type === PaymentOperationType.VOID))
          await transaction.paymentOperation.create({
            data: {
              amountMinor: depositPayment.authorizedAmountMinor,
              attemptCount: 0,
              currency: depositPayment.currency,
              idempotencyKey: `booking:${booking.id}:security-deposit:void:v1`,
              paymentId: depositPayment.id,
              providerRequestReference: randomUUID(),
              status: PaymentOperationStatus.PENDING,
              type: PaymentOperationType.VOID,
            },
          });
      }
      await transaction.vehicleOccupancy.updateMany({
        data: {
          active: false,
          releaseReason: 'CONFIRMED_BOOKING_CANCELLED',
          releasedAt: evaluatedAt,
        },
        where: { active: true, bookingId: booking.id },
      });
      await transaction.bookingStatusHistory.create({
        data: {
          actorType:
            actor === CancellationActorType.ADMIN ? BookingActorType.ADMIN : BookingActorType.USER,
          actorUserId: userId,
          bookingId: booking.id,
          correlationId: request.correlationId ?? idempotencyKey,
          fromStatus: booking.status,
          reasonCode: `${actor}_CONFIRMED_BOOKING_CANCELLED`,
          reasonText: input.detail?.trim() ?? null,
          toStatus: BookingStatus.CANCELLED,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: booking.id,
          aggregateType: 'BOOKING',
          eventType: `${actor}_CONFIRMED_BOOKING_CANCELLED`,
          payload: {
            actor,
            bookingId: booking.id,
            paymentDisposition: result.paymentDisposition,
            refundStatus: refund ? 'PROCESSING' : 'NOT_REQUIRED',
          },
        },
      });
      return { booking, obligation, operation, payment, refund, result, settlement } as const;
    });
    if ('existing' in prepared)
      return this.serialize({
        ...prepared.existing,
        ownerFinancialObligation: prepared.existing.ownerFinancialObligations[0] ?? null,
      });
    if (!prepared.refund || !prepared.operation)
      return this.serialize({
        ...prepared.settlement,
        ownerFinancialObligation: prepared.obligation,
      });
    if (!prepared.payment.externalPaymentId)
      this.conflict('CANCELLATION_PAYMENT_INCONSISTENT', 'Captured payment reference is missing.');
    let providerResult: ProviderOperationResult;
    try {
      providerResult = await this.provider.refund({
        amountMinor: prepared.refund.amountMinor,
        currency: prepared.refund.currency,
        externalPaymentId: prepared.payment.externalPaymentId,
        idempotencyKey: prepared.operation.idempotencyKey,
        reason: 'Confirmed booking cancellation',
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch {
      await this.markUnknown(prepared.payment.id, prepared.refund.id, prepared.operation.id);
      return this.serialize({
        ...prepared.settlement,
        ownerFinancialObligation: prepared.obligation,
        refundStatus: RefundStatus.PROCESSING,
      });
    }
    if (providerResult.kind !== 'SUCCEEDED') {
      await this.markUnknown(prepared.payment.id, prepared.refund.id, prepared.operation.id);
      return this.serialize({
        ...prepared.settlement,
        ownerFinancialObligation: prepared.obligation,
        refundStatus: RefundStatus.PROCESSING,
      });
    }
    await this.finalizeRefund(
      {
        operation: prepared.operation,
        payment: prepared.payment,
        refund: prepared.refund,
        settlement: prepared.settlement,
      },
      providerResult,
      request,
    );
    return this.serialize({
      ...prepared.settlement,
      ownerFinancialObligation: prepared.obligation,
      refundStatus: RefundStatus.COMPLETED,
    });
  }

  private evaluate(booking: CancellationBooking, actor: CancellationActorType, evaluatedAt: Date) {
    const payment = booking.payments[0];
    const blockers: string[] = [];
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.READY_FOR_PICKUP
    )
      blockers.push('BOOKING_STATE');
    if (!payment || payment.status !== PaymentStatus.CAPTURED || !payment.capturedAt)
      blockers.push('CAPTURE_NOT_AUTHORITATIVE');
    if (payment?.reconciliationRequired) blockers.push('PAYMENT_RECONCILIATION_REQUIRED');
    if (!booking.commissionSnapshot) blockers.push('COMMISSION_SNAPSHOT_MISSING');
    if (!booking.pricingSnapshot || !booking.fulfillmentSnapshot)
      blockers.push('BOOKING_SNAPSHOT_MISSING');
    if (booking.operationalHold) blockers.push('OPERATIONAL_HOLD');
    const custodyStarted =
      Boolean(booking.actualPickupAt) || booking.pickupChallenges.some((item) => item.consumedAt);
    if (custodyStarted) blockers.push('CUSTODY_ESTABLISHED');
    if (booking.cancellationSettlement) blockers.push('ALREADY_CANCELLED');
    if (
      blockers.length > 0 ||
      !payment?.capturedAt ||
      !booking.commissionSnapshot ||
      !booking.fulfillmentSnapshot
    )
      this.conflict('CANCELLATION_BLOCKED', `Cancellation is blocked: ${blockers.join(', ')}.`);
    const deliveryPerformed = booking.handoverTravelEvents.some(
      (event) =>
        event.phase === HandoverPhase.START && event.status === HandoverTravelStatus.ARRIVED,
    );
    const authority = cancellationAuthority(booking);
    let result: ConfirmedCancellationPolicyResult;
    try {
      result = evaluateConfirmedCancellation({
        actor: actor as Exclude<CancellationActorType, 'LEGACY_UNSPECIFIED'>,
        capturedAmountMinor: payment.capturedAmountMinor,
        collectionFeeMinor: authority.collectionFeeMinor,
        commissionMinor: authority.commissionMinor,
        confirmedAt: payment.capturedAt,
        custodyStarted,
        deliveryFeeMinor: authority.deliveryFeeMinor,
        deliveryPerformed,
        evaluatedAt,
        rentalComponentMinor: authority.rentalComponentMinor,
        scheduledPickupAt: authority.rentalStart,
      });
    } catch (error) {
      this.conflict(
        'CANCELLATION_RECONCILIATION_FAILED',
        error instanceof Error ? error.message : 'Cancellation snapshots do not reconcile.',
      );
    }
    const amendmentRefundObligationOffsetMinor = survivingAmendmentRefundObligation(booking);
    const grossCancellationRefundMinor = result!.totalRefundMinor;
    result = {
      ...result!,
      totalRefundMinor:
        grossCancellationRefundMinor > amendmentRefundObligationOffsetMinor
          ? grossCancellationRefundMinor - amendmentRefundObligationOffsetMinor
          : 0n,
    };
    return { amendmentRefundObligationOffsetMinor, blockers, payment, result };
  }

  private findAuthorized(
    client: Prisma.TransactionClient | DatabaseService['client'],
    userId: string,
    reference: string,
    actor: CancellationActorType,
  ) {
    return client.booking.findFirst({
      include: CANCELLATION_INCLUDE,
      where: {
        ...(actor === CancellationActorType.OWNER
          ? { ownerUserId: userId }
          : { renterUserId: userId }),
        OR: [
          { publicReference: reference },
          ...(this.isUuid(reference) ? [{ id: reference }] : []),
        ],
      },
    });
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async createOwnerObligation(
    transaction: Prisma.TransactionClient,
    booking: CancellationBooking,
    cancellationId: string,
    settlementId: string,
    result: ConfirmedCancellationPolicyResult,
    reasonCode: CancellationReasonCode,
    correlationId: string,
    effectiveAt: Date,
  ) {
    const obligation = await transaction.ownerFinancialObligation.create({
      data: {
        auditMetadata: { actor: 'OWNER', bookingId: booking.id },
        cancellationSettlementId: settlementId,
        commissionSnapshotId: booking.commissionSnapshot!.id,
        correlationId,
        currency: booking.commissionSnapshot!.currency,
        effectiveAt,
        originalAmountMinor: result.ownerPenaltyMinor,
        ownerProfileId: booking.ownerProfileId,
        policyVersion: result.policyVersion,
        reasonCode,
        recoveredAmountMinor: 0n,
        remainingAmountMinor: result.ownerPenaltyMinor,
        sourceCancellationId: cancellationId,
        status: OwnerFinancialObligationStatus.OUTSTANDING,
        type: OwnerFinancialObligationType.CANCELLATION_PENALTY,
        waivedAmountMinor: 0n,
      },
    });
    const accounts = await transaction.financialAccount.findMany({
      where: { active: true, currency: obligation.currency },
    });
    const account = (type: FinancialAccountType) => {
      const found = accounts.find((item) => item.type === type);
      if (!found) throw new Error(`Financial account ${type} is missing.`);
      return found.id;
    };
    await transaction.ledgerTransaction.create({
      data: {
        correlationId,
        currency: obligation.currency,
        description: 'Owner confirmed-booking cancellation penalty recognized',
        entries: {
          create: [
            {
              accountId: account(FinancialAccountType.OWNER_PENALTY_RECEIVABLE),
              amountMinor: obligation.originalAmountMinor,
              currency: obligation.currency,
              memo: 'Owner cancellation penalty receivable',
            },
            {
              accountId: account(FinancialAccountType.PLATFORM_CANCELLATION_REVENUE),
              amountMinor: -obligation.originalAmountMinor,
              currency: obligation.currency,
              memo: 'Cancellation penalty revenue',
            },
          ],
        },
        sourceId: obligation.id,
        sourceType: 'OWNER_FINANCIAL_OBLIGATION',
        type: LedgerTransactionType.OWNER_PENALTY_RECOGNITION,
      },
    });
    return obligation;
  }

  private async markUnknown(paymentId: string, refundId: string, operationId: string) {
    const grace = this.configuration.getOrThrow('PAYMENT_UNKNOWN_GRACE_MINUTES', { infer: true });
    await this.database.client.$transaction([
      this.database.client.paymentOperation.update({
        data: {
          failureCategory: PaymentFailureCategory.UNKNOWN,
          nextAttemptAt: new Date(Date.now() + 15_000),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: operationId },
      }),
      this.database.client.payment.update({
        data: {
          reconcileAfter: new Date(Date.now() + 15_000),
          reconciliationRequired: true,
          unknownExpiresAt: new Date(Date.now() + grace * 60_000),
        },
        where: { id: paymentId },
      }),
      this.database.client.refund.update({
        data: { status: RefundStatus.PROCESSING },
        where: { id: refundId },
      }),
    ]);
  }

  private async finalizeRefund(
    prepared: PreparedRefund,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockPayment(transaction, prepared.payment.id);
      const refund = await transaction.refund.findUniqueOrThrow({
        where: { id: prepared.refund.id },
      });
      if (refund.status === RefundStatus.COMPLETED) return;
      const accounts = await transaction.financialAccount.findMany({
        where: { active: true, currency: prepared.settlement.currency },
      });
      const account = (type: FinancialAccountType) => {
        const found = accounts.find((item) => item.type === type);
        if (!found) throw new Error(`Financial account ${type} is missing.`);
        return found.id;
      };
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: prepared.settlement.currency,
          description: 'Confirmed booking cancellation refund',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: prepared.settlement.refundAmountMinor,
                currency: prepared.settlement.currency,
                memo: 'Cancellation allocation reversal',
              },
              {
                accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
                amountMinor: -prepared.settlement.refundAmountMinor,
                currency: prepared.settlement.currency,
                memo: 'Renter cancellation refund',
              },
            ],
          },
          sourceId: prepared.settlement.id,
          sourceType: 'BOOKING_CANCELLATION_SETTLEMENT',
          type: LedgerTransactionType.REFUND,
        },
      });
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          externalOperationId: result.externalOperationId ?? null,
          failureCategory: null,
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: prepared.operation.id },
      });
      await transaction.refund.update({
        data: {
          completedAt: new Date(),
          externalRefundId: result.externalOperationId ?? null,
          status: RefundStatus.COMPLETED,
        },
        where: { id: prepared.refund.id },
      });
      const payment = await transaction.payment.findUniqueOrThrow({
        where: { id: prepared.payment.id },
      });
      const refundedAmountMinor = payment.refundedAmountMinor + prepared.refund.amountMinor;
      await transaction.payment.update({
        data: {
          reconcileAfter: null,
          reconciliationRequired: false,
          refundedAmountMinor,
          status:
            refundedAmountMinor === payment.capturedAmountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
          unknownExpiresAt: null,
        },
        where: { id: payment.id },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: prepared.settlement.id,
          aggregateType: 'BOOKING_CANCELLATION_SETTLEMENT',
          eventType: 'BOOKING_CANCELLATION_REFUND_COMPLETED',
          payload: { refundId: prepared.refund.id, settlementId: prepared.settlement.id },
        },
      });
    });
  }

  private sign(claims: PreviewClaims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac(
      'sha256',
      this.configuration.getOrThrow('TOKEN_HASH_SECRET', { infer: true }),
    )
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private verify(token: string): PreviewClaims {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra)
      this.conflict('CANCELLATION_PREVIEW_INVALID', 'Invalid preview token.');
    const expected = createHmac(
      'sha256',
      this.configuration.getOrThrow('TOKEN_HASH_SECRET', { infer: true }),
    )
      .update(payload!)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature!, 'base64url');
    } catch {
      this.conflict('CANCELLATION_PREVIEW_INVALID', 'Invalid preview token.');
    }
    if (actual!.length !== expected.length || !timingSafeEqual(actual!, expected))
      this.conflict('CANCELLATION_PREVIEW_INVALID', 'Invalid preview token.');
    try {
      const claims = JSON.parse(
        Buffer.from(payload!, 'base64url').toString('utf8'),
      ) as PreviewClaims;
      if (claims.version !== PREVIEW_VERSION) throw new Error('version');
      return claims;
    } catch {
      this.conflict('CANCELLATION_PREVIEW_INVALID', 'Invalid preview token.');
    }
  }

  private async lockBooking(transaction: Prisma.TransactionClient, id: string) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "bookings" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
  }

  private async lockPayment(transaction: Prisma.TransactionClient, id: string) {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "payments" WHERE "id" = ${id}::uuid FOR UPDATE`,
    );
  }

  private conflict(code: string, message: string): never {
    throw new ApplicationException(code, message, HttpStatus.CONFLICT);
  }

  private notFound(): never {
    throw new ApplicationException('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
    ) as T;
  }
}
