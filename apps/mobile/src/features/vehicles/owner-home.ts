export interface OwnerHomeCard {
  readonly bookingReference: string;
  readonly deepLinkTarget: { readonly bookingReference: string; readonly route: 'Booking' };
  readonly pickup: {
    readonly at: string;
    readonly handoverStatus: string | null;
    readonly location: string | null;
    readonly method: string;
  };
  readonly renterDisplayName: string;
  readonly return: {
    readonly at: string;
    readonly method: string;
    readonly workflowStatus: string | null;
  };
  readonly status: string;
  readonly vehicle: {
    readonly coverPhoto?: { readonly contentPath: string } | null;
    readonly make: string;
    readonly model: string;
  };
}

export interface OwnerHomeAttention {
  readonly bookingReference: string;
  readonly deepLinkTarget: { readonly bookingReference: string; readonly route: 'Booking' };
  readonly renterDisplayName: string;
  readonly severity: 'WARNING';
  readonly timestamp: string | null;
  readonly titleCode: string;
  readonly type: 'OVERDUE_PICKUP' | 'OVERDUE_RETURN' | 'OPERATIONAL_HOLD' | 'FINANCIAL_RECOVERY';
  readonly vehicleMake: string;
  readonly vehicleModel: string;
}

export interface OwnerHomeReadModel {
  readonly asOf: string;
  readonly timezone: 'Asia/Manila';
  readonly requests: {
    readonly amendmentRequestsCount: number;
    readonly bookingRequestsCount: number;
    readonly totalRequestsCount: number;
  };
  readonly today: {
    readonly activeRentals: readonly OwnerHomeCard[];
    readonly attention: readonly OwnerHomeAttention[];
    readonly counts: {
      readonly actionableRequestsCount: number;
      readonly activeRentalsCount: number;
      readonly needsAttentionCount: number;
      readonly pickupsTodayCount: number;
      readonly returnsTodayCount: number;
    };
    readonly endExclusive: string;
    readonly nextUpcoming: OwnerHomeCard | null;
    readonly pickups: readonly OwnerHomeCard[];
    readonly returns: readonly OwnerHomeCard[];
    readonly startInclusive: string;
  };
}

export interface OwnerHomeUpcomingPage {
  readonly asOf: string;
  readonly items: readonly OwnerHomeCard[];
  readonly page: number;
  readonly pageSize: number;
  readonly timezone: 'Asia/Manila';
  readonly total: number;
  readonly totalPages: number;
}

export const ownerHomeQueryKey = ['owner-home'] as const;

export function ownerTodayDateLabel(startInclusive: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'short',
    timeZone: timezone,
    weekday: 'long',
  }).format(new Date(startInclusive));
}

export function ownerHomeIsOperationallyEmpty(model: OwnerHomeReadModel): boolean {
  return (
    model.today.attention.length === 0 &&
    model.today.pickups.length === 0 &&
    model.today.activeRentals.length === 0 &&
    model.today.returns.length === 0
  );
}

export function ownerRequestSummaryLabel(count: number, canRespond: boolean): string {
  if (!canRespond) return `${count} booking ${count === 1 ? 'request' : 'requests'}`;
  return `${count} ${count === 1 ? 'request needs' : 'requests need'} your response`;
}

export function ownerRequestTabAccessibilityLabel(count: number, canRespond: boolean): string {
  if (count === 0) return 'Requests';
  return canRespond
    ? `Requests, ${count} ${count === 1 ? 'item needs' : 'items need'} your response`
    : `Requests, ${count} booking ${count === 1 ? 'request' : 'requests'}`;
}

export function ownerUnreadMessagesLabel(count: number): string {
  return `${count} unread ${count === 1 ? 'message' : 'messages'}`;
}

export function ownerUnreadMessageCount(
  items: readonly { readonly unreadCount: number }[],
): number {
  return items.reduce((total, item) => total + item.unreadCount, 0);
}

export function ownerAttentionLabel(item: OwnerHomeAttention, canAct: boolean): string {
  if (canAct) {
    if (item.type === 'OVERDUE_PICKUP') return 'Pickup needs attention';
    if (item.type === 'OVERDUE_RETURN') return 'Return is overdue';
    if (item.type === 'FINANCIAL_RECOVERY') return 'Booking update needs review';
    if (item.titleCode === 'PICKUP_DISCREPANCY') return 'Pickup discrepancy needs review';
    return 'Booking needs attention';
  }
  if (item.type === 'OVERDUE_PICKUP') return 'Pickup overdue';
  if (item.type === 'OVERDUE_RETURN') return 'Return overdue';
  if (item.titleCode === 'PICKUP_DISCREPANCY') return 'Pickup discrepancy';
  return 'Booking update';
}

export function groupOwnerUpcoming(
  items: readonly OwnerHomeCard[],
  todayStart: string,
  timezone: string,
) {
  const todayKey = localDateKey(todayStart, timezone);
  const tomorrow = new Date(new Date(todayStart).getTime() + 86_400_000);
  const tomorrowKey = localDateKey(tomorrow, timezone);
  const groups = new Map<string, OwnerHomeCard[]>();
  for (const item of items) {
    const key = localDateKey(item.pickup.at, timezone);
    if (key === todayKey) continue;
    const existing = groups.get(key) ?? [];
    if (!existing.some(({ bookingReference }) => bookingReference === item.bookingReference))
      existing.push(item);
    groups.set(key, existing);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, bookings]) => ({
      bookings,
      key,
      label:
        key === tomorrowKey
          ? 'Tomorrow'
          : new Intl.DateTimeFormat('en-PH', {
              day: 'numeric',
              month: 'short',
              timeZone: timezone,
            }).format(new Date(bookings[0]!.pickup.at)),
    }));
}

function localDateKey(value: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).format(new Date(value));
}
