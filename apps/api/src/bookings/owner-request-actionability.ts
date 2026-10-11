import { BookingAmendmentStatus, BookingStatus, type Prisma } from '@carrental/database';

export function ownerActionableBookingWhere(ownerUserId: string): Prisma.BookingWhereInput {
  return { ownerUserId, ...ownerActionableBookingWhereFromBooking() };
}

export function ownerActionableBookingWhereFromBooking(): Prisma.BookingWhereInput {
  return { status: BookingStatus.AWAITING_OWNER };
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

export function ownerActionableAmendmentWhereFromBooking(
  booking: Prisma.BookingWhereInput,
): Prisma.BookingAmendmentWhereInput {
  return {
    booking,
    fulfillmentSnapshot: { isNot: null },
    pricingSnapshot: { isNot: null },
    settlement: { isNot: null },
    status: BookingAmendmentStatus.PENDING_OWNER,
  };
}
