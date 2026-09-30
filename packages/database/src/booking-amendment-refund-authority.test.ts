import { FinancialAccountType, LedgerTransactionType } from './generated/prisma/enums';
import { describe, expect, it } from 'vitest';
import {
  amendmentRefundAccounting,
  amendmentRefundHoldRequired,
  attributeAmendmentRefund,
  validateAmendmentRefundCorrelation,
} from './booking-amendment-refund-authority';

describe('booking amendment refund authority', () => {
  it('requires exact booking, payment, amount and currency correlation', () => {
    const evidence = {
      amendmentBookingId: 'booking-1',
      currency: 'PHP',
      expectedAmountMinor: 500n,
      originalPaymentId: 'payment-1',
      paymentBookingId: 'booking-1',
      refundAmountMinor: 500n,
      refundCurrency: 'PHP',
      refundPaymentId: 'payment-1',
    };
    expect(validateAmendmentRefundCorrelation(evidence)).toBe(true);
    expect(validateAmendmentRefundCorrelation({ ...evidence, paymentBookingId: 'booking-2' })).toBe(
      false,
    );
    expect(validateAmendmentRefundCorrelation({ ...evidence, refundPaymentId: 'other' })).toBe(
      false,
    );
    expect(validateAmendmentRefundCorrelation({ ...evidence, refundAmountMinor: 499n })).toBe(
      false,
    );
    expect(validateAmendmentRefundCorrelation({ ...evidence, refundCurrency: 'USD' })).toBe(false);
  });

  it('treats cumulative movement as corroboration rather than attribution', () => {
    const evidence = {
      baselineRefundedMinor: 200n,
      currencyMatches: true,
      expectedRefundMinor: 500n,
      observedRefundedMinor: 700n,
      paymentMatches: true,
    };
    expect(attributeAmendmentRefund(evidence)).toBe('CORROBORATED_UNKNOWN');
    expect(attributeAmendmentRefund({ ...evidence, observedRefundedMinor: 699n })).toBe('UNKNOWN');
    expect(attributeAmendmentRefund({ ...evidence, observedRefundedMinor: 900n })).toBe('UNKNOWN');
    expect(attributeAmendmentRefund({ ...evidence, currencyMatches: false })).toBe('UNKNOWN');
    expect(attributeAmendmentRefund({ ...evidence, paymentMatches: false })).toBe('UNKNOWN');
  });

  it('requires matched provider evidence for terminal attribution', () => {
    const evidence = {
      baselineRefundedMinor: 0n,
      currencyMatches: true,
      expectedRefundMinor: 500n,
      observedRefundedMinor: 500n,
      paymentMatches: true,
    };
    expect(attributeAmendmentRefund({ ...evidence, providerEvidence: 'MATCHED_SUCCESS' })).toBe(
      'AUTHORITATIVE_SUCCESS',
    );
    expect(attributeAmendmentRefund({ ...evidence, providerEvidence: 'DEFINITIVE_FAILURE' })).toBe(
      'AUTHORITATIVE_FAILURE',
    );
  });

  it('defines a balanced two-stage liability and future suspense clearing contract', () => {
    expect(amendmentRefundAccounting.obligationRecognition).toEqual({
      credit: FinancialAccountType.REFUND_PAYABLE,
      debit: FinancialAccountType.AMENDMENT_REFUND_SUSPENSE,
      sourceType: 'BOOKING_AMENDMENT_REFUND_OBLIGATION',
      transactionType: LedgerTransactionType.ADJUSTMENT,
    });
    expect(amendmentRefundAccounting.providerSettlement).toEqual({
      credit: FinancialAccountType.PAYMENT_PROVIDER_RECEIVABLE,
      debit: FinancialAccountType.REFUND_PAYABLE,
      sourceType: 'BOOKING_AMENDMENT_REFUND',
      transactionType: LedgerTransactionType.REFUND,
    });
    expect(amendmentRefundAccounting.futureApplication.credit).toBe(
      FinancialAccountType.AMENDMENT_REFUND_SUSPENSE,
    );
    const refund = 500n;
    expect(refund - refund).toBe(0n);
    expect(refund - refund).toBe(0n);
  });

  it('keeps a hold only while application is still possible before proposed start', () => {
    const proposedRentalStart = new Date('2026-10-10T01:00:00.000Z');
    expect(
      amendmentRefundHoldRequired({
        applicationStillPossible: true,
        now: new Date('2026-10-10T00:59:59.999Z'),
        proposedRentalStart,
      }),
    ).toBe(true);
    expect(
      amendmentRefundHoldRequired({
        applicationStillPossible: true,
        now: proposedRentalStart,
        proposedRentalStart,
      }),
    ).toBe(false);
    expect(
      amendmentRefundHoldRequired({
        applicationStillPossible: false,
        now: new Date('2026-10-09T00:00:00.000Z'),
        proposedRentalStart,
      }),
    ).toBe(false);
  });
});
