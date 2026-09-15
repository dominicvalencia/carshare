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
  const templates: Readonly<Record<string, NotificationContent>> = {
    'booking.requested': {
      title: 'New booking request',
      body: `Please review booking ${reference}.`,
    },
    'booking.accepted': { title: 'Booking accepted', body: `Booking ${reference} was accepted.` },
    'booking.rejected': {
      title: 'Booking not accepted',
      body: `Booking ${reference} was declined.`,
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
