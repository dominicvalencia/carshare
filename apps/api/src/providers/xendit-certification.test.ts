import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { certifyXenditSessionOnce, isAllowedXenditTestCheckoutUrl } from './xendit-certification';

describe('Xendit local certification', () => {
  it('creates one fixed PHP 100 session and stores no provider identity', async () => {
    const markerPath = join(await mkdtemp(join(tmpdir(), 'xendit-cert-')), 'sent');
    const createSession = vi.fn().mockResolvedValue({
      customerActionUrl: 'https://dev.xen.to/safe',
      externalPaymentId: 'ps-test',
      kind: 'ACTION_REQUIRED',
      providerState: 'ACTIVE',
    });
    await expect(
      certifyXenditSessionOnce({ provider: { createSession }, markerPath }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 10_000n,
        currency: 'PHP',
        requestReference: 'carshare-local-xendit-certification',
      }),
    );
    await expect(
      certifyXenditSessionOnce({ provider: { createSession }, markerPath }),
    ).rejects.toThrow('ALREADY_COMPLETED');
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(await readFile(markerPath, 'utf8')).not.toContain('ps-test');
  });
  it.each(['https://dev.xen.to/test', 'https://checkout-staging.xendit.co/sessions/ps-test'])(
    'accepts exact test origin %s',
    (url) => expect(isAllowedXenditTestCheckoutUrl(url)).toBe(true),
  );
  it.each([
    'http://dev.xen.to/test',
    'https://checkout.xendit.co/session',
    'https://evil.xendit.co/test',
    'https://dev.xen.to.attacker.example/test',
    'https://user:pass@dev.xen.to/test',
  ])('rejects unsafe URL %s', (url) => expect(isAllowedXenditTestCheckoutUrl(url)).toBe(false));
});
