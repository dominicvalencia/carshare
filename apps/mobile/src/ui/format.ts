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

export function relativeTime(value: string | Date, now = Date.now()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  const difference = now - date.getTime();
  const absolute = Math.abs(difference);
  const past = difference >= 0;
  if (absolute < 60_000) return 'Just now';
  if (absolute < 3_600_000) {
    const minutes = Math.max(1, Math.floor(absolute / 60_000));
    return past ? `${minutes} min ago` : `In ${minutes} min`;
  }
  if (absolute < 86_400_000) {
    const hours = Math.max(1, Math.floor(absolute / 3_600_000));
    return past ? `${hours} hr ago` : `In ${hours} hr`;
  }
  if (absolute < 604_800_000) {
    const days = Math.max(1, Math.floor(absolute / 86_400_000));
    if (days === 1) return past ? 'Yesterday' : 'Tomorrow';
    return past ? `${days} days ago` : `In ${days} days`;
  }
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

export function bookingStatusLabel(
  status: string,
  perspective: 'owner' | 'renter' = 'renter',
): string {
  if (status === 'AWAITING_OWNER' && perspective === 'owner') return 'Waiting for your response';
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
  APPROVED: 'Approved',
  PAID: 'Paid',
  PENDING_APPROVAL: 'Pending approval',
  PROCESSING: 'Processing',
  PROCESSING_PAYOUT: 'Processing payout',
  SUBMITTING: 'Sending',
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
