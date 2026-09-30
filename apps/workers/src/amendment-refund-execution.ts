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
            },
          },
        },
        where: { id: amendmentId },
      });
      const refund = amendment.settlement?.refund;
      const payment = refund?.payment;
      const exactReplayExpired =
        refund?.operation &&
        refund.operation.createdAt.getTime() + environment.PAYMENT_UNKNOWN_GRACE_MINUTES * 60_000 <=
          Date.now();
      if (
        refund?.operation &&
        ['PROCESSING', 'UNKNOWN'].includes(refund.operation.status) &&
        exactReplayExpired &&
        payment?.externalPaymentId &&
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
          observedRefundedMinor: providerPayment.refundedAmountMinor ?? payment.refundedAmountMinor,
          paymentMatches: !competing,
        });
        if (attribution === 'CORROBORATED_UNKNOWN') {
          await finalizeBookingAmendmentRefundFromProviderEvidence(
            database,
            amendmentId,
            `provider-payment:${providerPayment.externalPaymentId}`,
          );
          processed += 1;
        }
        // Ambiguous cumulative movement remains in manual reconciliation.
        continue;
      }
      await executeBookingAmendmentRefund(database, provider, amendmentId, {
        allowReplay: true,
        unknownGraceMinutes: environment.PAYMENT_UNKNOWN_GRACE_MINUTES,
      });
      processed += 1;
    } catch {
      // A corrupt or concurrently resolved row must not block unrelated refunds.
    }
  }
  return processed;
}
