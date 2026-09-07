import { describe, expect, it } from 'vitest';
import { normalizePhilippineMobile } from './philippine-mobile';

describe('Philippine mobile normalization', () => {
  it.each([
    ['09171234567', '+639171234567'],
    ['+639171234567', '+639171234567'],
    ['0917 123 4567', '+639171234567'],
    ['0917-123-4567', '+639171234567'],
  ])('normalizes %s to the canonical E.164 form', (input, expected) => {
    expect(normalizePhilippineMobile(input)).toBe(expected);
  });

  it.each(['0917123456', '091712345678', '+14155552671', 'not-a-number'])(
    'rejects unsupported input %s',
    (input) => {
      expect(() => normalizePhilippineMobile(input)).toThrow('INVALID_PHILIPPINE_MOBILE');
    },
  );
});
