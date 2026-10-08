import { describe, expect, it } from 'vitest';
import { passwordResetAppScheme } from './password-reset-link';

describe('password reset app links', () => {
  it.each([
    ['local', 'carrental'],
    ['test', 'carshare-test'],
    ['staging', 'carshare-staging'],
    ['production', 'carshare'],
  ] as const)('maps %s email links to its matching mobile scheme', (environment, scheme) => {
    expect(passwordResetAppScheme(environment)).toBe(scheme);
  });
});
