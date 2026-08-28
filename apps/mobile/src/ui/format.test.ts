import { afterEach, describe, expect, it } from 'vitest';
import { dateLabel, relativeTime } from './format';

const now = new Date('2026-08-25T08:00:00.000Z').getTime();
const descriptor = Object.getOwnPropertyDescriptor(Intl, 'RelativeTimeFormat');

afterEach(() => {
  if (descriptor) Object.defineProperty(Intl, 'RelativeTimeFormat', descriptor);
});

describe('relativeTime', () => {
  it('formats now, minutes, hours, yesterday and recent day ranges', () => {
    expect(relativeTime(new Date(now - 15_000), now)).toBe('Just now');
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
    expect(relativeTime(new Date(now - 2 * 3_600_000), now)).toBe('2 hr ago');
    expect(relativeTime(new Date(now - 86_400_000), now)).toBe('Yesterday');
    expect(relativeTime(new Date(now - 3 * 86_400_000), now)).toBe('3 days ago');
  });

  it('uses a normal date for older content', () => {
    const old = new Date(now - 8 * 86_400_000);
    expect(relativeTime(old, now)).toBe(dateLabel(old));
  });

  it('does not require Intl.RelativeTimeFormat at runtime', () => {
    Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, value: undefined });
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe('5 min ago');
  });
});
