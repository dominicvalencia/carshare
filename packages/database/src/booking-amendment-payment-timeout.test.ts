import { describe, expect, it } from 'vitest';
import { PaymentOperationStatus, PaymentStatus } from './generated/prisma/enums';
import { isAmendmentPaymentTimeoutEligible } from './booking-amendment-payment-timeout';

describe('booking amendment payment timeout authority', () => {
  it('allows timeout when no payment was initiated', () => {
    expect(isAmendmentPaymentTimeoutEligible({ payment: null, paymentInitiatedAt: null })).toBe(
      true,
    );
  });

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.AUTHORIZING,
    PaymentStatus.CAPTURING,
    PaymentStatus.VOID_PENDING,
    PaymentStatus.CAPTURED,
  ])('protects unresolved or captured payment status %s', (status) => {
    expect(
      isAmendmentPaymentTimeoutEligible({
        payment: { operations: [], reconciliationRequired: false, status },
        paymentInitiatedAt: new Date(),
      }),
    ).toBe(false);
  });

  it.each([
    PaymentOperationStatus.PENDING,
    PaymentOperationStatus.PROCESSING,
    PaymentOperationStatus.UNKNOWN,
  ])('protects unresolved operation status %s', (status) => {
    expect(
      isAmendmentPaymentTimeoutEligible({
        payment: {
          operations: [{ status }],
          reconciliationRequired: false,
          status: PaymentStatus.FAILED,
        },
        paymentInitiatedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('protects reconciliation-required authority beyond the renter deadline', () => {
    expect(
      isAmendmentPaymentTimeoutEligible({
        payment: {
          operations: [{ status: PaymentOperationStatus.FAILED }],
          reconciliationRequired: true,
          status: PaymentStatus.FAILED,
        },
        paymentInitiatedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('allows terminal timeout after authoritative failure', () => {
    expect(
      isAmendmentPaymentTimeoutEligible({
        payment: {
          operations: [{ status: PaymentOperationStatus.FAILED }],
          reconciliationRequired: false,
          status: PaymentStatus.FAILED,
        },
        paymentInitiatedAt: new Date(),
      }),
    ).toBe(true);
  });

  it('fails closed for malformed initiated-without-payment authority', () => {
    expect(
      isAmendmentPaymentTimeoutEligible({ payment: null, paymentInitiatedAt: new Date() }),
    ).toBe(false);
  });
});
