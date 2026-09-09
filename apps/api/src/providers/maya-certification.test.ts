import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertMayaCertificationReturnUrls,
  certifyMayaCheckoutOnce,
  isAllowedMayaSandboxCheckoutUrl,
} from './maya-certification';

describe('Maya local certification', () => {
  it('creates exactly one fixed PHP 100 checkout and persists a secret-free marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'maya-certification-'));
    const markerPath = join(directory, 'maya.sent');
    const createCheckout = vi.fn().mockResolvedValue({
      customerActionUrl: 'https://payments-web-sandbox.maya.ph/checkout-1?token=synthetic',
      externalPaymentId: 'checkout-1',
      kind: 'ACTION_REQUIRED',
      providerState: 'CHECKOUT_CREATED',
    });
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 10_000n, currency: 'PHP' }),
    );
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).rejects.toThrow('MAYA_CERTIFICATION_ALREADY_COMPLETED');
    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(await readFile(markerPath, 'utf8')).not.toContain('checkout-1');
  });

  it.each([
    [{ kind: 'UNKNOWN' }, 'not accepted'],
    [
      {
        customerActionUrl: 'https://payments.maya.ph/production',
        externalPaymentId: 'checkout-1',
        kind: 'ACTION_REQUIRED',
      },
      'production checkout URL',
    ],
  ])('fails closed for %s and permits a safe retry', async (result) => {
    const directory = await mkdtemp(join(tmpdir(), 'maya-certification-'));
    const markerPath = join(directory, 'maya.sent');
    const createCheckout = vi.fn().mockResolvedValue(result);
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).rejects.toThrow('MAYA_CERTIFICATION_CHECKOUT_NOT_ACCEPTED');
    createCheckout.mockResolvedValue({
      customerActionUrl: 'https://payments-web-sandbox.paymaya.com/checkout-2',
      externalPaymentId: 'checkout-2',
      kind: 'ACTION_REQUIRED',
    });
    await expect(
      certifyMayaCheckoutOnce({ provider: { createCheckout }, markerPath }),
    ).resolves.toMatchObject({ kind: 'ACTION_REQUIRED' });
  });

  it('allows only the fixed local certification return URLs', () => {
    expect(() =>
      assertMayaCertificationReturnUrls([
        'http://localhost:8081/payment/success',
        'http://localhost:8081/payment/failure',
        'http://localhost:8081/payment/cancel',
      ]),
    ).not.toThrow();
    expect(() =>
      assertMayaCertificationReturnUrls([
        'https://attacker.example/success',
        'http://localhost:8081/payment/failure',
        'http://localhost:8081/payment/cancel',
      ]),
    ).toThrow('MAYA_CERTIFICATION_RETURN_URL_NOT_ALLOWED');
  });

  it.each([
    'https://payments-web-sandbox.maya.ph/checkout?id=synthetic',
    'https://payments-web-sandbox.paymaya.com/checkout?id=synthetic',
  ])('accepts the exact official sandbox Checkout origin: %s', (url) => {
    expect(isAllowedMayaSandboxCheckoutUrl(url)).toBe(true);
  });

  it.each([
    'https://payments.maya.ph/production',
    'http://payments-web-sandbox.maya.ph/checkout',
    'https://evil.maya.ph/checkout',
    'https://payments-web-sandbox.maya.ph.attacker.example/checkout',
    'https://payments-web-sandbox.paymaya.com.attacker.example/checkout',
    'https://attacker.example/?next=https://payments-web-sandbox.maya.ph',
    'https://user:password@payments-web-sandbox.maya.ph/checkout',
  ])('rejects non-allowlisted, insecure, lookalike, or credentialed URL: %s', (url) => {
    expect(isAllowedMayaSandboxCheckoutUrl(url)).toBe(false);
  });

  it('allows ordinary path/query data only after exact origin validation', () => {
    expect(
      isAllowedMayaSandboxCheckoutUrl(
        'https://payments-web-sandbox.maya.ph/checkout?checkoutId=synthetic#continue',
      ),
    ).toBe(true);
  });
});
