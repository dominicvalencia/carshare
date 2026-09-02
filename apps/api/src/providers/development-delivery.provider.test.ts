import { describe, expect, it, vi } from 'vitest';
import {
  DevelopmentDeliveryInbox,
  DevelopmentEmailProvider,
  DevelopmentSmsProvider,
} from './development-delivery.provider';

function configuration(appEnvironment: 'local' | 'production', provider = 'development') {
  return {
    getOrThrow: (key: string) =>
      key === 'APP_ENV' ? appEnvironment : key === 'AUTH_DELIVERY_PROVIDER' ? provider : undefined,
  };
}

function logger() {
  return { info: vi.fn(), setContext: vi.fn() };
}

describe('development authentication delivery inbox', () => {
  it('retains secrets without placing them in ordinary logs', async () => {
    const inbox = new DevelopmentDeliveryInbox();
    const log = logger();
    const email = new DevelopmentEmailProvider(
      log as never,
      configuration('local') as never,
      inbox,
    );
    const sms = new DevelopmentSmsProvider(log as never, configuration('local') as never, inbox);
    await email.send({
      actionUrl: 'http://localhost/verify?token=opaque.secret',
      template: 'EMAIL_VERIFICATION',
      to: 'renter@example.test',
      token: 'opaque.secret',
    });
    await sms.send({ template: 'MOBILE_VERIFICATION_OTP', to: '+639171234567', code: '123456' });
    expect(inbox.list(['renter@example.test', '+639171234567'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'EMAIL', secret: 'opaque.secret' }),
        expect.objectContaining({ channel: 'SMS', secret: '123456' }),
      ]),
    );
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('opaque.secret');
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('123456');
  });

  it('cannot deliver or retain fake secrets in production', async () => {
    const inbox = new DevelopmentDeliveryInbox();
    const email = new DevelopmentEmailProvider(
      logger() as never,
      configuration('production') as never,
      inbox,
    );
    await expect(
      email.send({
        actionUrl: 'https://example.test/verify?token=secret',
        template: 'EMAIL_VERIFICATION',
        to: 'renter@example.test',
        token: 'secret',
      }),
    ).rejects.toThrow('External email delivery provider is not configured');
    expect(inbox.list(['renter@example.test'])).toHaveLength(0);
  });
});
