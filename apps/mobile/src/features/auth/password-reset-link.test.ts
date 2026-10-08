import { describe, expect, it } from 'vitest';
import { passwordResetLink } from './password-reset-link';

const token = '123e4567-e89b-12d3-a456-426614174000.secret_value';

describe('password reset deep links', () => {
  it('extracts an opaque reset token only from the configured app scheme', () => {
    expect(passwordResetLink(`carrental://reset-password?token=${token}`)).toEqual({
      matched: true,
      token,
    });
    expect(
      passwordResetLink(`carshare-staging://reset-password?token=${token}`, 'carshare-staging'),
    ).toEqual({
      matched: true,
      token,
    });
  });

  it('marks malformed reset links as matched without exposing an invalid token', () => {
    expect(passwordResetLink('carrental://reset-password')).toEqual({ matched: true });
    expect(passwordResetLink('carrental://reset-password?token=not-an-opaque-token')).toEqual({
      matched: true,
    });
  });

  it('ignores unrelated and wrong-environment links', () => {
    expect(passwordResetLink(`https://example.com/reset-password?token=${token}`)).toEqual({
      matched: false,
    });
    expect(passwordResetLink(`carshare://reset-password?token=${token}`)).toEqual({
      matched: false,
    });
  });
});
