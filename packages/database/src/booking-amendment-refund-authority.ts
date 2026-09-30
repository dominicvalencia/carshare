import { FinancialAccountType, LedgerTransactionType } from './generated/prisma/enums';

export type RefundAttributionResult =
  'AUTHORITATIVE_FAILURE' | 'AUTHORITATIVE_SUCCESS' | 'CORROBORATED_UNKNOWN' | 'UNKNOWN';

export interface RefundCorrelationEvidence {
  amendmentBookingId: string;
  currency: string;
  expectedAmountMinor: bigint;
  originalPaymentId: string;
  paymentBookingId: string;
  refundAmountMinor: bigint;
  refundCurrency: string;
  refundPaymentId: string;
}

export interface RefundAttributionEvidence {
  baselineRefundedMinor: bigint;
  currencyMatches: boolean;
  expectedRefundMinor: bigint;
  observedRefundedMinor: bigint;
  paymentMatches: boolean;
  providerEvidence?: 'DEFINITIVE_FAILURE' | 'MATCHED_SUCCESS';
}

export function validateAmendmentRefundCorrelation(evidence: RefundCorrelationEvidence): boolean {
  return (
    evidence.amendmentBookingId === evidence.paymentBookingId &&
    evidence.originalPaymentId === evidence.refundPaymentId &&
    evidence.expectedAmountMinor === evidence.refundAmountMinor &&
    evidence.currency === evidence.refundCurrency
  );
}

export function attributeAmendmentRefund(
  evidence: RefundAttributionEvidence,
): RefundAttributionResult {
  if (!evidence.paymentMatches || !evidence.currencyMatches) return 'UNKNOWN';
  if (evidence.providerEvidence === 'MATCHED_SUCCESS') return 'AUTHORITATIVE_SUCCESS';
  if (evidence.providerEvidence === 'DEFINITIVE_FAILURE') return 'AUTHORITATIVE_FAILURE';
  const expected = evidence.baselineRefundedMinor + evidence.expectedRefundMinor;
  return evidence.observedRefundedMinor === expected ? 'CORROBORATED_UNKNOWN' : 'UNKNOWN';
}

export const amendmentRefundAccounting = Object.freeze({
  obligationRecognition: {
    credit: FinancialAccountType.REFUND_PAYABLE,
    debit: FinancialAccountType.AMENDMENT_REFUND_SUSPENSE,
    sourceType: 'BOOKING_AMENDMENT_REFUND_OBLIGATION',
    transactionType: LedgerTransactionType.ADJUSTMENT,
  },
  providerSettlement: {
    credit: FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
    debit: FinancialAccountType.REFUND_PAYABLE,
    sourceType: 'BOOKING_AMENDMENT_REFUND',
    transactionType: LedgerTransactionType.REFUND,
  },
  futureApplication: {
    credit: FinancialAccountType.AMENDMENT_REFUND_SUSPENSE,
    sourceType: 'BOOKING_AMENDMENT',
    transactionType: LedgerTransactionType.ADJUSTMENT,
  },
});

export function amendmentRefundHoldRequired(input: {
  applicationStillPossible: boolean;
  now: Date;
  proposedRentalStart: Date;
}): boolean {
  return input.applicationStillPossible && input.now < input.proposedRentalStart;
}
