import type { WorkerEnvironment } from '@carrental/config';
import {
  attributeAmendmentRefund,
  executeBookingAmendmentRefund,
  finalizeBookingAmendmentRefundFromProviderEvidence,
  findRecoverableBookingAmendmentRefunds,
  RefundStatus,
  type PrismaClient,
} from '@carrental/database';
import type { PaymentProvider } from '@carrental/payments';

export async function reconcileBookingAmendmentRefunds(
  database: PrismaClient,
  provider: PaymentProvider,
  environment: WorkerEnvironment,
) {
  const amendmentIds = await findRecoverableBookingAmendmentRefunds(database);
  let processed = 0;
  for (const amendmentId of amendmentIds) {
    try {
      const amendment = await database.bookingAmendment.findUniqueOrThrow({
        include: {
          settlement: {
            include: {
              refund: { include: { operation: true, payment: { include: { refunds: true } } } },
              refunds: {
                include: { operation: true, payment: { include: { refunds: true } } },
                orderBy: { amendmentAllocationIndex: 'asc' },
              },
            },
          },
        },
        where: { id: amendmentId },
      });
      const refunds = amendment.settlement?.refunds.length
        ? amendment.settlement.refunds
        : amendment.settlement?.refund
          ? [amendment.settlement.refund]
          : [];
      let reconciledFromEvidence = false;
      for (const refund of refunds) {
        const payment = refund.payment;
        const exactReplayExpired =
          refund.operation &&
          refund.operation.createdAt.getTime() +
            environment.PAYMENT_UNKNOWN_GRACE_MINUTES * 60_000 <=
            Date.now();
        if (
          refund.operation &&
          ['PROCESSING', 'UNKNOWN'].includes(refund.operation.status) &&
          exactReplayExpired &&
          payment.externalPaymentId &&
          (!payment.unknownExpiresAt || payment.unknownExpiresAt <= new Date())
        ) {
          const providerPayment = await provider.retrievePayment(payment.externalPaymentId);
          const competing = payment.refunds.some(
            (item) =>
              item.id !== refund.id &&
              item.status !== RefundStatus.FAILED &&
              item.createdAt >= refund.createdAt,
          );
          const attribution = attributeAmendmentRefund({
            baselineRefundedMinor: payment.refundedAmountMinor,
            currencyMatches: providerPayment.externalPaymentId === payment.externalPaymentId,
            expectedRefundMinor: refund.amountMinor,
            observedRefundedMinor:
              providerPayment.refundedAmountMinor ?? payment.refundedAmountMinor,
            paymentMatches: !competing,
          });
          if (attribution === 'CORROBORATED_UNKNOWN') {
            await finalizeBookingAmendmentRefundFromProviderEvidence(
              database,
              amendmentId,
              `provider-payment:${providerPayment.externalPaymentId}`,
              new Date(),
              refund.id,
            );
            processed += 1;
            reconciledFromEvidence = true;
          }
          // Ambiguous cumulative movement remains in manual reconciliation.
          break;
        }
      }
      if (reconciledFromEvidence) continue;
      await executeBookingAmendmentRefund(database, provider, amendmentId, {
        allowReplay: true,
        unknownGraceMinutes: environment.PAYMENT_UNKNOWN_GRACE_MINUTES,
      });
      processed += 1;
    } catch (error) {
      // A corrupt or concurrently resolved row must not block unrelated refunds.
      process.stderr.write(
        `${JSON.stringify({
          amendmentId,
          errorCode: error instanceof Error ? error.message : 'UNKNOWN_REFUND_ERROR',
          ...(error && typeof error === 'object' ? error : {}),
        })}\n`,
      );
    }
  }
  return processed;
}
