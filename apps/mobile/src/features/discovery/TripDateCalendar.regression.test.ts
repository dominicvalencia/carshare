import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'TripDateCalendar.tsx'),
  'utf8',
);
const sharedCalendar = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/CalendarMonth.tsx'),
  'utf8',
);
const policy = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'trip-date-policy.ts'),
  'utf8',
);

describe('TripDateCalendar source authority', () => {
  it('uses local 9 AM construction without parsing date-only strings', () => {
    expect(policy).toContain('const DISCOVERY_HOUR = 9');
    expect(policy).toContain('value.getFullYear()');
    expect(policy).toContain('value.getMonth()');
    expect(policy).toContain('value.getDate()');
    expect(policy).not.toMatch(/new Date\(["'`]\d{4}-\d{2}-\d{2}/);
  });

  it('enforces the established range boundaries and explicit apply step', () => {
    expect(source).toContain('const MAX_RANGE_DAYS = 365');
    expect(source).toContain('day.getTime() <= draftStart.getTime()');
    expect(source).toContain('calendarDaysBetween(draftStart, day) > MAX_RANGE_DAYS');
    expect(source).toContain('label="Apply dates"');
    expect(source).toContain('disabled={!complete}');
    expect(source).toContain('label="Clear dates"');
  });

  it('provides non-color range semantics and accessible month controls', () => {
    expect(sharedCalendar).toContain("'selected, range start'");
    expect(sharedCalendar).toContain("'selected, range end'");
    expect(sharedCalendar).toContain("'selected, in range'");
    expect(sharedCalendar).toContain('accessibilityLabel="Previous month"');
    expect(sharedCalendar).toContain('accessibilityLabel="Next month"');
    expect(sharedCalendar).toContain('accessibilityState={{ disabled: previousDisabled }}');
    expect(sharedCalendar).toContain("textDecorationLine: 'line-through'");
  });
});
