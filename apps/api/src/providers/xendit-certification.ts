import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ProviderOperationResult, XenditPaymentProvider } from '@carrental/payments';

const allowedOrigins = new Set(['https://checkout-staging.xendit.co', 'https://dev.xen.to']);
export function isAllowedXenditTestCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && allowedOrigins.has(url.origin)
    );
  } catch {
    return false;
  }
}
export async function certifyXenditSessionOnce(input: {
  readonly provider: Pick<XenditPaymentProvider, 'createSession'>;
  readonly markerPath: string;
}): Promise<ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' }> {
  await mkdir(dirname(input.markerPath), { recursive: true });
  let marker;
  try {
    marker = await open(input.markerPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('XENDIT_CERTIFICATION_ALREADY_COMPLETED');
    throw error;
  }
  let accepted = false;
  try {
    const result = await input.provider.createSession({
      amountMinor: 10_000n,
      currency: 'PHP',
      description: 'CarShare Xendit test certification',
      idempotencyKey: createHash('sha256')
        .update('xendit-local-payment-session-certification')
        .digest('hex'),
      requestReference: 'carshare-local-xendit-certification',
    });
    if (
      result.kind !== 'ACTION_REQUIRED' ||
      !result.externalPaymentId ||
      !result.customerActionUrl ||
      !isAllowedXenditTestCheckoutUrl(result.customerActionUrl)
    )
      throw new Error('XENDIT_CERTIFICATION_SESSION_NOT_ACCEPTED');
    accepted = true;
    await marker.writeFile(
      JSON.stringify({ provider: 'XENDIT', status: result.providerState, completed: true }),
    );
    return result as ProviderOperationResult & { readonly kind: 'ACTION_REQUIRED' };
  } finally {
    await marker.close().catch(() => undefined);
    if (!accepted) await unlink(input.markerPath).catch(() => undefined);
  }
}
