import { BookingAmendmentFinancialDirection, BookingAmendmentStatus } from '@carrental/database';

export interface AmendmentPaymentActionabilityInput {
  readonly additionalPaymentId: string | null;
  readonly direction: BookingAmendmentFinancialDirection | null;
  readonly financialDeltaMinor: bigint | null;
  readonly paymentDeadlineAt: Date | null;
  readonly pricingCurrency: string | null;
  readonly renterFinancialDeltaMinor: bigint | null;
  readonly settlementCurrency: string | null;
  readonly status: BookingAmendmentStatus;
}

export function canInitiateBookingAmendmentPayment(
  input: AmendmentPaymentActionabilityInput,
  evaluatedAt = new Date(),
) {
  return (
    input.status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING &&
    input.direction === BookingAmendmentFinancialDirection.ADDITIONAL_PAYMENT &&
    input.financialDeltaMinor !== null &&
    input.financialDeltaMinor > 0n &&
    input.renterFinancialDeltaMinor === input.financialDeltaMinor &&
    input.pricingCurrency !== null &&
    input.pricingCurrency === input.settlementCurrency &&
    input.additionalPaymentId === null &&
    input.paymentDeadlineAt !== null &&
    evaluatedAt < input.paymentDeadlineAt
  );
}
