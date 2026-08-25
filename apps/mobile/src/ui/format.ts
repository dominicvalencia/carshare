export function money(minor: number, currency = 'PHP'): string {
  return new Intl.NumberFormat('en-PH', {
    currency,
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(minor / 100);
}

export function dateLabel(value: string | Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function timeLabel(value: string | Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function dateTimeLabel(value: string | Date): string {
  return `${dateLabel(value)} · ${timeLabel(value)}`;
}

export function relativeTime(value: string | Date): string {
  const date = new Date(value);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(seconds, 'second');
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 604_800) return formatter.format(Math.round(seconds / 86_400), 'day');
  return dateLabel(date);
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return 'Not specified';
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const bookingStatus: Readonly<Record<string, string>> = {
  HOLD: 'Car held for you',
  AWAITING_PAYMENT: 'Payment setup needed',
  AWAITING_OWNER: 'Waiting for owner',
  CAPTURE_PENDING: 'Confirming payment',
  CONFIRMED: 'Confirmed',
  READY_FOR_PICKUP: 'Ready for pickup',
  ACTIVE: 'Rental in progress',
  RETURN_PENDING: 'Return being confirmed',
  RETURNED: 'Returned',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export function bookingStatusLabel(status: string): string {
  return bookingStatus[status] ?? titleCase(status);
}

const labels: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  APPROVED: 'Published',
  BANK_ACCOUNT: 'Bank account',
  BATTERY_ELECTRIC: 'Electric',
  CHANGES_REQUIRED: 'Changes requested',
  DRIVER_SIDE: 'Driver side',
  E_WALLET: 'E-wallet',
  FUEL_OR_BATTERY_DISPLAY: 'Fuel or battery display',
  FULL_TO_FULL: 'Full to full',
  ICE: 'Combustion',
  INTERIOR_DASHBOARD: 'Dashboard and interior',
  MAINTENANCE: 'In maintenance',
  PASSENGER_SIDE: 'Passenger side',
  PAID: 'Paid',
  PENDING: 'Pending release',
  PENDING_APPROVAL: 'Awaiting review',
  PROCESSING: 'Processing',
  PLUG_IN_HYBRID: 'Plug-in hybrid',
  HELD: 'Held for review',
  REJECTED: 'Not approved',
  SUBMITTING: 'Being sent',
  SAME_TO_SAME: 'Same level at return',
  SUSPENDED: 'Suspended',
  TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable',
  CVT: 'CVT',
};

const vehicleLabels: Readonly<Record<string, string>> = {
  APPROVED: 'Published',
  AVAILABLE: 'Available for booking',
  CHANGES_REQUIRED: 'Changes requested',
  MAINTENANCE: 'In maintenance',
  PENDING_APPROVAL: 'Awaiting review',
  TEMPORARILY_UNAVAILABLE: 'Temporarily unavailable',
};

const earningLabels: Readonly<Record<string, string>> = {
  AVAILABLE: 'Available for payout',
  HELD: 'Held for review',
  PENDING: 'Pending release',
};

const payoutEligibilityLabels: Readonly<Record<string, string>> = {
  ELIGIBLE: 'Ready for payouts',
  NOT_READY: 'Setup required',
  RESTRICTED: 'Payouts restricted',
};

const payoutLabels: Readonly<Record<string, string>> = {
  PAID: 'Paid',
  PROCESSING: 'Processing',
  PROCESSING_PAYOUT: 'Processing payout',
};

export function domainLabel(value: string | null | undefined): string {
  if (!value) return 'Not specified';
  return labels[value] ?? titleCase(value);
}

export function vehicleStatusLabel(value: string): string {
  return vehicleLabels[value] ?? labels[value] ?? titleCase(value);
}

export function earningStatusLabel(value: string): string {
  return earningLabels[value] ?? labels[value] ?? titleCase(value);
}

export function payoutEligibilityLabel(value: string): string {
  return payoutEligibilityLabels[value] ?? labels[value] ?? titleCase(value);
}

export function payoutStatusLabel(value: string): string {
  return payoutLabels[value] ?? labels[value] ?? titleCase(value);
}

export function channelLabel(value: string): string {
  const channel = value.replace(/^PH_/, '');
  return channel === 'GCASH' ? 'GCash' : channel.replaceAll('_', ' ');
}
