import {
  reconcilePaidBookingAmendments,
  reconcileOperationallyExpiredRefundAmendments,
  reconcileRefundBookingAmendments,
  reconcileZeroDeltaBookingAmendments,
  type PrismaClient,
} from '@carrental/database';

export async function reconcileBookingAmendmentApplications(database: PrismaClient) {
  const expiry = await reconcileOperationallyExpiredRefundAmendments(database);
  const [zeroDelta, paid, refund] = await Promise.all([
    reconcileZeroDeltaBookingAmendments(database),
    reconcilePaidBookingAmendments(database),
    reconcileRefundBookingAmendments(database),
  ]);
  return {
    applied: zeroDelta.applied + paid.applied + refund.applied,
    failed: zeroDelta.failed + paid.failed + refund.failed,
    operationallyExpired: expiry.transitioned,
    operationalExpiryFailures: expiry.failed,
    skipped: zeroDelta.skipped + paid.skipped + refund.skipped,
  };
}
