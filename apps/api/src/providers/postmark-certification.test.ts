import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { certifyPostmarkOnce } from './postmark-certification';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true }))),
);

describe('Postmark local certification', () => {
  it('sends once and persists only a non-sensitive completion marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'carshare-postmark-'));
    directories.push(directory);
    const markerPath = join(directory, 'postmark.sent');
    const sendCertification = vi.fn().mockResolvedValue({
      provider: 'postmark',
      providerMessageId: 'provider-message-1',
      status: 'ACCEPTED',
    });
    const input = {
      provider: { sendCertification },
      recipient: 'controlled@example.test',
      markerPath,
    };

    await expect(certifyPostmarkOnce(input)).resolves.toMatchObject({
      sent: true,
      receipt: { providerMessageId: 'provider-message-1', status: 'ACCEPTED' },
    });
    await expect(certifyPostmarkOnce(input)).rejects.toThrow(
      'POSTMARK_CERTIFICATION_ALREADY_COMPLETED',
    );
    expect(sendCertification).toHaveBeenCalledOnce();
    expect(await readFile(markerPath, 'utf8')).not.toContain('controlled@example.test');
    expect(await readFile(markerPath, 'utf8')).not.toContain('provider-message-1');
  });
});
