import { describe, expect, it } from 'vitest';
import {
  BOOKING_TIME_INCREMENT_MINUTES,
  applySharedBookingTime,
  bookingCalendarMinimumDate,
  discoveryDateForCalendarDay,
  hasSelectableBookingTimeSlot,
  isBookingTimeSlotSelectable,
  isBookingTimeAligned,
  isBookingCalendarDateSelectable,
  minutesSinceMidnight,
  tripDateSummary,
  tripDateTimeSummary,
} from './trip-date-policy';

describe('TripDateCalendar discovery-date policy', () => {
  it('converts a calendar choice to the established local 9:00 AM search instant', () => {
    const selected = discoveryDateForCalendarDay(new Date(2030, 8, 25, 18, 42));
    expect(selected.getFullYear()).toBe(2030);
    expect(selected.getMonth()).toBe(8);
    expect(selected.getDate()).toBe(25);
    expect(selected.getHours()).toBe(9);
    expect(selected.getMinutes()).toBe(0);
    expect(selected.getSeconds()).toBe(0);
    expect(Number.isFinite(Date.parse(selected.toISOString()))).toBe(true);
  });

  it('allows today while a future slot remains and keeps yesterday disabled', () => {
    const now = new Date(2030, 8, 25, 13, 7);
    const minimumDate = bookingCalendarMinimumDate(now);

    expect(minimumDate).toEqual(new Date(2030, 8, 25, 9));
    expect(isBookingCalendarDateSelectable(new Date(2030, 8, 25, 12), { minimumDate, now })).toBe(
      true,
    );
    expect(isBookingCalendarDateSelectable(new Date(2030, 8, 24, 23, 59), { minimumDate })).toBe(
      false,
    );
  });

  it('uses local calendar fields across offset-bearing day-boundary instants', () => {
    const nearLocalMidnight = new Date(2030, 8, 25, 0, 1);
    const minimumDate = bookingCalendarMinimumDate(nearLocalMidnight);

    expect(minimumDate.getFullYear()).toBe(nearLocalMidnight.getFullYear());
    expect(minimumDate.getMonth()).toBe(nearLocalMidnight.getMonth());
    expect(minimumDate.getDate()).toBe(nearLocalMidnight.getDate());
    expect(isBookingCalendarDateSelectable(nearLocalMidnight, { minimumDate })).toBe(true);
  });

  it('preserves flow-specific minimum dates and unavailable-day blocks', () => {
    const today = new Date(2030, 8, 25, 12);
    const tomorrow = new Date(2030, 8, 26, 12);
    const laterMinimum = new Date(2030, 8, 27, 18);

    expect(isBookingCalendarDateSelectable(today, { minimumDate: laterMinimum })).toBe(false);
    expect(
      isBookingCalendarDateSelectable(tomorrow, {
        disabledDate: (date) => date.getDate() === tomorrow.getDate(),
        minimumDate: today,
      }),
    ).toBe(false);
  });

  it('formats same-month, cross-month, and cross-year ranges without handover wording', () => {
    expect(tripDateSummary(new Date(2030, 8, 25, 9), new Date(2030, 8, 27, 9))).toBe(
      'Sep 25–27, 2030',
    );
    expect(tripDateSummary(new Date(2030, 8, 29, 9), new Date(2030, 9, 2, 9))).toBe(
      'Sep 29 – Oct 2, 2030',
    );
    expect(tripDateSummary(new Date(2030, 11, 30, 9), new Date(2031, 0, 2, 9))).toBe(
      'Dec 30, 2030 – Jan 2, 2031',
    );
  });

  it('applies one 30-minute booking time to both local calendar dates', () => {
    const result = applySharedBookingTime(
      new Date(2030, 8, 25, 9),
      new Date(2030, 8, 27, 17),
      10 * 60 + 30,
    );

    expect(BOOKING_TIME_INCREMENT_MINUTES).toBe(30);
    expect(result.start).toEqual(new Date(2030, 8, 25, 10, 30));
    expect(result.end).toEqual(new Date(2030, 8, 27, 10, 30));
    expect(tripDateTimeSummary(result.start, result.end)).toContain('10:30');
  });

  it('blocks elapsed same-day slots but allows the same slot on a future date', () => {
    const now = new Date(2030, 8, 25, 10, 10);
    expect(isBookingTimeSlotSelectable(new Date(2030, 8, 25), 10 * 60, now)).toBe(false);
    expect(isBookingTimeSlotSelectable(new Date(2030, 8, 25), 10 * 60 + 30, now)).toBe(true);
    expect(isBookingTimeSlotSelectable(new Date(2030, 8, 26), 10 * 60, now)).toBe(true);
  });

  it('applies authoritative notice to the combined same-day timestamp', () => {
    const now = new Date(2030, 8, 25, 13, 7);
    expect(isBookingTimeSlotSelectable(new Date(2030, 8, 25), 13 * 60 + 30, now, 120)).toBe(false);
    expect(isBookingTimeSlotSelectable(new Date(2030, 8, 25), 15 * 60 + 30, now, 120)).toBe(true);
  });

  it('disables today only when no valid half-hour slot remains', () => {
    const closeToMidnight = new Date(2030, 8, 25, 23, 31);
    const minimumDate = bookingCalendarMinimumDate(closeToMidnight);
    expect(hasSelectableBookingTimeSlot(closeToMidnight, closeToMidnight)).toBe(false);
    expect(
      isBookingCalendarDateSelectable(closeToMidnight, { minimumDate, now: closeToMidnight }),
    ).toBe(false);
    expect(
      isBookingCalendarDateSelectable(new Date(2030, 8, 26), {
        minimumDate,
        now: closeToMidnight,
      }),
    ).toBe(true);
  });

  it('disables today when notice pushes the next valid slot into tomorrow', () => {
    const now = new Date(2030, 8, 25, 22, 15);
    expect(hasSelectableBookingTimeSlot(now, now, 120)).toBe(false);
    expect(hasSelectableBookingTimeSlot(new Date(2030, 8, 26), now, 120)).toBe(true);
  });

  it('uses the selected shared time instead of the legacy discovery hour', () => {
    const now = new Date(2030, 8, 25, 13, 7);
    const selected = applySharedBookingTime(
      discoveryDateForCalendarDay(now),
      discoveryDateForCalendarDay(new Date(2030, 8, 26)),
      13 * 60 + 30,
    );
    expect(selected.start.getHours()).toBe(13);
    expect(selected.start.getMinutes()).toBe(30);
    expect(
      isBookingTimeSlotSelectable(selected.start, minutesSinceMidnight(selected.start), now),
    ).toBe(true);
  });

  it('accepts only times aligned to the booking half-hour policy', () => {
    expect(isBookingTimeAligned(new Date(2030, 8, 25, 10, 0))).toBe(true);
    expect(isBookingTimeAligned(new Date(2030, 8, 25, 10, 30))).toBe(true);
    expect(isBookingTimeAligned(new Date(2030, 8, 25, 10, 15))).toBe(false);
  });
});
