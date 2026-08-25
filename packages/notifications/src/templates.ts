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
    'booking.expired': { title: 'Booking expired', body: `Booking ${reference} expired.` },
    'payment.updated': {
      title: 'Payment update',
      body: `Payment status changed for ${reference}.`,
    },
    'rental.updated': { title: 'Rental update', body: `There is an update for ${reference}.` },
    'claim.updated': { title: 'Claim update', body: `There is a claim update for ${reference}.` },
    'earning.updated': { title: 'Earnings update', body: 'Your owner earnings have been updated.' },
    'payout.updated': { title: 'Payout update', body: 'Your payout status has been updated.' },
    'message.new': { title: 'New message', body: 'You received a message about a booking.' },
    'review.available': {
      title: 'Share your experience',
      body: `Reviews are available for ${reference}.`,
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
