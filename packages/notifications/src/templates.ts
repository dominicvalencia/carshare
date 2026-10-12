export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export function renderNotification(
  templateKey: string,
  variables: Readonly<Record<string, unknown>>,
): NotificationContent {
  const reference = text(variables.reference, 'your booking');
  const scope = text(variables.scope, 'BOTH');
  const managerDisplayName = text(variables.managerDisplayName, 'A Manager');
  const vehicleDisplayName = text(variables.vehicleDisplayName, 'a vehicle');
  const templates: Readonly<Record<string, NotificationContent>> = {
    'vehicle-owner-approval.submitted': {
      title: 'Vehicle needs your approval',
      body: `${managerDisplayName} submitted ${vehicleDisplayName} for your approval.`,
    },
    'vehicle-owner-approval.approved': {
      title: 'Vehicle approved by Owner',
      body: `${vehicleDisplayName} was approved and submitted to CarShare for review.`,
    },
    'vehicle-owner-approval.changes-required': {
      title: 'Changes requested',
      body: `The Owner requested changes to ${vehicleDisplayName}.`,
    },
    'vehicle.operational-fields-updated': {
      title: 'Vehicle updated',
      body: `${managerDisplayName} updated ${vehicleDisplayName}.`,
    },
    'security-deposit.required': {
      title: 'Security deposit required',
      body: `Complete the security deposit for ${reference} before pickup.`,
    },
    'security-deposit.24-hour-reminder': {
      title: 'Your trip starts tomorrow',
      body: `Complete the security deposit for ${reference} to avoid pickup issues.`,
    },
    'security-deposit.final-reminder': {
      title: 'Security deposit still required',
      body: `Your trip starts soon. Complete the security deposit for ${reference} before pickup.`,
    },
    'security-deposit.completed': {
      title: 'Security deposit completed',
      body: `No further deposit action is needed for ${reference}. You're ready for pickup.`,
    },
    'rental.overdue-recovery-reported': {
      title:
        scope === 'START'
          ? 'Action required: Confirm Pickup handover'
          : scope === 'RETURN'
            ? 'Action required: Confirm Return handover'
            : 'Action required: Confirm Pickup and Return',
      body:
        scope === 'START'
          ? "Review the Owner's overdue Pickup report before the response deadline."
          : scope === 'RETURN'
            ? "Review the Owner's overdue Return report before the response deadline."
            : "Review the Owner's overdue Pickup and Return report before the response deadline.",
    },
    'rental.overdue-recovery-accepted': {
      title: 'Overdue handover report accepted',
      body: 'The owner-reported handover was accepted after confirmation or the 24-hour response window. Reduced-evidence warnings still apply.',
    },
    'rental.overdue-recovery-midpoint': {
      title: 'Action required: Confirm your handover',
      body:
        scope === 'START'
          ? "Review the Owner's Pickup/Delivery report before the response deadline."
          : scope === 'RETURN'
            ? "Review the Owner's Return/Collection report before the response deadline."
            : "Review the Owner's Pickup and Return report before the response deadline.",
    },
    'rental.overdue-recovery-final': {
      title: 'Final reminder: Handover confirmation',
      body: "Review the Owner's handover report before the response deadline.",
    },
    'rental.start-evidence-waived': {
      title: 'Handover inspection skipped',
      body: 'The owner chose to continue without a full CarShare inspection record. Pickup verification is still required.',
    },
    'rental.return-evidence-waived': {
      title: 'Return inspection skipped',
      body: 'The renter chose to continue without a full CarShare return inspection record. Confirm vehicle receipt to complete the return.',
    },
    'rental.owner-return-evidence-waived': {
      title: 'Owner completed Return without inspection',
      body: 'The owner reported receiving the vehicle without the normal CarShare Return inspection. Open the booking to report a disagreement or issue.',
    },
    'rental.handover-overdue.owner': {
      title: 'Handover overdue',
      body: 'Complete the CarShare handover process to keep your booking and payout workflow up to date.',
    },
    'rental.handover-overdue.renter': {
      title: 'Handover overdue',
      body: 'Complete the vehicle handover in CarShare to preserve your inspection and condition record.',
    },
    'rental.return-overdue.owner': {
      title: 'Return process overdue',
      body: 'Complete the required return process so CarShare can verify the end of the rental and continue payout processing.',
    },
    'rental.return-overdue.renter': {
      title: 'Return process overdue',
      body: 'Complete the return inspection to preserve your vehicle condition evidence.',
    },
    'booking.requested': {
      title: 'New booking request',
      body: `Please review booking ${reference}.`,
    },
    'booking.accepted': { title: 'Booking accepted', body: `Booking ${reference} was accepted.` },
    'booking.rejected': {
      title: 'Booking not accepted',
      body: `Booking ${reference} was declined.`,
    },
    'booking-amendment.accepted-processing': {
      title: 'Change request accepted',
      body: `The owner accepted your change request for ${reference}. We're processing the change.`,
    },
    'booking-amendment.accepted-payment-required': {
      title: 'Payment required for your change',
      body: `The owner accepted your change request for ${reference}. Complete the additional payment before the deadline.`,
    },
    'booking-amendment.declined': {
      title: 'Change request declined',
      body: `Your change request for ${reference} was declined. Your original booking is unchanged.`,
    },
    'booking-amendment.applied': {
      title: 'Booking change applied',
      body: `Your booking change for ${reference} has been applied.`,
    },
    'booking-amendment.refund-completed-awaiting-application': {
      title: 'Refund completed',
      body: `Your refund for ${reference} is complete. We're finishing your booking change.`,
    },
    'booking-amendment.financial-recovery-refund-completed': {
      title: 'Refund completed',
      body: `Your refund for ${reference} is complete. Your original booking details remain unchanged.`,
    },
    'booking-amendment.active-extension-recovery-pending': {
      title: 'Extension could not be applied',
      body: `Your extension for ${reference} could not be applied. A refund is being processed.`,
    },
    'booking-amendment.active-extension-operationally-expired': {
      title: 'Extension could not be applied',
      body: `Your extension for ${reference} could not be applied. We are resolving its payment status.`,
    },
    'booking-amendment.active-extension-recovery-completed': {
      title: 'Extension refund completed',
      body: `Your extension for ${reference} was not applied, and its payment has been refunded.`,
    },
    'booking-amendment.payment-window-expired': {
      title: 'Booking change not applied',
      body: `The additional-payment window for ${reference} expired. Your original booking is unchanged.`,
    },
    'booking.cancelled': {
      title: 'Booking cancelled',
      body: `Booking ${reference} was cancelled.`,
    },
    'booking.pre-custody-cancelled': {
      title: 'Booking cancelled before handover',
      body: 'The renter cancelled before handover. Open Booking Detail for the reason and settlement status.',
    },
    'booking.expired': { title: 'Booking expired', body: `Booking ${reference} expired.` },
    'payment.updated': {
      title: 'Payment update',
      body: `Payment status changed for ${reference}.`,
    },
    'rental.updated': { title: 'Rental update', body: `There is an update for ${reference}.` },
    'rental.inspection-ready': {
      title: 'Vehicle inspection ready for review',
      body: 'Review the owner’s vehicle inspection before handover can continue.',
    },
    'rental.discrepancy-reported': {
      title: 'Renter reported a vehicle-condition issue',
      body: 'Review the reported discrepancy before handover can continue.',
    },
    'rental.discrepancy-response': {
      title: 'Owner responded to your handover discrepancy',
      body: 'Review the response before handover can continue.',
    },
    'rental.discrepancy-support': {
      title: 'CarShare support requested',
      body: 'Support was requested for the handover disagreement. Open the rental for updates.',
    },
    'rental.discrepancy-resolution': {
      title: 'Handover discrepancy updated',
      body: 'The renter reviewed the discrepancy resolution.',
    },
    'rental.operations-resolution': {
      title: 'CarShare reviewed the handover',
      body: 'Open the rental to view the Operations decision and your next step.',
    },
    'inspection-correction.requested': {
      title: 'Correction submitted',
      body: `Your inspection correction for ${reference} is pending administrator review.`,
    },
    'inspection-correction.approved': {
      title: 'Inspection correction approved',
      body: `An inspection measurement for ${reference} was corrected after administrative review.`,
    },
    'inspection-correction.rejected': {
      title: 'Inspection correction not approved',
      body: `Your inspection correction for ${reference} was rejected.`,
    },
    'claim.updated': { title: 'Claim update', body: `There is a claim update for ${reference}.` },
    'earning.updated': { title: 'Earnings update', body: 'Your owner earnings have been updated.' },
    'payout.updated': { title: 'Payout update', body: 'Your payout status has been updated.' },
    'message.new': { title: 'New message', body: 'You received a message about a booking.' },
    'review.available': {
      title: 'Share your experience',
      body: `Reviews are available for ${reference}.`,
    },
    'review.counterpart-submitted': {
      title: 'A review is waiting',
      body: `The other party reviewed ${reference}. Their review remains private until you submit or the review window closes.`,
    },
    'review.published': {
      title: 'Reviews published',
      body: `Reviews for ${reference} are now available.`,
    },
    'support.updated': { title: 'Support update', body: 'Your support ticket has a new update.' },
  };
  return (
    templates[templateKey] ?? {
      title: 'Car Rental update',
      body: 'There is a new update in your account.',
    }
  );
}
