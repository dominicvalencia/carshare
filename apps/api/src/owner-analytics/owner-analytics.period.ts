export const OWNER_ANALYTICS_TIMEZONE = 'Asia/Manila';
export const OWNER_ANALYTICS_DEFINITION_VERSION = 'owner-analytics-v1';

export type OwnerAnalyticsPeriod = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'CUSTOM';

export interface OwnerAnalyticsRange {
  period: OwnerAnalyticsPeriod;
  startInclusive: Date;
  endExclusive: Date;
  comparisonStartInclusive: Date;
  comparisonEndExclusive: Date;
}

const calendarFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: OWNER_ANALYTICS_TIMEZONE,
  year: 'numeric',
});

type CalendarDate = { year: number; month: number; day: number };

export function resolveOwnerAnalyticsPeriod(input: {
  period: OwnerAnalyticsPeriod;
  now?: Date;
  startDate?: string;
  endDate?: string;
}): OwnerAnalyticsRange {
  const now = input.now ?? new Date();
  const today = calendarDate(now);
  let start: CalendarDate;
  let end: CalendarDate;

  if (input.period === 'CUSTOM') {
    if (!input.startDate || !input.endDate) throw new Error('CUSTOM_REQUIRES_START_AND_END_DATES');
    start = parseCalendarDate(input.startDate);
    end = addDays(parseCalendarDate(input.endDate), 1);
  } else if (input.period === 'TODAY') {
    start = today;
    end = addDays(start, 1);
  } else if (input.period === 'THIS_WEEK') {
    const weekday = isoWeekday(today);
    start = addDays(today, 1 - weekday);
    end = addDays(start, 7);
  } else {
    start = { year: today.year, month: today.month, day: 1 };
    end = addMonths(start, 1);
  }

  const calendarDays = daysBetween(start, end);
  if (calendarDays < 1) throw new Error('INVALID_ANALYTICS_DATE_RANGE');
  if (input.period === 'CUSTOM' && calendarDays > 366)
    throw new Error('ANALYTICS_DATE_RANGE_EXCEEDS_366_DAYS');

  const previousStart =
    input.period === 'THIS_MONTH' ? addMonths(start, -1) : addDays(start, -calendarDays);
  return {
    period: input.period,
    startInclusive: zonedMidnight(start),
    endExclusive: zonedMidnight(end),
    comparisonStartInclusive: zonedMidnight(previousStart),
    comparisonEndExclusive: zonedMidnight(start),
  };
}

function calendarDate(value: Date): CalendarDate {
  const parts = calendarFormatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error('INVALID_ANALYTICS_CALENDAR_DATE');
  const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const normalized = new Date(Date.UTC(result.year, result.month - 1, result.day));
  if (
    normalized.getUTCFullYear() !== result.year ||
    normalized.getUTCMonth() + 1 !== result.month ||
    normalized.getUTCDate() !== result.day
  )
    throw new Error('INVALID_ANALYTICS_CALENDAR_DATE');
  return result;
}

function addDays(value: CalendarDate, amount: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addMonths(value: CalendarDate, amount: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1 + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: 1 };
}

function daysBetween(start: CalendarDate, end: CalendarDate): number {
  return Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      86_400_000,
  );
}

function isoWeekday(value: CalendarDate): number {
  const day = new Date(Date.UTC(value.year, value.month - 1, value.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function zonedMidnight(value: CalendarDate): Date {
  // Resolve a local calendar midnight through the IANA timezone database. The
  // iteration also remains correct if the configured jurisdiction later uses DST.
  const desired = Date.UTC(value.year, value.month - 1, value.day);
  let instant = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const represented = calendarDate(new Date(instant));
    const representedValue = Date.UTC(represented.year, represented.month - 1, represented.day);
    if (representedValue === desired) break;
    instant += desired - representedValue;
  }
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    second: '2-digit',
    timeZone: OWNER_ANALYTICS_TIMEZONE,
  });
  const parts = hourFormatter.formatToParts(new Date(instant));
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  instant -= (number('hour') * 3_600 + number('minute') * 60 + number('second')) * 1_000;
  return new Date(instant);
}
