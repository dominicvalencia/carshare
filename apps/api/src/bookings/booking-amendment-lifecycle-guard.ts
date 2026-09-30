import {
  BookingAmendmentFinancialDirection,
  BookingAmendmentStatus,
  expireBookingRefundAmendmentForBooking,
  Prisma,
} from '@carrental/database';

type AcceptedAmendmentAuthority = {
  status: BookingAmendmentStatus;
  settlement: {
    direction: BookingAmendmentFinancialDirection;
    financialDeltaMinor: bigint;
  } | null;
};

export function blocksIncompatibleBookingLifecycle(amendment: AcceptedAmendmentAuthority): boolean {
  if (amendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING) return true;

  return (
    amendment.status === BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING &&
    amendment.settlement?.direction === BookingAmendmentFinancialDirection.REFUND &&
    amendment.settlement.financialDeltaMinor < 0n
  );
}

export async function hasBlockingAcceptedBookingAmendment(
  transaction: Prisma.TransactionClient,
  bookingId: string,
  evaluatedAt = new Date(),
): Promise<boolean> {
  await expireBookingRefundAmendmentForBooking(transaction, bookingId, evaluatedAt);
  const amendment = await transaction.bookingAmendment.findFirst({
    orderBy: { createdAt: 'desc' },
    select: {
      settlement: { select: { direction: true, financialDeltaMinor: true } },
      status: true,
    },
    where: {
      bookingId,
      OR: [
        { status: BookingAmendmentStatus.OWNER_ACCEPTED_PAYMENT_PENDING },
        {
          settlement: {
            is: {
              direction: BookingAmendmentFinancialDirection.REFUND,
              financialDeltaMinor: { lt: 0n },
            },
          },
          status: BookingAmendmentStatus.OWNER_ACCEPTED_PROCESSING,
        },
      ],
    },
  });

  return amendment !== null && blocksIncompatibleBookingLifecycle(amendment);
}
