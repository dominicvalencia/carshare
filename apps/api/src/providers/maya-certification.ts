import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { MayaPaymentProvider, ProviderOperationResult } from '@carrental/payments';

export class MayaCertificationError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'MayaCertificationError';
  }
}

const allowedReturnUrls = [
  'http://localhost:8081/payment/success',
  'http://localhost:8081/payment/failure',
  'http://localhost:8081/payment/cancel',
] as const;

const allowedSandboxCheckoutOrigins = new Set([
  'https://payments-web-sandbox.maya.ph',
  'https://payments-web-sandbox.paymaya.com',
]);

export function isAllowedMayaSandboxCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      allowedSandboxCheckoutOrigins.has(url.origin)
    );
  } catch {
    return false;
  }
}

export function assertMayaCertificationReturnUrls(urls: readonly string[]): void {
  if (
    urls.length !== allowedReturnUrls.length ||
    urls.some((url, index) => url !== allowedReturnUrls[index])
  ) {
    throw new Error('MAYA_CERTIFICATION_RETURN_URL_NOT_ALLOWED');
  }
}

export async function certifyMayaCheckoutOnce(input: {
  readonly provider: Pick<MayaPaymentProvider, 'createCheckout'>;
  readonly markerPath: string;
}): Promise<ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' }> {
  await mkdir(dirname(input.markerPath), { recursive: true });
  let marker;
  try {
    marker = await open(input.markerPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('MAYA_CERTIFICATION_ALREADY_COMPLETED');
    throw error;
  }

  let accepted = false;
  try {
    const result = await input.provider.createCheckout({
      amountMinor: 10_000n,
      currency: 'PHP',
      description: 'CarShare Maya sandbox certification',
      idempotencyKey: createHash('sha256')
        .update('maya-local-checkout-certification')
        .digest('hex'),
      requestReference: 'carshare-local-maya-certification',
    });
    let returnedOrigin: string | undefined;
    try {
      returnedOrigin = result.customerActionUrl
        ? new URL(result.customerActionUrl).origin
        : undefined;
    } catch {
      returnedOrigin = undefined;
    }
    if (
      result.kind !== 'ACTION_REQUIRED' ||
      !result.externalPaymentId ||
      !result.customerActionUrl ||
      !isAllowedMayaSandboxCheckoutUrl(result.customerActionUrl)
    ) {
      throw new MayaCertificationError('MAYA_CERTIFICATION_CHECKOUT_NOT_ACCEPTED', {
        reason:
          result.kind !== 'ACTION_REQUIRED'
            ? 'Provider did not return an actionable Checkout.'
            : !result.externalPaymentId
              ? 'Provider did not return a checkout identifier.'
              : 'Provider returned an unexpected hosted Checkout origin.',
        requestReference: 'carshare-local-maya-certification',
        ...(returnedOrigin ? { returnedOrigin } : {}),
      });
    }
    accepted = true;
    await marker.writeFile(
      JSON.stringify({ provider: 'MAYA', status: result.providerState, completed: true }),
    );
    return result as ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' };
  } finally {
    await marker.close().catch(() => undefined);
    if (!accepted) await unlink(input.markerPath).catch(() => undefined);
  }
}
