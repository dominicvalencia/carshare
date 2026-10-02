import { describe, expect, it } from 'vitest';
import { discoveryDateForCalendarDay, tripDateSummary } from './trip-date-policy';

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
});
