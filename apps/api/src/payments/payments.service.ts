import { createHash, randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import {
  BookingActorType,
  BookingAmendmentFinancialDirection,
  BookingStatus,
  CommissionScope,
  FinancialAccountType,
  HandoverPhase,
  HandoverTravelStatus,
  LedgerTransactionType,
  OwnerEarningStatus,
  PaymentFailureCategory,
  PaymentEvidenceAttribution,
  PaymentOperationEvidenceSource,
  PaymentOperationStatus,
  PaymentOperationType,
  PaymentProviderCode,
  PaymentPurpose,
  PaymentStatus,
  PaymentWebhookStatus,
  Prisma,
  RefundStatus,
  SecurityDepositStatus,
  executeBookingAmendmentRefund,
  finalizeBookingAmendmentPaymentCapture,
  isBookingAmendmentReadyForPaidApplication,
  resolveAmendmentRefundManually,
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
import { canInitiateBookingAmendmentPayment } from '../bookings/amendment-payment-actionability';
import { PAYMENT_PROVIDER } from './payment-provider.factory';
import type { ResolveAmendmentRefundDto } from './payments.dto';

const PAYMENT_INCLUDE = {
  operations: { orderBy: { createdAt: 'asc' as const } },
  refunds: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.PaymentInclude;

type PaymentRecord = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

type HandoverCancellationReason =
  | 'VEHICLE_CONDITION_DIFFERS_FROM_INSPECTION'
  | 'UNDISCLOSED_DAMAGE'
  | 'SAFETY_CONCERN'
  | 'MECHANICAL_OR_WARNING_LIGHT'
  | 'VEHICLE_CLEANLINESS_OR_CONDITION'
  | 'VEHICLE_DOES_NOT_MATCH_BOOKING'
  | 'OWNER_RENTER_COULD_NOT_AGREE'
  | 'OTHER';

export interface HandoverCancellationQuote {
  capturedAmountMinor: string;
  collectionFeeMinor: string;
  collectionRefundedMinor: string;
  commissionRetainedMinor: string;
  currency: string;
  deliveryCompleted: boolean;
  deliveryFeeMinor: string;
  deliveryRefundedMinor: string;
  deliveryRetainedMinor: string;
  refundAmountMinor: string;
  rentalComponentMinor: string;
  rentalRefundedMinor: string;
}

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

export function calculatePreCustodyCancellation(input: {
  readonly capturedAmountMinor: bigint;
  readonly collectionFeeMinor: bigint;
  readonly commissionRetainedMinor: bigint;
  readonly currency: string;
  readonly deliveryCompleted: boolean;
  readonly deliveryFeeMinor: bigint;
  readonly rentalComponentMinor: bigint;
}): HandoverCancellationQuote {
  const deliveryRetainedMinor = input.deliveryCompleted ? input.deliveryFeeMinor : 0n;
  const deliveryRefundedMinor = input.deliveryFeeMinor - deliveryRetainedMinor;
  const rentalRefundedMinor = input.rentalComponentMinor - input.commissionRetainedMinor;
  if (rentalRefundedMinor < 0n) throw new Error('Commission cannot exceed the rental component.');
  const refundAmountMinor = rentalRefundedMinor + deliveryRefundedMinor + input.collectionFeeMinor;
  if (
    input.rentalComponentMinor + input.deliveryFeeMinor + input.collectionFeeMinor !==
      input.capturedAmountMinor ||
    refundAmountMinor + input.commissionRetainedMinor + deliveryRetainedMinor !==
      input.capturedAmountMinor
  )
    throw new Error('Cancellation components do not reconcile to the captured amount.');
  return {
    capturedAmountMinor: input.capturedAmountMinor.toString(),
    collectionFeeMinor: input.collectionFeeMinor.toString(),
    collectionRefundedMinor: input.collectionFeeMinor.toString(),
    commissionRetainedMinor: input.commissionRetainedMinor.toString(),
    currency: input.currency,
    deliveryCompleted: input.deliveryCompleted,
    deliveryFeeMinor: input.deliveryFeeMinor.toString(),
    deliveryRefundedMinor: deliveryRefundedMinor.toString(),
    deliveryRetainedMinor: deliveryRetainedMinor.toString(),
    refundAmountMinor: refundAmountMinor.toString(),
    rentalComponentMinor: input.rentalComponentMinor.toString(),
    rentalRefundedMinor: rentalRefundedMinor.toString(),
  };
}

export function calculatePreCustodyOwnerAdjustment(input: {
  readonly currentAdjustmentMinor: bigint;
  readonly originalNetEarningMinor: bigint;
  readonly retainedDeliveryMinor: bigint;
}) {
  return input.currentAdjustmentMinor + input.retainedDeliveryMinor - input.originalNetEarningMinor;
}

export function securityDepositEligibility(input: {
  readonly leadHours: number;
  readonly now: Date;
  readonly pickupAt: Date;
}) {
  const eligibleAt = new Date(input.pickupAt.getTime() - input.leadHours * 3_600_000);
  return { eligibleAt, isEligibleNow: input.now >= eligibleAt };
}

export function securityDepositAuthorizationFits(input: {
  readonly authorizationLifetimeSeconds: number | null;
  readonly clearanceBufferHours: number;
  readonly holdAt: Date;
  readonly returnAt: Date;
}) {
  if (!input.authorizationLifetimeSeconds) return false;
  const requiredUntil = input.returnAt.getTime() + input.clearanceBufferHours * 3_600_000;
  const providerExpiresAt = input.holdAt.getTime() + input.authorizationLifetimeSeconds * 1_000;
  return requiredUntil <= providerExpiresAt;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ConfigService) private readonly configuration: ConfigService<ApiEnvironment, true>,
    private readonly renterEligibility: RenterEligibilityService,
  ) {}

  resolveAmendmentRefundManually(
    actorUserId: string,
    amendmentSettlementId: string,
    input: ResolveAmendmentRefundDto,
  ) {
    return resolveAmendmentRefundManually(this.database.client, {
      actorType: BookingActorType.ADMIN,
      actorUserId,
      amendmentId: input.amendmentId,
      amendmentSettlementId,
      currency: input.currency,
      evidenceAt: new Date(input.evidenceAt),
      evidenceType: input.evidenceType,
      externalReference: input.externalReference,
      idempotencyKey: input.idempotencyKey,
      originalPaymentId: input.originalPaymentId,
      outcome: input.outcome,
      provider: input.provider,
      refundId: input.refundId,
      resolutionNote: input.resolutionNote,
      resolvedAmountMinor: BigInt(input.resolvedAmountMinor),
    });
  }

  async refundBookingAmendment(userId: string, reference: string, amendmentId: string) {
    const amendment = await this.database.client.bookingAmendment.findFirst({
      select: { id: true },
      where: {
        id: amendmentId,
        booking: { renterUserId: userId, ...this.bookingIdentity(reference) },
      },
    });
    if (!amendment) this.notFound();
    if (!this.provider.capabilities.supportsRefund)
      this.invalidState('Provider refunds are not enabled.');
    return executeBookingAmendmentRefund(this.database.client, this.provider, amendment.id, {
      unknownGraceMinutes: this.configuration.getOrThrow('PAYMENT_UNKNOWN_GRACE_MINUTES', {
        infer: true,
      }),
    });
  }

  async payBookingAmendment(
    userId: string,
    reference: string,
    amendmentId: string,
    request: RequestMetadata,
  ) {
    const prepared = await this.database.client.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "booking_amendments" WHERE "id" = ${amendmentId}::uuid FOR UPDATE`,
      );
      const amendment = await transaction.bookingAmendment.findFirst({
        include: {
          booking: { include: { renter: { select: { email: true } } } },
          pricingSnapshot: true,
          settlement: true,
        },
        where: {
          id: amendmentId,
          booking: { renterUserId: userId, ...this.bookingIdentity(reference) },
        },
      });
      if (!amendment) this.notFound();
      const settlement = amendment.settlement;
      const pricing = amendment.pricingSnapshot;
      if (!settlement || !pricing)
        this.invalidState('The booking amendment is not awaiting an additional payment.');
      if (settlement.additionalPaymentId) {
        const existing = await transaction.payment.findUniqueOrThrow({
          include: PAYMENT_INCLUDE,
          where: { id: settlement.additionalPaymentId },
        });
        this.assertAmendmentPaymentCorrelation(amendment, existing);
        return { amendment, existing: true, operation: null, payment: existing };
      }
      const evaluatedAt = new Date();
      if (
        !canInitiateBookingAmendmentPayment(
          {
            additionalPaymentId: settlement.additionalPaymentId,
            direction: settlement.direction,
            financialDeltaMinor: settlement.financialDeltaMinor,
            paymentDeadlineAt: amendment.paymentDeadlineAt,
            pricingCurrency: pricing.currency,
            renterFinancialDeltaMinor: pricing.renterFinancialDeltaMinor,
            settlementCurrency: settlement.currency,
            status: amendment.status,
          },
          evaluatedAt,
        )
      )
        this.invalidState(
          !amendment.paymentDeadlineAt || evaluatedAt >= amendment.paymentDeadlineAt
            ? 'The additional-payment deadline has passed.'
            : 'The booking amendment is not awaiting an additional payment.',
        );
      const providerRequestReference = randomUUID();
      const payment = await transaction.payment.create({
        data: {
          amountMinor: settlement.financialDeltaMinor,
          bookingId: amendment.bookingId,
          currency: settlement.currency,
          provider: this.providerCode(),
          providerRequestReference,
          purpose: PaymentPurpose.ADDITIONAL_CHARGE,
          status: PaymentStatus.AUTHORIZING,
        },
      });
      await transaction.bookingAmendmentSettlement.update({
        data: { additionalPaymentId: payment.id, status: 'PROCESSING' },
        where: { id: settlement.id },
      });
      await transaction.bookingAmendment.updateMany({
        data: { paymentInitiatedAt: evaluatedAt },
        where: { id: amendment.id, paymentInitiatedAt: null },
      });
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          attemptCount: 1,
          currency: payment.currency,
          idempotencyKey: `booking-amendment:${amendment.id}:authorize:v1`,
          paymentId: payment.id,
          providerRequestReference,
          startedAt: evaluatedAt,
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.AUTHORIZE,
        },
      });
      return {
        amendment,
        existing: false,
        operation,
        payment: { ...payment, operations: [], refunds: [] },
      };
    });
    if (prepared.existing || !prepared.operation)
      return this.amendmentPaymentProjection(prepared.amendment.id, prepared.payment);
    let result: ProviderOperationResult;
    try {
      result = await this.provider.authorize({
        amountMinor: prepared.payment.amountMinor,
        ...(prepared.amendment.booking.renter.email
          ? { customerEmail: prepared.amendment.booking.renter.email }
          : {}),
        currency: prepared.payment.currency,
        description: `Booking amendment ${prepared.amendment.id}`,
        idempotencyKey: prepared.operation.idempotencyKey,
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch (error) {
      await this.recordUnknown(prepared.payment.id, prepared.operation.id, error);
      return this.getAmendmentPayment(userId, reference, amendmentId);
    }
    if (result.kind === 'SUCCEEDED') {
      await this.finalizeAuthorization(prepared.payment.id, prepared.operation.id, result, request);
      const payment = await this.database.client.payment.findUniqueOrThrow({
        include: PAYMENT_INCLUDE,
        where: { id: prepared.payment.id },
      });
      if (payment.status === PaymentStatus.CAPTURING)
        await this.executePendingOperation(payment, PaymentOperationType.CAPTURE, request);
    } else if (result.kind === 'ACTION_REQUIRED') {
      await this.database.client.$transaction([
        this.database.client.payment.update({
          data: {
            customerActionUrl: result.customerActionUrl ?? null,
            externalPaymentId: result.externalPaymentId ?? null,
            providerState: result.providerState ?? null,
            reconcileAfter: new Date(Date.now() + 15_000),
            reconciliationRequired: true,
          },
          where: { id: prepared.payment.id },
        }),
        this.database.client.paymentOperation.update({
          data: { completedAt: new Date(), status: PaymentOperationStatus.SUCCEEDED },
          where: { id: prepared.operation.id },
        }),
      ]);
    } else if (result.kind === 'DECLINED') {
      await this.failAuthorization(prepared.payment.id, prepared.operation.id, result, request);
    } else {
      await this.recordUnknown(prepared.payment.id, prepared.operation.id, undefined, result);
    }
    return this.getAmendmentPayment(userId, reference, amendmentId);
  }

  async getAmendmentPayment(userId: string, reference: string, amendmentId: string) {
    const amendment = await this.database.client.bookingAmendment.findFirst({
      include: { settlement: true },
      where: {
        id: amendmentId,
        booking: { renterUserId: userId, ...this.bookingIdentity(reference) },
      },
    });
    if (!amendment?.settlement?.additionalPaymentId) this.notFound();
    const payment = await this.database.client.payment.findUniqueOrThrow({
      include: PAYMENT_INCLUDE,
      where: { id: amendment.settlement.additionalPaymentId },
    });
    this.assertAmendmentPaymentCorrelation(amendment, payment);
    return this.amendmentPaymentProjection(amendment.id, payment);
  }

  async previewPreCustodyCancellation(userId: string, reference: string) {
    const booking = await this.database.client.booking.findFirst({
      include: {
        commissionSnapshot: true,
        fulfillmentSnapshot: true,
        handoverTravelEvents: true,
        inspections: {
          include: {
            confirmations: {
              include: {
                discrepancyResponses: {
                  include: { resolutionReview: true },
                  orderBy: { roundNumber: 'asc' },
                },
              },
            },
          },
          where: { type: 'PICKUP', status: 'FINALIZED' },
        },
        payments: { where: { purpose: PaymentPurpose.RENTAL }, orderBy: { createdAt: 'desc' } },
        pickupChallenges: true,
        pricingSnapshot: true,
      },
      where: { renterUserId: userId, ...this.bookingIdentity(reference) },
    });
    if (!booking) this.notFound();
    this.assertPreCustodyCancellation(booking);
    const payment = booking.payments[0]!;
    const fulfillment = booking.fulfillmentSnapshot!;
    const commission = booking.commissionSnapshot!;
    const deliveryCompleted =
      fulfillment.startMethod === 'OWNER_DELIVERY' &&
      booking.handoverTravelEvents.some(
        (event) =>
          event.phase === HandoverPhase.START && event.status === HandoverTravelStatus.ARRIVED,
      );
    const deliveryFeeMinor = BigInt(fulfillment.deliveryFeeMinor);
    const collectionFeeMinor = BigInt(fulfillment.collectionFeeMinor);
    const rentalComponentMinor = commission.commissionableBaseMinor;
    const commissionRetainedMinor = commission.calculatedCommissionMinor;
    try {
      return calculatePreCustodyCancellation({
        capturedAmountMinor: payment.capturedAmountMinor,
        collectionFeeMinor,
        commissionRetainedMinor,
        currency: payment.currency,
        deliveryCompleted,
        deliveryFeeMinor,
        rentalComponentMinor,
      });
    } catch {
      throw new ApplicationException(
        'HANDOVER_CANCELLATION_RECONCILIATION_FAILED',
        'The accepted booking financial snapshot does not reconcile.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async cancelPreCustodyHandover(
    userId: string,
    reference: string,
    reasonCode: HandoverCancellationReason,
    reasonText: string | undefined,
    request: RequestMetadata,
  ) {
    if (!this.provider.capabilities.supportsRefund)
      this.invalidState('Provider refunds are not enabled.');
    if (reasonCode === 'OTHER' && !reasonText?.trim())
      this.invalidState('Explain the other cancellation reason.');
    const existing = await this.database.client.booking.findFirst({
      include: { cancellationSettlement: { include: { refund: true } } },
      where: { renterUserId: userId, ...this.bookingIdentity(reference) },
    });
    if (existing?.cancellationSettlement)
      return this.toSerializable(existing.cancellationSettlement);
    const prepared = await this.database.client.$transaction(async (transaction) => {
      const found = await transaction.booking.findFirst({
        where: { renterUserId: userId, ...this.bookingIdentity(reference) },
      });
      if (!found) this.notFound();
      await this.lockBooking(transaction, found.id);
      const booking = await transaction.booking.findUniqueOrThrow({
        include: {
          commissionSnapshot: true,
          fulfillmentSnapshot: true,
          handoverTravelEvents: true,
          inspections: {
            include: {
              confirmations: {
                include: {
                  discrepancyResponses: {
                    include: { resolutionReview: true },
                    orderBy: { roundNumber: 'asc' },
                  },
                },
              },
            },
            where: { type: 'PICKUP', status: 'FINALIZED' },
          },
          payments: { where: { purpose: PaymentPurpose.RENTAL }, orderBy: { createdAt: 'desc' } },
          pickupChallenges: true,
          pricingSnapshot: true,
          cancellationSettlement: true,
        },
        where: { id: found.id },
      });
      if (booking.cancellationSettlement)
        return { existingSettlement: booking.cancellationSettlement } as const;
      this.assertPreCustodyCancellation(booking);
      const payment = booking.payments[0]!;
      await this.lockPayment(transaction, payment.id);
      const fulfillment = booking.fulfillmentSnapshot!;
      const commission = booking.commissionSnapshot!;
      const deliveryCompleted =
        fulfillment.startMethod === 'OWNER_DELIVERY' &&
        booking.handoverTravelEvents.some(
          (event) =>
            event.phase === HandoverPhase.START && event.status === HandoverTravelStatus.ARRIVED,
        );
      let quote: HandoverCancellationQuote;
      try {
        quote = calculatePreCustodyCancellation({
          capturedAmountMinor: payment.capturedAmountMinor,
          collectionFeeMinor: BigInt(fulfillment.collectionFeeMinor),
          commissionRetainedMinor: commission.calculatedCommissionMinor,
          currency: payment.currency,
          deliveryCompleted,
          deliveryFeeMinor: BigInt(fulfillment.deliveryFeeMinor),
          rentalComponentMinor: commission.commissionableBaseMinor,
        });
      } catch {
        throw new ApplicationException(
          'HANDOVER_CANCELLATION_RECONCILIATION_FAILED',
          'The accepted booking financial snapshot does not reconcile.',
          HttpStatus.CONFLICT,
        );
      }
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: BigInt(quote.refundAmountMinor),
          attemptCount: 1,
          currency: quote.currency,
          idempotencyKey: `handover-cancellation:${booking.id}:refund:v1`,
          paymentId: payment.id,
          providerRequestReference: randomUUID(),
          startedAt: new Date(),
          status: PaymentOperationStatus.PROCESSING,
          type: PaymentOperationType.REFUND,
        },
      });
      const refund = await transaction.refund.create({
        data: {
          amountMinor: BigInt(quote.refundAmountMinor),
          currency: quote.currency,
          operationId: operation.id,
          paymentId: payment.id,
          reason: `Pre-custody handover cancellation: ${reasonCode}`,
          status: RefundStatus.PROCESSING,
        },
      });
      const cancellation = await transaction.bookingCancellation.create({
        data: {
          actorType: BookingActorType.USER,
          actorUserId: userId,
          bookingId: booking.id,
          correlationId: request.correlationId ?? null,
          reasonCode,
          reasonText: reasonText?.trim() ?? null,
        },
      });
      const settlement = await transaction.bookingCancellationSettlement.create({
        data: {
          bookingId: booking.id,
          bookingCancellationId: cancellation.id,
          calculationVersion: 'PRE_CUSTODY_HANDOVER_V1',
          capturedAmountMinor: BigInt(quote.capturedAmountMinor),
          collectionFeeMinor: BigInt(quote.collectionFeeMinor),
          collectionRefundedMinor: BigInt(quote.collectionRefundedMinor),
          commissionRetainedMinor: BigInt(quote.commissionRetainedMinor),
          commissionSnapshotId: booking.commissionSnapshot!.id,
          currency: quote.currency,
          deliveryCompleted: quote.deliveryCompleted,
          deliveryCompletionBasis: quote.deliveryCompleted
            ? 'OWNER_DELIVERY_START_ARRIVED'
            : 'NO_START_ARRIVED_EVENT',
          deliveryFeeMinor: BigInt(quote.deliveryFeeMinor),
          deliveryRefundedMinor: BigInt(quote.deliveryRefundedMinor),
          deliveryRetainedMinor: BigInt(quote.deliveryRetainedMinor),
          paymentId: payment.id,
          refundAmountMinor: BigInt(quote.refundAmountMinor),
          refundId: refund.id,
          rentalComponentMinor: BigInt(quote.rentalComponentMinor),
        },
      });
      await transaction.booking.update({
        data: { status: BookingStatus.CANCELLED },
        where: { id: booking.id },
      });
      await transaction.vehicleOccupancy.updateMany({
        data: {
          active: false,
          releaseReason: 'RENTER_HANDOVER_DISAGREEMENT_CANCELLED',
          releasedAt: new Date(),
        },
        where: { active: true, bookingId: booking.id },
      });
      await transaction.inspectionVerificationChallenge.updateMany({
        data: { supersededAt: new Date() },
        where: { bookingId: booking.id, consumedAt: null, supersededAt: null },
      });
      await transaction.bookingStatusHistory.create({
        data: {
          actorType: BookingActorType.USER,
          actorUserId: userId,
          bookingId: booking.id,
          correlationId: request.correlationId ?? null,
          fromStatus: booking.status,
          reasonCode: 'RENTER_PRE_CUSTODY_HANDOVER_CANCELLED',
          reasonText: reasonText?.trim() ?? null,
          toStatus: BookingStatus.CANCELLED,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateId: booking.id,
          aggregateType: 'BOOKING',
          eventType: 'RENTER_PRE_CUSTODY_HANDOVER_CANCELLED',
          payload: { bookingId: booking.id, recipientUserId: booking.ownerUserId },
        },
      });
      return { existingSettlement: null, operation, payment, refund, settlement } as const;
    });
    if (prepared.existingSettlement) return this.toSerializable(prepared.existingSettlement);
    if (!prepared.payment.externalPaymentId)
      this.invalidState('Captured payment reference is missing.');
    let result: ProviderOperationResult;
    try {
      result = await this.provider.refund({
        amountMinor: prepared.refund.amountMinor,
        currency: prepared.refund.currency,
        externalPaymentId: prepared.payment.externalPaymentId,
        idempotencyKey: prepared.operation.idempotencyKey,
        reason: 'Pre-custody handover cancellation',
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch {
      await this.markHandoverRefundUnknown(
        prepared.payment.id,
        prepared.refund.id,
        prepared.operation.id,
      );
      return this.toSerializable({ ...prepared.settlement, refundStatus: RefundStatus.PROCESSING });
    }
    if (result.kind !== 'SUCCEEDED') {
      await this.markHandoverRefundUnknown(
        prepared.payment.id,
        prepared.refund.id,
        prepared.operation.id,
      );
      return this.toSerializable({ ...prepared.settlement, refundStatus: RefundStatus.PROCESSING });
    }
    await this.finalizeHandoverRefund(
      prepared.settlement.id,
      prepared.payment.id,
      prepared.refund.id,
      prepared.operation.id,
      result,
      request,
    );
    return this.toSerializable({ ...prepared.settlement, refundStatus: RefundStatus.COMPLETED });
  }

  async authorizeRental(userId: string, reference: string, request: RequestMetadata) {
    const prepared = await this.database.client.$transaction(async (transaction) => {
      await this.renterEligibility.assertEligible(userId, transaction);
      const booking = await transaction.booking.findFirst({
        include: {
          policySnapshot: true,
          pricingSnapshot: true,
          renter: { select: { email: true } },
        },
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
      if (!booking.policySnapshot) this.invalidState('The booking policy snapshot is missing.');
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
      if (!booking.policySnapshot.securityDepositRequired) {
        await transaction.securityDepositAuthorization.upsert({
          create: {
            bookingId: booking.id,
            currency: booking.pricingSnapshot.currency,
            status: SecurityDepositStatus.NOT_REQUIRED,
          },
          update: {},
          where: { bookingId: booking.id },
        });
      }
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

  async authorizeSecurityDeposit(userId: string, reference: string, request: RequestMetadata) {
    if (!this.configuration.getOrThrow('SECURITY_DEPOSIT_EXECUTION_ENABLED', { infer: true }))
      throw new ApplicationException(
        PaymentErrorCode.SECURITY_DEPOSIT_EXECUTION_DISABLED,
        'Security deposit placement is not enabled.',
        HttpStatus.CONFLICT,
      );
    if (!this.provider.capabilities.supportsSecurityDeposit)
      this.invalidState('The payment provider cannot place security deposit holds.');
    const prepared = await this.database.client.$transaction(async (transaction) => {
      const identity = await transaction.booking.findFirst({
        select: { id: true },
        where: { renterUserId: userId, ...this.bookingIdentity(reference) },
      });
      if (!identity) this.notFound();
      await this.lockBooking(transaction, identity.id);
      const booking = await transaction.booking.findFirst({
        include: {
          payments: { where: { purpose: PaymentPurpose.RENTAL } },
          policySnapshot: true,
          renter: { select: { email: true } },
          securityDeposit: { include: { payment: { include: PAYMENT_INCLUDE } } },
        },
        where: { id: identity.id, renterUserId: userId },
      });
      if (!booking) this.notFound();
      const snapshot = booking.policySnapshot;
      if (
        !snapshot?.securityDepositRequired ||
        !snapshot.securityDepositAmountMinor ||
        !snapshot.securityDepositCurrency
      )
        this.invalidState('This booking does not require a security deposit.');
      if (
        booking.status !== BookingStatus.CONFIRMED &&
        booking.status !== BookingStatus.READY_FOR_PICKUP
      )
        this.invalidState('The booking is not eligible for security deposit placement.');
      if (!booking.payments.some((payment) => payment.status === PaymentStatus.CAPTURED))
        this.invalidState('Complete the rental payment before placing the security deposit.');
      const evaluatedAt = new Date();
      const eligibility = securityDepositEligibility({
        leadHours: this.configuration.getOrThrow('SECURITY_DEPOSIT_LEAD_HOURS', { infer: true }),
        now: evaluatedAt,
        pickupAt: booking.rentalStart,
      });
      if (!eligibility.isEligibleNow)
        throw new ApplicationException(
          PaymentErrorCode.SECURITY_DEPOSIT_NOT_ELIGIBLE,
          `The security deposit can be placed from ${eligibility.eligibleAt.toISOString()}.`,
          HttpStatus.CONFLICT,
        );
      const authorizationLifetime = this.provider.capabilities.authorizationHoldDurationSeconds;
      if (
        !securityDepositAuthorizationFits({
          authorizationLifetimeSeconds: authorizationLifetime,
          clearanceBufferHours: this.configuration.getOrThrow(
            'SECURITY_DEPOSIT_POST_RETURN_BUFFER_HOURS',
            { infer: true },
          ),
          holdAt: evaluatedAt,
          returnAt: booking.rentalEnd,
        })
      )
        throw new ApplicationException(
          PaymentErrorCode.SECURITY_DEPOSIT_AUTH_WINDOW_UNSUPPORTED,
          'The provider hold would not remain valid through the return clearance window.',
          HttpStatus.CONFLICT,
        );
      if (
        booking.securityDeposit?.payment &&
        booking.securityDeposit.payment.status !== PaymentStatus.FAILED &&
        booking.securityDeposit.payment.status !== PaymentStatus.VOIDED
      )
        return {
          booking,
          existing: true,
          operation: null,
          payment: booking.securityDeposit.payment,
        };

      const providerRequestReference = randomUUID();
      const payment = await transaction.payment.create({
        data: {
          amountMinor: BigInt(snapshot.securityDepositAmountMinor),
          bookingId: booking.id,
          currency: snapshot.securityDepositCurrency,
          provider: this.providerCode(),
          providerRequestReference,
          purpose: PaymentPurpose.SECURITY_DEPOSIT,
          status: PaymentStatus.AUTHORIZING,
        },
      });
      const operation = await transaction.paymentOperation.create({
        data: {
          amountMinor: payment.amountMinor,
          attemptCount: 1,
          currency: payment.currency,
          idempotencyKey: `booking:${booking.id}:security-deposit:authorize:${providerRequestReference}`,
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
          currency: payment.currency,
          paymentId: payment.id,
          requiredAmountMinor: payment.amountMinor,
          status: SecurityDepositStatus.AUTHORIZING,
        },
        update: { paymentId: payment.id, status: SecurityDepositStatus.AUTHORIZING },
        where: { bookingId: booking.id },
      });
      return {
        booking,
        existing: false,
        operation,
        payment: { ...payment, operations: [], refunds: [] },
      };
    });
    if (prepared.existing || !prepared.operation) return this.paymentProjection(prepared.payment);
    let result: ProviderOperationResult;
    try {
      result = await this.provider.authorize({
        amountMinor: prepared.payment.amountMinor,
        authorizationType: 'PREAUTHORIZATION',
        ...(prepared.booking.renter.email ? { customerEmail: prepared.booking.renter.email } : {}),
        currency: prepared.payment.currency,
        description: `Security deposit ${prepared.booking.publicReference}`,
        idempotencyKey: prepared.operation.idempotencyKey,
        requestReference: prepared.operation.providerRequestReference,
      });
    } catch (error) {
      await this.recordUnknown(prepared.payment.id, prepared.operation.id, error);
      return this.paymentProjection(
        await this.database.client.payment.findUniqueOrThrow({
          include: PAYMENT_INCLUDE,
          where: { id: prepared.payment.id },
        }),
      );
    }
    if (result.kind === 'SUCCEEDED')
      await this.finalizeAuthorization(prepared.payment.id, prepared.operation.id, result, request);
    else if (result.kind === 'ACTION_REQUIRED') {
      await this.database.client.$transaction([
        this.database.client.payment.update({
          data: {
            customerActionUrl: result.customerActionUrl ?? null,
            externalPaymentId: result.externalPaymentId ?? null,
            providerState: result.providerState ?? null,
            reconcileAfter: new Date(Date.now() + 15_000),
            reconciliationRequired: true,
          },
          where: { id: prepared.payment.id },
        }),
        this.database.client.paymentOperation.update({
          data: { completedAt: new Date(), status: PaymentOperationStatus.SUCCEEDED },
          where: { id: prepared.operation.id },
        }),
      ]);
    } else if (result.kind === 'DECLINED')
      await this.failAuthorization(prepared.payment.id, prepared.operation.id, result, request);
    else await this.recordUnknown(prepared.payment.id, prepared.operation.id, undefined, result);
    return this.paymentProjection(
      await this.database.client.payment.findUniqueOrThrow({
        include: PAYMENT_INCLUDE,
        where: { id: prepared.payment.id },
      }),
    );
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
    if (!payment) return;
    const authorizationReference = payment.operations.find(
      (candidate) => candidate.type === PaymentOperationType.AUTHORIZE,
    )?.providerRequestReference;
    if (!payment.externalPaymentId && !authorizationReference) return;
    let status: ProviderPaymentStatus;
    try {
      status = payment.externalPaymentId
        ? await this.provider.retrievePayment(payment.externalPaymentId)
        : await this.provider.retrievePaymentByRequestReference(authorizationReference!);
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
    // The provider abstraction currently exposes payment retrieval, not refund retrieval. A
    // captured payment therefore cannot prove that an indeterminate refund failed. Keep the refund
    // quarantined for reconciliation instead of misclassifying it as a successful capture or
    // issuing a duplicate refund.
    if (operation?.type === PaymentOperationType.REFUND) {
      await this.deferReconciliation(payment.id);
      return;
    }
    if (status.state === 'AUTHORIZED' && payment.status === PaymentStatus.AUTHORIZING) {
      if (
        payment.purpose === PaymentPurpose.SECURITY_DEPOSIT &&
        (status.authorizedAmountMinor !== payment.amountMinor ||
          status.currency !== payment.currency)
      ) {
        await this.deferReconciliation(payment.id);
        return;
      }
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
        ...(payment ? { mappedAt: new Date() } : { nextRemapAt: new Date() }),
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
      await this.database.client.$transaction(async (transaction) => {
        await transaction.paymentOperationEvidence.upsert({
          create: {
            attribution: PaymentEvidenceAttribution.AMBIGUOUS,
            evidenceKey: `webhook:${event.id}`,
            paymentId: payment.id,
            providerPaymentId: verified.providerPaymentId,
            providerStatus: verified.eventType,
            reason: 'Webhook proves aggregate payment evidence; operation identity is not assumed.',
            sanitizedMetadata: { eventType: verified.eventType },
            source: PaymentOperationEvidenceSource.WEBHOOK,
            webhookEventId: event.id,
          },
          update: {},
          where: {
            paymentId_evidenceKey: {
              evidenceKey: `webhook:${event.id}`,
              paymentId: payment.id,
            },
          },
        });
        await transaction.payment.update({
          data: { reconcileAfter: new Date(), reconciliationRequired: true },
          where: { id: payment.id },
        });
        await transaction.paymentWebhookEvent.update({
          data: {
            attemptCount: { increment: 1 },
            mappedAt: event.mappedAt ?? new Date(),
            processedAt: new Date(),
            status: PaymentWebhookStatus.PROCESSED,
          },
          where: { id: event.id },
        });
      });
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
        const amendmentSettlement = await transaction.bookingAmendmentSettlement.findUnique({
          where: { additionalPaymentId: payment.id },
        });
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
        if (amendmentSettlement) {
          if (
            amendmentSettlement.financialDeltaMinor !== payment.amountMinor ||
            amendmentSettlement.currency !== payment.currency
          )
            throw new Error('AMENDMENT_PAYMENT_CORRELATION_INVALID');
        } else if (payment.additionalChargeId) {
          await transaction.additionalCharge.update({
            data: { status: 'PROCESSING' },
            where: { id: payment.additionalChargeId },
          });
        }
        await this.ensureOperation(transaction, payment, PaymentOperationType.CAPTURE);
        return;
      }
      if (payment.purpose === PaymentPurpose.SECURITY_DEPOSIT) {
        const authorizedAt = new Date();
        await transaction.payment.update({
          data: {
            authorizedAmountMinor: payment.amountMinor,
            authorizedAt,
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
        await transaction.securityDepositAuthorization.update({
          data: {
            authorizedAmountMinor: payment.amountMinor,
            status: SecurityDepositStatus.AUTHORIZED,
          },
          where: { paymentId: payment.id },
        });
        await this.outbox(transaction, booking.id, 'SECURITY_DEPOSIT_HELD', {
          amountMinor: payment.amountMinor.toString(),
          bookingId: booking.id,
          currency: payment.currency,
        });
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
      const identity = await transaction.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (identity.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        const amendmentHandled = await finalizeBookingAmendmentPaymentCapture(transaction, {
          ...(request.correlationId ? { correlationId: request.correlationId } : {}),
          ...(externalOperationId ? { externalOperationId } : {}),
          ...(operationId ? { operationId } : {}),
          paymentId: identity.id,
          providerState,
        });
        if (amendmentHandled) return;
      }
      const payment = await this.lockPayment(transaction, paymentId);
      if (payment.status === PaymentStatus.CAPTURED) return;
      if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
        if (!payment.additionalChargeId) throw new Error('ADDITIONAL_CHARGE_CORRELATION_INVALID');
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
      if (payment.purpose === PaymentPurpose.SECURITY_DEPOSIT) {
        await transaction.securityDepositAuthorization.update({
          data: { status: SecurityDepositStatus.RELEASED },
          where: { paymentId: payment.id },
        });
      }
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
      if (payment.purpose === PaymentPurpose.SECURITY_DEPOSIT) {
        await transaction.securityDepositAuthorization.update({
          data: { status: SecurityDepositStatus.FAILED },
          where: { paymentId: payment.id },
        });
        return;
      }
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
    await this.database.client.$transaction(async (transaction) => {
      await transaction.paymentOperation.update({
        data: {
          failureCategory,
          failureCode: result?.failureCode ?? null,
          failureMessage:
            error instanceof Error ? error.message.slice(0, 500) : (result?.failureMessage ?? null),
          nextAttemptAt: new Date(Date.now() + 15_000),
          status: PaymentOperationStatus.UNKNOWN,
        },
        where: { id: operationId },
      });
      const payment = await transaction.payment.findUniqueOrThrow({
        select: { unknownExpiresAt: true },
        where: { id: paymentId },
      });
      await transaction.payment.update({
        data: {
          ...(result?.externalPaymentId ? { externalPaymentId: result.externalPaymentId } : {}),
          providerState: result?.providerState ?? null,
          reconcileAfter: new Date(Date.now() + 15_000),
          reconciliationRequired: true,
          ...(payment.unknownExpiresAt
            ? {}
            : { unknownExpiresAt: new Date(Date.now() + grace * 60_000) }),
        },
        where: { id: paymentId },
      });
    });
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
    let prefix = `booking:${payment.bookingId}`;
    if (payment.purpose === PaymentPurpose.ADDITIONAL_CHARGE) {
      const settlement = await transaction.bookingAmendmentSettlement.findUnique({
        select: { amendmentId: true },
        where: { additionalPaymentId: payment.id },
      });
      if (settlement) prefix = `booking-amendment:${settlement.amendmentId}`;
      else if (payment.additionalChargeId)
        prefix = `additional-charge:${payment.additionalChargeId}`;
      else throw new Error('ADDITIONAL_CHARGE_CORRELATION_INVALID');
    }
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

  private assertPreCustodyCancellation(booking: {
    actualPickupAt: Date | null;
    commissionSnapshot: {
      calculatedCommissionMinor: bigint;
      commissionableBaseMinor: bigint;
    } | null;
    fulfillmentSnapshot: object | null;
    inspections: Array<{
      confirmations: Array<{
        decision: string;
        discrepancyResponses: Array<{ resolutionReview: { decision: string } | null }>;
      }>;
    }>;
    payments: Array<{ capturedAmountMinor: bigint; status: PaymentStatus }>;
    pickupChallenges: Array<{ consumedAt: Date | null }>;
    pricingSnapshot: object | null;
    status: BookingStatus;
  }) {
    if (booking.status !== BookingStatus.READY_FOR_PICKUP || booking.actualPickupAt)
      this.invalidState(
        'Only a pickup-ready booking before custody transfer may use this cancellation.',
      );
    if (booking.pickupChallenges.some(({ consumedAt }) => consumedAt))
      this.invalidState(
        'A successfully consumed pickup challenge prevents pre-custody cancellation.',
      );
    const renterConfirmation = booking.inspections[0]?.confirmations.find(
      ({ decision }) => decision === 'DISAGREED',
    );
    const latest = renterConfirmation?.discrepancyResponses.at(-1);
    if (!renterConfirmation || latest?.resolutionReview?.decision === 'ACCEPTED')
      this.invalidState('An unresolved pickup discrepancy is required.');
    if (!booking.pricingSnapshot || !booking.fulfillmentSnapshot || !booking.commissionSnapshot)
      this.invalidState('Accepted booking financial snapshots are required.');
    if (!booking.payments[0] || booking.payments[0].status !== PaymentStatus.CAPTURED)
      this.invalidState('A reconciled captured rental payment is required.');
  }

  private toSerializable<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
    ) as T;
  }

  private async markHandoverRefundUnknown(
    paymentId: string,
    refundId: string,
    operationId: string,
  ) {
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

  private async finalizeHandoverRefund(
    settlementId: string,
    paymentId: string,
    refundId: string,
    operationId: string,
    result: ProviderOperationResult,
    request: RequestMetadata,
  ) {
    await this.database.client.$transaction(async (transaction) => {
      await this.lockPayment(transaction, paymentId);
      const settlement = await transaction.bookingCancellationSettlement.findUniqueOrThrow({
        where: { id: settlementId },
      });
      const refund = await transaction.refund.findUniqueOrThrow({ where: { id: refundId } });
      if (refund.status === RefundStatus.COMPLETED) return;
      const accounts = await transaction.financialAccount.findMany({
        where: { active: true, currency: settlement.currency },
      });
      const account = (type: FinancialAccountType) => {
        const found = accounts.find((item) => item.type === type);
        if (!found) throw new Error(`Financial account ${type} is missing.`);
        return found.id;
      };
      const ownerReversal = settlement.refundAmountMinor;
      await transaction.ledgerTransaction.create({
        data: {
          correlationId: request.correlationId ?? null,
          currency: settlement.currency,
          description: 'Pre-custody handover cancellation refund',
          entries: {
            create: [
              {
                accountId: account(FinancialAccountType.OWNER_PAYABLE),
                amountMinor: ownerReversal,
                currency: settlement.currency,
                memo: 'Reverse unvested owner rental and fulfillment',
              },
              {
                accountId: account(FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE),
                amountMinor: -settlement.refundAmountMinor,
                currency: settlement.currency,
                memo: 'Renter refund',
              },
            ],
          },
          sourceId: settlement.id,
          sourceType: 'BOOKING_CANCELLATION_SETTLEMENT',
          type: LedgerTransactionType.REFUND,
        },
      });
      const earning = await transaction.ownerEarning.findUniqueOrThrow({
        where: { bookingId: settlement.bookingId },
      });
      await transaction.ownerEarning.update({
        data: {
          adjustmentAmountMinor: calculatePreCustodyOwnerAdjustment({
            currentAdjustmentMinor: earning.adjustmentAmountMinor,
            originalNetEarningMinor: earning.netEarningAmountMinor,
            retainedDeliveryMinor: settlement.deliveryRetainedMinor,
          }),
          lastFinancialResolutionAt: new Date(),
        },
        where: { id: earning.id },
      });
      await transaction.paymentOperation.update({
        data: {
          completedAt: new Date(),
          externalOperationId: result.externalOperationId ?? null,
          failureCategory: null,
          status: PaymentOperationStatus.SUCCEEDED,
        },
        where: { id: operationId },
      });
      await transaction.refund.update({
        data: {
          completedAt: new Date(),
          externalRefundId: result.externalOperationId ?? null,
          status: RefundStatus.COMPLETED,
        },
        where: { id: refundId },
      });
      const payment = await transaction.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const refunded = payment.refundedAmountMinor + settlement.refundAmountMinor;
      await transaction.payment.update({
        data: {
          refundedAmountMinor: refunded,
          reconciliationRequired: false,
          status:
            refunded === payment.capturedAmountMinor
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
        where: { id: paymentId },
      });
    });
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

  private async amendmentPaymentProjection(amendmentId: string, payment: PaymentRecord) {
    const eligibleForApplication = await this.database.client.$transaction((transaction) =>
      isBookingAmendmentReadyForPaidApplication(transaction, amendmentId),
    );
    return {
      ...this.paymentProjection(payment),
      amendmentId,
      amendmentState: eligibleForApplication
        ? 'PAYMENT_RECEIVED_AWAITING_APPLICATION'
        : payment.reconciliationRequired
          ? 'PAYMENT_VERIFYING'
          : 'WAITING_FOR_PAYMENT',
      eligibleForApplication,
    };
  }

  private assertAmendmentPaymentCorrelation(
    amendment: {
      bookingId: string;
      settlement: {
        additionalPaymentId: string | null;
        currency: string;
        direction: BookingAmendmentFinancialDirection;
        financialDeltaMinor: bigint;
      } | null;
    },
    payment: PaymentRecord,
  ) {
    if (
      !amendment.settlement ||
      amendment.settlement.additionalPaymentId !== payment.id ||
      amendment.settlement.direction !== BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT ||
      amendment.bookingId !== payment.bookingId ||
      payment.purpose !== PaymentPurpose.ADDITIONAL_CHARGE ||
      amendment.settlement.financialDeltaMinor !== payment.amountMinor ||
      amendment.settlement.currency !== payment.currency
    )
      throw new ApplicationException(
        PaymentErrorCode.PAYMENT_INVALID_STATE,
        'The amendment payment correlation is invalid.',
        HttpStatus.CONFLICT,
      );
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
