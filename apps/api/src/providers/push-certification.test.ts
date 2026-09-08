import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PushProvider } from '@carrental/notifications';
import { certifyPushOnce } from './push-certification';

describe('local push certification', () => {
  it('sends fixed safe content exactly once without persisting the token', async () => {
    const markerPath = join(await mkdtemp(join(tmpdir(), 'push-certification-')), 'sent');
    const send = vi.fn().mockResolvedValue({ status: 'ACCEPTED', providerReference: 'ticket-1' });
    const input = {
      provider: { code: 'expo', send, receipts: vi.fn() } as PushProvider,
      token: 'ExponentPushToken[controlled-device]',
      deepLink: 'carrental://notifications',
      markerPath,
    };
    await expect(certifyPushOnce(input)).resolves.toMatchObject({ status: 'ACCEPTED' });
    await expect(certifyPushOnce(input)).rejects.toThrow('PUSH_CERTIFICATION_ALREADY_COMPLETED');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'CarShare push certification',
        body: 'Push notification delivery is configured correctly.',
        data: { deepLink: 'carrental://notifications' },
      }),
    );
    expect(await readFile(markerPath, 'utf8')).not.toContain(input.token);
  });

  it('removes the marker after provider rejection', async () => {
    const markerPath = join(await mkdtemp(join(tmpdir(), 'push-certification-')), 'sent');
    const send = vi.fn().mockResolvedValue({
      status: 'PERMANENT_FAILURE',
      safeFailureMessage: 'Push provider rejected the request.',
    });
    const provider = { code: 'expo', send, receipts: vi.fn() } as PushProvider;
    await expect(
      certifyPushOnce({
        provider,
        token: 'ExponentPushToken[controlled-device]',
        deepLink: 'carrental://notifications',
        markerPath,
      }),
    ).rejects.toThrow('Push provider rejected');
    await expect(
      certifyPushOnce({
        provider,
        token: 'ExponentPushToken[controlled-device]',
        deepLink: 'carrental://notifications',
        markerPath,
      }),
    ).rejects.toThrow('Push provider rejected');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
