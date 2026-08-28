export type BookingGroup = 'Current' | 'Upcoming' | 'Past';

export function bookingGroup(status: string): BookingGroup {
  if (['ACTIVE', 'READY_FOR_PICKUP', 'RETURN_PENDING', 'RETURNED'].includes(status))
    return 'Current';
  if (['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'Past';
  return 'Upcoming';
}
