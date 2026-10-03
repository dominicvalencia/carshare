import { BookingAmendmentStatus, BookingStatus, type Prisma } from '@carrental/database';

export function ownerActionableBookingWhere(ownerUserId: string): Prisma.BookingWhereInput {
  return { ownerUserId, status: BookingStatus.AWAITING_OWNER };
}

export function ownerActionableAmendmentWhere(
  ownerUserId: string,
): Prisma.BookingAmendmentWhereInput {
  return {
    booking: { ownerUserId },
    fulfillmentSnapshot: { isNot: null },
    pricingSnapshot: { isNot: null },
    settlement: { isNot: null },
    status: BookingAmendmentStatus.PENDING_OWNER,
  };
}
