const DISCOVERY_HOUR = 9;
export const BOOKING_TIME_INCREMENT_MINUTES = 30;

export function discoveryDateForCalendarDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), DISCOVERY_HOUR, 0, 0, 0);
}

export function bookingCalendarMinimumDate(now: Date = new Date()) {
  return discoveryDateForCalendarDay(now);
}

export function isBookingCalendarDateSelectable(
  value: Date,
  policy: {
    readonly disabledDate?: (date: Date) => boolean;
    readonly minimumDate: Date;
  },
) {
  const calendarDate = discoveryDateForCalendarDay(value);
  const minimumDate = discoveryDateForCalendarDay(policy.minimumDate);
  return calendarDate >= minimumDate && !(policy.disabledDate?.(calendarDate) ?? false);
}

export function tripDateSummary(
  start: Date,
  end: Date,
  options: { readonly alwaysShowYear?: boolean } = {},
) {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const currentYear = new Date().getFullYear();
  if (!sameYear) {
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  if (sameMonth) {
    const month = start.toLocaleDateString(undefined, { month: 'short' });
    const year =
      options.alwaysShowYear || start.getFullYear() !== currentYear
        ? `, ${start.getFullYear()}`
        : '';
    return `${month} ${start.getDate()}–${end.getDate()}${year}`;
  }
  const dateOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const year =
    options.alwaysShowYear || start.getFullYear() !== currentYear ? `, ${start.getFullYear()}` : '';
  return `${start.toLocaleDateString(undefined, dateOptions)} – ${end.toLocaleDateString(undefined, dateOptions)}${year}`;
}

export function bookingTimeLabel(value: Date) {
  return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function tripDateTimeSummary(start: Date, end: Date) {
  return `${tripDateSummary(start, end)} · ${bookingTimeLabel(start)}`;
}

export function applyBookingTime(value: Date, minutesSinceMidnight: number) {
  const next = new Date(value);
  next.setHours(Math.floor(minutesSinceMidnight / 60), minutesSinceMidnight % 60, 0, 0);
  return next;
}

export function applySharedBookingTime(start: Date, end: Date, minutesSinceMidnight: number) {
  return {
    start: applyBookingTime(start, minutesSinceMidnight),
    end: applyBookingTime(end, minutesSinceMidnight),
  };
}

export function minutesSinceMidnight(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

export function isBookingTimeAligned(value: Date) {
  return value.getMinutes() % BOOKING_TIME_INCREMENT_MINUTES === 0;
}

export function nextBookingTimeSlot(now: Date = new Date()) {
  const current = minutesSinceMidnight(now);
  const next =
    Math.ceil((current + 1) / BOOKING_TIME_INCREMENT_MINUTES) * BOOKING_TIME_INCREMENT_MINUTES;
  return Math.min(next, 24 * 60 - BOOKING_TIME_INCREMENT_MINUTES);
}

export function isBookingTimeSlotSelectable(
  pickupDate: Date,
  slotMinutes: number,
  now: Date = new Date(),
) {
  const sameLocalDay =
    pickupDate.getFullYear() === now.getFullYear() &&
    pickupDate.getMonth() === now.getMonth() &&
    pickupDate.getDate() === now.getDate();
  return !sameLocalDay || applyBookingTime(pickupDate, slotMinutes) > now;
}
