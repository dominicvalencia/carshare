import { describe, expect, it } from 'vitest';
import { renderSmsMessage } from './delivery.provider';

describe('Staff password recovery SMS', () => {
  it('uses a dedicated password-reset template without exposing workspace context', () => {
    expect(
      renderSmsMessage({
        code: '123456',
        template: 'STAFF_PASSWORD_RESET_OTP',
        to: '+639171234567',
      }),
    ).toBe('Your CarShare Staff password reset code is 123456. It expires soon.');
  });
});
