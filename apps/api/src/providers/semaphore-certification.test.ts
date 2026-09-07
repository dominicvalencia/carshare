import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LocalSmsCertificationProvider } from './delivery.provider';
import { certifySemaphoreOnce } from './semaphore-certification';

describe('Semaphore local certification', () => {
  it('sends exactly once and stores no recipient or provider message identifier', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'semaphore-certification-'));
    const markerPath = join(directory, 'sent');
    const sendCertification = vi.fn().mockResolvedValue({
      provider: 'semaphore',
      providerMessageId: 'provider-message-1',
      status: 'DELAYED',
    });
    const input = {
      markerPath,
      provider: { sendCertification } as LocalSmsCertificationProvider,
      recipient: '+639171234567',
    };

    await expect(certifySemaphoreOnce(input)).resolves.toMatchObject({ sent: true });
    await expect(certifySemaphoreOnce(input)).rejects.toThrow(
      'SEMAPHORE_CERTIFICATION_ALREADY_COMPLETED',
    );
    expect(sendCertification).toHaveBeenCalledTimes(1);
    const marker = await readFile(markerPath, 'utf8');
    expect(marker).not.toContain(input.recipient);
    expect(marker).not.toContain('provider-message-1');
  });

  it('removes its marker when provider delivery is rejected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'semaphore-certification-'));
    const markerPath = join(directory, 'sent');
    const provider = {
      sendCertification: vi.fn().mockRejectedValue(new Error('SMS_PROVIDER_REJECTED')),
    } as LocalSmsCertificationProvider;

    await expect(
      certifySemaphoreOnce({ markerPath, provider, recipient: '+639171234567' }),
    ).rejects.toThrow('SMS_PROVIDER_REJECTED');
    await expect(
      certifySemaphoreOnce({ markerPath, provider, recipient: '+639171234567' }),
    ).rejects.toThrow('SMS_PROVIDER_REJECTED');
    expect(provider.sendCertification).toHaveBeenCalledTimes(2);
  });
});
