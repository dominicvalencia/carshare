import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./recovery-reminders.ts', import.meta.url), 'utf8');

describe('durable overdue recovery reminders', () => {
  it('rechecks authoritative terminal state before each provider attempt', () => {
    expect(source).toContain('current.response || current.acceptance');
    expect(source).toContain('current.responseDeadlineAt <= now');
    expect(source).toContain('RENTER_ALREADY_RESPONDED');
    expect(source).toContain('RECOVERY_ALREADY_ACCEPTED');
  });

  it('requires verified authoritative destinations and never accepts client destinations', () => {
    expect(source).toContain('recipient.emailVerifiedAt');
    expect(source).toContain('recipient.mobileVerifiedAt');
    expect(source).toContain('recipient.normalizedMobileNumber');
    expect(source).not.toMatch(/payload\.(email|phone|mobile)/);
  });

  it('isolates transactional SMS and retains unknown provider outcomes', () => {
    expect(source).toContain('SMS_TRANSACTIONAL_ENABLED');
    expect(source).not.toContain('sendOtp');
    expect(source).toContain('NotificationDeliveryStatus.UNKNOWN');
    expect(source).toContain('UNKNOWN_PROVIDER_RESULT');
  });

  it('keeps external content to safe scope, deadline, reference, and link data', () => {
    expect(source).not.toMatch(/reported(Pickup|Return)At/);
    expect(source).not.toMatch(/address|coordinates|mediaUrl|kyc|payment/i);
  });
});
