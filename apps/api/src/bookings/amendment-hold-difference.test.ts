import { describe, expect, it } from 'vitest';
import { amendmentHoldDifference } from './amendment-hold-difference';

const currentStart = new Date('2026-10-01T09:00:00.000Z');
const currentEnd = new Date('2026-10-03T10:00:00.000Z');

describe('amendment hold difference', () => {
  it('protects only the extension tail after current turnaround', () => {
    expect(
      amendmentHoldDifference({
        currentEnd,
        currentStart,
        proposedEnd: new Date('2026-10-03T14:00:00.000Z'),
        proposedStart: currentStart,
        turnaroundMinutes: 120,
      }),
    ).toEqual([
      {
        start: new Date('2026-10-03T12:00:00.000Z'),
        end: new Date('2026-10-03T16:00:00.000Z'),
      },
    ]);
  });

  it('protects only a same-date earlier-pickup lead', () => {
    expect(
      amendmentHoldDifference({
        currentEnd,
        currentStart,
        proposedEnd: currentEnd,
        proposedStart: new Date('2026-10-01T07:00:00.000Z'),
        turnaroundMinutes: 120,
      }),
    ).toEqual([{ start: new Date('2026-10-01T07:00:00.000Z'), end: currentStart }]);
  });

  it('returns two ordered minimal intervals for both-side expansion', () => {
    expect(
      amendmentHoldDifference({
        currentEnd,
        currentStart,
        proposedEnd: new Date('2026-10-03T14:00:00.000Z'),
        proposedStart: new Date('2026-10-01T07:00:00.000Z'),
        turnaroundMinutes: 120,
      }),
    ).toHaveLength(2);
  });

  it.each([
    ['shortening', new Date('2026-10-01T09:00:00.000Z'), new Date('2026-10-02T10:00:00.000Z')],
    ['later pickup', new Date('2026-10-01T11:00:00.000Z'), currentEnd],
  ])('creates no release/negative hold for %s', (_label, proposedStart, proposedEnd) => {
    expect(
      amendmentHoldDifference({
        currentEnd,
        currentStart,
        proposedEnd,
        proposedStart,
        turnaroundMinutes: 120,
      }),
    ).toEqual([]);
  });
});
